import type { AuthSession } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { AppError,type AppErrorCode } from '@/utils/errors';
import { secureStorage } from '../storage';
import { useApiConnectionStore } from '@/store/apiConnectionStore';
export const API_BASE_URL=process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/,'');
const COLD_START_TIMEOUT_MS=75000, WARM_TIMEOUT_MS=20000, IDLE_MS=5*60000, SLOW_REQUEST_MS=8000;
let lastResponseAt=0;
let refreshing:{token:string;promise:Promise<AuthSession>}|undefined;
interface Options {method?:string;body?:unknown;key?:string;public?:boolean;form?:FormData;retry?:boolean}
const codes:Record<string,AppErrorCode>={UNAUTHORIZED:'unauthorized',NOT_FOUND:'not_found',INSUFFICIENT_FUNDS:'insufficient_funds',PAYMENT_FAILED:'payment_failed',VALIDATION:'validation'};
export function sessionRefreshDelay(session:AuthSession):number{
 // The final access token already ends at the absolute deadline. Wait for that
 // boundary instead of rotating once per second in its last 30 seconds.
 const finalToken=session.rememberedUntil&&Date.parse(session.expiresAt)>=Date.parse(session.rememberedUntil);
 return Math.max(0,Date.parse(session.expiresAt)-Date.now()-(finalToken?0:30000));
}
export async function refreshSession():Promise<AuthSession>{
 const previous=useAuthStore.getState().session;
 if(!previous)throw new AppError('unauthorized','Sign in to continue');
 if(refreshing?.token===previous.refreshToken)return refreshing.promise;
 const promise=(async()=>{try{
 const next=await api<AuthSession>('/auth/refresh',{method:'POST',body:{refreshToken:previous.refreshToken},public:true});
 const state=useAuthStore.getState();
 if(state.session?.refreshToken!==previous.refreshToken)throw new AppError('network','Session changed while reconnecting');
 if(!next||next.userId!==previous.userId||typeof next.accessToken!=='string'||!next.accessToken
   ||typeof next.refreshToken!=='string'||!next.refreshToken||!Number.isFinite(Date.parse(next.expiresAt))
   ||next.rememberedUntil!==undefined&&(!Number.isFinite(Date.parse(next.rememberedUntil))
      ||Date.parse(next.expiresAt)>Date.parse(next.rememberedUntil)
      ||previous.rememberedUntil!==undefined&&Date.parse(next.rememberedUntil)>Date.parse(previous.rememberedUntil))
   ||Date.parse(next.expiresAt)<=Date.now()||!state.user)throw new AppError('network','Invalid session response');
 await state.signIn(next,state.user);return next;
 }catch(e){
  // A delayed refresh belonging to an old login must never sign out a newer login.
  if(e instanceof AppError&&e.code==='unauthorized'&&e.details?.status===401
    &&e.details?.serverCode==='UNAUTHORIZED'
    &&useAuthStore.getState().session?.refreshToken===previous.refreshToken){
   await useAuthStore.getState().signOut();
  }
  throw e;
 }finally{if(refreshing?.token===previous.refreshToken)refreshing=undefined;}})();
 refreshing={token:previous.refreshToken,promise};
 return promise;
}
export async function api<T>(path:string,options:Options={}):Promise<T>{
 if(!API_BASE_URL)throw new AppError('network','Set EXPO_PUBLIC_API_BASE_URL to your ParkFlow backend URL.');
 let session=useAuthStore.getState().session;
 if(!options.public&&session&&sessionRefreshDelay(session)<=0){session=await refreshSession();}
 const controller=new AbortController();
 const timeoutMs=path==='/auth/refresh'||Date.now()-lastResponseAt>=IDLE_MS?COLD_START_TIMEOUT_MS:WARM_TIMEOUT_MS;
 const timeout=setTimeout(()=>controller.abort(),timeoutMs);
 let shownSlow=false;
 const slow=setTimeout(()=>{shownSlow=true;useApiConnectionStore.setState(s=>({slowRequests:s.slowRequests+1}));},SLOW_REQUEST_MS);
 let response:Response;
 let data:unknown;
 try{
  response=await fetch(API_BASE_URL+path,{method:options.method??'GET',headers:{...(!options.form?{'Content-Type':'application/json'}:{}),...(!options.public&&session?{Authorization:`Bearer ${session.accessToken}`} :{}),...(options.key?{'Idempotency-Key':options.key}:{})},body:options.form??(options.body===undefined?undefined:JSON.stringify(options.body)),signal:controller.signal});
  data=await response.json();
 }catch{throw new AppError('network','Could not reach the ParkFlow backend. Please try again; your session is preserved');}
 finally{clearTimeout(timeout);clearTimeout(slow);if(shownSlow)useApiConnectionStore.setState(s=>({slowRequests:Math.max(0,s.slowRequests-1)}));}
 if(!options.public&&session&&useAuthStore.getState().session?.userId!==session.userId)throw new AppError('network','Session changed while reconnecting');
 const error=data&&typeof data==='object'&&'error' in data?data.error as {code?:string;message?:string;details?:Record<string,unknown>}|null:undefined;
 const confirmedUnauthorized=response.status===401&&error?.code==='UNAUTHORIZED';
 if(confirmedUnauthorized&&!options.public&&session){
  if(options.retry!==false){
   // Another request may already have rotated this session while this one was in flight.
   if(useAuthStore.getState().session?.refreshToken===session.refreshToken)await refreshSession();
   return api<T>(path,{...options,retry:false});
  }
  if(useAuthStore.getState().session?.refreshToken===session.refreshToken)await useAuthStore.getState().signOut();
 }
 if(response.status>=500||response.status===408||response.status===401&&!error?.code
    ||response.ok&&(path==='/auth/me'||path==='/users/me')&&(!data||typeof data!=='object'
      ||!('id' in data)||typeof data.id!=='string'||!('fullName' in data)||typeof data.fullName!=='string'
      ||!options.public&&session&&data.id!==session.userId))throw new AppError('network','The server is temporarily unavailable. Please try again',{status:response.status});
 if(!response.ok||error){const code=error?.code??'UNKNOWN';throw new AppError(code==='UNAUTHORIZED'&&!confirmedUnauthorized?'unknown':codes[code]??(response.status===409?'conflict':response.status===400?'validation':'unknown'),error?.message??'The request failed',{...error?.details,serverCode:code,status:response.status});}
 lastResponseAt=Date.now();
 return data as T;
}
export function query(params:Record<string,unknown>){const entries=Object.entries(params).filter(([,v])=>v!==undefined&&v!==null);return entries.length?'?'+entries.map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&'):'';}
export const segment=(s:string)=>encodeURIComponent(s);
// Persist only a request key, never authoritative business state. Retries after app restarts
// reuse the same key if the previous response was lost.
const pending=new Map<string,Promise<unknown>>();
export function mutation<T>(path:string,body:unknown={}):Promise<T>{
 const scope=(useAuthStore.getState().session?.userId??'anonymous')+path+JSON.stringify(body);
 const existing=pending.get(scope);if(existing)return existing as Promise<T>;
 const storageKey='pf_request_'+Array.from(scope).map(c=>c.charCodeAt(0).toString(16)).join('_');
 const request=(async()=>{let key=await secureStorage.getItem(storageKey);if(!key){key=`request-${Date.now()}-${Math.random().toString(36).slice(2)}`;await secureStorage.setItem(storageKey,key);}try{const result=await api<T>(path,{method:'POST',body,key});await secureStorage.removeItem(storageKey);return result;}catch(e){if(e instanceof AppError&&e.code!=='network'&&Number(e.details?.status??500)<500)await secureStorage.removeItem(storageKey);throw e;}finally{pending.delete(scope);}})();
 pending.set(scope,request);return request;
}
