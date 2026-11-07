'use strict';
const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('rehearsal_playtest_token') || '';
let state = null, roleDraft = {}, roomKey = '', audioLease = null, audioURL = null;
let clip = null, recording = null, transcriptSource = 'typed', polling = false;
const busy = new Set();
let chatVersion = "";
const uid = () => crypto.randomUUID();
function notice(text) { $('notice').textContent = text; }
function node(tag, text, className) { const el=document.createElement(tag); if(text !== undefined) el.textContent=text; if(className) el.className=className; return el; }
async function api(path, body, options={}) {
  const headers = {...(token ? {Authorization:'Bearer '+token}:{}), ...(options.headers || {})};
  let payload=body;
  if(body && !(body instanceof Blob)) {headers['Content-Type']='application/json'; payload=JSON.stringify(body);}
  const res = await fetch(path, {method:body===undefined?'GET':'POST',headers,body:payload});
  if(!res.ok) {let error; try {error=await res.json();}catch {error={};} const failure=new Error(error.error || error.detail || `Request failed (${res.status})`);failure.status=res.status;throw failure;}
  return options.blob ? res.blob() : res.json();
}
async function act(action, data={}) {await api('/api/command/'+action,{...data,command_id:uid()}); await refresh();}
function handle(id, fn) {$(id).addEventListener('click', async event => {const button=event.currentTarget; if(busy.has(id))return; busy.add(id); button.disabled=true; try {notice(''); await fn();} catch(e){notice(e.message);} finally{busy.delete(id); button.disabled=false; if(state) renderControls();}});}
function name(mid) {return state?.members.find(m=>m.id===mid)?.name || 'Member';}
function stopLocalAudio(){const a=$('audio');a.pause();a.removeAttribute('src');a.hidden=true;if(audioURL) URL.revokeObjectURL(audioURL);audioURL=null;audioLease=null;}
function canContribute(){return state?.phase==='discussion' && state.electorate.includes(state.self) && (!state.speaker || state.speaker===state.self);}
async function refresh(){
 if(!token || polling) return; polling=true;
 try {state=await api('/api/state'); state._received=Date.now()/1000; render();}catch(e){if(e.status===401){if(state){$('name').value=name(state.self);$('code').value=state.code;}token='';sessionStorage.removeItem('rehearsal_playtest_token');stopLocalAudio();if(recording)await stopRecording();state=null;$('entry').hidden=false;$('room').hidden=true;document.title='Rehearsal · AI playtest';notice('Your previous session ended. Enter your name and room code to rejoin, or leave the code empty to create a new room.');}else notice(e.message);}finally{polling=false;}
}
async function health(){try{const h=await api('/api/health'); $('health').textContent=`Local models: ${h.models.online?'online':'unavailable'} · Speech: ${h.speech_configured?'configured':'not configured'}\n${h.speech.remaining.toLocaleString()} / ${h.speech.cap.toLocaleString()} credits available (reserved estimate)`;$('rejoinHelp').textContent=h.test_name_rejoin?'Local test rejoin is enabled: use the same name and room code after leaving. If you close the window, wait 30 seconds before rejoining.':'Refresh keeps your seat in this tab. Returning to an existing seat requires its original session.';}catch{$('health').textContent='Test server unavailable. Start the server, then refresh.';}}
function renderControls(){
 const s=state, host=s.self===s.host;
 $('hostLobby').hidden=!(host&&s.phase==='lobby');$('end').hidden=!host||['lobby','ended'].includes(s.phase);
 $('start').disabled=s.members.length<3;
 $('submit').disabled=!canContribute();$('finish').disabled=!(s.phase==='discussion'&&s.speaker===s.self);
 $('skip').disabled=!(host&&s.phase==='discussion'&&s.speaker);
 $('propose').disabled=!(s.phase==='discussion'&&s.electorate.includes(s.self));
 $('record').disabled=!canContribute()||!!recording;$('transcribe').disabled=!clip||!canContribute();
 $('read').disabled=s.phase==='lobby'||!!s.speech;
 $('retry').hidden=!(host&&s.phase==='resolution_failed');
 document.querySelectorAll('[data-agent]').forEach(b=>b.disabled=s.phase==='lobby'||(b.dataset.agent==='debrief'&&s.phase!=='ended'));
 $('extract').disabled=!s.contributions.length;
 $('stopRecord').disabled=!recording;
 for(const id of busy)$(id).disabled=true;
}
function render(){
 const s=state; $('entry').hidden=true;$('room').hidden=false;
 document.title=`${name(s.self)} · ${s.code} · Rehearsal`;
 $('chatLabel').textContent=`Message as ${name(s.self)}`;
 const nextChatVersion=s.code+':'+(s.chat?.at(-1)?.id||'empty');
 if(chatVersion!==nextChatVersion){chatVersion=nextChatVersion;$('chatMessages').replaceChildren(...(s.chat||[]).map(m=>{const el=node('div',undefined,'item');el.append(node('strong',name(m.member)),node('p',m.text,'prewrap'));return el;}));$('chatMessages').scrollTop=$('chatMessages').scrollHeight;}
 $('roomLabel').textContent=`ROOM ${s.code} · ${s.members.length}/30 · YOU ARE ${name(s.self)}`;
 $('phase').textContent=s.phase.replaceAll('_',' ');$('phase').style.textTransform='capitalize';
 $('newTab').href='/?room='+s.code;$('newTab').textContent='Open another seat';
 $('roundLabel').textContent=s.round?`ROUND ${s.round} OF ${s.round_limit||1} · ${s.profile==='test_3'?'ACCELERATED TEST':s.profile==='single_5'?'5 MINUTE TEST':s.profile}`:'PREPARATION';
 $('situationTitle').textContent=s.node_title||s.title;$('inject').textContent=s.inject||'Read the documents and assign one CEO. The host starts when three people are connected.';
 $('questions').replaceChildren(...s.study_questions.map(q=>node('li',q)));
 $('metrics').replaceChildren(...Object.entries(s.metrics).map(([key,value])=>{const el=node('div',key.replaceAll('_',' '),'metric');el.append(node('strong',value));return el;}));
 const peopleKey=s.phase+JSON.stringify(s.members.map(m=>[m.id,m.role,m.connected]));
 if(roomKey!==peopleKey&&!$('people').contains(document.activeElement)){
   roomKey=peopleKey; $('people').replaceChildren(...s.members.map(m=>{const el=node('div',undefined,'person');el.append(node('strong',`${m.name}${m.id===s.host?' · host':''}${m.connected?'':' · away'}`));el.append(node('span','ID '+m.id.slice(0,8),'muted'));if(s.phase==='lobby'&&s.self===s.host){const select=node('select');select.setAttribute('aria-label',m.name+' role');s.roles.forEach(r=>{const opt=node('option',r.name);opt.value=r.id;select.append(opt);});select.value=roleDraft[m.id]||m.role;select.onchange=()=>roleDraft[m.id]=select.value;el.append(select);}else{el.append(node('span',m.role.replaceAll('_',' '),'muted'));}return el;}));
 }
 $('eligibility').textContent=s.phase==='lobby'?'Exactly one CEO. Every eligible participant has one equal vote.':s.electorate.includes(s.self)?'You are eligible in this round.':'You join speaking and voting next round.';
 $('turn').textContent=s.phase==='discussion'?(s.speaker?`Speaking now: ${name(s.speaker)}`:'Open discussion: anyone eligible may contribute.'):'Contributions open during discussion. Draft text stays here between phases.';
 $('choices').replaceChildren(...s.options.map(o=>{const b=node('button',o.label,'choice'+(s.own_vote===o.id?' selected':''));b.append(node('small',o.kind==='custom'?`Custom proposal · ${name(o.author)}`:'Prepared option'));const vote=s.phase==='voting'&&s.electorate.includes(s.self), tie=s.phase==='tie_break'&&s.members.find(m=>m.id===s.self)?.role==='ceo'&&s.ties.includes(o.id);b.disabled=!(vote||tie);b.onclick=()=>act(tie?'tie':'vote',{option_id:o.id}).catch(e=>notice(e.message));return b;}));
 $('voteStatus').textContent=s.phase==='voting'?`Your ballot: ${s.own_vote?'recorded, change it before close':'not yet cast'}. Other ballots stay private until close.`:s.phase==='tie_break'?'Tie: the CEO chooses one of the tied options.':s.unresolved?'The voted custom action remains unresolved. No consequence has been invented.':Object.keys(s.tally).length?`Closed tally: ${Object.entries(s.tally).map(([id,n])=>`${s.options.find(o=>o.id===id)?.label.slice(0,45)||id}: ${n}`).join(' · ')}`:'Options freeze when voting starts.';
 $('reassign').replaceChildren();if(s.phase==='tie_break'&&s.self===s.host&&s.members.some(m=>m.role==='ceo'&&!m.connected)){s.members.filter(m=>m.connected&&s.electorate.includes(m.id)).forEach(m=>{const b=node('button','Assign CEO to '+m.name,'secondary');b.onclick=()=>act('reassign_ceo',{member_id:m.id}).catch(e=>notice(e.message));$('reassign').append(b);});}
 $('climate').replaceChildren(...s.members.map(m=>node('p',`${m.name}: ${s.climate.contributions_by_member[m.id]||0} committed contributions`)),node('p',`${s.climate.questions_recorded} contributions contain a question.`));
 $('discussion').replaceChildren(...s.contributions.slice(-30).map(c=>{const el=node('div',undefined,'item');el.append(node('strong',`${name(c.member)} · round ${c.round} · ${c.source}`),node('p',c.text));return el;}));
 const referenceReply=s.suggestions.filter(x=>x.kind==='preparation'&&x.pack_id===$('referencePack').value).at(-1);
 if(referenceReply)$('referenceAnswer').textContent=referenceReply.text+'\n'+referenceReply.note;
 $('jobs').replaceChildren(...s.jobs.slice(-6).map(j=>node('p',`${j.kind}: ${j.status}${j.error?' · '+j.error:''}`,'job')));
 $('suggestions').replaceChildren(...s.suggestions.slice(-8).reverse().map(x=>{const el=node('div',undefined,'item');el.append(node('strong',`${x.kind} · round ${x.round}`),node('p',x.text,'prewrap'));if(x.note)el.append(node('p',x.note,'muted'));if(x.evidence_ids)el.append(node('p','Evidence: '+x.evidence_ids.join(', '),'muted'));if(x.spans)x.spans.forEach(span=>el.append(node('span',`${span.label}: ${span.text}`,'tag')));if(x.classification)el.append(node('p',`Advisory class: ${x.classification}. Raw span scores are not calibrated confidence.`,'muted'));const b=node('button','Generate response audio','secondary');b.disabled=x.round!==s.round||!!s.speech;b.onclick=()=>speak('suggestion',x.id).catch(e=>notice(e.message));el.append(b);return el;}));
 $('history').replaceChildren(...s.history.map(h=>{const el=node('div',undefined,'item');el.append(node('strong',`Round ${h.round} · ${h.reason.replaceAll('_',' ')}`),node('p',h.summary));if(h.ai_explanation)el.append(node('p','AI mapping explanation: '+h.ai_explanation,'muted'));return el;}));
 $('ending').textContent=s.phase==='ended'?`Exercise ended: ${s.end_reason.replaceAll('_',' ')}. ${s.unresolved?'A voted action is unresolved. ':''}The records below remain available even if AI feedback fails.`:'Actual decisions will appear here.';
 if(audioLease && (!s.speech||s.speech.id!==audioLease))stopLocalAudio();
 $('captions').textContent=s.speech?`${s.speech.status==='generating'?'Generating':'Speech owned by '+name(s.speech.member)}: ${s.speech.text}`:'Playback is explicit. One device holds the shared speech lease; anyone can stop it.';
 if(recording&&!canContribute())stopRecording();
 renderControls();renderClock();
}
function renderClock(){if(!state)return;const now=Date.now()/1000+(state.server_time-(state._received||state.server_time));const remaining=state.deadline?Math.max(0,Math.ceil(state.deadline-now)):null;$('clock').textContent=`${remaining===null?'No active countdown':remaining+' seconds in this phase'}${state.total_deadline&&state.phase!=='ended'?' · '+Math.max(0,Math.ceil(state.total_deadline-now))+' seconds left overall':''}${state.speaker_deadline&&state.speaker?' · '+Math.max(0,Math.ceil(state.speaker_deadline-now))+' seconds in speaker slot':''}`;}
$('joinForm').addEventListener('submit',async e=>{e.preventDefault();try{notice('');const result=await api('/api/join',{name:$('name').value,code:$('code').value.trim().toUpperCase()||undefined});token=result.token;sessionStorage.setItem('rehearsal_playtest_token',token);await loadRoom();}catch(error){notice(error.message);}});
async function loadRoom(){await refresh();if(!state)return;await loadReferences();const docs=await api('/api/documents');$('documents').replaceChildren(...docs.documents.map(d=>{const el=node('details');el.append(node('summary',d.id.replaceAll('_',' ')),node('div',d.text,'document'));return el;}));}
handle('saveRoles',async()=>{const roles={};state.members.forEach(m=>roles[m.id]=roleDraft[m.id]||m.role);await act('roles',{roles});roleDraft={};roomKey='';});
handle('start',()=>act('start',{profile:$('profile').value}));handle('end',()=>act('end'));
handle('submit',async()=>{await act('contribute',{text:$('contribution').value,source:transcriptSource});$('contribution').value='';transcriptSource='typed';});
handle('finish',()=>act('finish'));handle('skip',()=>act('skip'));handle('retry',()=>act('retry'));
handle('propose',()=>act('propose',{text:$('proposal').value}));
handle('forget',async()=>{if(recording)await stopRecording();stopLocalAudio();const code=state?.code||'';try{await api('/api/command/leave',{command_id:uid()});}catch(e){if(e.status!==401)throw e;}token='';sessionStorage.removeItem('rehearsal_playtest_token');location.href='/?room='+encodeURIComponent(code);});
for(const button of document.querySelectorAll('[data-agent]'))button.onclick=async()=>{try{notice('');await api('/api/agent/'+button.dataset.agent,{command_id:uid(),text:$('question').value});await refresh();}catch(e){notice(e.message);}};
handle('extract',async()=>{await api('/api/agent/tracker',{command_id:uid(),contribution_id:state.contributions.at(-1).id});await refresh();});
async function speak(source,id){stopLocalAudio();notice('Generating speech. Captions remain visible.');const result=await api('/api/speak',{command_id:uid(),source,id});audioLease=result.id;const blob=await api('/api/audio/'+result.id,undefined,{blob:true});audioURL=URL.createObjectURL(blob);$('audio').src=audioURL;$('audio').hidden=false;notice('Audio ready. Press Play in the player.');await refresh();await health();}
handle('read',()=>speak('inject'));
handle('stopSpeech',async()=>{stopLocalAudio();await api('/api/speech/stop',{});await refresh();});
$('audio').addEventListener('ended',async()=>{const id=audioLease;stopLocalAudio();if(id)await api('/api/speech/stop',{id,delivered:true});});
function wavBlob(chunks,rate){const count=chunks.reduce((n,c)=>n+c.length,0),buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);function str(at,t){for(let i=0;i<t.length;i++)v.setUint8(at+i,t.charCodeAt(i));}str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);let at=44;for(const chunk of chunks)for(const sample of chunk){const clamped=Math.max(-1,Math.min(1,sample));v.setInt16(at,clamped<0?clamped*32768:clamped*32767,true);at+=2;}return new Blob([buffer],{type:'audio/wav'});}
handle('record',async()=>{
 if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone unavailable in this browser. Use a WAV file or typed input.');
 stopLocalAudio();await api('/api/speech/stop',{});
 const stream=await navigator.mediaDevices.getUserMedia({audio:true});
 try{const ctx=new AudioContext(),source=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(4096,1,1),mute=ctx.createGain();mute.gain.value=0;const chunks=[];
 processor.onaudioprocess=e=>{if(recording)chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};source.connect(processor);processor.connect(mute);mute.connect(ctx.destination);
 recording={stream,ctx,source,processor,mute,chunks,started:Date.now()};recording.timer=setTimeout(()=>stopRecording(),29000);$('recording').textContent='Recording locally, up to 29 seconds. Stop when finished.';$('stopRecord').disabled=false;
 }catch(e){stream.getTracks().forEach(t=>t.stop());throw e;}
});
async function stopRecording(){if(!recording)return;const r=recording;recording=null;clearTimeout(r.timer);r.processor.disconnect();r.source.disconnect();r.mute.disconnect();r.stream.getTracks().forEach(t=>t.stop());clip=wavBlob(r.chunks,r.ctx.sampleRate);await r.ctx.close();$('recording').textContent='Recording ready. Click Transcribe to send it to ElevenLabs.';$('stopRecord').disabled=true;renderControls();}
handle('stopRecord',stopRecording);
$('wav').onchange=()=>{clip=$('wav').files[0]||null;$('recording').textContent=clip?'WAV selected. Maximum 30 seconds and 4 MB.':'';renderControls();};
handle('transcribe',async()=>{const result=await api('/api/transcribe',clip,{headers:{'Content-Type':'audio/wav','X-Command-ID':uid()}});$('contribution').value=result.text;transcriptSource='speech';notice('Provisional transcript. Review and edit it, then Commit during an eligible speaking turn.');await health();});
handle('export',async()=>{const record=await api('/api/state');const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='rehearsal-'+state.code+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('code').value=new URLSearchParams(location.search).get('room')||'';
window.addEventListener('beforeunload',()=>{recording?.stream.getTracks().forEach(t=>t.stop());});
health();if(token)loadRoom().catch(e=>notice(e.message));
setInterval(refresh,1000);setInterval(health,15000);setInterval(renderClock,250);

handle('checkDecision',async()=>{const result=await api('/api/command/check_decision',{command_id:uid()});$('decisionCheck').textContent=result.text+'\nEvidence: '+result.evidence+'\n'+result.ownership_note;});

handle('sendChat',async()=>{await act('chat',{text:$('chatText').value});$('chatText').value='';});
$('chatText').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('sendChat').click();}});

let referencePacks=[];
function renderReference(){const pack=referencePacks.find(p=>p.id===$('referencePack').value);$('referenceDocs').replaceChildren(...(pack?.documents||[]).map(d=>{const detail=node('details');detail.append(node('summary',d.id+' · '+d.title),node('div',d.text,'document'));return detail;}));}
async function loadReferences(){const data=await api('/api/reference-packs');referencePacks=data.packs;$('referenceRules').textContent=data.common_rules;$('referencePack').replaceChildren(...data.packs.map(p=>{const option=node('option',p.id+' · '+p.title);option.value=p.id;return option;}));renderReference();}
$('referencePack').addEventListener('change',()=>{renderReference();$('referenceAnswer').textContent='';});
handle('askReference',async()=>{await api('/api/agent/preparation',{command_id:uid(),pack_id:$('referencePack').value,text:$('referenceQuestion').value});$('referenceAnswer').textContent='Preparation request queued. The answer will cite participant document clauses.';await refresh();});
