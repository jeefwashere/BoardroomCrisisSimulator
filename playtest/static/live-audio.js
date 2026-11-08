'use strict';
let liveTask=null,liveStatus=null,liveDraft=null,liveRenderedKey='';
const liveKey=s=>[s?.code,s?.me,s?.phase,s?.private_session?.phase,s?.private_session?.revision].join(':');
function renderLiveAudio(s){
 const eligible=four(s)&&s.phase==='private'&&['coaching','assessment'].includes(s.private_session?.phase)&&!!s.private_session?.prompt;
 $('livePanel').hidden=!eligible;
 if(liveTask&&(!same(liveTask.owner)||active!==liveTask.owner.seat||liveKey(s)!==liveTask.key))void stopLiveAudio();
 $('startLive').disabled=!eligible||busy||!!liveTask||!!exerciseVoice||!!briefing||!!fixturePlayback||!!fixtureDraft||!!recording||s?.private_session?.busy||!liveStatus?.configured;
 $('stopLive').disabled=!liveTask;$('liveEndTurn').disabled=!liveTask?.ready;
 $('useLiveAnswer').disabled=busy||!!liveTask||!liveDraft||liveDraft.key!==liveKey(s)||!liveDraft.text.trim();
 $('resumeLive').hidden=!liveTask;
 if(!liveTask)$('liveAvailability').textContent=liveStatus?.message||'Checking Live audio availability…';
 if(liveRenderedKey!==liveKey(s)&&!liveTask){liveRenderedKey=liveKey(s);liveDraft=null;$('liveTranscript').replaceChildren();$('liveState').textContent='Microphone is off. Start explicitly to stream audio to Gemini.';}
 if(liveTask){$('submitPrivate').disabled=true;$('privateAgent').disabled=true;$('recordPrivate').disabled=true;$('transcribePrivate').disabled=true;$('playFixture').disabled=true;}
}
async function checkLiveStatus(){try{liveStatus=await api('/api/roundtable/exercise/live-status');}catch{liveStatus={configured:false,message:'This server does not have Live audio enabled. Use the updated Live test server.'};}render();}
async function releaseLiveDevices(task){
 task.stream?.getTracks().forEach(t=>t.stop());task.stream=null;
 task.input?.disconnect();task.worklet?.disconnect();task.mute?.disconnect();
 const capture=task.capture;task.capture=null;
 if(capture&&capture.state!=='closed')await capture.close();
}
async function finishLive(task,message){
 if(task.finished)return;task.finished=true;clearTimeout(task.timer);clearTimeout(task.stopTimer);
 await releaseLiveDevices(task);await task.player?.stop();
 if(task.socket?.readyState<2)task.socket.close();
 if(same(task.owner)&&active===task.owner.seat&&task.key===liveKey(state())){
  liveDraft={key:task.key,text:task.history.filter(x=>x.role==='human').map(x=>x.text.trim()).filter(Boolean).join('\n\n')};
  $('liveState').textContent=message||'Microphone stopped. Review your words before using them as an answer.';
 }
 if(liveTask===task)liveTask=null;await refresh();render();
}
async function stopLiveAudio(){const task=liveTask;if(!task||task.stopping)return;task.stopping=true;await releaseLiveDevices(task);await task.player?.stop();
 if(task.socket?.readyState===1){task.socket.send(JSON.stringify({type:'stop'}));task.stopTimer=setTimeout(()=>void finishLive(task),1500);}else await finishLive(task);
}
function showLiveTranscript(task,role,text){
 if(task.history.at(-1)?.role===role)task.history.at(-1).text+=text;else task.history.push({role,text});
 if(same(task.owner)&&active===task.owner.seat)$('liveTranscript').replaceChildren(...task.history.map(row=>{const n=el('p');n.append(el('b',row.role==='human'?'You: ':'Agent: '),el('span',row.text));return n;}));
}
async function startLiveAudio(){
 const s=state();if(liveTask||!four(s)||s.phase!=='private'||!s.private_session?.prompt||s.private_session.busy||exerciseVoice||briefing||fixturePlayback||fixtureDraft||recording)throw new Error('Finish the current audio or saved answer before starting Live.');
 const task={owner:context(),key:liveKey(s),revision:s.private_session.revision,history:[],ready:false,finished:false,stopping:false};liveTask=task;liveDraft=null;$('liveTranscript').replaceChildren();render();
 try{
  task.player=new PCMStreamPlayer();await task.player.unlock();
  $('liveState').textContent='Requesting microphone access. Audio is sent only while this session is active.';
  task.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  if(task.stopping||task.finished||!same(task.owner)||task.key!==liveKey(state())){await releaseLiveDevices(task);return;}
  task.capture=new AudioContext();await task.capture.audioWorklet.addModule('/live-capture-worklet.js');
  if(task.stopping||task.finished){await releaseLiveDevices(task);return;}
  task.worklet=new AudioWorkletNode(task.capture,'live-capture');task.input=task.capture.createMediaStreamSource(task.stream);task.mute=task.capture.createGain();task.mute.gain.value=0;
  task.input.connect(task.worklet);task.worklet.connect(task.mute);task.mute.connect(task.capture.destination);await task.capture.resume();
  if(task.stopping||task.finished){await releaseLiveDevices(task);return;}
  const socket=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/api/roundtable/exercise/live');task.socket=socket;
  task.worklet.port.onmessage=e=>{if(!task.ready||task.stopping||task.finished||socket.readyState!==1)return;if(socket.bufferedAmount>128000){void finishLive(task,'Connection is too slow. Microphone stopped; review your transcript.');return;}socket.send(e.data);};
  socket.onopen=()=>{if(task.finished){socket.close();return;}socket.send(JSON.stringify({token:task.owner.token,revision:task.revision}));};
  let processing=Promise.resolve();
  socket.onmessage=e=>{processing=processing.then(async()=>{
   if(task.finished)return;const event=JSON.parse(e.data);
   if(event.type==='ready'){clearTimeout(task.timer);task.ready=true;$('liveState').textContent='LIVE · Microphone on. Speak naturally; you can interrupt the agent. Stop before reviewing your answer.';task.timer=setTimeout(()=>void stopLiveAudio(),event.max_seconds*1000);render();}
   if(event.type==='transcript')showLiveTranscript(task,event.role,event.text);
   if(event.type==='audio'&&!task.stopping)task.player.append(event.pcm,event.sample_rate);
   if(event.type==='interrupted'&&!task.stopping){await task.player.stop();task.player=new PCMStreamPlayer();void task.player.unlock();}
   if(event.type==='notice')$('liveState').textContent=event.message;
   if(event.type==='error')task.error=event.message;
   if(event.type==='closed'){if(event.transcript)task.history=event.transcript;await finishLive(task,task.error||'Live session ended. Your transcript is provisional; review it before submitting.');}
  }).catch(()=>finishLive(task,'Live audio stopped. Your submitted answers are unchanged.'));};
  socket.onclose=()=>void processing.finally(()=>finishLive(task,task.error));
  socket.onerror=()=>{task.error='Live connection failed. Check the backend Live key; your saved answers are unchanged.';};
  task.timer=setTimeout(()=>void finishLive(task,'Live connection timed out. Microphone stopped.'),30000);
 }catch(e){await finishLive(task,e.name==='NotAllowedError'?'Microphone permission was denied. You can still type or use saved clips.':e.message);}
}
bind('startLive',startLiveAudio);
$('stopLive').onclick=()=>void stopLiveAudio();
$('resumeLive').onclick=()=>void liveTask?.player?.unlock();
$('liveEndTurn').onclick=()=>{if(liveTask?.socket?.readyState===1)liveTask.socket.send(JSON.stringify({type:'end_turn'}));};
bind('useLiveAnswer',async()=>{if(liveTask||!liveDraft||liveDraft.key!==liveKey(state()))throw new Error('Stop Live and review the transcript for this question first.');$('privateAnswer').value=liveDraft.text;$('confirmPrivateAnswer').checked=false;$('liveState').textContent='Your words are in the editable answer box. Remove conversational questions, correct transcription, then confirm and submit.';});
window.addEventListener('beforeunload',()=>{const task=liveTask;if(!task)return;task.stream?.getTracks().forEach(t=>t.stop());task.socket?.close();void task.player?.stop();});
void checkLiveStatus();setInterval(()=>{if(!liveTask)void checkLiveStatus();},10000);
