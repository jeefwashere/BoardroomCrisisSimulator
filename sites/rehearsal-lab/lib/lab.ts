import {env} from 'cloudflare:workers';
export const END=Date.parse('2026-11-08T15:46:25Z');
export const MODELS=[{id:'lfm3',name:'LFM3-1.7B',role:'Conversation · tool responses',ready:true},{id:'gliner-base',name:'GLiNER2.5 Base',role:'Entity extraction · classification',ready:true},{id:'minicpm',name:'MiniCPM5-2B',role:'Reasoning · scenario questions',ready:false},{id:'nemotron',name:'Nemotron 3.5 Bolt E4B',role:'Conversational characters',ready:false},{id:'granite',name:'Granite 4.2 3B',role:'Document-grounded responses',ready:false},{id:'gliner-small',name:'GLiNER2.5 Small',role:'Compact extraction',ready:false},{id:'decide',name:'GLiNER2.5 Decide',role:'Contribution classification',ready:false},{id:'d1',name:'Liquid d1-2B',role:'Decision queries',ready:false},{id:'nuextract',name:'NuExtract3',role:'Document extraction',ready:false}];
export const settings=()=>env as unknown as {DB:D1Database;MEMBER_EMAILS:string;WORKER_TOKEN:string;APPLICATION_KEY_HASH:string};
export const db=()=>settings().DB;
export const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function identity(r:Request){
 const id=r.headers.get('oai-authenticated-user-id'),email=r.headers.get('oai-authenticated-user-email')?.toLowerCase();
 if(id&&email&&settings().MEMBER_EMAILS?.split(',').includes(email))return 'user:'+id;
 const key=r.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(key&&settings().APPLICATION_KEY_HASH&&await hash(key)===settings().APPLICATION_KEY_HASH)return 'application:boardroom';
 return null;
}
export function sameOrigin(r:Request){const o=r.headers.get('Origin');return !o||o===new URL(r.url).origin;}
export async function body(r:Request){const s=await r.text();if(s.length>20000)throw Error('Request too large');return JSON.parse(s);}
export async function workerAuth(r:Request){const value=r.headers.get('Authorization')||'';return !!settings().WORKER_TOKEN&&await hash(value)===await hash('Bearer '+settings().WORKER_TOKEN);}
export async function online(){const w=await db().prepare('SELECT MAX(seen) AS seen FROM workers').first<{seen:number}>();return Date.now()<END&&!!w?.seen&&Date.now()-w.seen<60000;}
