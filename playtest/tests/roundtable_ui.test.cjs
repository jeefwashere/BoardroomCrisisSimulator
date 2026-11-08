/* Real UI handlers with a minimal DOM, without network or paid providers. */
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../static/roundtable.js'),'utf8');
assert(source.includes('async function init()'));
function harness(){
 const nodes=new Map();
 function node(id){if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',children:[],files:[],replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},prepend(...children){this.children.unshift(...children);},querySelectorAll(q){return this.children.flatMap(c=>[...(q==='button'&&c.onclick?[c]:[]),...(c.querySelectorAll?.(q)||[])]);},click(){}});return nodes.get(id);}
 const ctx=vm.createContext({Blob,crypto:webcrypto,console,Date,setInterval(){},setTimeout,clearTimeout,document:{getElementById:node,createElement:()=>node(Symbol())},window:{addEventListener(){}},sessionStorage:{getItem(){return null;},setItem(){}},URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},fetch(){throw Error('Unexpected network request');}});
 const run=s=>vm.runInContext(s,ctx,{timeout:1000});
 run(source.split('async function init()')[0]);
 run(`bundle={code:'DEMO',test:true,seats:[{name:'A',token:'secret'},{name:'B',token:'b'},{name:'C',token:'c'}]};states=[{code:'DEMO',me:'a',host:'a',ceo:'a',phase:'lobby',server_time:100,received:Date.now(),members:[{id:'a',name:'A',role:'ceo',ready:false,connected:true},{id:'b',name:'B',role:'finance',ready:false,connected:true},{id:'c',name:'C',role:'technology',ready:false,connected:true}],can_start:false,start_blockers:['Everyone must be ready'],documents_ready:true,documents:[{id:'doc',title:'Test PDF',pages:2}],transcript:[],summary:{items:[]},decisions:[],jobs:[],suggestions:[]}];render();`);
 return {ctx,run,node};
}
test('phase and CEO controls follow the server snapshot',()=>{
 const {run,node}=harness();assert(node('start').disabled);assert(!node('allReady').disabled);assert(node('commit').disabled);
 run(`states[0].phase='discussion';render();`);assert(!node('record').disabled);assert(!node('commit').disabled);assert(node('facilitate').disabled);
 run(`states[0].phase='opening_facilitator';render();`);assert(!node('facilitate').disabled);assert(!node('skip').disabled);
 run(`states[0].me='b';render();`);assert(node('skip').disabled);
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
