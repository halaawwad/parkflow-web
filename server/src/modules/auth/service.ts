import { createHmac,randomInt,randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { env } from '../../config/env';
import { redis } from '../../database/redis';
import { db,atomic,lock,type Tx } from '../../database/client';
import { emailProvider } from '../../providers/email';
import { z } from 'zod';
import { assert,ApiError,requireValue } from '../../utils/errors';
export const digest=(v:string)=>createHmac('sha256',env.JWT_REFRESH_SECRET).update(v).digest('hex');
export const normalizeEmail=(value:string)=>z.email().max(254).parse(value.trim().toLowerCase());
const REMEMBERED_SESSION_MS=24*60*60*1000;

// Retained rotation records anchor the family to its ORIGINAL OTP login.
// Also caps legacy families without a schema change or trusting a client timestamp.
async function sessionDeadline(tx:Pick<Tx,'refreshToken'>,userId:string,familyId:string){
 const {_min}=await tx.refreshToken.aggregate({where:{userId,familyId},_min:{createdAt:true,expiresAt:true}});
 return _min.createdAt&&_min.expiresAt
  ? new Date(Math.min(_min.createdAt.getTime()+REMEMBERED_SESSION_MS,_min.expiresAt.getTime())):null;
}
export async function requestOtp(input:{email:string}){
 const email=normalizeEmail(input.email);
 const cooldown=`otp:email:cooldown:${email}`;
 assert(await redis.set(cooldown,'1','EX',60,'NX'),'OTP_COOLDOWN','Please wait before requesting another code',429);
 const challengeId=randomUUID(),code=String(randomInt(100000,1000000));
 const key=`otp:email:${challengeId}`;
 await redis.multi().hset(key,{email,hash:digest(challengeId+code),tries:'0'}).expire(key,300).exec();
 try {await emailProvider.sendOtp(email,code);}catch {
  await redis.del(key,cooldown);
  throw new ApiError(503,'EMAIL_DELIVERY_FAILED','Unable to send the verification email. Please try again.');
 }
 return {challengeId,email,resendAfterSeconds:60,expiresAt:new Date(Date.now()+300000).toISOString()};
}
async function issue(tx:Tx,user:User,meta:{device?:string;ip?:string},familyId:string=randomUUID(),deadline?:Date){
 const now=Math.floor(Date.now()/1000);
 const absoluteExpiry=Math.floor((deadline?.getTime()??(Date.now()+REMEMBERED_SESSION_MS))/1000);
 const refreshExpiry=Math.min(absoluteExpiry,now+env.REFRESH_TOKEN_TTL);
 const accessExpiry=Math.min(refreshExpiry,now+env.ACCESS_TOKEN_TTL);
 assert(refreshExpiry>now,'UNAUTHORIZED','Remembered session expired; verify your email again',401);
 const id=randomUUID(),expiresAt=new Date(refreshExpiry*1000);
 const refreshToken=jwt.sign({sub:user.id,jti:id,familyId,kind:'refresh',exp:refreshExpiry},env.JWT_REFRESH_SECRET,{algorithm:'HS256',issuer:'parkflow',audience:'parkflow-refresh'});
 await tx.refreshToken.create({data:{id,userId:user.id,tokenHash:digest(refreshToken),familyId,expiresAt,...meta}});
 return {userId:user.id,accessToken:jwt.sign({sub:user.id,sid:id,kind:'access',exp:accessExpiry},env.JWT_ACCESS_SECRET,{algorithm:'HS256',issuer:'parkflow',audience:'parkflow-api'}),refreshToken,expiresAt:new Date(accessExpiry*1000).toISOString(),rememberedUntil:expiresAt.toISOString()};
}
export async function verifyOtp(input:{challengeId:string;code:string},meta:{device?:string;ip?:string}){
 const result=String(await redis.eval(`
 local h=redis.call('HGET',KEYS[1],'hash')
 if not h then return 'expired' end
 local tries=tonumber(redis.call('HGET',KEYS[1],'tries') or '0')
 if tries>=5 then return 'locked' end
 if h~=ARGV[1] then redis.call('HINCRBY',KEYS[1],'tries',1);return 'invalid' end
 local email=redis.call('HGET',KEYS[1],'email');redis.call('DEL',KEYS[1]);return email
 `,1,`otp:email:${input.challengeId}`,digest(input.challengeId+input.code)));
 assert(result.includes('@'),'OTP_'+result.toUpperCase(),'The code is invalid, expired, or has reached its retry limit',401);
 return atomic(async tx=>{
 await lock(tx,`email:${result}`);
 const existing=await tx.user.findUnique({where:{email:result}});
 assert(!existing || existing.emailVerifiedAt,'EMAIL_MIGRATION_REQUIRED','Contact support to link your existing account to a verified email',409);
 const user=existing?await tx.user.update({where:{id:existing.id},data:{lastLoginAt:new Date(),emailVerifiedAt:new Date()}}):await tx.user.create({data:{email:result,emailVerifiedAt:new Date(),lastLoginAt:new Date(),wallet:{create:{}}}});
 assert(user.status==='ACTIVE','ACCOUNT_SUSPENDED','This account is suspended',403);
 return {session:await issue(tx,user,meta),user,isNewUser:!user.fullName};
 });
}
export async function devLogin(input:{email:string},meta:{device?:string;ip?:string}){
 assert(env.NODE_ENV==='development'&&env.DEV_SKIP_EMAIL_OTP,'DEV_LOGIN_DISABLED','Development login is disabled',403);
 const email=normalizeEmail(input.email);
 return atomic(async tx=>{
  await lock(tx,`email:${email}`);
  const existing=await tx.user.findUnique({where:{email}});
  const user=existing
   ?await tx.user.update({where:{id:existing.id},data:{lastLoginAt:new Date()}})
   :await tx.user.create({data:{email,emailVerifiedAt:new Date(),lastLoginAt:new Date(),wallet:{create:{}}}});
  assert(user.status==='ACTIVE','ACCOUNT_SUSPENDED','This account is suspended',403);
  return {session:await issue(tx,user,meta),user,isNewUser:!user.fullName};
 });
}
export function verifyAccess(token:string){try{
 const v=jwt.verify(token,env.JWT_ACCESS_SECRET,{algorithms:['HS256'],issuer:'parkflow',audience:'parkflow-api'}) as jwt.JwtPayload;
 assert(v.kind==='access'&&typeof v.sub==='string'&&typeof v.sid==='string','UNAUTHORIZED','Invalid token',401);return {userId:v.sub,sid:v.sid,exp:v.exp!};
 }catch{throw new ApiError(401,'UNAUTHORIZED','Invalid or expired access token');}}
export async function authenticate(token:string){const claims=verifyAccess(token);const record=await db.refreshToken.findUnique({where:{id:claims.sid},include:{user:true}});
 assert(record&&!record.revokedAt&&record.expiresAt>new Date()&&record.user.status==='ACTIVE','UNAUTHORIZED','Session has ended',401);
 const deadline=await sessionDeadline(db,record.userId,record.familyId);
 assert(deadline&&deadline.getTime()>Date.now(),'UNAUTHORIZED','Remembered session expired; verify your email again',401);
 return {...claims,role:record.user.role};}
export async function refresh(token:string,meta:{device?:string;ip?:string}){
 try{jwt.verify(token,env.JWT_REFRESH_SECRET,{algorithms:['HS256'],issuer:'parkflow',audience:'parkflow-refresh'});}catch{throw new ApiError(401,'UNAUTHORIZED','Refresh token expired');}
 const result=await atomic(async tx=>{const old=await tx.refreshToken.findUnique({where:{tokenHash:digest(token)},include:{user:true}});
 if(!old)return null;
 await lock(tx,`refresh:${old.familyId}`);
 const current=requireValue(await tx.refreshToken.findUnique({where:{id:old.id}}));
 if(current.revokedAt){await tx.refreshToken.updateMany({where:{familyId:old.familyId,revokedAt:null},data:{revokedAt:new Date()}});return null;}
 const deadline=await sessionDeadline(tx,old.userId,old.familyId);
 if(current.expiresAt.getTime()<=Date.now()||!deadline||deadline.getTime()<=Date.now()||old.user.status!=='ACTIVE')return null;
 const next=await issue(tx,old.user,meta,old.familyId,deadline);
 const nextClaims=jwt.decode(next.refreshToken) as jwt.JwtPayload;
 await tx.refreshToken.update({where:{id:old.id},data:{revokedAt:new Date(),replacedBy:nextClaims.jti}});return next;});
 assert(result,'UNAUTHORIZED','Refresh token was revoked or reused',401);return result;
}
export async function logout(userId:string,sid:string,all=false){return atomic(async tx=>{
 const session=await tx.refreshToken.findUnique({where:{id:sid}});
 if(!session||session.userId!==userId)return;
 await lock(tx,`refresh:${session.familyId}`);
 await tx.refreshToken.updateMany({where:{userId,...(all?{}:{familyId:session.familyId}),revokedAt:null},data:{revokedAt:new Date()}});
});}
