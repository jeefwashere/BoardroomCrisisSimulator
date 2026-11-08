'use strict';
const $=id=>document.getElementById(id),uid=()=>crypto.randomUUID(),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let bundle=null;try{bundle=JSON.parse(sessionStorage.getItem('rehearsal_roundtable_v2')||'null');}catch{}
let states=[],active=0,busy=false,polling=false,memory=null,recording=null,clip=null,clipOwner=null,source='typed',documentKey='',transcriptKey='',rosterKey='',briefing=null,turnPlayback=null,completedPlayback=null,recordings=[],automaticRunning=false,decisionPlayback=null,voteDrafts=Object.create(null),voteFocusKey='',scriptLength=9,ballotVersions=Object.create(null),customFormContext=null,customFormKey='';
const save=()=>sessionStorage.setItem('rehearsal_roundtable_v2',JSON.stringify(bundle)),state=()=>states[active],say=t=>{$('notice').textContent=t;};
const context=()=>({code:bundle?.code,token:bundle?.seats[active]?.token,seat:active});
const same=c=>bundle?.code===c.code&&bundle?.seats[c.seat]?.token===c.token;
async function api(path,data,c=context(),extra={}){const headers={...extra.headers};if(c?.token)headers.Authorization='Bearer '+c.token;let body=data;if(data!==undefined&&!(data instanceof Blob)){headers['Content-Type']='application/json';body=JSON.stringify(data);}const r=await fetch(path,{method:data===undefined?'GET':'POST',headers,body});if(!r.ok){let e;try{e=await r.json();}catch{}throw new Error(e?.error||e?.detail||'Request failed ('+r.status+')');}return extra.blob?r.blob():r.json();}
async function command(action,data={},c=context()){const result=await api('/api/roundtable/command/'+action,{command_id:uid(),...data},c);if(same(c)&&result?.me)states[c.seat]={...result,received:Date.now()};await refresh();}
function bind(id,fn){$(id).onclick=async()=>{if(busy)return;busy=true;render();try{say('');await fn();}catch(e){say(e.message);}finally{busy=false;render();}};}
function button(text,fn,disabled=false){const b=el('button',text,'secondary');b.disabled=disabled||busy;b.onclick=async()=>{if(busy)return;busy=true;render();try{await fn();}catch(e){say(e.message);}finally{busy=false;render();}};return b;}
async function refresh(){if(polling||!bundle)return;polling=true;const b=bundle;try{const results=await Promise.all(b.seats.map((s,seat)=>api('/api/roundtable/state',undefined,{code:b.code,token:s.token,seat})));if(bundle!==b)return;states=results.map((s,i)=>states[i]?.server_time>s.server_time?states[i]:({...s,received:Date.now()}));if(briefing&&(!same(briefing.owner)||state()?.phase!==briefing.phase))await stopBriefing();if((turnPlayback&&!sameTurn(turnPlayback))||(completedPlayback&&!sameTurn(completedPlayback)))await stopTurnPlayback();if(decisionPlayback&&(!same(decisionPlayback.owner)||state()?.phase!=='decision'))await stopDecisionGuide();if(recording&&(!canRecordHere(state())||state()?.phase!==recording.owner.phase))await stopRecording();render();void automaticAgents();}catch(e){say(e.message);}finally{polling=false;}}
async function loadMemory(){const c=context();const m=await api('/api/roundtable/memory',undefined,c);if(same(c)){memory=m;documentKey='';render();}}
async function health(){try{const h=await api('/api/health',undefined,{});$('health').textContent=(h.models?.model||'Vertex Flash')+' · '+(h.models?.thinking_level||'LOW');$('budget').textContent=h.speech?.unlimited&&h.models?.budget?.unlimited?'Usage tracking only · no app spending cap':'Usage tracking enabled. Live agent replies use Gemini and ElevenLabs.';}catch{$('health').textContent='Local server unavailable';}}
async function join(test){if(recording)throw new Error('Stop recording first.');const names=test?['Alex · test CEO','Morgan · test member','Sam · test member']:[$('name').value.trim()];if(!names[0])throw new Error('Enter a name.');const first=await api('/api/roundtable/join',{name:names[0],flow:'board_round1',...(test||!$('code').value.trim()?{}:{code:$('code').value.trim().toUpperCase()})},{});bundle={code:first.code,seats:[{name:names[0],token:first.token}],test,autoEvents:[]};voteDrafts=Object.create(null);voteFocusKey='';ballotVersions=Object.create(null);customFormContext=null;customFormKey='';$('ballotUpdate').textContent='';recordings=[];scriptLength=9;completedPlayback=null;active=0;states=[];memory=null;clip=null;clipOwner=null;source='typed';$('message').value='';save();for(const name of names.slice(1)){const r=await api('/api/roundtable/join',{name,code:bundle.code},{});bundle.seats.push({name,token:r.token});save();}documentKey=transcriptKey=rosterKey='';await refresh();await loadMemory();await loadRecordings();}
const phaseNames={lobby:'Prepare together',preparation:'Your 30 second introduction',discussion:'Five minute discussion',consultation:'One minute with live advisers',decision:'Make your decisions',ended:'Meeting complete'};
const phaseHints={lobby:'Load your test participants, then the CEO starts the introduction.',preparation:'The preparation agent sets the scene. Discussion opens after 30 seconds.',discussion:'Each participant speaks in turn. Finish early to consult the advisers.',consultation:'Ask the live facilitator, IT character or journalist. The CEO can continue to voting early.',decision:'Review the recorded guide, choose a response for each participant, then the CEO records the result.',ended:'Review the evaluation and export your written record.'};
const ballotVersion=d=>d?.ballot_version??1;
function recordingAtTurn(turn){return recordings.find(r=>r.turn_number===turn);}
function upcomingRecording(s,memberId){const order=s.speaking?.length?s.speaking:s.members.map(m=>m.id),index=order.indexOf(memberId);if(index<0||!order.length)return null;const current=Math.max(1,s.turn_number||1),speakerIndex=s.speaker?order.indexOf(s.speaker):(current-1)%order.length,offset=(index-Math.max(0,speakerIndex)+order.length)%order.length;return recordingAtTurn(current+offset)||null;}
function syncBallotRevision(){
 const s=state();if(!s)return;
 for(const d of s.decisions||[]){if(d.mode!=='fixed_choice')continue;const key=s.code+':'+d.id,version=ballotVersion(d),previous=ballotVersions[key];
  if(previous!==undefined&&version>previous){for(const draftKey of Object.keys(voteDrafts))if(draftKey.startsWith(key+':'))delete voteDrafts[draftKey];voteFocusKey='';$('ballotUpdate').textContent='Ballot updated to version '+version+'. All previous votes and selections were cleared. Every participant must vote again.';}
  ballotVersions[key]=Math.max(previous||0,version);
 }
}
function renderCustomForm(s,locked){
 const d=s?.decisions?.find(d=>d.mode==='fixed_choice'&&d.status==='pending'),visible=s?.phase==='decision'&&!!d&&s.me===s.ceo;
 $('fixedCustomForm').hidden=!visible;if(!visible){$('addCustomOption').disabled=true;customFormContext=null;customFormKey='';return;}
 const revision=ballotVersion(d),key=s.code+':'+d.id+':'+revision+':'+s.me;
 if(customFormKey!==key){customFormKey=key;customFormContext={owner:context(),decisionId:d.id,revision};$('customOptionTitle').value='';$('customOptionProposal').value='';$('acknowledgeReset').checked=false;}
 const hasVotes=d.ballot_count>0,full=d.options.length>=6,eligible=(s.electorate||s.members.map(m=>m.id)).includes(s.me);
 $('resetAcknowledgement').hidden=!hasVotes;$('customOptionLimit').textContent=d.options.length+' of 6 choices used. '+(full?'The choice limit has been reached.':'Prepared choices remain available alongside custom responses.');
 $('addCustomOption').textContent=hasVotes?'Add custom option and restart voting':'Add custom option';$('addCustomOption').disabled=locked||!!briefing||!eligible||full||(hasVotes&&!$('acknowledgeReset').checked);for(const id of ['customOptionTitle','customOptionProposal','acknowledgeReset'])$(id).disabled=locked||!!briefing||full||!eligible;
}
async function addCustomOption(){
 const form=customFormContext,s=state(),d=s?.decisions?.find(d=>d.id===form?.decisionId);
 if(!form||!same(form.owner)||context().token!==form.owner.token||s.me!==s.ceo||s.phase!=='decision'||d?.status!=='pending'||ballotVersion(d)!==form.revision)throw new Error('The participant or ballot changed. Review the custom response again.');
 const title=$('customOptionTitle').value.trim(),proposal=$('customOptionProposal').value.trim(),acknowledge_reset=$('acknowledgeReset').checked===true;
 if(!title||title.length>80||!proposal||proposal.length>1500)throw new Error('Enter a title of up to 80 characters and a response of up to 1500 characters.');
 if(d.options.length>=6)throw new Error('This ballot already has six choices.');if(d.ballot_count>0&&!acknowledge_reset)throw new Error('Confirm that all existing votes will be cleared before adding this option.');
 await command('add_custom_option',{decision_id:d.id,title,proposal,ballot_version:form.revision,acknowledge_reset},form.owner);$('customOptionTitle').value='';$('customOptionProposal').value='';$('acknowledgeReset').checked=false;
}
async function commitFixedDecision(decisionId,revision,owner,optionId){const s=state(),d=s?.decisions?.find(d=>d.id===decisionId);if(!same(owner)||context().token!==owner.token||s?.phase!=='decision'||d?.status!=='pending'||ballotVersion(d)!==revision)throw new Error('The participant or ballot changed. Review the result again.');await command('commit_decision',{decision_id:decisionId,ballot_version:revision,...(optionId?{option_id:optionId}:{})},owner);}
function nextVoter(d,s){return d.next_voter!==undefined?d.next_voter:(s.electorate||s.members.map(m=>m.id)).find(id=>!(d.voted_members||[]).includes(id))||null;}
function followVoteTurn(){
 if(!bundle?.test||briefing||decisionPlayback||recording||turnPlayback)return;
 const s=state(),d=s?.decisions?.find(d=>d.mode==='fixed_choice'&&d.status==='pending');if(s?.phase!=='decision'||!d)return;
 const revision=ballotVersion(d);if(states.some(own=>{const other=own.decisions?.find(x=>x.id===d.id);return other&&ballotVersion(other)<revision;}))return;
 const target=nextVoter(d,s)||s.ceo,key=s.code+':'+d.id+':'+revision+':'+target;
 if(voteFocusKey===key)return;
 const seat=states.findIndex(own=>own.me===target);if(seat<0)return;
 active=seat;voteFocusKey=key;
 $('decisions').scrollIntoView?.({behavior:'smooth',block:'nearest'});
}
function voteDraftKey(d,s){return s.code+':'+d.id+':'+ballotVersion(d)+':'+s.me;}
async function confirmVote(decisionId,owner,expectedOption,expectedRevision){
 if(!owner||!same(owner)||context().token!==owner.token)throw new Error('The selected participant changed. Review and confirm again.');
 const s=state(),d=s?.decisions?.find(d=>d.id===decisionId),key=d&&voteDraftKey(d,s),option=voteDrafts[key];
 if(ballotVersion(d)!==expectedRevision)throw new Error('The ballot changed. Previous selections are cleared; choose again.');
 if(s?.phase!=='decision'||d?.status!=='pending'||option!==expectedOption||!d.options?.some(o=>o.id===option))throw new Error('Choose one response before confirming your vote.');
 if(nextVoter(d,s)!==s.me&&!(d.voted_members||[]).includes(s.me))throw new Error('Wait until you are asked for your decision.');
 await command('vote_option',{decision_id:d.id,option_id:option,ballot_version:expectedRevision},owner);
 delete voteDrafts[key];say('Vote received for '+s.members.find(m=>m.id===s.me)?.name+'.');
 followVoteTurn();render();
}
function render(){syncBallotRevision();followVoteTurn();const s=state(),phase=s?.phase,ceo=s&&s.me===s.ceo,host=s&&s.me===s.host,fac=['discussion','consultation','decision'].includes(phase)&&(ceo||isRoundOne(s)),turn=phase==='discussion'&&s?.speaker===s?.me,locked=busy||!!recording||!!turnPlayback||!!decisionPlayback;
 $('stopDecisionGuide').disabled=!decisionPlayback;$('playDecisionGuide').disabled=locked||!!briefing||!ceo||phase!=='decision'||!s?.decisions?.some(d=>d.mode==='fixed_choice');$('consultationNotice').hidden=phase!=='consultation';
 $('stopBriefing').disabled=!briefing;$('intro').disabled=busy||!s?.documents_ready||phase!=='lobby';$('intro').hidden=phase!=='lobby';
 $('playTurn').disabled=locked||!!briefing||!turn||!recordingAtTurn(s?.turn_number)?.available||!!completedPlayback;$('stopTurn').disabled=!turnPlayback&&!completedPlayback;$('commitRecorded').disabled=locked||!completedPlayback||!sameTurn(completedPlayback);$('nextTurn').disabled=locked||!!briefing||phase!=='discussion'||!(turn||ceo)||!!completedPlayback;
 const disabled={join:locked,testSeats:locked,ready:busy||phase!=='lobby',allReady:busy||phase!=='lobby'||!bundle?.test,start:busy||!ceo||!s?.can_start,finishDiscussion:locked||!ceo||phase!=='discussion',skipConsultation:locked||!ceo||phase!=='consultation',end:busy||!ceo||phase!=='decision'||s?.decisions?.some(d=>d.status==='pending'),export:!s,assignCeo:busy||!host||phase!=='lobby',upload:busy||phase!=='lobby'||!(ceo||host),prepare:locked||!!briefing||!s||!s.documents_ready||!['lobby','preparation'].includes(phase),facilitate:locked||!!briefing||!fac,commit:locked||!!briefing||!turn,record:locked||!!briefing||!canRecordHere(s),stopRecord:!recording,transcribe:locked||!canRecordHere(s)||!clip||clipOwner?.token!==context().token,propose:busy||phase!=='decision',minutes:busy||!s?.transcript?.length};for(const[id,v]of Object.entries(disabled))$(id).disabled=!!v;
 $('agentKind').disabled=locked||!!briefing||!fac;
 renderCustomForm(s,locked);$('roleControls').hidden=!host||phase!=='lobby';const fixed=s?.fixed_scenario==='T01'||s?.decisions?.some(d=>d.mode==='fixed_choice');$('customDecision').hidden=!!fixed;$('decisionGuide').hidden=!fixed;$('decisionHint').textContent=fixed?'Each participant is asked in turn. Choose a response and click Confirm my vote. Every ballot is required before the CEO records the result.':'Draft a proposal for each problem, then collect ballots and record the result.';if(!s){renderRoundOne(s,locked);return;}
 const ballot=(s.decisions||[]).find(d=>d.mode==='fixed_choice'&&d.status==='pending'),voter=ballot&&nextVoter(ballot,s),voterName=s.members.find(m=>m.id===voter)?.name;
 $('votePrompt').hidden=phase!=='decision'||!ballot;const promptText=voterName?voterName+', which response do you choose? Select an option below, then confirm your vote.':'Every member has voted. The CEO must review and record the result.';if($('votePrompt').textContent!==promptText)$('votePrompt').textContent=promptText;
 const speaker=s.members.find(m=>m.id===s.speaker);$('turnSpeaker').textContent=speaker?'Turn '+s.turn_number+' · '+speaker.name:'Waiting for discussion';$('contributionHint').textContent=speaker?'Current speaker: '+speaker.name+'. Only that participant can commit a contribution.':'Discussion contributions open after the introduction.';const recordingForSeat=recordingAtTurn(s.turn_number);$('recordedCaption').textContent=recordingForSeat?.text||(s.turn_number>scriptLength?'The scripted turns are finished. Continue with typed discussion or let the CEO finish early.':'Nine scripted turns, played and committed manually.');$('recordingProgress').textContent=s.turn_number>scriptLength?'All '+scriptLength+' scripted turns have passed.':(recordingForSeat?'Recorded turn '+s.turn_number+' of '+scriptLength+' · '+recordingForSeat.title:'Nine recorded turns are ready for discussion.');$('recordingProgressBar').max=scriptLength;$('recordingProgressBar').value=Math.min(scriptLength,Math.max(0,(s.turn_number||1)-1));
 $('roomCode').textContent='ROOM '+s.code;$('phase').textContent=phaseNames[phase]||phase;$('phaseHint').textContent=phaseHints[phase]||'';const left=s.deadline?Math.max(0,Math.ceil(s.deadline-s.server_time-(Date.now()-s.received)/1000)):0;$('timer').textContent=s.deadline?String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0'):phase==='ended'?'Done':'Ready';$('memberCount').textContent=s.members.length;$('activeSeat').textContent=s.members.find(m=>m.id===s.me)?.name||'Participant';$('ready').textContent=s.members.find(m=>m.id===s.me)?.ready?'Mark not ready':'I am ready';$('allReady').hidden=!bundle.test;$('blockers').textContent=(s.start_blockers||[]).join(' · ');
 $('seats').replaceChildren(...bundle.seats.map((seat,i)=>{
  const member=s.members.find(m=>m.id===states[i]?.me),speaking=phase==='discussion'&&member?.id===s.speaker;
  const saved=upcomingRecording(s,member?.id),card=el('article',undefined,'participant-card'+(i===active?' selected':'')+(speaking?' speaking':''));
  const select=button(seat.name,async()=>{if(recording||turnPlayback)throw new Error('Stop recording or playback before switching seats.');active=i;source='typed';$('message').value='';await refresh();},!!recording||!!turnPlayback);
  select.className='participant-select';card.append(select,el('span',phase==='decision'&&ballot?(member?.id===voter?'DECIDE NOW':(ballot.voted_members||[]).includes(member?.id)?'VOTE RECEIVED':'WAITING TO VOTE'):speaking?'SPEAKING NOW':phase==='discussion'?'Waiting for turn':phase==='lobby'?'Ready for the meeting':phase==='preparation'?'Listening to introduction':'Discussion finished','turn-badge'));
  card.append(el('small',(member?.role||'participant')+' · '+(i===active?'You control this seat':'Select to control')));
  const controls=el('div',undefined,'actions');
  controls.append(button("Play this participant’s saved clip",async()=>{active=i;source='typed';$('message').value='';await playRecordedTurn();},!speaking||!saved?.available||locked||!!briefing||!!completedPlayback));
  const ownedPlayback=(turnPlayback||completedPlayback)?.owner.seat===i;
  const stop=el('button','Stop','secondary');stop.disabled=!ownedPlayback;stop.onclick=()=>stopTurnPlayback().catch(e=>say(e.message));controls.append(stop);
  controls.append(button('Commit caption and pass',commitRecordedTurn,!completedPlayback||completedPlayback.owner.seat!==i||!sameTurn(completedPlayback)||locked));
  card.append(controls,el('p',saved?'Recorded turn '+saved.turn_number+' of '+scriptLength+' · '+saved.title:'No further scripted turn for this participant.','muted'));if(saved)card.append(el('p',saved.text||'','clip-caption'));return card;
 }));
 $('roster').replaceChildren(...s.members.map(m=>{const n=el('div',undefined,'member');n.append(el('b',m.name),el('span',m.role+' · '+(m.ready?'ready':'not ready')+(m.connected?'':' · offline')));return n;}));
 const rk=s.members.map(m=>m.id+':'+m.role).join();if(rosterKey!==rk){rosterKey=rk;$('ceoSelect').replaceChildren(...s.members.map(m=>{const o=el('option',m.name);o.value=m.id;return o;}));$('ceoSelect').value=s.ceo;}
 const docs=s.documents||memory?.documents||[];const dk=JSON.stringify([docs,s.documents_ready]);if(dk!==documentKey){documentKey=dk;$('documents').replaceChildren(...docs.map(d=>{const n=el('div',undefined,'document');n.append(el('b',d.title||d.filename||d.id),el('small',(d.pages||'?')+' pages'),button('Download PDF',()=>downloadDocument(d)));return n;}));}
 for(const b of $('documents').querySelectorAll('button'))b.disabled=busy;
 $('memoryStatus').textContent=s.documents_ready?'Ready':'Preparing';$('memoryModel').textContent=s.documents_ready?'Loaded automatically. Your agent uses this report to prepare the meeting.':'The report is being prepared. You can load participants while it finishes.';
 $('recordCount').textContent=(s.transcript||[]).length+' contributions';const tk=JSON.stringify(s.transcript);if(tk!==transcriptKey){transcriptKey=tk;$('transcript').replaceChildren(...(s.transcript||[]).map(t=>{const n=el('article',undefined,'line');n.append(el('b',s.members.find(m=>m.id===(t.member||t.member_id))?.name||t.name||t.speaker||'Member'),el('small',' · '+t.id+' · '+t.source),el('p',t.text));return n;}));const checked=new Set([...$('sourceChoices').querySelectorAll('input:checked')].map(x=>x.value));$('sourceChoices').replaceChildren(...(s.transcript||[]).map(t=>{const l=el('label',undefined,'source'),c=el('input');c.type='checkbox';c.value=t.id;c.checked=checked.has(t.id);l.append(c,el('span',t.id+': '+t.text));return l;}));}
 $('replies').replaceChildren(...(s.suggestions||[]).filter(r=>r.kind!=='minutes').slice(-6).map(r=>{const n=el('article',undefined,'reply');n.append(el('b',r.kind+' · AI suggestion'),el('p',r.text));for(const c of r.citations||[])n.append(el('div',(c.title||c.document_id)+' · page '+c.page+'\n'+(c.text||''),'citation'));if(r.source_ids?.length)n.append(el('small','Discussion sources: '+r.source_ids.join(', ')));return n;}));
 $('jobs').textContent=(s.jobs||[]).slice(-5).map(j=>j.kind+': '+j.status+(j.error?' · '+j.error:'')).join(' · ');
 $('summary').replaceChildren(...(s.summary?.items||[]).map(item=>{const n=el('article',undefined,'line');n.append(el('p',item.text),el('small',(item.speaker||'')+' · sources: '+(item.source_ids||[]).join(', ')));return n;}));if(!s.summary?.items?.length)$('summary').append(el('p','No AI minutes yet. The full committed transcript is shown in Discussion.','muted'));if(s.summary?.partial)$('summary').prepend(el('p','Partial coverage: only the latest contributions that fit the bounded request were considered. The full transcript remains available.','muted'));if(s.summary?.stale)$('summary').prepend(el('p','New contributions arrived after this summary. Refresh to include them.','muted'));
 $('prompts').replaceChildren(...(s.decision_prompts||[]).map(p=>button(p.text,async()=>{$('problem').value=p.text;for(const c of $('sourceChoices').querySelectorAll('input'))c.checked=(p.source_ids||[]).includes(c.value);},phase!=='decision')));
 $('decisions').replaceChildren(...(s.decisions||[]).map(d=>renderDecision(d,s)));
 renderRoundOne(s,locked);
 $('committed').replaceChildren(...(s.decisions||[]).filter(d=>d.status!=='pending').map(d=>{const n=el('article',undefined,'line');n.append(el('b',d.status.toUpperCase()),el('p',d.problem),el('p',d.proposal));return n;}));
}
function renderDecision(d,s){
 const n=el('article',undefined,'decision'),ceo=s.me===s.ceo,phase=s.phase,pending=d.status==='pending';
 n.append(el('b',d.problem),el('small',d.status+' · '+d.ballot_count+' / '+s.members.length+' ballots'+(d.mode==='fixed_choice'?' · ballot version '+ballotVersion(d):'')));
 const voted=new Set(d.voted_members||[]),voters=el('div',undefined,'voter-status');
 for(const m of s.members)voters.append(el('span',m.name+': '+(voted.has(m.id)?'voted':'waiting'),voted.has(m.id)?'voted':'waiting'));
 n.append(voters);
 if(d.mode==='fixed_choice'){
  const key=voteDraftKey(d,s),draft=voteDrafts[key],canVote=nextVoter(d,s)===s.me||voted.has(s.me),owner=context(),revision=ballotVersion(d);
  const options=el('div',undefined,'fixed-options');
  for(const option of d.options||[]){
   const selected=draft===option.id,card=el('section',undefined,'fixed-option'+(selected?' selected':'')+(d.option_id===option.id?' winner':''));
   card.append(el('b',option.label),el('p',option.proposal));if(option.custom)card.append(el('span','Human proposal · unverified','custom-badge'),el('small','Proposed by '+(s.members.find(m=>m.id===option.proposed_by)?.name||'a participant')));if(d.tally)card.append(el('small',(d.tally[option.id]||0)+' votes'));
   if(d.my_vote===option.id)card.append(el('small','Your submitted vote'));
   if(pending)card.append(button(selected?'Selected — confirm below':'Choose this response',async()=>{
    if(!same(owner)||context().token!==owner.token)throw new Error('The selected participant changed. Choose again.');
    if(ballotVersion(state()?.decisions?.find(x=>x.id===d.id))!==revision)throw new Error('The ballot changed. Choose again.');voteDrafts[key]=option.id;render();
   },phase!=='decision'||!canVote));options.append(card);
  }
  n.append(options);
  if(pending){const confirmation=el('div',undefined,'vote-confirmation');
   const label=(d.options||[]).find(o=>o.id===draft)?.label;
   confirmation.append(el('p',label?'Your selection: '+label+'. This is not submitted yet.':canVote?'Choose one response, then confirm your vote.':'Waiting for '+(s.members.find(m=>m.id===nextVoter(d,s))?.name||'the other members')+'.'));
   confirmation.append(button(d.my_vote?'Confirm changed vote':'Confirm my vote',()=>confirmVote(d.id,owner,draft,revision),phase!=='decision'||!canVote||!label));n.append(confirmation);
  }
  if(pending&&ceo){const controls=el('div',undefined,'actions'),all=d.ballot_count===s.members.length,maximum=d.tally?Math.max(...Object.values(d.tally)):0,tied=(d.options||[]).filter(o=>maximum>0&&d.tally?.[o.id]===maximum);
   if(all&&tied.length>1){controls.append(el('p','The leading choices are tied. The CEO must choose one of them.','muted'));for(const option of tied)controls.append(button('CEO tie: '+option.label,()=>commitFixedDecision(d.id,revision,owner,option.id),phase!=='decision'));}
   else controls.append(button('CEO: Record winning response',()=>commitFixedDecision(d.id,revision,owner),!all||phase!=='decision'));
   n.append(controls);
  }
  if(!pending)n.append(el('p','Recorded response: '+((d.options||[]).find(o=>o.id===d.option_id)?.label||d.option_id)));
  return n;
 }
 n.append(el('p',d.proposal),el('small',d.my_vote?'Your vote: '+d.my_vote:''));
 if(pending){const controls=el('div',undefined,'actions');for(const choice of ['approve','reject','abstain'])controls.append(button(choice,()=>command('vote_decision',{decision_id:d.id,choice}),phase!=='decision'));if(ceo){controls.append(button('CEO: Record result',()=>command('commit_decision',{decision_id:d.id}),d.ballot_count<s.members.length));if(d.tally&&d.tally.approve===d.tally.reject&&d.tally.approve>0)for(const tie_break of ['approve','reject'])controls.append(button('CEO tie: '+tie_break,()=>command('commit_decision',{decision_id:d.id,tie_break})));controls.append(button('CEO: Cancel proposal',()=>command('cancel_decision',{decision_id:d.id,reason:'CEO cancelled this test proposal explicitly.'})));}n.append(controls);}return n;
}
async function ask(kind){const c=context();await api('/api/roundtable/agent/'+kind,{command_id:uid(),...(kind==='minutes'?{}:{text:$('question').value})},c);await refresh();await health();}
async function downloadDocument(d){const c=context();const blob=await api('/api/roundtable/documents/'+encodeURIComponent(d.id),undefined,c,{blob:true});if(same(c))download(blob,d.filename||d.id+'.pdf');}
function download(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
bind('join',()=>join(false));bind('testSeats',loadTestPeople);bind('ready',()=>command('ready',{ready:!state().members.find(m=>m.id===state().me).ready}));bind('allReady',async()=>{for(let i=0;i<bundle.seats.length;i++)await command('ready',{ready:true},{code:bundle.code,token:bundle.seats[i].token,seat:i});});
bind('assignCeo',()=>{const s=state(),roles=Object.fromEntries(s.members.map(m=>[m.id,m.id===$('ceoSelect').value?'ceo':m.role==='ceo'?'operations':m.role]));return command('assign_roles',{roles});});
bind('start',async()=>{let player=null;if($('voiceOn').checked){player=new PCMStreamPlayer();await player.unlock();}try{await command('start');await startPreparation('intro','preparation',{automatic:true},context(),player);}catch(e){await player?.stop();throw e;}});
for(const[id,action]of [['finishDiscussion','finish_discussion'],['skipConsultation','skip_consultation'],['end','end']])bind(id,()=>command(action));
bind('nextTurn',()=>command('next_turn',{turn_number:state().turn_number}));
bind('intro',()=>startPreparation('intro'));bind('prepare',()=>startPreparation('question'));bind('facilitate',()=>startPreparation('question',$('agentKind').value));bind('minutes',()=>ask('minutes'));
bind('commit',async()=>{await command('contribute',{text:$('message').value,source});$('message').value='';source='typed';clip=null;});
bind('addCustomOption',addCustomOption);$('acknowledgeReset').onchange=render;
bind('propose',async()=>{await command('propose_decision',{problem:$('problem').value,proposal:$('proposal').value,source_ids:[...$('sourceChoices').querySelectorAll('input:checked')].map(c=>c.value)});$('problem').value='';$('proposal').value='';});
bind('upload',async()=>{const file=$('pdf').files[0];if(!file)throw new Error('Select a PDF first.');if(file.size>5*1024*1024)throw new Error('PDF must be no larger than 5 MB.');await api('/api/roundtable/upload',file,context(),{headers:{'Content-Type':'application/pdf','X-Filename':encodeURIComponent(file.name)}});await loadMemory();await refresh();});
bind('export',()=>{const s=state();download(new Blob([JSON.stringify({code:s.code,phase:s.phase,members:s.members,documents:s.documents,transcript:s.transcript,summary:s.summary,flow:s.flow,individual_decision:s.individual_decision,decision_submissions:s.decision_submissions,expert_briefings:s.expert_briefings,scoring:s.scoring,decisions:s.decisions,history:s.history,jobs:s.jobs,suggestions:s.suggestions,recording_policy:s.recording_policy},null,2)],{type:'application/json'}),'roundtable-'+s.code+'.json');});
function wav(chunks,rate){const length=chunks.reduce((s,c)=>s+c.length,0),b=new ArrayBuffer(44+length*2),v=new DataView(b),str=(p,t)=>[...t].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length*2,true);let p=44;for(const c of chunks)for(const x of c){const n=Math.max(-1,Math.min(1,x));v.setInt16(p,n<0?n*32768:n*32767,true);p+=2;}return new Blob([b],{type:'audio/wav'});}
bind('record',async()=>{const owner={...context(),phase:state()?.phase,target:isRoundOne(state())&&state()?.phase==='decision'?$('decisionVoiceField').value:null};let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const fresh=await api('/api/roundtable/state',undefined,owner);if(!same(owner)||(!canRecordHere(fresh)||fresh.phase!==owner.phase))throw new Error('Discussion ended before microphone permission arrived.');const ctx=new AudioContext(),input=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(4096,1,1),mute=ctx.createGain(),chunks=[];mute.gain.value=0;processor.onaudioprocess=e=>{if(recording)chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};input.connect(processor);processor.connect(mute);mute.connect(ctx.destination);recording={owner,stream,ctx,input,processor,mute,chunks};recording.timer=setTimeout(()=>stopRecording().catch(e=>say(e.message)),29000);$('micStatus').textContent='Recording locally, up to 29 seconds. Stop before transcribing.';}catch(e){stream?.getTracks().forEach(t=>t.stop());throw e;}});
async function stopRecording(){if(!recording)return;const r=recording;recording=null;clearTimeout(r.timer);r.stream.getTracks().forEach(t=>t.stop());r.processor.disconnect();r.input.disconnect();r.mute.disconnect();clip=wav(r.chunks,r.ctx.sampleRate);clipOwner=r.owner;await r.ctx.close();$('micStatus').textContent='Local clip ready. Explicitly transcribe, review the text, then commit. Nothing was uploaded automatically.';render();}
bind('stopRecord',stopRecording);bind('transcribe',async()=>{const captured=clipOwner,c=context(),r=await api('/api/roundtable/transcribe',clip,c,{headers:{'Content-Type':'audio/wav','X-Command-ID':uid()}});if(same(c)&&active===c.seat&&state()?.phase===captured.phase){if(captured.target){$(individualIds[captured.target]).value=r.text;$('confirmIndividual').checked=false;}else{$('message').value=r.text;source='speech';}$('micStatus').textContent='Provisional Scribe transcript. Review and edit before submitting.';}await health();});
window.addEventListener('beforeunload',()=>{recording?.stream.getTracks().forEach(t=>t.stop());if(briefing){briefing.controller.abort();void briefing.player?.stop();}if(turnPlayback||completedPlayback)void stopTurnPlayback();if(decisionPlayback)void stopDecisionGuide();});
async function loadTestPeople(){
 const current=state();
 if(bundle?.test&&bundle.seats.length===3&&current?.phase==='lobby'){
   // Repeated clicks reuse the existing three seats, rather than creating rooms.
 }else if(bundle&&current?.phase==='lobby'&&current.host===current.me&&current.members.length===1){
   for(const name of ['Morgan · test member','Sam · test member']){const r=await api('/api/roundtable/join',{name,code:bundle.code},{});bundle.seats.push({name,token:r.token});}
   bundle.test=true;save();
 }else{await join(true);}
 for(let i=0;i<bundle.seats.length;i++)await api('/api/roundtable/command/ready',{command_id:uid(),ready:true},{code:bundle.code,token:bundle.seats[i].token,seat:i});
 await refresh();await loadMemory();await loadRecordings();say('Three test participants loaded and ready. The CEO can Start meeting to hear the introduction.');
}
async function stopBriefing(){
 const task=briefing;if(!task)return;
 task.controller.abort();await task.player?.stop();
 if(task.id)void api('/api/roundtable/briefing/'+task.id+'/stop',{},task.owner).catch(()=>{});
 if(briefing===task){$('briefingStatus').textContent='Stopped. Your written briefing stays here.';}
}
$('stopBriefing').onclick=()=>stopBriefing().catch(e=>say(e.message));
async function startPreparation(mode,kind='preparation',extra={},owner=context(),preparedPlayer=null){
 if(briefing||turnPlayback||completedPlayback||decisionPlayback)throw new Error('Stop the current audio before asking an agent.');
 const controller=new AbortController();let voice=$('voiceOn').checked;
 const task={owner,controller,phase:state().phase,player:voice?(preparedPlayer||new PCMStreamPlayer()):null,id:null};
 briefing=task;render();$('briefingText').textContent='';$('streamSources').replaceChildren();$('briefingStatus').textContent=kind==='preparation'?'Reading your PDF…':'Listening to the '+kind+' agent…';
 let ended=false,streamError=false;
 try{
   // Unlock audio in the click gesture, before waiting for network or model work.
   if(task.player){$('resumeAudio').hidden=false;await Promise.race([task.player.unlock(),new Promise(resolve=>setTimeout(resolve,1500))]);if(task.player.context?.state==='suspended'){$('briefingStatus').textContent='Audio needs permission. Press Resume audio; written text continues.';}}
   const response=await fetch('/api/roundtable/briefing',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+owner.token},signal:controller.signal,body:JSON.stringify({command_id:uid(),mode,kind,text:$('question').value,voice:!!voice,...extra})});
   if(!response.ok){const error=await response.json();throw new Error(error.error||'Could not start preparation');}
   await consumeNDJSON(response.body,async event=>{
     if(controller.signal.aborted||!same(owner)||briefing!==task)return;
     if(event.id)task.id=event.id;
     if(event.type==='status')$('briefingStatus').textContent=event.message;
     if(event.type==='sources')for(const c of event.citations){const n=el('div',undefined,'citation');n.append(el('b',c.title+' · page '+c.page),el('p',c.text));$('streamSources').append(n);}
     if(event.type==='text'){$('briefingText').textContent+=event.text;$('briefingStatus').textContent=voice?'Writing and speaking…':'Writing the briefing…';}
     if(event.type==='audio'&&task.player){try{task.player.append(event.pcm,event.sample_rate);}catch(e){await task.player.stop();say(e.message+' The written briefing will continue.');}}
     if(event.type==='speech_error'){say(event.message);await task.player?.stop();}
     if(event.type==='error'){streamError=true;say(event.message);}
     if(event.type==='done'){ended=true;streamError ||= event.status!=='done';$('briefingStatus').textContent=event.status==='limited'?'Briefing reached its length limit.':voice?'Finishing the spoken briefing…':'Briefing ready.';}
   },controller.signal);
   if(!ended&&!controller.signal.aborted)throw new Error('Connection ended early. The text shown is a partial briefing.');
   await task.player?.drain();
   if(!controller.signal.aborted&&same(owner))$('briefingStatus').textContent=streamError?'Partial briefing. Review the report or try a new question.':'Agent finished. Continue the meeting or ask another question.';
 }catch(e){if(e.name!=='AbortError'){if(same(owner))$('briefingStatus').textContent='Preparation stopped before completion.';throw e;}}
 finally{await task.player?.stop();if(briefing===task)briefing=null;$('resumeAudio').hidden=true;await refresh();await health();render();}
}

