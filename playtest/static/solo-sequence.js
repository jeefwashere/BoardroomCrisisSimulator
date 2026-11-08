'use strict';
let savedSequence=null,sequenceCatalog=null,sequenceCatalogKey='';
const sequenceKey=s=>[s?.code,s?.me,s?.phase,s?.private_session?.phase,s?.private_session?.turn,s?.private_session?.revision].join(':');
function renderSoloSequence(s){
 const eligible=four(s)&&s.solo_test&&s.phase==='private'&&['coaching','assessment'].includes(s.private_session?.phase)&&s.beta_mode;
 $('soloSequencePanel').hidden=!s?.solo_test||s.phase!=='private';
 $('soloSeat').disabled=busy||!!recording||!!turnPlayback||!!briefing||!!exerciseVoice||!!fixturePlayback||!!liveTask||!!savedSequence;
 if(eligible&&!savedSequence&&sequenceCatalogKey!==sequenceKey(s))void loadSequenceCatalog(s);
 $('runSequence').disabled=!eligible||busy||!!savedSequence||!!liveTask||!!exerciseVoice||!!briefing||!!recording||!!fixturePlayback||!!fixtureDraft||s?.private_session?.busy||!$('approveSequence').checked||sequenceCatalog?.key!==sequenceKey(s)||!liveStatus?.recorded_input;
 $('approveSequence').disabled=!!savedSequence;
 $('stopSequence').disabled=!savedSequence;
 if(savedSequence&&(!same(savedSequence.owner)||active!==savedSequence.owner.seat))void stopSavedSequence();
}
async function loadSequenceCatalog(s){
 const key=sequenceKey(s),owner=context();sequenceCatalogKey=key;sequenceCatalog=null;$('approveSequence').checked=false;
 try{const data=await api('/api/roundtable/exercise/sequence',undefined,owner);if(!same(owner)||key!==sequenceKey(state()))return;sequenceCatalog={...data,key};
  $('sequencePreview').replaceChildren(...data.clips.map(c=>{const n=el('li');n.append(el('b','Turn '+c.step+': '+c.question),el('p',c.text));return n;}));
  $('sequenceStatus').textContent='Ready: '+data.clips.length+' remaining recorded answers. Approve them, then run once. No microphone is used.';render();
 }catch(e){$('sequenceStatus').textContent=e.message;}
}
function sequenceCheck(run){if(run.cancelled||!same(run.owner)||active!==run.owner.seat)throw new Error('Sequence stopped. Completed answers remain saved.');}
async function sequenceWait(run,condition,ms=60000){const deadline=Date.now()+ms;while(!condition()){sequenceCheck(run);if(Date.now()>deadline)throw new Error('The sequence timed out. No further answer was submitted. Retry explicitly.');await new Promise(resolve=>setTimeout(resolve,100));}sequenceCheck(run);}
async function sequenceAgent(run){
 sequenceCheck(run);
 const response=await fetch('/api/roundtable/exercise/agent',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+run.owner.token},body:JSON.stringify({command_id:uid(),voice:false}),signal:run.controller.signal});
 if(!response.ok)throw new Error('The agent could not prepare or score this turn. Your existing answers are saved.');
 let done=false;await consumeNDJSON(response.body,async e=>{if(e.type==='error')throw new Error(e.message);if(e.type==='done')done=true;},run.controller.signal);
 sequenceCheck(run);if(!done)throw new Error('Agent response ended early.');await sequenceWait(run,()=>!polling,10000);await refresh();
}
async function runSavedSequence(){
 const s=state(),catalog=sequenceCatalog;
 if(savedSequence||!s?.solo_test||!s.beta_mode||catalog?.key!==sequenceKey(s)||!$('approveSequence').checked)throw new Error('Review and approve the current single member sequence first.');
 const run={owner:context(),phase:s.private_session.phase,clips:[...catalog.clips],controller:new AbortController(),cancelled:false};savedSequence=run;render();
 try{
  for(const clip of run.clips){
   sequenceCheck(run);await refresh();let ps=state().private_session;
   if(ps.phase!==run.phase||ps.turn!==clip.step)throw new Error('The question changed. Review the remaining sequence again.');
   if(!ps.prompt){await sequenceAgent(run);ps=state().private_session;}
   $('sequenceStatus').textContent='Turn '+clip.step+' of 3: listening to the agent question…';
   const task=await startLiveAudio('recordings');if(!task)throw new Error('Live connection did not start.');
   await sequenceWait(run,()=>task.ready||task.finished,25000);if(task.finished)throw new Error(task.error||'Live ended before playback.');
   await sequenceWait(run,()=>task.modelTurns>=1||task.finished);if(task.finished)throw new Error(task.error||'Live ended before the question finished.');
   await task.player.drain();sequenceCheck(run);
   $('sequenceStatus').textContent='Turn '+clip.step+' of 3: playing your saved answer and waiting for the live reply…';
   await sendLiveRecording(clip.id);
   await sequenceWait(run,()=>task.fixtureCompleted||task.finished);if(task.finished)throw new Error(task.error||'The recording was interrupted.');
   await sequenceWait(run,()=>task.replyCompleted||task.finished);if(task.finished)throw new Error(task.error||'Live ended before the reply completed.');
   await task.player.drain();sequenceCheck(run);
   if(!task.history.some(row=>row.role==='human'&&row.text.trim()))throw new Error('Gemini did not transcribe the saved clip. No answer submitted.');
   await stopLiveAudio();await sequenceWait(run,()=>!liveTask,5000);await refresh();sequenceCheck(run);
   await command('submit_sequence_answer',{revision:ps.revision,live_session_id:task.connectionId,approved:true},run.owner);
   if(run.phase==='assessment')await sequenceAgent(run);
  }
  if(run.phase==='coaching')await sequenceAgent(run);
  $('sequenceStatus').textContent=run.phase==='coaching'?'All 3 coaching clips finished. Playback stopped. Review and confirm your response card to begin assessment.':'All 3 assessment clips finished. Playback stopped. Your results are ready; no other member is required.';
  say($('sequenceStatus').textContent);
 }catch(e){$('sequenceStatus').textContent=run.cancelled?'Sequence stopped. Completed answers remain saved; remaining clips were not submitted.':e.message;say($('sequenceStatus').textContent);}
 finally{run.controller.abort();if(liveTask)await stopLiveAudio();savedSequence=null;sequenceCatalog=null;sequenceCatalogKey='';$('approveSequence').checked=false;await refresh();render();}
}
async function stopSavedSequence(){const run=savedSequence;if(!run)return;run.cancelled=true;run.controller.abort();if(liveTask)await stopLiveAudio();}
bind('runSequence',runSavedSequence);$('stopSequence').onclick=()=>void stopSavedSequence();$('approveSequence').onchange=render;
window.addEventListener('beforeunload',()=>{if(savedSequence){savedSequence.cancelled=true;savedSequence.controller.abort();}});
render();
