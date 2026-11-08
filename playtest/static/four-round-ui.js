'use strict';
let exerciseVoice=null,fixturePlayback=null,fixtureDraft=null,fixtureClips=[],fixtureKey='',privateFormKey='',cardFormKey='',reunionFormKey='',exerciseAuto=new Set();
const four=s=>s?.flow==='four_rounds';
const exerciseKey=s=>[s?.code,s?.me,s?.phase,s?.private_session?.phase,s?.private_session?.turn,s?.private_session?.revision].join(':');
const exerciseFields=['action','responsibility','evidence','dependencies','fallback','communication','review'];
function renderFourRounds(s,locked){
 const enabled=four(s),privateStage=enabled&&s.phase==='private',reunion=enabled&&['reunion','ended'].includes(s.phase)&&!!s.reunion,ps=s?.private_session;
 $('betaMode').disabled=!enabled||s.phase!=='lobby'||s.me!==s.ceo||busy;if(enabled)$('betaMode').checked=s.beta_mode;
 $('privatePanel').hidden=!privateStage;$('reunionPanel').hidden=!reunion;
 $('exerciseRecordings').hidden=!enabled||!['decision','private','reunion'].includes(s.phase);
 if(!enabled)return;
 $('groupAgents').hidden=privateStage||reunion;$('groupDiscussion').hidden=privateStage||reunion;$('roundOneExperts').hidden=privateStage||reunion;$('individualPanel').hidden=privateStage||reunion;
 if(s.phase==='decision')$('end').textContent='CEO: Start Round 2';
 $('phaseHint').textContent=privateStage?'One human and one coach/examiner per private branch. Other members cannot see this conversation.':reunion?(s.solo_test?'Review your personal assessment. Playback has stopped; request feedback when ready.':s.test_skip?.ranking_disabled?'Test reunion: review recorded work. Skipped work is unassessed; no winner.':'Compare separate branches, review the evidence, then announce the highest final score.'):$('phaseHint').textContent;
 if(privateStage)$('phase').textContent='Round '+s.exercise_round+' · Private '+(ps.phase==='coaching'||ps.phase==='card_review'?'preparation':'assessment');
 if(reunion)$('phase').textContent=s.phase==='ended'?'Exercise complete':s.solo_test?'Your results':'Round 4 · Board reunion';
 if(exerciseVoice&&(!same(exerciseVoice.owner)||active!==exerciseVoice.owner.seat||exerciseVoice.skipRevision!==s.test_skip?.revision))void stopExerciseVoice();
 const signature=exerciseKey(s);
 if(fixturePlayback&&fixturePlayback.key!==signature)void stopFixture().catch(e=>say(e.message));
 if(fixtureDraft&&fixtureDraft.key!==signature)fixtureDraft=null;
 if(fixtureKey!==signature){fixtureKey=signature;fixtureClips=[];$('fixtureSelect').replaceChildren();if(['decision','private','reunion'].includes(s.phase))void loadExerciseClips(signature);}
 const answerReady=privateStage&&['coaching','assessment'].includes(ps.phase)&&!!ps.prompt;
 $('playFixture').disabled=locked||!!exerciseVoice||!!briefing||!fixtureClips.length||privateStage&&!answerReady;
 $('stopFixture').disabled=!fixturePlayback;$('useFixture').disabled=locked||!fixturePlayback?.finished;$('ownAnswer').disabled=busy||!fixturePlayback&&!fixtureDraft;
 $('fixtureHint').textContent=s.beta_mode?'Beta mode: these fictional human answers match the fixed question order. Play, review, then separately submit.':'Adaptive mode: Gemini may ask a different question. Use the sample only if it answers the actual question, or give your own response.';
 if(privateStage){
  $('privateRoundLabel').textContent='ROUND '+s.exercise_round+' · PRIVATE · '+s.members.find(m=>m.id===s.me)?.name;
  $('privateTitle').textContent=ps.phase==='coaching'||ps.phase==='card_review'?'Your crisis coach':'Your examiner';
  $('privateProgress').textContent=(ps.phase==='coaching'?'Coaching turn '+ps.turn+' of 3':ps.phase==='card_review'?'Review your response card':ps.phase==='assessment_done'?'Assessment finished; waiting for the other members':'Assessment stage '+ps.turn+' of 3')+' · '+(s.beta_mode?'Predictable beta questions':'Adaptive Gemini questions');
  $('privateScore').textContent=['coaching','card_review'].includes(ps.phase)?'Preparation earns no points.':ps.assessment_skipped?ps.total+' earned points recorded · assessment skipped.':ps.total+' / 100 points so far. Detailed feedback appears after all three assessment stages.';
  if(!exerciseVoice)$('privateAgentText').textContent=ps.prompt||ps.error||(ps.phase==='grading'?'Your submitted answer is ready for evidence based scoring.':ps.phase==='assessment_done'?'Your assessment is complete. Other members are finishing their own branches.':'Continue with your agent to receive the next question.');
  $('privateAgent').disabled=locked||!!exerciseVoice||!!fixturePlayback||ps.busy||ps.phase==='assessment_done';
  $('privateAgent').textContent=ps.error?'Retry agent request':ps.phase==='grading'?'Score submitted answer and continue':ps.prompt?'Hear my agent again':'Continue with my agent';
  $('privateAnswerBox').hidden=!answerReady;
  if(privateFormKey!==signature){privateFormKey=signature;$('privateAnswer').value='';$('confirmPrivateAnswer').checked=false;}
  $('submitPrivate').disabled=locked||ps.busy||!answerReady||!$('confirmPrivateAnswer').checked;
  $('responseCard').hidden=ps.phase!=='card_review'||!ps.card;
  if(ps.card&&cardFormKey!==signature){cardFormKey=signature;$('responseCardFields').replaceChildren(...exerciseFields.map(field=>{const label=el('label',field[0].toUpperCase()+field.slice(1)),input=el('textarea');input.id='card_'+field;input.value=ps.card[field]||'';input.maxLength=800;input.rows=2;label.append(input);return label;}));$('confirmCard').checked=false;}
  $('submitCard').disabled=locked||ps.busy||ps.phase!=='card_review'||!ps.card||!$('confirmCard').checked;
  $('privateHistory').replaceChildren(...ps.history.map(row=>{const n=el('article',undefined,'reply');n.append(el('b',row.phase+' · turn '+row.turn),el('p','Agent: '+row.question),el('p','You: '+row.answer),el('small',row.scripted?'Reviewed scripted test answer':'Human submitted answer'));return n;}));
  $('privateFeedback').replaceChildren(...Object.values(ps.scores).map(score=>{const n=el('article',undefined,'reply');n.append(el('b','Stage '+(score.stage||'?')+': '+score.total+' / '+score.maximum));for(const c of score.criteria||[])n.append(el('p',c.id+': '+c.points+'/10. '+c.reason),el('blockquote',c.evidence||'No supporting passage'));return n;}));
 }
 for(const [target,sourceId] of [['recordPrivate','record'],['stopPrivateRecord','stopRecord'],['transcribePrivate','transcribe']])$(target).disabled=$(sourceId).disabled||!privateStage;
 for(const [target,sourceId] of [['recordReunion','record'],['stopReunionRecord','stopRecord'],['transcribeReunion','transcribe']])$(target).disabled=$(sourceId).disabled||!reunion||s.phase!=='reunion';
 $('stopExerciseVoice').disabled=!exerciseVoice;
 if(reunion){
  const r=s.reunion;if(reunionFormKey!==s.code+':'+s.me){reunionFormKey=s.code+':'+s.me;$('reviewQuote').value='';$('reunionAnswer').value='';}
  $('reunionAgent').textContent=s.solo_test?'Hear my feedback':'CEO: Hear reunion summary';
 $('reunionAgent').disabled=locked||!!exerciseVoice||s.me!==s.ceo||s.phase!=='reunion';
  $('reunionSummary').textContent=r.summary?.text||(s.solo_test?'Your scores are below. Choose Hear my feedback when ready.':'The facilitator will compare these branches. Scores come from the assessment record.');
  $('reunionResults').replaceChildren(...r.branches.map(b=>{const n=el('article',undefined,'reply');n.append(el('h3',b.name+' · '+b.total+(b.assessment_skipped?' earned points · incomplete':'/100')),el('p','Original approach: '+b.original_decision.action),el('p','Final instruction: '+(b.assessment_answers.assessment_3?.text||'Not submitted')),el('small',b.reviewed?'Review confirmed':'Awaiting member review'));for(const score of Object.values(b.scores)){const detail=el('details');detail.append(el('summary','Stage '+score.stage+': '+score.total+'/'+score.maximum));for(const c of score.criteria)detail.append(el('p',c.id+': '+c.points+'/10. '+c.reason),el('blockquote',c.evidence||'No supporting passage'));n.append(detail);}return n;}));
  $('reviewControls').hidden=s.phase!=='reunion';
  $('scoreReviewStatus').textContent=Object.entries(ps.appeals||{}).map(([stage,a])=>'Stage '+stage+' review: '+a.status).join(' · ')||'Use an exact passage from your own submitted Round 3 answer.';
  $('requestScoreReview').disabled=locked||ps.busy||s.phase!=='reunion';$('withdrawScoreReview').disabled=locked||ps.busy||!Object.values(ps.appeals||{}).some(a=>a.status==='failed');
  $('confirmScoreReview').disabled=locked||ps.busy||s.phase!=='reunion'||Object.values(ps.appeals||{}).some(a=>['pending','failed'].includes(a.status));
  $('submitReunion').disabled=locked||s.phase!=='reunion';
  $('reunionDiscussion').replaceChildren(...r.discussion.map(x=>{const n=el('article',undefined,'line');n.append(el('b',x.name),el('p',x.text));return n;}));
  $('announceWinner').textContent=s.solo_test?'Finish my test':'CEO: Announce final winner';
 $('announceWinner').disabled=!!s.test_skip?.ranking_disabled||locked||s.me!==s.ceo||s.phase!=='reunion'||!r.branches.every(b=>b.reviewed)||r.summary?.score_version!==r.score_version;
  $('winnerAnnouncement').textContent=s.solo_test?(s.phase==='ended'?'Your single member test is complete.':'Review your own results, then finish. No other members or competition winner are required.'):r.winners.length?(r.winners.length>1?'Joint winners: ':'Winner: ')+r.winners.map(id=>s.members.find(m=>m.id===id)?.name).join(', ')+'. Highest final Round 3 score.':s.test_skip?.ranking_disabled?'Historical incomplete test: rounds were skipped. Start a fresh room with the corrected controls; no winner is announced.':'Winner announced after every member reviews their evidence.';
 }
}
async function loadExerciseClips(key){const owner=context();try{const result=await api('/api/roundtable/exercise/recordings',undefined,owner);if(!same(owner)||key!==fixtureKey)return;fixtureClips=result.clips||[];$('fixtureSelect').replaceChildren(...fixtureClips.map(c=>{const option=el('option',c.title+' · '+c.duration_seconds.toFixed(1)+'s');option.value=c.id;return option;}));if(fixtureClips.length)$('fixtureSelect').value=fixtureClips[0].id;updateFixtureCaption();render();}catch(e){if(key===fixtureKey)$('fixtureStatus').textContent=e.message;}}
function updateFixtureCaption(){$('fixtureCaption').textContent=fixtureClips.find(c=>c.id===$('fixtureSelect').value)?.text||'No saved response is needed at this stage.';}
$('fixtureSelect').onchange=updateFixtureCaption;
async function stopFixture(){const task=fixturePlayback;fixturePlayback=null;fixtureDraft=null;$('fixtureAudio').pause();$('fixtureAudio').removeAttribute('src');if(task){task.cancelled=true;task.resolve?.(false);if(task.url)URL.revokeObjectURL(task.url);await api('/api/roundtable/exercise/recordings/stop',{},task.owner).catch(()=>{});}else if(bundle)await api('/api/roundtable/exercise/recordings/stop',{}).catch(()=>{});render();}
bind('playFixture',async()=>{
 if(exerciseVoice||briefing||turnPlayback||fixturePlayback)throw new Error('Stop the current audio first.');
 const owner=context(),key=exerciseKey(state()),clipId=$('fixtureSelect').value,task={owner,key,cancelled:false,finished:false};fixturePlayback=task;fixtureDraft=null;render();
 try{const lease=await api('/api/roundtable/exercise/recordings/play',{clip_id:clipId},owner);task.id=lease.id;if(task.cancelled||!same(owner)||key!==exerciseKey(state()))return;
 const blob=await api('/api/roundtable/exercise/recordings/audio/'+lease.id,undefined,owner,{blob:true});if(task.cancelled||key!==exerciseKey(state()))return;
 task.url=URL.createObjectURL(blob);const audio=$('fixtureAudio');audio.src=task.url;const ended=new Promise((resolve,reject)=>{task.resolve=resolve;audio.onended=()=>resolve(true);audio.onerror=()=>reject(new Error('Sample audio could not play.'));});await audio.play();$('fixtureStatus').textContent='Playing a prerecorded human response. Nothing is submitted.';
 task.finished=await ended;if(task.finished)$('fixtureStatus').textContent='Playback finished. Review this answer as a draft, then submit separately.';
 }catch(e){await stopFixture();throw e;}finally{render();}
});
$('stopFixture').onclick=()=>stopFixture().catch(e=>say(e.message));
bind('ownAnswer',async()=>{await stopFixture();$('fixtureStatus').textContent='Using your own reviewed answer. The text stays editable.';});
bind('useFixture',async()=>{
 const task=fixturePlayback;if(!task?.finished||task.key!==exerciseKey(state()))throw new Error('Finish the sample for this turn first.');
 const result=await api('/api/roundtable/exercise/recordings/complete',{id:task.id},task.owner);if(!same(task.owner)||task.key!==exerciseKey(state()))return;
 fixtureDraft={owner:task.owner,key:task.key,id:result.lease_id};if(task.url)URL.revokeObjectURL(task.url);fixturePlayback=null;$('fixtureAudio').removeAttribute('src');
 if(state().phase==='decision'){$('individualAnswer').value=result.response_fields?decisionAnswer(result.response_fields):result.text;$('confirmIndividual').checked=false;}
 else if(state().phase==='private'){$('privateAnswer').value=result.text;$('confirmPrivateAnswer').checked=false;}
 else $('reunionAnswer').value=result.text;
 $('fixtureStatus').textContent='Draft loaded. Review or edit it, then confirm and submit. No answer has been submitted automatically.';
});
async function stopExerciseVoice(){const task=exerciseVoice;if(!task)return;task.controller.abort();await task.player?.stop();}
$('stopExerciseVoice').onclick=()=>stopExerciseVoice().catch(e=>say(e.message));
async function runExerciseAgent(reunion=false){
 if(exerciseVoice||briefing||fixturePlayback||turnPlayback||recording)throw new Error('Stop other audio before asking your agent.');
 const owner=context(),controller=new AbortController(),voice=$('voiceOn').checked,task={owner,controller,skipRevision:state()?.test_skip?.revision,player:voice?new PCMStreamPlayer():null};exerciseVoice=task;render();
 try{
  if(task.player){$('resumeAudio').hidden=false;await Promise.race([task.player.unlock(),new Promise(resolve=>setTimeout(resolve,1500))]);}
  $('privateAgentStatus').textContent='Gemini is preparing this turn…';
  const response=await fetch('/api/roundtable/exercise/'+(reunion?'reunion':'agent'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+owner.token},body:JSON.stringify({command_id:uid(),voice}),signal:controller.signal});
  if(!response.ok){const error=await response.json();throw new Error(error.error||'Agent request failed');}
  let done=false;
  await consumeNDJSON(response.body,async event=>{if(!same(owner)||active!==owner.seat||controller.signal.aborted)return;if(event.type==='text'){if(reunion)$('reunionSummary').textContent=event.text;else $('privateAgentText').textContent=event.text;}if(event.type==='audio')task.player?.append(event.pcm,event.sample_rate);if(event.type==='speech_error')say(event.message);if(event.type==='done')done=true;},controller.signal);
  if(!done&&!controller.signal.aborted)throw new Error('The connection ended early. Check the saved text before retrying.');
  await task.player?.drain();$('privateAgentStatus').textContent='Agent turn complete. Review the question or response card.';
 }catch(e){if(e.name!=='AbortError')throw e;}
 finally{await task.player?.stop();if(exerciseVoice===task)exerciseVoice=null;$('resumeAudio').hidden=true;await refresh();await health();render();}
}
bind('privateAgent',()=>runExerciseAgent());bind('reunionAgent',()=>runExerciseAgent(true));
bind('submitPrivate',async()=>{
 const owner=context(),s=state(),ps=s.private_session;if(!four(s)||s.phase!=='private'||!['coaching','assessment'].includes(ps?.phase)||!$('confirmPrivateAnswer').checked)throw new Error('Review and confirm your answer for the current private question.');
 const text=$('privateAnswer').value.trim();if(!text)throw new Error('Enter or record an answer.');
 await command('private_answer',{...(typeof liveAnswerMetadata==='function'?liveAnswerMetadata():{}),text,revision:ps.revision,...(fixtureDraft?.key===exerciseKey(s)?{recording_lease:fixtureDraft.id}:{})},owner);fixtureDraft=null;
});
$('confirmPrivateAnswer').onchange=render;$('privateAnswer').oninput=()=>{$('confirmPrivateAnswer').checked=false;render();};
$('confirmCard').onchange=render;
bind('submitCard',async()=>{const s=state();if(!s.private_session?.card||!$('confirmCard').checked)throw new Error('Review and confirm the preparation card.');await command('confirm_response_card',{revision:s.private_session.revision,...Object.fromEntries(exerciseFields.map(field=>[field,$('card_'+field).value.trim()]))});});
$('betaMode').onchange=async()=>{try{await command('set_beta_mode',{enabled:$('betaMode').checked});}catch(e){say(e.message);render();}};
$('resumeAudio').onclick=()=>{const player=exerciseVoice?.player||briefing?.player;void player?.unlock().catch(e=>say(e.message));};
$('recordReunion').onclick=()=>$('record').onclick();$('stopReunionRecord').onclick=()=>stopRecording();$('transcribeReunion').onclick=()=>$('transcribe').onclick();
$('recordPrivate').onclick=()=>$('record').onclick();$('stopPrivateRecord').onclick=()=>stopRecording();$('transcribePrivate').onclick=()=>$('transcribe').onclick();
bind('requestScoreReview',async()=>{await api('/api/roundtable/exercise/review',{review_stage:Number($('reviewStage').value),quote:$('reviewQuote').value.trim()});await refresh();});
bind('withdrawScoreReview',()=>command('withdraw_score_review',{review_stage:Number($('reviewStage').value)}));
bind('confirmScoreReview',()=>command('confirm_score_review'));
bind('submitReunion',async()=>{await command('reunion_contribute',{text:$('reunionAnswer').value.trim(),...(fixtureDraft?.key===exerciseKey(state())?{recording_lease:fixtureDraft.id}:{})});$('reunionAnswer').value='';fixtureDraft=null;});
bind('announceWinner',()=>command(state()?.solo_test?'finish_solo_test':'announce_winner'));
async function automaticFourRounds(){
 if(typeof savedSequence!=='undefined'&&savedSequence)return;
 if(state()?.solo_test)return;
 if(typeof liveTask!=="undefined"&&liveTask)return;
 const s=state();if(!four(s)||busy||exerciseVoice||briefing||fixturePlayback||recording||turnPlayback)return;
 const p=s.private_session;let key=null,reunion=false;
 if(s.phase==='private'&&p&&!p.busy&&!p.error&&(p.phase==='grading'||p.phase==='card_review'&&!p.card||['coaching','assessment'].includes(p.phase)&&!p.prompt))key=exerciseKey(s);
 else if(s.phase==='reunion'&&s.me===s.ceo&&!s.reunion.summary){key=s.code+':reunion:'+s.reunion.score_version;reunion=true;}
 if(!key||exerciseAuto.has(key))return;exerciseAuto.add(key);busy=true;render();
 try{await runExerciseAgent(reunion);}catch(e){say(e.message+' Use the agent button to retry explicitly.');}finally{busy=false;render();}
}
window.addEventListener('beforeunload',()=>{exerciseVoice?.controller.abort();void exerciseVoice?.player?.stop();if(fixturePlayback)void stopFixture();});