$('resumeAudio').onclick=()=>briefing?.player?.unlock().catch(e=>say(e.message));
async function loadRecordings(){const c=context(),result=await api('/api/roundtable/recordings',undefined,c);if(same(c)){recordings=(result.clips||[]).map(r=>({...r,seat_index:r.default_seat}));scriptLength=result.script_length||9;render();}}
function sameTurn(task){const s=states[task.owner.seat];return same(task.owner)&&s?.phase==='discussion'&&s.speaker===task.speaker&&s.turn_number===task.turn;}
async function stopTurnPlayback(){const task=turnPlayback||completedPlayback;if(!task)return;task.cancelled=true;task.resolve?.(false);$('recordedAudio').pause();$('recordedAudio').removeAttribute('src');if(task.url)URL.revokeObjectURL(task.url);if(turnPlayback===task)turnPlayback=null;if(completedPlayback===task)completedPlayback=null;if(task.id)await api('/api/roundtable/recordings/stop',{command_id:uid(),id:task.id},task.owner).catch(()=>{});$('recordedStatus').textContent='Playback stopped. No caption was committed.';render();}
async function playRecordedTurn(){
 if(briefing||recording||turnPlayback||completedPlayback||decisionPlayback)throw new Error('Stop or commit the current audio first.');
 const s=state(),owner=context();if(s?.phase!=='discussion'||s.speaker!==s.me)throw new Error('Select the current speaker before playing.');
 const recordingForSeat=recordingAtTurn(s.turn_number);if(!recordingForSeat?.available)throw new Error(s.turn_number>scriptLength?'All scripted turns are finished. Continue with typed discussion or finish early.':'The recording for this turn is unavailable.');
 const task={owner,speaker:s.speaker,turn:s.turn_number,id:null,url:null,cancelled:false};turnPlayback=task;render();
 try{
  const lease=await api('/api/roundtable/recordings/play',{command_id:uid(),clip_id:recordingForSeat.id},owner);task.id=lease.id;
  if(task.cancelled||!sameTurn(task)){await api('/api/roundtable/recordings/stop',{command_id:uid(),id:task.id},owner).catch(()=>{});return false;}
  const blob=await api('/api/roundtable/recordings/audio/'+encodeURIComponent(task.id),undefined,owner,{blob:true});
  if(task.cancelled||!sameTurn(task)){await stopTurnPlayback();return false;}
  const audio=$('recordedAudio');task.url=URL.createObjectURL(blob);audio.src=task.url;
  const finished=new Promise((resolve,reject)=>{task.resolve=resolve;audio.onended=()=>resolve(true);audio.onerror=()=>reject(new Error('Recording playback failed. No text was committed.'));});
  $('recordedStatus').textContent='Playing existing recording for '+s.members.find(m=>m.id===s.me)?.name+'. Stop cancels without a commit.';
  try{await audio.play();}catch{throw new Error('Browser blocked playback. Press Play this turn’s recording to retry.');}
  const ended=await finished;
  if(!ended||task.cancelled||!sameTurn(task)){await stopTurnPlayback();return false;}
  turnPlayback=null;completedPlayback=task;$('recordedStatus').textContent='Playback finished. Commit the trusted caption and advance to the next participant, or Stop to discard.';return true;
 }catch(e){await stopTurnPlayback();throw e;}
 finally{render();}
}
async function commitRecordedTurn(){const task=completedPlayback;if(!task||!sameTurn(task))throw new Error('Finish a recording in the current speaking turn first.');await new Promise(resolve=>setTimeout(resolve,250));if(!sameTurn(task)||completedPlayback!==task)throw new Error('The speaking turn changed. Nothing was committed.');await api('/api/roundtable/recordings/complete',{command_id:uid(),id:task.id},task.owner);if(task.url)URL.revokeObjectURL(task.url);if(completedPlayback===task)completedPlayback=null;$('recordedAudio').removeAttribute('src');$('recordedStatus').textContent='Recorded caption committed. The next participant now has the floor.';while(polling)await new Promise(resolve=>setTimeout(resolve,30));await refresh();}
bind('playTurn',playRecordedTurn);bind('commitRecorded',commitRecordedTurn);$('stopTurn').onclick=()=>stopTurnPlayback().catch(e=>say(e.message));

