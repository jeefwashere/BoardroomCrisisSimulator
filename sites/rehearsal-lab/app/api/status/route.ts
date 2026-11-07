import {identity,reply,online,MODELS,END,db} from '@/lib/lab';
export async function GET(r:Request){if(!await identity(r))return reply({error:'Unauthorized'},401);const q=await db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").first();return reply({online:await online(),ends:new Date(END).toISOString(),models:MODELS,queued:q?.n||0});}