// Explicit CEO test navigation, separate from normal exercise completion.
function renderTestSkips(s){
 const control=s?.test_skip,ceo=s?.me===s?.ceo;
 $('testSkipPanel').hidden=!four(s)||['lobby','ended'].includes(s?.phase);
 $('testSkipButtons').replaceChildren();
 if(control?.version!==2){$('testSkipHint').textContent='The corrected section controls need the updated server. Your existing meeting stays available here. ';const link=el('a','Open updated test app');link.href='http://127.0.0.1:8792/roundtable';$('testSkipHint').append(link);return;}
 for(const action of control.actions){
  const owner=context(),phase=s.phase,revision=control.revision;
  const b=button('CEO: '+action.label,async()=>{
   if(!same(owner)||state()?.phase!==phase||state()?.test_skip?.revision!==revision)throw new Error('The round changed. Review the current skip control.');
   if(typeof liveTask!=='undefined'&&liveTask)throw new Error('Stop Live audio before skipping.');
   await stopBriefing();await stopExerciseVoice();
   if(fixturePlayback||fixtureDraft)await stopFixture();
   await command('skip_test_stage',{stage:action.stage,expected_phase:phase,skip_revision:revision},owner);
  },busy||!ceo||control.blocked||!!recording||(typeof liveTask!=='undefined'&&!!liveTask));
  $('testSkipButtons').append(b);
 }
 const skipped=control.history.map(x=>({opening:'introduction',discussion:'discussion ended early',consultation:'continued to decisions'})[x.stage]).join(', ');
 $('testSkipHint').textContent=(!ceo?'Select the CEO for shared section controls. ':control.blocked?'Wait for the current expert response. ':'')+'Only presentation and discussion sections can end early. Every member must still submit their decision, coaching answers, reviewed card and assessment answers. Stop agent speech to move at your own pace without skipping an answer.'+(skipped?' Completed early: '+skipped+'.':'');
}
