/* Real UI handlers with a minimal DOM, without network or paid providers. */
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../static/roundtable.js'),'utf8');
assert(source.includes('async function init()'));
function harness(){
 const nodes=new Map();
 function node(id){if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',children:[],files:[],pause(){},removeAttribute(name){delete this[name];},play(){return Promise.resolve();},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},prepend(...children){this.children.unshift(...children);},querySelectorAll(q){return this.children.flatMap(c=>[...(q==='button'&&c.onclick?[c]:[]),...(c.querySelectorAll?.(q)||[])]);},click(){}});return nodes.get(id);}
 const ctx=vm.createContext({Blob,AbortController,crypto:webcrypto,console,Date,setInterval(){},setTimeout,clearTimeout,document:{getElementById:node,createElement:()=>node(Symbol())},window:{addEventListener(){}},sessionStorage:{getItem(){return null;},setItem(){}},URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},fetch(){throw Error('Unexpected network request');}});
 const run=s=>vm.runInContext(s,ctx,{timeout:1000});
 run(source.split('async function init()')[0]);
 run(`bundle={code:'DEMO',test:true,seats:[{name:'A',token:'secret'},{name:'B',token:'b'},{name:'C',token:'c'}]};states=[{code:'DEMO',me:'a',host:'a',ceo:'a',phase:'lobby',speaker:'a',speaking:['a','b','c'],turn_number:1,server_time:100,received:Date.now(),members:[{id:'a',name:'A',role:'ceo',ready:false,connected:true},{id:'b',name:'B',role:'finance',ready:false,connected:true},{id:'c',name:'C',role:'technology',ready:false,connected:true}],can_start:false,start_blockers:['Everyone must be ready'],documents_ready:true,documents:[{id:'doc',title:'Test PDF',pages:2}],transcript:[],summary:{items:[]},decisions:[],jobs:[],suggestions:[]}];render();`);
 return {ctx,run,node};
}
test('phase and CEO controls follow the server snapshot',()=>{
 const {run,node}=harness();assert(node('start').disabled);assert(!node('allReady').disabled);assert(node('commit').disabled);
 run(`states[0].phase='discussion';render();`);assert(!node('record').disabled);assert(!node('commit').disabled);assert(!node('facilitate').disabled);
 run(`states[0].phase='preparation';render();`);assert(node('facilitate').disabled);assert(node('commit').disabled);
 run(`states[0].phase='discussion';states[0].me='b';render();`);assert(node('facilitate').disabled);assert(node('commit').disabled);assert(node('record').disabled);
 run(`states[0].phase='decision';states[0].me='a';render();`);assert(!node('facilitate').disabled);
});
test('pending decisions block ending and positive ties expose explicit CEO choices',()=>{
 const {run,node}=harness();run(`states[0].phase='decision';states[0].decisions=[{id:'d1',problem:'Problem',proposal:'Act',status:'pending',ballot_count:3,tally:{approve:1,reject:1,abstain:1}}];render();`);
 assert(node('end').disabled);const labels=node('decisions').children[0].children.at(-1).children.map(c=>c.textContent);assert(labels.includes('CEO tie: approve'));assert(labels.includes('CEO tie: reject'));
 run(`states[0].decisions[0].status='approved';render();`);assert(!node('end').disabled);
});
test('late transcription keeps captured auth and cannot replace a new room editor',async()=>{
 const {ctx,run,node}=harness();let release,auth;ctx.fetch=(_,options)=>{auth=options.headers.Authorization;return new Promise(r=>release=r);};
 run(`states[0].phase='discussion';clip=new Blob(['wav']);clipOwner=context();$('message').value='keep';health=async()=>{};`);
 const pending=run(`$('transcribe').onclick()`);assert(run('busy'));assert(node('join').disabled);
 run(`bundle={code:'NEW',seats:[{token:'new'}]};`);release({ok:true,json:async()=>({text:'stale text'})});await pending;
 assert.equal(auth,'Bearer secret');assert.equal(node('message').value,'keep');assert.equal(run('source'),'typed');
});
test('partial summary coverage is visible and does not hide the transcript',()=>{
 const {run,node}=harness();run(`states[0].transcript=[{id:'e1',member:'a',text:'First contribution',source:'typed'}];states[0].summary={items:[{source_ids:['e1'],text:'First contribution',speaker:'A'}],partial:true};render();`);
 assert(node('summary').children[0].textContent.includes('Partial coverage'));assert.equal(node('transcript').children.length,1);
});

