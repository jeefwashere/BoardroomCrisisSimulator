/* Browser-independent media boundary regressions. No network, provider calls or DOM rendering. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const source=fs.readFileSync(path.join(__dirname,'../static/audio-lab.js'),'utf8');
// Keep real handlers and media logic; omit startup polling and network initialization.
assert(source.includes('async function init()'));
const code=source.split('async function init()')[0];

function harness(t){
 const nodes=new Map(),metrics={blobCreations:0,plays:0};
 function node(id){
  if(!nodes.has(id))nodes.set(id,{
   textContent:'',value:'',hidden:false,disabled:false,
   replaceChildren(){},append(){},pause(){},removeAttribute(name){delete this[name];},
   play(){assert(this.src,'Audio source must exist before playback starts');metrics.plays++;
    setTimeout(()=>this.onended(),5);return Promise.resolve();},
  });
  return nodes.get(id);
 }
 const context=vm.createContext({
  assert,Blob,console,performance,crypto:webcrypto,setTimeout,clearTimeout,setInterval(){},
  document:{getElementById:node,createElement:()=>node(Symbol())},
  window:{addEventListener(){}},
  sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
  URL:{createObjectURL(){metrics.blobCreations++;return 'blob:fixture';},revokeObjectURL(){}},
  fetch(){throw new Error('Unexpected network call');},
 });
 const run=text=>vm.runInContext(text,context,{timeout:1000});
 run(code);
 run(`render=()=>{};renderLibrary=()=>{};health=async()=>{};
  bundle={code:'OLD',seats:[{token:'old-token'}],activity:[],done:[],demo:false};
  states=[{self:'member',round:1,phase:'discussion',server_time:100,speaker:'member',electorate:['member']}];
  catalog=[{id:'discussion_owner',available:true,text:'Fixture text',role:'Board member'}];
  selectedId='discussion_owner';`);
 t.after(()=>run('cancelAudio(false)'));
 return {run,context,nodes,metrics};
}

function response(data){return {ok:true,json:async()=>data,blob:async()=>({fixture:true})};}

function newRoomInContext(h){
 h.run(`bundle={code:'NEW',seats:[{token:'new-token'}],activity:[],done:[],demo:false};`);
}

test('audio is fetched and installed before playback, then reports completion', {timeout:3000}, async t=>{
 const h=harness(t),calls=[];
 h.context.fetch=async(url,options)=>{
  calls.push({url,auth:options.headers.Authorization});
  await new Promise(resolve=>setTimeout(resolve,2));
  return response(url==='/api/recordings/play'?{id:'lease',captions:'Fixture text',expires:110}:{});
 };
 assert.equal(await h.run("playClip('discussion_owner')"),true);
 assert.equal(h.metrics.plays,1);
 assert.equal(h.run("bundle.activity.filter(x=>x.type==='clip_finished').length"),1);
 assert(calls.some(c=>c.url==='/api/audio/lease'));
 assert(calls.every(c=>c.auth==='Bearer old-token'));
 assert(!calls.some(c=>c.url.startsWith('/api/agent/')||c.url.includes('transcribe')));
});

test('interrupted recorded demo never commits a contribution or finishes a turn', async t=>{
 const h=harness(t),commands=[];
 h.run('bundle.demo=true;playClip=async()=>false;');
 h.context.fetch=async(url)=>{
  if(url.startsWith('/api/command/'))commands.push(url);
  return response({phase:'discussion',round:1,speaker:'member'});
 };
 await h.run('automate()');
 assert.deepEqual(commands,[]);
 assert.equal(h.run("bundle.done.includes('clip-0')"),true);
 assert.equal(h.run("bundle.activity.some(x=>x.type==='script_committed')"),false);
});

test('pending transcription blocks room creation and discards an old-room result', async t=>{
 const h=harness(t);let resolveResponse,auth;
 h.context.fetch=(url,options)=>{
  assert.equal(url,'/api/recordings/transcribe');auth=options.headers.Authorization;
  return new Promise(resolve=>{resolveResponse=resolve;});
 };
 h.run("$('message').value='New room editor text';");
 const pending=h.run('transcribe(true)');
 assert.equal(h.run('mediaBusy'),true);
 await assert.rejects(h.run('newRoom()'),/media request/);
 newRoomInContext(h);
 resolveResponse(response({text:'Old room transcript'}));
 await pending;
 assert.equal(auth,'Bearer old-token');
 assert.equal(h.nodes.get('message').value,'New room editor text');
 assert.equal(h.run('bundle.activity.length'),0);
 assert.equal(h.run('source'),'typed');
});

test('stale audio is not installed and its lease cleanup uses captured authentication', async t=>{
 const h=harness(t);let resolveAudio;const calls=[];
 h.context.fetch=(url,options)=>{
  calls.push({url,auth:options.headers.Authorization,body:options.body});
  if(url==='/api/audio/old-lease')return new Promise(resolve=>{resolveAudio=resolve;});
  return Promise.resolve(response({}));
 };
 const pending=h.run("setupAudio({id:'old-lease',expires:110},captureSeat())");
 newRoomInContext(h);
 resolveAudio(response({}));
 assert.equal(await pending,null);
 assert.equal(h.metrics.blobCreations,0);
 assert.equal(h.run('audioId'),null);
 const cleanup=calls.find(c=>c.url==='/api/speech/stop');
 assert(cleanup);
 assert.equal(cleanup.auth,'Bearer old-token');
 assert.deepEqual(JSON.parse(cleanup.body),{id:'old-lease'});
 assert.equal(h.run('bundle.activity.length'),0);
});
