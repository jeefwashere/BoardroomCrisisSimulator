const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function harness(){
 const nodes={},node=id=>nodes[id]||={checked:false,disabled:false,textContent:'',children:[],append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;}};
 const state={code:'SOLO',me:'alex',solo_test:true,flow:'four_rounds',phase:'private',beta_mode:true,private_session:{phase:'coaching',turn:1,revision:1,prompt:'Q1',busy:false}};
 const played=[],submitted=[],calls=[];let stops=0,interruptAfterFirst=false;
 const ctx=vm.createContext({console,Date,setTimeout,clearTimeout,AbortController,window:{addEventListener(){}},$:node,el:()=>node(Symbol()),four:s=>s?.flow==='four_rounds',state:()=>state,context:()=>({code:'SOLO',token:'membership',seat:0}),same:()=>true,active:0,busy:false,polling:false,recording:null,turnPlayback:null,briefing:null,exerciseVoice:null,fixturePlayback:null,fixtureDraft:null,liveTask:null,liveStatus:{recorded_input:true},render(){},say(){},refresh:async()=>{},uid:()=>String(calls.length),bind:(id,fn)=>node(id).onclick=fn,
  api:async()=>({phase:state.private_session.phase,clips:[1,2,3].filter(step=>step>=state.private_session.turn).map(step=>({id:'clip_'+step,step,text:'Approved answer '+step,question:'Question '+step}))}),
  fetch:async(url,options)=>{calls.push(JSON.parse(options.body));state.private_session.prompt='Question '+state.private_session.turn;if(state.private_session.phase==='card_review')state.private_session.card={action:'Review me'};return{ok:true,body:{}};},consumeNDJSON:async(body,fn)=>fn({type:'done'}),
  startLiveAudio:async mode=>{assert.equal(mode,'recordings');const t={ready:true,modelTurns:1,connectionId:'live_'+state.private_session.turn,history:[{role:'human',text:'Recognized answer'}],player:{drain:async()=>{}}};ctx.liveTask=t;return t;},
  sendLiveRecording:async id=>{played.push(id);ctx.liveTask.fixtureCompleted=true;ctx.liveTask.modelTurns=2;ctx.liveTask.replyCompleted=true;},
  stopLiveAudio:async()=>{stops++;ctx.liveTask=null;},
  command:async(action,data)=>{submitted.push({action,data});assert.equal(action,'submit_sequence_answer');const ps=state.private_session;ps.revision++;ps.prompt=null;if(ps.turn===3){if(ps.phase==='assessment'){ps.phase='complete';state.phase='reunion';}else ps.phase='card_review';}else ps.turn++;if(interruptAfterFirst)vm.runInContext('savedSequence.cancelled=true',ctx);}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/solo-sequence.js'),'utf8'),ctx);
 return {ctx,state,node,played,submitted,calls,get stops(){return stops;},run:s=>vm.runInContext(s,ctx),interrupt(){interruptAfterFirst=true;}};
}
test('one approved sequence plays exactly three clips, submits each and stops at card review',async()=>{
 const h=harness();await h.run('loadSequenceCatalog(state())');h.node('approveSequence').checked=true;await h.node('runSequence').onclick();
 assert.deepEqual(h.played,['clip_1','clip_2','clip_3']);assert.equal(h.submitted.length,3);assert(h.submitted.every(c=>c.data.approved));assert.equal(h.stops,3);
 assert.equal(h.state.private_session.phase,'card_review');assert.equal(h.run('savedSequence'),null);assert.equal(h.ctx.liveTask,null);assert.equal(h.node('approveSequence').checked,false);assert.match(h.node('sequenceStatus').textContent,/Playback stopped/);assert(h.calls.every(c=>c.voice===false));
});
test('stop after a completed answer prevents later clips and does not replay the first',async()=>{
 const h=harness();await h.run('loadSequenceCatalog(state())');h.node('approveSequence').checked=true;h.interrupt();await h.node('runSequence').onclick();
 assert.deepEqual(h.played,['clip_1']);assert.equal(h.submitted.length,1);assert.equal(h.state.private_session.turn,2);assert.equal(h.ctx.liveTask,null);assert.match(h.node('sequenceStatus').textContent,/remaining clips were not submitted/);
});
test('approval and solo mode are required before any recording or submission',async()=>{
 const h=harness();await h.run('loadSequenceCatalog(state())');await assert.rejects(h.node('runSequence').onclick(),/approve/);h.node('approveSequence').checked=true;h.state.solo_test=false;await assert.rejects(h.node('runSequence').onclick(),/single member/);assert.equal(h.played.length,0);assert.equal(h.submitted.length,0);
});

test('assessment plays the three remaining clips then stops without starting feedback or another member',async()=>{
 const h=harness();h.state.private_session.phase='assessment';await h.run('loadSequenceCatalog(state())');h.node('approveSequence').checked=true;await h.node('runSequence').onclick();
 assert.deepEqual(h.played,['clip_1','clip_2','clip_3']);assert.equal(h.submitted.length,3);assert.equal(h.calls.length,3);assert.equal(h.state.phase,'reunion');assert.equal(h.ctx.liveTask,null);assert.equal(h.run('savedSequence'),null);assert.match(h.node('sequenceStatus').textContent,/results are ready/);
});

test('agent preparation waits for an in-flight room poll before reading the next question',async()=>{
 const h=harness();h.ctx.polling=true;await h.run('loadSequenceCatalog(state())');h.node('approveSequence').checked=true;
 setTimeout(()=>{h.ctx.polling=false;},25);await h.node('runSequence').onclick();
 assert.equal(h.submitted.length,3);assert.equal(h.state.private_session.phase,'card_review');assert.equal(h.ctx.liveTask,null);
});
