const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
test('capture worklet resamples one second to 16 kHz PCM at 48 kHz and 44.1 kHz',()=>{
 for(const rate of [48000,44100]){let Processor;const messages=[];const ctx={sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:pcm=>messages.push(pcm)};}},registerProcessor:(name,p)=>Processor=p};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/live-capture-worklet.js'),'utf8'),ctx);const p=new Processor();for(let i=0;i<rate;i+=128)p.process([[new Float32Array(Math.min(128,rate-i)).fill(.5)]]);assert.equal(messages.reduce((n,b)=>n+b.byteLength,0),32000);assert.equal(new DataView(messages[0]).getInt16(0,true),16383);}
});
function harness(){const nodes={};const node=id=>nodes[id]||=( {hidden:false,disabled:false,value:'',textContent:'',children:[],replaceChildren(...c){this.children=c;},append(...c){this.children.push(...c);}});const state={flow:'four_rounds',code:'ROOM',me:'a',phase:'private',private_session:{phase:'coaching',revision:1,prompt:'Question?',busy:false}};const ctx=vm.createContext({console,setTimeout,clearTimeout,setInterval(){},window:{addEventListener(){}},$:node,el:()=>node(Symbol()),four:s=>s?.flow==='four_rounds',state:()=>state,active:0,busy:false,exerciseVoice:null,briefing:null,fixturePlayback:null,fixtureDraft:null,recording:null,context:()=>({code:'ROOM',token:'membership',seat:0}),same:()=>true,render(){},refresh:async()=>{},api:async()=>({configured:true,message:'Ready'}),bind:(id,fn)=>{node(id).onclick=fn;}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/live-audio.js'),'utf8'),ctx);return{ctx,node,state,run:s=>vm.runInContext(s,ctx)};}
test('live draft requires stop and explicit human review; stage changes invalidate it',async()=>{
 const {run,node,state}=harness();run("liveDraft={key:liveKey(state()),text:'My provisional spoken answer'};liveTask={};");await assert.rejects(node('useLiveAnswer').onclick(),/Stop Live/);
 run('liveTask=null;');await node('useLiveAnswer').onclick();assert.equal(node('privateAnswer').value,'My provisional spoken answer');assert.equal(node('confirmPrivateAnswer').checked,false);
 state.private_session.revision=2;await assert.rejects(node('useLiveAnswer').onclick(),/Stop Live/);
});
test('live controls disable submission and other audio while microphone is owned',()=>{
 const {run,node}=harness();run("liveStatus={configured:true,message:'Ready'};liveTask={owner:context(),key:liveKey(state()),ready:true};renderLiveAudio(state());");assert.equal(node('submitPrivate').disabled,true);assert.equal(node('recordPrivate').disabled,true);assert.equal(node('stopLive').disabled,false);assert.equal(node('useLiveAnswer').disabled,true);
});

test('stopping during microphone permission or worklet loading releases devices and never opens a socket',async()=>{
 for(const stage of ['permission','module']){
  const {ctx,run,node}=harness();let resolveGate,stops=0,closes=0,connections=0;
  const gate=new Promise(resolve=>resolveGate=resolve);const stream={getTracks:()=>[{stop(){stops++;}}]};
  ctx.PCMStreamPlayer=class{async unlock(){}async stop(){}};
  ctx.navigator={mediaDevices:{getUserMedia:()=>stage==='permission'?gate:Promise.resolve(stream)}};
  ctx.AudioContext=class{constructor(){this.state='running';this.audioWorklet={addModule:()=>gate};}async close(){closes++;this.state='closed';}};
  ctx.WebSocket=class{constructor(){connections++;}};
  const pending=node('startLive').onclick();await new Promise(resolve=>setImmediate(resolve));
  await run('stopLiveAudio()');resolveGate(stage==='permission'?stream:undefined);await pending;
  assert.equal(stops,1);assert.equal(connections,0);assert.equal(closes,stage==='module'?1:0);assert.equal(run('liveTask'),null);
 }
});