async function stopDecisionGuide(){
 const task=decisionPlayback;if(!task)return;task.cancelled=true;task.resolve?.(false);$('decisionGuideAudio').pause();$('decisionGuideAudio').removeAttribute('src');if(task.url){URL.revokeObjectURL(task.url);task.url=null;}
 if(decisionPlayback===task)decisionPlayback=null;
 if(task.requestedAudio)await api('/api/roundtable/decision-prompt/stop',{command_id:uid()},task.owner).catch(()=>{});
 $('decisionGuideStatus').textContent='Guide stopped. No contribution or vote was submitted.';render();
}
async function playDecisionGuide(owner=context()){
 if(briefing||recording||turnPlayback||completedPlayback||decisionPlayback)throw new Error('Stop the current audio before playing the decision guide.');
 const snapshot=states[owner.seat],ballot=snapshot?.decisions?.find(d=>d.mode==='fixed_choice');if(snapshot?.phase!=='decision'||!ballot)throw new Error('The recorded guide is available during fixed choice voting.');
 const task={owner,decisionId:ballot.id,cancelled:false,url:null,requestedAudio:false};decisionPlayback=task;render();
 const current=()=>same(owner)&&!task.cancelled&&decisionPlayback===task&&states[owner.seat]?.phase==='decision';
 try{
  const guide=await api('/api/roundtable/decision-prompt',undefined,owner);if(!current())return false;
  if(guide.decision_id!==ballot.id)throw new Error('This guide does not match the current ballot.');
  $('decisionGuideText').textContent=guide.text;
  if(!$('voiceOn').checked){$('decisionGuideStatus').textContent='Text only. Enable Speak with ElevenLabs and press CEO: Replay recorded guide to hear the saved recording.';return true;}
  if(typeof guide.audio_url!=='string'||!guide.audio_url.startsWith('/api/roundtable/'))throw new Error('Unexpected decision guide audio location.');
  task.requestedAudio=true;const blob=await api(guide.audio_url,undefined,owner,{blob:true});if(!current())return false;
  const audio=$('decisionGuideAudio');task.url=URL.createObjectURL(blob);audio.src=task.url;
  const finished=new Promise((resolve,reject)=>{task.resolve=resolve;audio.onended=()=>resolve(true);audio.onerror=()=>reject(new Error('The saved guide could not play. Press CEO: Replay recorded guide to retry.'));});
  $('decisionGuideStatus').textContent='Playing the recorded decision guide. This is not a live adviser or a participant contribution.';
  try{await audio.play();}catch{throw new Error('Browser blocked automatic audio. Press CEO: Replay recorded guide to retry.');}
  const ended=await finished;if(ended&&current())$('decisionGuideStatus').textContent='Guide complete. Select a participant and explicitly cast their vote.';return !!ended&&current();
 }finally{
  if(task.requestedAudio)await api('/api/roundtable/decision-prompt/stop',{command_id:uid()},owner).catch(()=>{});
  if(task.url)URL.revokeObjectURL(task.url);if(decisionPlayback===task){$('decisionGuideAudio').pause();$('decisionGuideAudio').removeAttribute('src');decisionPlayback=null;}render();
 }
}
bind('playDecisionGuide',()=>playDecisionGuide());$('stopDecisionGuide').onclick=()=>stopDecisionGuide().catch(e=>say(e.message));

