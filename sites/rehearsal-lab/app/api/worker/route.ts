import {workerAuth,reply,body,db,END} from '@/lib/lab';
export async function POST(r:Request){if(!await workerAuth(r))return reply({error:'Unauthorized'},401);try{const b=await body(r),now=Date.now();
 if(b.action==='complete'){if(!b.id||!b.lease)return reply({error:'Invalid completion'},400);const result=JSON.stringify(b.result??null);if(result.length>16000)return reply({error:'Result too large'},400);await db().prepare("UPDATE jobs SET status=?,result=?,error=?,finished=? WHERE id=? AND lease=? AND status='running'").bind(b.error?'failed':'done',result,b.error?'Inference failed; retry with a new request.':null,now,b.id,b.lease).run();return reply({ok:true});}
 if(!['heartbeat','claim'].includes(b.action))return reply({error:'Unknown operation'},400);
 await db().prepare("INSERT INTO workers(id,seen) VALUES('gpu20031',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen").bind(now).run();
 await db().prepare("UPDATE jobs SET status='failed',error='Worker timed out. Submit a new request.',finished=? WHERE status='running' AND started<?").bind(now,now-300000).run();
 if(now>=END){await db().prepare("UPDATE jobs SET status='failed',error='GPU allocation ended',finished=? WHERE status='queued'").bind(now).run();return reply({stop:true});}
 if(b.action==='heartbeat')return reply({ok:true});
 const job=await db().prepare("UPDATE jobs SET status='running',started=?,lease=? WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created LIMIT 1) AND NOT EXISTS(SELECT 1 FROM jobs WHERE status='running') RETURNING id,model,prompt,lease").bind(now,crypto.randomUUID()).first();return reply({job});
 }catch{return reply({error:'Invalid worker request'},400);}}
