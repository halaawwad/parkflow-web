import { Queue } from 'bullmq';
import { redisConnection } from '../database/redis';
// Frequent scheduler jobs must not retain an unbounded terminal history in shared Redis.
export const maintenanceQueue=new Queue('parkflow-maintenance',{connection:redisConnection(),defaultJobOptions:{removeOnComplete:{age:3600,count:100},removeOnFail:{age:86400,count:100}}});
export const pushQueue=new Queue('parkflow-push',{connection:redisConnection(),defaultJobOptions:{attempts:8,backoff:{type:'exponential',delay:5000},removeOnComplete:1000,removeOnFail:1000}});
