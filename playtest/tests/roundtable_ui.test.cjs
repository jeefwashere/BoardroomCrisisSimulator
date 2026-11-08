/* Real UI handlers with a minimal DOM, without network or paid providers. */
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../static/roundtable.js'),'utf8');
assert(source.includes('async function init()'));
function harness(exercise=false){
 const nodes=new Map();
 function node(id){if(!nodes.has(id)&&typeof id==='string'){const existing=[...nodes.values()].find(n=>n.id===id);if(existing)return existing;}if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',children:[],files:[],pause(){},removeAttribute(name){delete this[name];},play(){return Promise.resolve();},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},prepend(...children){this.children.unshift(...children);},querySelectorAll(q){return this.children.flatMap(c=>[...(q==='button'&&c.onclick?[c]:[]),...(c.querySelectorAll?.(q)||[])]);},click(){}});return nodes.get(id);}
 const ctx=vm.createContext({Blob,AbortController,crypto:webcrypto,console,Date,setInterval(){},setTimeout,clearTimeout,document:{getElementById:node,createElement:()=>node(Symbol())},window:{addEventListener(){}},sessionStorage:{getItem(){return null;},setItem(){}},URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},fetch(){throw Error('Unexpected network request');}});
 const run=s=>vm.runInContext(s,ctx,{timeout:1000});
 run(source.split('async function init()')[0]);
 if(exercise)run(fs.readFileSync(path.join(__dirname,'../static/four-round-ui.js'),'utf8'));
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
 run(`states[0].phase='discussion';recordings=[{id:'fixed',turn_number:1,seat_index:0,available:true,text:'Known caption'}];refresh=async()=>{};`);
 const pending=run('playRecordedTurn()');await new Promise(resolve=>setImmediate(resolve));
 assert(!calls.some(c=>c.url.endsWith('/complete')));node('recordedAudio').onended();assert.equal(await pending,true);
 assert(run('completedPlayback!==null'));assert(!calls.some(c=>c.url.endsWith('/complete')));
 await run('commitRecordedTurn()');assert.equal(calls.filter(c=>c.url.endsWith('/complete')).length,1);assert(calls.every(c=>c.auth==='Bearer secret'));
 assert(!calls.some(c=>c.url.includes('transcribe')||c.url.includes('/briefing')));
});
test('stopped pending recording cannot play or commit in a replacement room',async()=>{
 const {run,ctx}=harness();let resolveLease;const calls=[];
 ctx.fetch=(url,options)=>{calls.push({url,auth:options.headers.Authorization});if(url.endsWith('/play'))return new Promise(resolve=>resolveLease=resolve);return Promise.resolve({ok:true,json:async()=>({ok:true})});};
 run(`states[0].phase='discussion';recordings=[{id:'fixed',turn_number:1,seat_index:0,available:true}];`);
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
 run(`states[0].phase='discussion';states[0].speaker='b';states[0].turn_number=2;states=[states[0],{...states[0],me:'b'},{...states[0],me:'c'}];recordings=[0,1,2].map(i=>({id:'clip'+i,turn_number:i+1,seat_index:i,available:true,title:'Participant '+i}));playRecordedTurn=async()=>{plays.push(context().token);};render();`);
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

function fixedFixture(run){run(`states[0].phase='decision';states[0].fixed_scenario='T01';states[0].decisions=[{id:'t01_response',mode:'fixed_choice',ballot_version:1,problem:'Choose a response',status:'pending',ballot_count:1,voted_members:['a'],my_vote:'controlled_continuity',options:[{id:'controlled_continuity',label:'Controlled continuity',proposal:'Coordinate and verify'},{id:'technical_first',label:'Technical checks first',proposal:'Prioritize technical checks'},{id:'wait_for_director',label:'Wait for director',proposal:'Defer until contact'}]}];render();`);}
test('consultation has a visible minute timer and CEO can finish it early',()=>{
 const {run,node}=harness();run(`states[0].phase='consultation';states[0].deadline=160;states[0].received=Date.now();render();`);
 assert.equal(node('phase').textContent,'One minute with live advisers');assert.equal(node('timer').textContent,'01:00');assert.equal(node('consultationNotice').hidden,false);assert(!node('skipConsultation').disabled);assert(!node('facilitate').disabled);
 run(`states[0].me='b';render();`);assert(node('skipConsultation').disabled);assert(node('facilitate').disabled);
});
test('fixed ballot hides custom forms and sends explicit option votes with voter status',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];run(`command=async(action,data)=>commands.push({action,data});`);
 assert(node('customDecision').hidden);const decision=node('decisions').children[0],options=decision.children.find(c=>c.className==='fixed-options');assert.equal(options.children.length,3);
 assert(decision.children.find(c=>c.className==='voter-status').children[0].textContent.includes('voted'));
 await options.children[1].children.at(-1).onclick();assert.equal(ctx.commands.length,0);
 await node('decisions').children[0].children.find(c=>c.className==='vote-confirmation').children.at(-1).onclick();assert.equal(ctx.commands[0].action,'vote_option');assert.equal(ctx.commands[0].data.option_id,'technical_first');
 const buttons=decision.children.at(-1).children;assert(buttons[0].disabled);assert(!decision.children.some(c=>c.textContent==='approve'));
});
test('fixed option ties offer only tied leaders to the CEO',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];run(`command=async(action,data)=>commands.push({action,data});states[0].decisions[0].ballot_count=3;states[0].decisions[0].tally={controlled_continuity:1,technical_first:1,wait_for_director:1};render();`);
 const actions=node('decisions').children[0].children.at(-1).children.filter(c=>c.onclick);assert.equal(actions.length,3);await actions[1].onclick();assert.equal(ctx.commands[0].action,'commit_decision');assert.equal(ctx.commands[0].data.option_id,'technical_first');
});
test('fixed decision automatically uses the recorded guide once then live evaluation',async()=>{
 const {run,ctx}=harness();fixedFixture(run);ctx.guides=[];ctx.generated=[];
 run(`playDecisionGuide=async owner=>guides.push(owner.token);startPreparation=async(mode,kind,extra)=>generated.push({kind,extra});`);
 await run('automaticAgents()');await run('automaticAgents()');assert.equal(ctx.guides.length,1);assert.equal(ctx.generated.length,0);
 run(`states[0].decisions[0].status='approved';states[0].decisions[0].option_id='technical_first';`);await run('automaticAgents()');assert.equal(ctx.generated.length,1);assert.equal(ctx.generated[0].kind,'evaluation');assert.equal(ctx.generated[0].extra.decision_id,'t01_response');
});
test('recorded decision guide respects text only and makes no speech or vote call',async()=>{
 const {run,ctx,node}=harness();fixedFixture(run);const calls=[];ctx.fetch=async(url)=>{calls.push(url);return {ok:true,json:async()=>({decision_id:'t01_response',text:'Read the three responses.',audio_url:'/api/roundtable/decision-prompt/audio'})};};
 assert.equal(await run('playDecisionGuide()'),true);assert.equal(node('decisionGuideText').textContent,'Read the three responses.');assert.deepEqual(calls,['/api/roundtable/decision-prompt']);
});
test('stopping a pending guide prevents stale playback and releases captured room lease',async()=>{
 const {run,ctx}=harness();fixedFixture(run);const calls=[];let release;
 ctx.fetch=(url,options)=>{calls.push({url,auth:options.headers.Authorization});if(url.endsWith('/audio'))return new Promise(resolve=>release=resolve);return Promise.resolve({ok:true,json:async()=>({decision_id:'t01_response',text:'Guide',audio_url:'/api/roundtable/decision-prompt/audio'})});};
 run(`$('voiceOn').checked=true;`);const playing=run('playDecisionGuide()');await new Promise(resolve=>setImmediate(resolve));await run('stopDecisionGuide()');run(`bundle={code:'NEW',seats:[{token:'new'}]};`);release({ok:true,blob:async()=>new Blob(['audio'])});assert.equal(await playing,false);
 assert(calls.filter(c=>c.url.endsWith('/stop')).every(c=>c.auth==='Bearer secret'));assert(!calls.some(c=>c.url.includes('/command/')||c.url.includes('/briefing')));
});

