/** Explicit, additive candidate import. Never called by application startup or seed. */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
const db=new PrismaClient();
const record=z.object({id:z.string().min(1),nameAr:z.string(),nameEn:z.string(),type:z.enum(['checkpoint','road_gate']),latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional(),source:z.record(z.string(),z.unknown())});
const schema=z.object({schemaVersion:z.literal(1),retrievedAt:z.string(),source:z.record(z.string(),z.unknown()),checkpoints:z.array(record),missingLocations:z.array(z.unknown()).optional()});
// Known existing catalog identities; a nearby gate must not merge into a checkpoint.
const aliases:Record<string,string>={'geomolg-checkpoints-160':'cp_qalandia','geomolg-checkpoints-199':'cp_atara','geomolg-checkpoints-173':'cp_beitel'};
const normalized=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
async function main(){
 const path=process.argv[2];if(!path)throw new Error('Provide the candidate JSON path');
 const data=schema.parse(JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,'')));
 for(const c of data.checkpoints){
  if(c.latitude==null || c.longitude==null){console.log(`Skipped missing coordinates: ${c.id}`);continue;}
  await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('checkpoint-candidate-import',0))`;
   const all=await tx.roadCheckpoint.findMany();
   const sourceKey=c.source.featureUrl;
   const matches=all.filter(r=>r.id===c.id || r.id===aliases[c.id] || (Array.isArray(r.sourceReferences)&&r.sourceReferences.some(x=>!!x && typeof x==='object' && !Array.isArray(x) && (x.candidateId===c.id || sourceKey && x.source && typeof x.source==='object' && !Array.isArray(x.source) && x.source.featureUrl===sourceKey))) || (r.kind===c.type && (normalized(r.nameAr)===normalized(c.nameAr) || normalized(r.nameEn)===normalized(c.nameEn))));
   if(matches.length===0 && all.some(r=>r.kind===c.type && Math.hypot(r.latitude-c.latitude!,r.longitude-c.longitude!)<0.0008)){console.log(`Nearby identity uncertain; review manually: ${c.id}`);return;}
   if(matches.length>1){console.log(`Ambiguous; review manually: ${c.id}`);return;}
   const reference={candidateId:c.id,candidateKind:c.type,retrievedAt:data.retrievedAt,source:c.source,datasetSource:data.source,candidateCoordinates:{latitude:c.latitude,longitude:c.longitude},requiresReview:true};
   const existing=matches[0];
   if(existing){
    const refs=Array.isArray(existing.sourceReferences)?existing.sourceReferences:[];
    if(!refs.some(x=>!!x && typeof x==='object' && !Array.isArray(x) && (x.candidateId===c.id || sourceKey && x.source && typeof x.source==='object' && !Array.isArray(x.source) && x.source.featureUrl===sourceKey))) {
     await tx.roadCheckpoint.update({where:{id:existing.id},data:{sourceReferences:JSON.parse(JSON.stringify([...refs,reference])) as Prisma.InputJsonValue}});
    }
    console.log(`Reused without changing coordinates or activation: ${existing.id}`);return;
   }
   await tx.roadCheckpoint.create({data:{id:c.id,nameAr:c.nameAr,nameEn:c.nameEn,latitude:c.latitude!,longitude:c.longitude!,kind:c.type,active:true,enabledForLiveReporting:false,directions:[],sourceReferences:JSON.parse(JSON.stringify([reference])) as Prisma.InputJsonValue}});
   console.log(`Created inactive candidate: ${c.id}`);
  },{isolationLevel:'Serializable'});
 }
 console.log(`Excluded ${(data.missingLocations??[]).length} missing-location entries; no coordinates were invented.`);
}
void main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