test('recorded playback finishes before a separate trusted caption commit',async()=>{
 const {run,node,ctx}=harness();const calls=[];
 ctx.fetch=async(url,options)=>{calls.push({url,auth:options.headers.Authorization,body:options.body});return {ok:true,json:async()=>({id:'lease'}),blob:async()=>new Blob(['fixed audio'])};};
 run(`states[0].phase='discussion';recordings=[{id:'fixed',seat_index:0,available:true,text:'Known caption'}];refresh=async()=>{};`);
 const pending=run('playRecordedTurn()');await new Promise(resolve=>setImmediate(resolve));
 assert(!calls.some(c=>c.url.endsWith('/complete')));node('recordedAudio').onended();assert.equal(await pending,true);
 assert(run('completedPlayback!==null'));assert(!calls.some(c=>c.url.endsWith('/complete')));
 await run('commitRecordedTurn()');assert.equal(calls.filter(c=>c.url.endsWith('/complete')).length,1);assert(calls.every(c=>c.auth==='Bearer secret'));
 assert(!calls.some(c=>c.url.includes('transcribe')||c.url.includes('/briefing')));
});
test('stopped pending recording cannot play or commit in a replacement room',async()=>{
 const {run,ctx}=harness();let resolveLease;const calls=[];
 ctx.fetch=(url,options)=>{calls.push({url,auth:options.headers.Authorization});if(url.endsWith('/play'))return new Promise(resolve=>resolveLease=resolve);return Promise.resolve({ok:true,json:async()=>({ok:true})});};
 run(`states[0].phase='discussion';recordings=[{id:'fixed',seat_index:0,available:true}];`);
 const pending=run('playRecordedTurn()');await run('stopTurnPlayback()');run(`bundle={code:'NEW',seats:[{token:'new'}]};`);
 resolveLease({ok:true,json:async()=>({id:'old-lease'})});assert.equal(await pending,false);
 assert(!calls.some(c=>c.url.includes('/audio/')||c.url.endsWith('/complete')));const stop=calls.find(c=>c.url.endsWith('/stop'));assert.equal(stop.auth,'Bearer secret');
});
test('decision and evaluation auto streams are marked before requests and never auto retry errors',async()=>{
 const {run,ctx}=harness();ctx.requests=[];
 run(`states[0].phase='decision';startPreparation=async(mode,kind,extra,owner)=>{requests.push({mode,kind,extra,token:owner.token});throw new Error('Provider unavailable');};`);
 await run('automaticAgents()');await run('automaticAgents()');assert.equal(ctx.requests.length,1);assert.equal(ctx.requests[0].kind,'decision');
 run(`states[0].decisions=[{id:'d1',status:'approved'}];`);await run('automaticAgents()');await run('automaticAgents()');assert.equal(ctx.requests.length,2);assert.equal(ctx.requests[1].kind,'evaluation');assert.equal(ctx.requests[1].extra.decision_id,'d1');assert.equal(ctx.requests[1].token,'secret');
});

test('each participant has manual turn controls and only the current speaker can play',async()=>{
 const {run,node,ctx}=harness();ctx.plays=[];
 run(`states[0].phase='discussion';states[0].speaker='b';states=[states[0],{...states[0],me:'b'},{...states[0],me:'c'}];recordings=[0,1,2].map(i=>({id:'clip'+i,seat_index:i,available:true,title:'Participant '+i}));playRecordedTurn=async()=>{plays.push(context().token);};render();`);
 const cards=node('seats').children;assert.equal(cards.length,3);
 const buttons=cards.map(card=>card.children.find(c=>c.className==='actions').children);
 assert(buttons[0][0].disabled);assert(!buttons[1][0].disabled);assert(buttons[2][0].disabled);assert.equal(cards[1].children[1].textContent,'SPEAKING NOW');
 assert.equal(ctx.plays.length,0);await buttons[1][0].onclick();assert.equal(ctx.plays.length,1);assert.equal(ctx.plays[0],'b');assert.equal(run('active'),1);
 assert(!source.includes('autoTurns'));assert(!fs.readFileSync(path.join(__dirname,'../static/roundtable.html'),'utf8').includes('id="autoTurns"'));
});
test('unlimited health displays tracking without a false zero balance',async()=>{
 const {run,node,ctx}=harness();ctx.fetch=async()=>({ok:true,json:async()=>({models:{model:'gemini',thinking_level:'LOW',budget:{unlimited:true,remaining_usd:null}},speech:{unlimited:true,remaining:null}})});
 await run('health()');assert.equal(node('budget').textContent,'Usage tracking only · no app spending cap');assert(!node('budget').textContent.includes('$0'));
});