test('recorded guide replay is enabled only for the CEO seat',()=>{
 const {run,node}=harness();fixedFixture(run);assert(!node('playDecisionGuide').disabled);
 run(`states[0].me='b';render();`);assert(node('playDecisionGuide').disabled);
});


test('named voting prompts advance test seats only after explicit confirmation',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];
 run(`states[0].decisions[0].ballot_count=0;states[0].decisions[0].voted_members=[];states[0].decisions[0].my_vote=null;states[0].decisions[0].next_voter='a';states=['a','b','c'].map(id=>({...states[0],me:id,decisions:[{...states[0].decisions[0]}]}));active=2;render();
 command=async(action,data,owner)=>{commands.push({action,data,token:owner.token});const mid=states[owner.seat].me;for(const own of states){const d=own.decisions[0];d.voted_members=[...new Set([...d.voted_members,mid])];d.ballot_count=d.voted_members.length;d.next_voter=['a','b','c'].find(id=>!d.voted_members.includes(id))||null;if(own.me===mid)d.my_vote=data.option_id;}};`);
 assert.equal(run('active'),0);assert(node('votePrompt').textContent.startsWith('A, which response'));assert.equal(ctx.commands.length,0);
 for(const [seat,name,token] of [[0,'A','secret'],[1,'B','b'],[2,'C','c']]){
  assert.equal(run('active'),seat);assert(node('votePrompt').textContent.startsWith(name+', which response'));
  let card=node('decisions').children[0],confirm=card.children.find(c=>c.className==='vote-confirmation').children.at(-1);assert(confirm.disabled);
  const options=card.children.find(c=>c.className==='fixed-options');await options.children[0].children.at(-1).onclick();
  assert.equal(ctx.commands.length,seat);assert.equal(run('active'),seat);
  confirm=node('decisions').children[0].children.find(c=>c.className==='vote-confirmation').children.at(-1);assert(!confirm.disabled);await confirm.onclick();
  assert.equal(ctx.commands.length,seat+1);assert.equal(ctx.commands[seat].token,token);
 }
 assert.equal(run('active'),0);assert(node('votePrompt').textContent.includes('Every member has voted'));
});