async function automaticAgents(){
 if(automaticRunning||busy||briefing||recording||turnPlayback||completedPlayback||decisionPlayback||!bundle)return;
 const seat=states.findIndex(s=>s.me===s.ceo);if(seat<0)return;const s=states[seat];if(isRoundOne(s)){await automaticExperts(s,seat);return;}if(!['decision','ended'].includes(s.phase))return;
 bundle.autoEvents ||= [];let event=null;
 const fixed=(s.decisions||[]).find(d=>d.mode==='fixed_choice');
 if(s.phase==='decision'&&fixed?.status==='pending'&&!bundle.autoEvents.includes('recorded_decision:'+fixed.id))event={key:'recorded_decision:'+fixed.id,kind:'recorded_decision',extra:{decision_id:fixed.id}};
 else if(s.phase==='decision'&&!fixed&&s.fixed_scenario!=='T01'&&!bundle.autoEvents.includes('decision'))event={key:'decision',kind:'decision',extra:{}};
 else{const d=(s.decisions||[]).find(d=>['approved','rejected'].includes(d.status)&&!bundle.autoEvents.includes('evaluation:'+d.id));if(d)event={key:'evaluation:'+d.id,kind:'evaluation',extra:{decision_id:d.id}};}
 if(!event)return;bundle.autoEvents.push(event.key);save();automaticRunning=true;busy=true;render();
 try{const owner={code:bundle.code,token:bundle.seats[seat].token,seat};if(event.kind==='recorded_decision')await playDecisionGuide(owner);else await startPreparation('intro',event.kind,{...event.extra,automatic:true},owner);}
 catch(e){say('Automatic '+event.kind+' agent: '+e.message+' This automatic request will not repeat.');}
 finally{busy=false;automaticRunning=false;render();}
}
const individualIds={action:'individualAction',reasoning:'individualReasoning',evidence:'individualEvidence',unknowns:'individualUnknowns'};
const expertLabels={it:'IT / security',operations:'Operations / community services',governance:'Governance / finance'};
let individualDrafts=Object.create(null),individualContext=null,individualKey='';
const isRoundOne=s=>s?.flow==='board_round1';
const canRecordHere=s=>s?.phase==='discussion'&&s.speaker===s.me||isRoundOne(s)&&s.phase==='decision';
function captureIndividualDraft(){if(individualContext){individualDrafts[individualKey]={revision:individualContext.revision,...Object.fromEntries(Object.entries(individualIds).map(([k,id])=>[k,$(id).value]))};}}
function renderRoundOne(s,locked){
 const enabled=isRoundOne(s),ceo=s?.me===s?.ceo;
 $('legacyDecisionPanel').hidden=enabled;$('roundOneExperts').hidden=!enabled;$('individualPanel').hidden=!enabled;
 if(!enabled)return;
 $('decisionGuide').hidden=true;$('customDecision').hidden=true;$('fixedCustomForm').hidden=true;
 $('agentKind').querySelectorAll?.('option').forEach(o=>{o.hidden=o.value==='journalist';});
 if($('agentKind').value==='journalist')$('agentKind').value='facilitator';
 $('consultationNotice').textContent='Three live expert perspectives follow the group discussion. All three must finish before individual decisions open.';
 $('skipConsultation').textContent='CEO: Begin individual decisions';$('end').textContent='CEO: Complete Round 1';
 const completed=s.expert_briefings||{},order=s.expert_order||['it','operations','governance'],all=order.every(k=>completed[k]);
 $('skipConsultation').disabled=locked||!!briefing||!ceo||s.phase!=='consultation'||!all;
 $('end').disabled=locked||!!briefing||!ceo||s.phase!=='decision'||!(s.decision_submissions||[]).every(x=>x.submitted);
 const names={consultation:'Round 1 · Expert perspectives',decision:'Round 1 · Individual decisions',ended:'Round 1 complete'};
 if(names[s.phase])$('phase').textContent=names[s.phase];
 if(s.phase==='consultation')$('phaseHint').textContent='Hear each expert, then continue. No points and no shared winning ballot.';
 if(s.phase==='decision')$('phaseHint').textContent='Every member submits an action, reasons, information and unknowns.';
 if(s.phase==='ended')$('phaseHint').textContent='Individual starting points saved. Private coaching and assessment are not implemented yet.';
 $('nextExpert').disabled=locked||!!briefing||!ceo||s.phase!=='consultation'||all;
 $('expertCards').replaceChildren(...order.map(kind=>{const n=el('article',undefined,'reply'),reply=completed[kind];n.append(el('b',expertLabels[kind]),el('p',reply?.text||'Waiting for this perspective.'));if(reply){for(const c of reply.citations||[])n.append(el('small',(c.title||c.document_id)+' · page '+c.page));}return n;}));
 $('expertStatus').textContent=all?'All three perspectives are ready. The CEO can open individual decisions.':'The CEO presents one expert at a time. A failed request stays incomplete; use Hear next expert to retry.';
 const my=s.individual_decision,key=s.code+':'+s.me,revision=my?.revision||0;
 if(key!==individualKey||revision!==individualContext?.revision){captureIndividualDraft();individualKey=key;const draft=individualDrafts[key],values=draft?.revision===revision?draft:my||{};for(const [k,id] of Object.entries(individualIds))$(id).value=values[k]||'';$('confirmIndividual').checked=false;individualContext={owner:context(),revision,key};}
 $('individualTitle').textContent=(s.members.find(m=>m.id===s.me)?.name||'Member')+', what would you do?';
 const editable=s.phase==='decision';for(const id of Object.values(individualIds))$(id).disabled=locked||!editable;
 $('confirmIndividual').disabled=locked||!editable;$('submitIndividual').disabled=locked||!!briefing||!editable||!$('confirmIndividual').checked;
 $('submitIndividual').textContent=my?'Confirm my revised decision':'Submit my individual decision';
 $('individualStatus').textContent=my?'Your decision is saved, version '+my.revision+'. '+(editable?'You can review and revise until the CEO completes Round 1.':'It is frozen for your later private session.'):'No decision submitted. Complete all four fields after the experts.';
 $('submissionStatus').replaceChildren(...(s.decision_submissions||[]).map(row=>el('p',(s.members.find(m=>m.id===row.member)?.name||'Member')+': '+(row.submitted?'decision submitted':'waiting'))));
 $('exportContext').disabled=locked||s.phase!=='ended';$('recordDecision').disabled=$('record').disabled||!editable;$('stopDecisionRecord').disabled=!recording;$('transcribeDecision').disabled=$('transcribe').disabled||!editable;
}
async function submitIndividual(){
 const captured=individualContext,s=state();if(!captured||!same(captured.owner)||context().token!==captured.owner.token||s.phase!=='decision'||!isRoundOne(s))throw new Error('The selected member or phase changed. Review your decision again.');
 if(!$('confirmIndividual').checked)throw new Error('Review and confirm your decision before submitting.');
 const fields=Object.fromEntries(Object.entries(individualIds).map(([k,id])=>[k,$(id).value.trim()]));
 if(Object.values(fields).some(v=>!v||v.length>1200))throw new Error('Complete each field using up to 1200 characters.');
 await command('submit_individual_decision',{...fields,revision:captured.revision},captured.owner);say('Your individual decision is saved. No points are awarded in Round 1.');
}
async function nextExpert(){const s=state();if(!isRoundOne(s)||s.phase!=='consultation'||s.me!==s.ceo)throw new Error('Select the CEO during expert perspectives.');const kind=s.expert_order.find(k=>!s.expert_briefings[k]);if(kind)await startPreparation('intro',kind);}
async function automaticExperts(s,seat){
 if(s.phase!=='consultation'||s.active_stream||s.active_audio)return;
 const kind=s.expert_order.find(k=>!s.expert_briefings[k]);if(!kind)return;
 bundle.autoEvents ||= [];const key='expert:'+kind;if(bundle.autoEvents.includes(key))return;
 bundle.autoEvents.push(key);save();automaticRunning=true;busy=true;render();
 try{await startPreparation('intro',kind,{automatic:true},{code:bundle.code,token:bundle.seats[seat].token,seat});}
 catch(e){say(expertLabels[kind]+': '+e.message+' Use Hear next expert to retry.');}
 finally{automaticRunning=false;busy=false;render();}
}
bind('submitIndividual',submitIndividual);$('confirmIndividual').onchange=render;
for(const id of Object.values(individualIds))$(id).oninput=()=>{$('confirmIndividual').checked=false;captureIndividualDraft();};
bind('nextExpert',nextExpert);
$('recordDecision').onclick=()=>$('record').onclick();$('stopDecisionRecord').onclick=()=>stopRecording();$('transcribeDecision').onclick=()=>$('transcribe').onclick();
bind('exportContext',async()=>{const owner=context(),r=await api('/api/roundtable/round1-context',undefined,owner);if(same(owner))download(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}),'round1-my-preparation-context.json');});

async function init(){
 render();await health();
 try{
   if(bundle){await refresh();if(!states.length){bundle=null;save();}}
   if(!bundle)await join(false);
   else {await loadMemory();await loadRecordings();}
 }catch(e){say(e.message);}
}
void init();setInterval(refresh,1000);setInterval(render,1000);setInterval(health,20000);
