'use strict';
let liveTask=null,liveStatus=null,liveDraft=null,liveRenderedKey='',liveAnswerSource=null;
const liveKey=s=>[s?.code,s?.me,s?.phase,s?.private_session?.phase,s?.private_session?.revision].join(':');
function renderLiveAudio(s){
 const eligible=four(s)&&s.phase==='private'&&['coaching','assessment'].includes(s.private_session?.phase)&&!!s.private_session?.prompt;
 $('livePanel').hidden=!eligible;
 if(liveTask&&(!same(liveTask.owner)||active!==liveTask.owner.seat||liveKey(s)!==liveTask.key))void stopLiveAudio();
 $('startLive').disabled=!eligible||busy||!!liveTask||!!exerciseVoice||!!briefing||!!fixturePlayback||!!fixtureDraft||!!recording||s?.private_session?.busy||!liveStatus?.configured;
 $('startLiveClips').disabled=$('startLive').disabled||!liveStatus?.recorded_input;
 $('sendLiveClip').disabled=!liveTask?.ready||liveTask.inputMode!=='recordings'||!!liveTask.playingClip||!!liveTask.stopping||!liveTask.clips?.length;
 $('liveClipSelect').disabled=$('sendLiveClip').disabled;
 $('stopLive').disabled=!liveTask;$('liveEndTurn').disabled=!liveTask?.ready||liveTask.inputMode!=='microphone';
 $('useLiveAnswer').disabled=busy||!!liveTask||!liveDraft||liveDraft.key!==liveKey(s)||!liveDraft.text.trim();
 $('resumeLive').hidden=!liveTask;
 if(!liveTask)$('liveAvailability').textContent=liveStatus?.message||'Checking Live audio availability…';
 if(liveRenderedKey!==liveKey(s)&&!liveTask){liveRenderedKey=liveKey(s);liveDraft=null;$('liveTranscript').replaceChildren();$('liveClipSelect').replaceChildren();$('liveClipCaption').textContent='Connect saved clip mode to load the answer for this member and question.';$('liveClipState').textContent='';$('liveState').textContent='Choose saved clips or your microphone. Saved clip mode never opens the microphone.';}
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
 await releaseLiveDevices(task);await task.player?.stop();await task.fixturePlayer?.stop();
 if(task.socket?.readyState<2)task.socket.close();
 if(same(task.owner)&&active===task.owner.seat&&task.key===liveKey(state())){
  liveDraft={key:task.key,connectionId:task.connectionId,text:task.history.filter(x=>x.role==='human').map(x=>x.text.trim()).filter(Boolean).join('\n\n')};
  $('liveState').textContent=message||'Live stopped. Review the recognized words before using them as an answer.';
 }
 if(liveTask===task)liveTask=null;await refresh();render();
}
async function stopLiveAudio(){const task=liveTask;if(!task||task.stopping)return;task.stopping=true;await releaseLiveDevices(task);await task.player?.stop();await task.fixturePlayer?.stop();
 if(task.socket?.readyState===1){task.socket.send(JSON.stringify({type:'stop'}));task.stopTimer=setTimeout(()=>void finishLive(task),1500);}else await finishLive(task);
}
function showLiveTranscript(task,role,text){
 if(task.history.at(-1)?.role===role)task.history.at(-1).text+=text;else task.history.push({role,text});
 if(same(task.owner)&&active===task.owner.seat)$('liveTranscript').replaceChildren(...task.history.map(row=>{const n=el('p');n.append(el('b',row.role==='human'?'You: ':'Agent: '),el('span',row.text));return n;}));
}
async function startLiveAudio(inputMode='microphone'){
 const s=state();if(liveTask||!four(s)||s.phase!=='private'||!s.private_session?.prompt||s.private_session.busy||exerciseVoice||briefing||fixturePlayback||fixtureDraft||recording)throw new Error('Finish the current audio or saved answer before starting Live.');
 const task={owner:context(),key:liveKey(s),revision:s.private_session.revision,history:[],inputMode,clips:[],ready:false,finished:false,stopping:false};liveTask=task;liveDraft=null;$('liveTranscript').replaceChildren();render();
 try{
  task.player=new PCMStreamPlayer();await task.player.unlock();
  if(inputMode==='recordings'){task.fixturePlayer=new PCMStreamPlayer();await task.fixturePlayer.unlock();$('liveState').textContent='Connecting with saved clips. Microphone stays off.';}
  else{
  $('liveState').textContent='Requesting microphone access. Audio is sent only while this session is active.';
  task.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  if(task.stopping||task.finished||!same(task.owner)||task.key!==liveKey(state())){await releaseLiveDevices(task);return;}
  task.capture=new AudioContext();await task.capture.audioWorklet.addModule('/live-capture-worklet.js');
  if(task.stopping||task.finished){await releaseLiveDevices(task);return;}
  task.worklet=new AudioWorkletNode(task.capture,'live-capture');task.input=task.capture.createMediaStreamSource(task.stream);task.mute=task.capture.createGain();task.mute.gain.value=0;
  task.input.connect(task.worklet);task.worklet.connect(task.mute);task.mute.connect(task.capture.destination);await task.capture.resume();
  if(task.stopping||task.finished){await releaseLiveDevices(task);return;}
  }
  if(task.stopping||task.finished||!same(task.owner)||task.key!==liveKey(state())){await releaseLiveDevices(task);return;}
  const socket=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/api/roundtable/exercise/live');task.socket=socket;
  if(task.worklet)task.worklet.port.onmessage=e=>{if(!task.ready||task.stopping||task.finished||socket.readyState!==1)return;if(socket.bufferedAmount>128000){void finishLive(task,'Connection is too slow. Microphone stopped; review your transcript.');return;}socket.send(e.data);};
  socket.onopen=()=>{if(task.finished){socket.close();return;}socket.send(JSON.stringify({token:task.owner.token,revision:task.revision,input_mode:task.inputMode}));};
  let processing=Promise.resolve();
  socket.onmessage=e=>{processing=processing.then(async()=>{
   if(task.finished)return;const event=JSON.parse(e.data);
   if(event.type==='ready'){
    clearTimeout(task.timer);task.ready=true;task.connectionId=event.connection_id;task.clips=event.clips||[];
    $('liveClipSelect').replaceChildren(...task.clips.map(c=>{const n=el('option',c.title);n.value=c.id;return n;}));
    if(task.clips.length){$('liveClipSelect').value=task.clips[0].id;$('liveClipCaption').textContent=task.clips[0].text;}
    $('liveState').textContent=task.inputMode==='recordings'?'LIVE · Saved clips connected. Microphone is OFF. Send the selected participant answer when ready.':'LIVE · Microphone on. Speak naturally; you can interrupt the agent. Stop before reviewing your answer.';
    task.timer=setTimeout(()=>void stopLiveAudio(),event.max_seconds*1000);render();
   }
   if(event.type==='fixture_started'){task.playingClip=true;$('liveClipState').textContent='Playing into Gemini: '+event.title+' · '+Math.ceil(event.seconds)+'s. This is a prerecorded participant, not your microphone.';render();}
   if(event.type==='fixture_audio'&&!task.stopping)task.fixturePlayer?.append(event.pcm,event.sample_rate);
   if(event.type==='fixture_complete'){task.playingClip=false;await task.fixturePlayer?.drain();if(!task.stopping)for(const chunk of task.deferredAudio||[])task.player.append(chunk.pcm,chunk.sample_rate);task.deferredAudio=[];$('liveClipState').textContent='Recording sent. Listen to the live reply, then Stop and review the recognized answer.';render();}

   if(event.type==='transcript')showLiveTranscript(task,event.role,event.text);
   if(event.type==='audio'&&!task.stopping){if(task.playingClip)(task.deferredAudio||=[]).push(event);else task.player.append(event.pcm,event.sample_rate);}
   if(event.type==='interrupted'&&!task.stopping){task.deferredAudio=[];await task.player.stop();task.player=new PCMStreamPlayer();void task.player.unlock();}
   if(event.type==='notice')$('liveState').textContent=event.message;
   if(event.type==='error')task.error=event.message;
   if(event.type==='closed'){if(event.transcript)task.history=event.transcript;await finishLive(task,task.error||'Live session ended. Your transcript is provisional; review it before submitting.');}
  }).catch(()=>finishLive(task,'Live audio stopped. Your submitted answers are unchanged.'));};
  socket.onclose=()=>void processing.finally(()=>finishLive(task,task.error));
  socket.onerror=()=>{task.error='Live connection failed. Check the backend Live key; your saved answers are unchanged.';};
  task.timer=setTimeout(()=>void finishLive(task,'Live connection timed out. Audio stopped.'),30000);
 }catch(e){await finishLive(task,e.name==='NotAllowedError'?'Microphone permission was denied. You can still type or use saved clips.':e.message);}
}
bind('startLive',()=>startLiveAudio('microphone'));
bind('startLiveClips',()=>startLiveAudio('recordings'));
bind('sendLiveClip',async()=>{
 const task=liveTask,id=$('liveClipSelect').value;
 if(!task?.ready||task.inputMode!=='recordings'||task.playingClip||task.stopping||task.key!==liveKey(state())||!task.clips.some(c=>c.id===id))throw new Error('Connect saved clip mode for the current question first.');
 task.playingClip=true;task.deferredAudio=[];await task.player.stop();task.player=new PCMStreamPlayer();void task.player.unlock();
 task.socket.send(JSON.stringify({type:'play_fixture',clip_id:id}));$('liveClipState').textContent='Sending the selected recording to Gemini…';render();
});
$('liveClipSelect').onchange=()=>{$('liveClipCaption').textContent=liveTask?.clips?.find(c=>c.id===$('liveClipSelect').value)?.text||'';};
function liveAnswerMetadata(){return liveAnswerSource?.key===liveKey(state())?{live_session_id:liveAnswerSource.id}:{};}
$('stopLive').onclick=()=>void stopLiveAudio();
$('resumeLive').onclick=()=>{void liveTask?.player?.unlock();void liveTask?.fixturePlayer?.unlock();};
$('liveEndTurn').onclick=()=>{if(liveTask?.socket?.readyState===1)liveTask.socket.send(JSON.stringify({type:'end_turn'}));};
bind('useLiveAnswer',async()=>{if(liveTask||!liveDraft||liveDraft.key!==liveKey(state()))throw new Error('Stop Live and review the transcript for this question first.');$('privateAnswer').value=liveDraft.text;liveAnswerSource={key:liveDraft.key,id:liveDraft.connectionId};$('confirmPrivateAnswer').checked=false;$('liveState').textContent='Your words are in the editable answer box. Remove conversational questions, correct transcription, then confirm and submit.';});
window.addEventListener('beforeunload',()=>{const task=liveTask;if(!task)return;task.stream?.getTracks().forEach(t=>t.stop());task.socket?.close();void task.player?.stop();void task.fixturePlayer?.stop();});
void checkLiveStatus();setInterval(()=>{if(!liveTask)void checkLiveStatus();},10000);