test('other members cannot select or confirm a first ballot before their turn',()=>{
 const {run,node}=harness();fixedFixture(run);run(`bundle.test=false;states[0].me='c';states[0].decisions[0].my_vote=null;states[0].decisions[0].next_voter='b';render();`);
 const card=node('decisions').children[0];assert(node('votePrompt').textContent.startsWith('B, which response'));
 assert(card.children.find(c=>c.className==='fixed-options').children.every(c=>c.children.at(-1).disabled));
 assert(card.children.find(c=>c.className==='vote-confirmation').children.at(-1).disabled);
});

test('single member sessions never switch identities and stale selection does not cast a ballot',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];
 run(`bundle.test=false;command=async(...args)=>commands.push(args);render();`);
 const staleButton=node('decisions').children[0].children.find(c=>c.className==='fixed-options').children[0].children.at(-1);
 run(`bundle={code:'NEW',seats:[{token:'new'}]};`);await staleButton.onclick();assert.equal(ctx.commands.length,0);assert(node('notice').textContent.includes('changed'));
});


test('a stale confirmation cannot submit a different selected member ballot',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];run(`command=async(...args)=>commands.push(args);`);
 await node('decisions').children[0].children.find(c=>c.className==='fixed-options').children[0].children.at(-1).onclick();
 const confirm=node('decisions').children[0].children.find(c=>c.className==='vote-confirmation').children.at(-1);
 run(`states.push({...states[0],me:'b',decisions:[{...states[0].decisions[0],my_vote:null,next_voter:'b'}]});active=1;voteDrafts[voteDraftKey(states[1].decisions[0],states[1])]='technical_first';`);
 await confirm.onclick();assert.equal(ctx.commands.length,0);assert(node('notice').textContent.includes('changed'));
});

