const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/preparation.js'),'utf8');
function runtime(){
 const contexts=[];
 class AudioContext {
   constructor(){this.currentTime=1;this.state='running';this.destination={};this.started=[];this.buffers=[];contexts.push(this);}
   async resume(){}
   createBuffer(_,count,rate){const data=new Float32Array(count);this.buffers.push({data,rate});return {getChannelData:()=>data};}
   createBufferSource(){const self=this;return {connect(){},start(time){self.started.push({time,source:this});},stop(){this.stopped=true;this.onended?.();}};}
   async close(){this.state='closed';}
 }
 const context=vm.createContext({AudioContext,atob,Uint8Array,DataView,TextDecoder,setTimeout,console});
 vm.runInContext(source,context);return {context,contexts,run:s=>vm.runInContext(s,context)};
}
test('raw PCM plays immediately, handles odd byte boundaries and preserves sample order',async()=>{
 const {run,contexts}=runtime();run('var player=new PCMStreamPlayer();');
 run(`player.append('${Buffer.from([0,128,255]).toString('base64')}');`);
 const ctx=contexts[0];assert.equal(ctx.started.length,1);assert.equal(ctx.buffers[0].data[0],-1);
 run(`player.append('${Buffer.from([127,0,0]).toString('base64')}');`);
 assert.equal(ctx.started.length,2);assert.equal(ctx.buffers[1].data[0],32767/32768);assert.equal(ctx.buffers[1].data[1],0);
 assert(ctx.started[1].time>=ctx.started[0].time+1/24000);
 await run('player.stop()');assert(ctx.started.every(x=>x.source.stopped));assert.equal(ctx.state,'closed');
 run(`player.append('${Buffer.from([0,0]).toString('base64')}');`);assert.equal(ctx.started.length,2);
});
test('NDJSON exposes an event before EOF and handles split UTF8',async()=>{
 const {context,run}=runtime();const bytes=new TextEncoder().encode('{"type":"text","text":"héllo"}\n{"type":"done"}\n');
 let sawText=false,offset=0;
 context.stream={getReader:()=>({async read(){if(offset<bytes.length){const value=bytes.slice(offset,++offset);if(offset===bytes.length)assert(sawText);return {value,done:false};}return {done:true};},async cancel(){},releaseLock(){}})};
 const events=[];context.onEvent=e=>{events.push(e);if(e.type==='text')sawText=true;};
 await run('consumeNDJSON(stream,onEvent)');assert.equal(events[0].text,'héllo');assert.equal(events[1].type,'done');
});
test('aborting a stream prevents later text or audio events',async()=>{
 const {context,run}=runtime();let cancelled=false,count=0;
 context.signal={aborted:false};context.stream={getReader:()=>({async read(){return {value:new TextEncoder().encode('{"type":"text"}\n{"type":"audio"}\n'),done:false};},async cancel(){cancelled=true;},releaseLock(){}})};
 context.onEvent=()=>{count++;context.signal.aborted=true;};
 await run('consumeNDJSON(stream,onEvent,signal)');assert.equal(count,1);assert(cancelled);
});