test('recorded turns use nine distinct ordinals and preview the next assigned clip',async()=>{
 const {run,node}=harness();run(`states[0].phase='discussion';recordings=Array.from({length:9},(_,i)=>({id:'turn'+(i+1),turn_number:i+1,default_seat:i%3,title:'Script '+(i+1),text:'Caption '+(i+1),available:true}));states[0].turn_number=4;states[0].speaker='a';render();`);
 assert.equal(run("recordingAtTurn(state().turn_number).id"),'turn4');assert.equal(run("upcomingRecording(state(),'b').id"),'turn5');assert.equal(run("upcomingRecording(state(),'c').id"),'turn6');assert(node('recordingProgress').textContent.includes('Recorded turn 4 of 9'));assert.equal(node('recordedCaption').textContent,'Caption 4');
 run(`states[0].turn_number=10;render();`);assert(node('playTurn').disabled);assert(!node('commit').disabled);assert(node('recordedCaption').textContent.includes('finished'));await assert.rejects(run('playRecordedTurn()'),/scripted turns are finished/);
});
test('custom response requires explicit reset acknowledgement and submits the displayed version',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];run(`command=async(action,data,owner)=>commands.push({action,data,token:owner.token});$('customOptionTitle').value='Coordinated fallback';$('customOptionProposal').value='Morgan verifies service status; Alex coordinates a documented fallback.';`);
 assert(!node('fixedCustomForm').hidden);assert.equal(node('addCustomOption').textContent,'Add custom option and restart voting');assert(node('addCustomOption').disabled);await assert.rejects(run('addCustomOption()'),/existing votes will be cleared/);assert.equal(ctx.commands.length,0);
 run(`$('acknowledgeReset').checked=true;render();`);assert(!node('addCustomOption').disabled);await run('addCustomOption()');assert.equal(ctx.commands[0].action,'add_custom_option');assert.equal(ctx.commands[0].data.ballot_version,1);assert.equal(ctx.commands[0].data.acknowledge_reset,true);assert.equal(ctx.commands[0].token,'secret');
});
test('custom choices are labelled unverified and the six choice limit disables addition',()=>{
 const {run,node}=harness();fixedFixture(run);run(`states[0].decisions[0].options.push(...[1,2,3].map(i=>({id:'custom_'+i,label:'Custom '+i,proposal:'Human alternative '+i,custom:true,proposed_by:'b'})));render();`);
 const options=node('decisions').children[0].children.find(c=>c.className==='fixed-options');assert.equal(options.children.length,6);assert(options.children[3].children.some(c=>c.textContent==='Human proposal · unverified'));assert(node('addCustomOption').disabled);assert(node('customOptionLimit').textContent.includes('limit has been reached'));
});
test('ballot version change clears selections and reopens the first named voting turn',()=>{
 const {run,node}=harness();fixedFixture(run);
 run(`states=['a','b','c'].map(id=>({...states[0],me:id,decisions:[{...states[0].decisions[0],ballot_version:1,voted_members:['a','b'],ballot_count:2,next_voter:'c'}]}));active=2;render();voteDrafts[voteDraftKey(states[2].decisions[0],states[2])]='technical_first';$('customOptionTitle').value='Stale text';for(const own of states){own.decisions[0]={...own.decisions[0],ballot_version:2,voted_members:[],ballot_count:0,next_voter:'a',my_vote:null};}render();`);
 assert.equal(run('active'),0);assert.equal(run('Object.keys(voteDrafts).length'),0);assert(node('votePrompt').textContent.startsWith('A, which response'));assert(node('ballotUpdate').textContent.includes('All previous votes and selections were cleared'));assert.equal(node('customOptionTitle').value,'');
});
test('stale confirmation and CEO result controls reject a changed ballot version',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];run(`command=async(...args)=>commands.push(args);`);
 await node('decisions').children[0].children.find(c=>c.className==='fixed-options').children[0].children.at(-1).onclick();const staleConfirm=node('decisions').children[0].children.find(c=>c.className==='vote-confirmation').children.at(-1);
 run(`states[0].decisions[0].ballot_count=3;states[0].decisions[0].tally={controlled_continuity:2,technical_first:1,wait_for_director:0};render();`);const staleCommit=node('decisions').children[0].children.at(-1).children[0];
 run(`states[0].decisions[0]={...states[0].decisions[0],ballot_version:2,ballot_count:0,voted_members:[],tally:null,my_vote:null};render();`);await staleConfirm.onclick();assert.equal(ctx.commands.length,0);assert(node('notice').textContent.includes('ballot changed'));await staleCommit.onclick();assert.equal(ctx.commands.length,0);assert(node('notice').textContent.includes('ballot changed'));
});
test('confirmed choices and CEO ties carry the captured ballot revision',async()=>{
 const {run,node,ctx}=harness();fixedFixture(run);ctx.commands=[];run(`states[0].decisions[0].ballot_version=2;command=async(action,data)=>commands.push({action,data});render();`);
 await node('decisions').children[0].children.find(c=>c.className==='fixed-options').children[1].children.at(-1).onclick();await node('decisions').children[0].children.find(c=>c.className==='vote-confirmation').children.at(-1).onclick();assert.equal(ctx.commands[0].data.ballot_version,2);
 run(`states[0].decisions[0].ballot_count=3;states[0].decisions[0].tally={controlled_continuity:1,technical_first:1,wait_for_director:1};render();`);await node('decisions').children[0].children.at(-1).children.find(c=>c.onclick).onclick();assert.equal(ctx.commands[1].data.ballot_version,2);
});

test('only the CEO sees the custom option form',async()=>{
 const {run,node}=harness();fixedFixture(run);assert(!node('fixedCustomForm').hidden);
 run(`states[0].me='b';render();`);assert(node('fixedCustomForm').hidden);assert(node('addCustomOption').disabled);
 await assert.rejects(run('addCustomOption()'),/participant or ballot changed/);
});

test('Round 1 hides ballots, preserves preparation and waits for all experts and members',()=>{
 const {run,node}=harness();run(`states[0]={...states[0],flow:'board_round1',expert_order:['it','operations','governance'],expert_briefings:{},decision_submissions:[{member:'a',submitted:false},{member:'b',submitted:false},{member:'c',submitted:false}],individual_decision:null};render();`);
 assert(node('legacyDecisionPanel').hidden);assert(!node('individualPanel').hidden);assert(!node('intro').hidden);
 run(`states[0].phase='consultation';render();`);assert(node('skipConsultation').disabled);assert(!node('nextExpert').disabled);
 run(`states[0].expert_briefings={it:{text:'IT'},operations:{text:'Operations'},governance:{text:'Governance'}};render();`);assert(!node('skipConsultation').disabled);
 run(`states[0].phase='decision';render();`);assert(node('end').disabled);assert(node('submitIndividual').disabled);
 run(`states[0].decision_submissions.forEach(s=>s.submitted=true);render();`);assert(!node('end').disabled);
});
test('Round 1 decision drafts stay with their selected member and require confirmation',async()=>{
 const {run,node,ctx}=harness();ctx.commands=[];run(`states=['a','b','c'].map(me=>({...states[0],me,flow:'board_round1',phase:'decision',expert_order:['it','operations','governance'],expert_briefings:{},decision_submissions:[],individual_decision:null}));command=async(action,data,owner)=>commands.push({action,data,token:owner.token});render();`);
 for(const id of ['individualAction','individualReasoning','individualEvidence','individualUnknowns'])node(id).value='A own answer';
 await assert.rejects(run('submitIndividual()'),/confirm/);
 run(`active=1;render();`);assert.equal(node('individualAction').value,'');node('individualAction').value='B draft';
 run(`active=0;render();`);assert.equal(node('individualAction').value,'A own answer');
 run(`$('confirmIndividual').checked=true;`);await run('submitIndividual()');assert.equal(ctx.commands[0].action,'submit_individual_decision');assert.equal(ctx.commands[0].token,'secret');assert.equal(ctx.commands[0].data.action,'A own answer');assert.equal(ctx.commands[0].data.revision,0);
 run(`active=1;`);await assert.rejects(run('submitIndividual()'),/member or phase changed/);
});
test('Round 1 automatically presents three experts without requesting a vote guide or evaluation',async()=>{
 const {run,ctx}=harness();ctx.calls=[];run(`states[0]={...states[0],flow:'board_round1',phase:'consultation',expert_order:['it','operations','governance'],expert_briefings:{},decision_submissions:[]};startPreparation=async(mode,kind,extra)=>{calls.push(kind);states[0].expert_briefings[kind]={text:kind};};`);
 await run('automaticAgents()');await run('automaticAgents()');await run('automaticAgents()');await run('automaticAgents()');assert.deepEqual([...ctx.calls],['it','operations','governance']);
 run(`states[0].phase='decision';`);await run('automaticAgents()');run(`states[0].phase='ended';`);await run('automaticAgents()');assert.equal(ctx.calls.length,3);
});

function privateFixture(run,phase='coaching'){
 run(`loadExerciseClips=async()=>{};states[0]={...states[0],flow:'four_rounds',phase:'private',beta_mode:true,exercise_round:2,expert_order:['it','operations','governance'],expert_briefings:{},decision_submissions:[],private_session:{agent_id:'agent-a',phase:${JSON.stringify(phase)},turn:1,revision:1,prompt:'What would you do next?',history:[],answers:{},scores:{},total:0,busy:false,error:null,appeals:{}},private_progress:[]};render();`);
}
test('private UI hides shared controls and does not submit an unchecked answer',async()=>{
 const {run,node,ctx}=harness(true);privateFixture(run);ctx.commands=[];run(`command=async(action,data,owner)=>commands.push({action,data,owner});$('privateAnswer').value='My own response';`);
 assert(!node('privatePanel').hidden);assert(node('groupDiscussion').hidden);assert(node('individualPanel').hidden);assert(node('submitPrivate').disabled);assert(node('privateScore').textContent.includes('no points'));
 await run(`$('submitPrivate').onclick()`);assert.equal(ctx.commands.length,0);
 run(`$('confirmPrivateAnswer').checked=true;`);await run(`$('submitPrivate').onclick()`);assert.equal(ctx.commands[0].action,'private_answer');assert.equal(ctx.commands[0].data.text,'My own response');assert.equal(ctx.commands[0].data.revision,1);assert.equal(ctx.commands[0].owner.token,'secret');
 run(`states[0].me='b';states[0].private_session={...states[0].private_session,agent_id:'agent-b'};render();`);assert.equal(node('privateAnswer').value,'');assert(!node('confirmPrivateAnswer').checked);
});
test('private card requires review and submits editable fields before assessment',async()=>{
 const {run,node,ctx}=harness(true);privateFixture(run,'card_review');ctx.commands=[];run(`states[0].private_session.card=Object.fromEntries(exerciseFields.map(k=>[k,'Needs confirmation']));command=async(action,data)=>commands.push({action,data});render();`);
 assert(!node('responseCard').hidden);assert(node('submitCard').disabled);
 node('card_review').value='Review in thirty minutes';run(`$('confirmCard').checked=true;`);await run(`$('submitCard').onclick()`);
 assert.equal(ctx.commands[0].action,'confirm_response_card');assert.equal(ctx.commands[0].data.review,'Review in thirty minutes');
});
test('automatic private agent runs once per turn and leaves failures for an explicit retry',async()=>{
 const {run,ctx}=harness(true);privateFixture(run);ctx.calls=0;run(`states[0].private_session.prompt=null;runExerciseAgent=async()=>{calls++;throw new Error('fixture failure');};`);
 await run('automaticFourRounds()');await run('automaticFourRounds()');assert.equal(ctx.calls,1);
 run(`states[0].private_session.revision++;`);await run('automaticFourRounds()');assert.equal(ctx.calls,2);
});
test('saved answer playback is separate from draft loading and submission',async()=>{
 const {run,node,ctx}=harness(true);privateFixture(run);const calls=[];
 ctx.fetch=async(url,options)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/play')?{id:'lease'}:{text:'Recorded sample',lease_id:'lease'},blob:async()=>new Blob(['mp3'])};};
 run(`fixtureClips=[{id:'sample',duration_seconds:1,text:'Recorded sample'}];$('fixtureSelect').value='sample';refresh=async()=>{};`);
 const pending=run(`$('playFixture').onclick()`);await new Promise(resolve=>setImmediate(resolve));assert(!calls.some(p=>p.endsWith('/complete')));node('fixtureAudio').onended();await pending;
 assert.equal(node('privateAnswer').value,'');await run(`$('useFixture').onclick()`);assert.equal(node('privateAnswer').value,'Recorded sample');assert(!node('confirmPrivateAnswer').checked);assert(!calls.some(p=>p.includes('private_answer')));
});

test('late private transcription cannot overwrite a later assessment question',async()=>{
 const {ctx,run,node}=harness(true);let release;
 ctx.fetch=()=>new Promise(r=>release=r);
 run(`loadExerciseClips=async()=>{};states[0].flow='four_rounds';states[0].phase='private';states[0].private_session={agent_id:'agent-a',phase:'assessment',turn:1,revision:8,prompt:'First question?',history:[],scores:{},total:0,appeals:{},busy:false};clip=new Blob(['wav']);clipOwner={...context(),phase:'private',target:'private',privateRevision:8};health=async()=>{};$('privateAnswer').value='draft';render();`);
 const pending=run(`$('transcribe').onclick()`);
 run(`states[0].private_session.revision=9;states[0].private_session.turn=2;render();$('privateAnswer').value='Keep the new answer';`);
 release({ok:true,json:async()=>({text:'Old transcribed answer'})});await pending;
 assert.equal(node('privateAnswer').value,'Keep the new answer');
});
