'use strict';
const $=id=>document.getElementById(id), uid=()=>crypto.randomUUID();
const roleNames={facilitator:'Facilitator',it:'IT character',journalist:'Journalist',tracker:'Discussion tracker',preparation:'Preparation',debrief:'Debrief',resolve:'Custom resolution'};
let bundle=null;try{bundle=JSON.parse(sessionStorage.getItem('rehearsal_audio_lab')||'null');}catch{}
let states=[],active=0,catalog=[],selectedId='',polling=false,creating=false,autoRunning=false,mediaBusy=false;
let audioId=null,audioURL=null,audioOwner=0,audioContext=null,audioInstalledAt=0,audioTimeout=null,finishAudio=null,recording=null,micClip=null,micSeat=null,source='typed';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const save=()=>sessionStorage.setItem('rehearsal_audio_lab',JSON.stringify(bundle));
const say=t=>{$('notice').textContent=t;};
const current=()=>states[active]||states[0];
const selected=()=>catalog.find(c=>c.id===selectedId);
const seconds=ms=>ms==null?'—':(ms/1000).toFixed(2)+'s';
async function api(path,data,seat=active,opts={}){
 const headers={...opts.headers};const auth=opts.token??bundle?.seats[seat]?.token;if(auth)headers.Authorization='Bearer '+auth;
 let body=data;if(data!==undefined&&!(data instanceof Blob)){headers['Content-Type']='application/json';body=JSON.stringify(data);}
 const response=await fetch(path,{method:data===undefined?'GET':'POST',headers,body});
 if(!response.ok){let message;try{message=(await response.json()).error;}catch{}const error=new Error(message||'Request failed ('+response.status+')');error.status=response.status;throw error;}
 return opts.blob?response.blob():response.json();
}
const cmd=(action,data={},seat=active)=>api('/api/command/'+action,{command_id:uid(),...data},seat);
function captureSeat(seat=active){if(!bundle?.seats[seat])throw new Error('Join a room first.');return {code:bundle.code,token:bundle.seats[seat].token,seat};}
const sameSeat=context=>bundle?.code===context.code&&bundle?.seats[context.seat]?.token===context.token;
const mediaApi=(path,data,context,options={})=>api(path,data,context.seat,{...options,token:context.token});
async function releaseLease(context,id){try{await mediaApi('/api/speech/stop',{id},context);}catch{}}
function event(type,data={}){if(!bundle)return;bundle.activity.push({type,at:new Date().toISOString(),...data});save();}
function bind(id,fn){$(id).onclick=async()=>{try{$(id).disabled=true;say('');await fn();}catch(error){say(error.message);}finally{render();}};}
function canContribute(seat=active){const s=states[seat];return !!s&&s.phase==='discussion'&&s.electorate.includes(s.self)&&(!s.speaker||s.speaker===s.self);}
function canPlay(seat=active){const s=states[seat];return !!s&&(s.phase!=='discussion'||canContribute(seat));}
async function health(){try{const h=await api('/api/health',undefined,-1);$('health').textContent=h.models.online?'Vertex Flash LOW · '+(h.models.verified?'verified':'configured'):'Vertex unavailable';$('budget').textContent=h.speech.remaining.toLocaleString()+' / '+h.speech.cap.toLocaleString()+' speech credits remaining. Vertex $'+(h.models.budget?.remaining_usd??0).toFixed(2)+' / $'+(h.models.budget?.cap_usd??0).toFixed(2)+' reservation budget remaining. Clip replay is free.';}catch{$('health').textContent='Start the localhost test server';}}
async function loadCatalog(){const result=await api('/api/recordings',undefined,0);catalog=result.clips;selectedId=selectedId||catalog[0]?.id||'';const filter=$('group');filter.replaceChildren(el('option','All roles and topics'));filter.firstChild.value='';for(const group of [...new Set(catalog.map(c=>c.group))]){const option=el('option',group.replaceAll('_',' '));option.value=group;filter.append(option);}renderLibrary();}
function renderLibrary(){const clip=selected();$('clipCount').textContent=catalog.filter(c=>c.available).length+' ready';$('clipList').replaceChildren(...catalog.filter(c=>!$('group').value||c.group===$('group').value).map(c=>{const button=el('button',undefined,'clip-item'+(c.id===selectedId?' selected':''));button.append(el('b',c.title),el('small',c.role+' · '+(c.available?(c.duration_seconds||0).toFixed(1)+'s':'not generated')));button.onclick=()=>{selectedId=c.id;renderLibrary();render();};return button;}));$('clipTitle').textContent=clip?.title||'A fixed recording, ready when you are';$('clipText').textContent=clip?.text||'Create a room, then choose a library recording.';$('clipRole').textContent=clip?.role||'Choose a clip';}
async function newRoom(){if(mediaBusy)throw new Error('Wait for the media request to finish, or stop its playback, before creating another room.');if(creating)return;creating=true;try{if(recording)await stopRecording();if(states[0]&&!['lobby','ended'].includes(states[0].phase))await cmd('end',{},0);cancelAudio(false);const joined=await api('/api/join',{name:'You · audio test host'},-1);bundle={code:joined.code,seats:[{name:'You · audio test host',token:joined.token}],demo:false,done:[],activity:[],manualChecks:{}};save();for(const name of ['Alex · recorded test seat','Morgan · recorded test seat']){const seat=await api('/api/join',{name,code:bundle.code},-1);bundle.seats.push({name,token:seat.token});save();}states=[];active=0;source='typed';micClip=null;$('message').value='';$('decisionCheck').textContent='';await refresh();await loadCatalog();}finally{creating=false;render();}}
function render(){const s=current(),clip=selected(),pending=s?.jobs.some(j=>j.status==='pending'),demo=!!bundle?.demo;
 $('newRoom').disabled=creating||!!recording||mediaBusy;$('demo').disabled=creating||!!recording||mediaBusy;$('start').disabled=!s||s.phase!=='lobby'||creating||mediaBusy;$('end').disabled=!s||['lobby','ended'].includes(s.phase);
 $('play').disabled=!clip?.available||!canPlay()||mediaBusy||demo;$('stop').disabled=!audioId&&!s?.speech;$('load').disabled=!clip||!!recording||demo;
 $('commit').disabled=!canContribute()||demo||mediaBusy;$('chat').disabled=!s||demo;$('finish').disabled=!s||s.phase!=='discussion'||s.speaker!==s.self||demo;$('skip').disabled=!s||s.phase!=='discussion'||!s.speaker||demo;
 $('propose').disabled=!s||s.phase!=='discussion'||!s.electorate.includes(s.self)||demo;$('retry').disabled=!s||s.phase!=='resolution_failed'||pending;
 $('check').disabled=!s;$('export').disabled=!s;$('record').disabled=!canContribute()||!!recording||mediaBusy||demo;$('stopRecord').disabled=!recording;
 $('transcribeMic').disabled=!micClip||micSeat!==active||!canContribute()||mediaBusy||demo;$('transcribeClip').disabled=!clip?.available||!canContribute()||mediaBusy||demo;
 $('ask').disabled=!s||demo;$('agent').disabled=!!$('pack').value;$('extract').disabled=!s?.contributions.length||demo;$('compare').disabled=!s||s.phase!=='ended'||pending;$('debrief').disabled=!s||s.phase!=='ended'||pending;$('speakReply').disabled=!s||s.phase==='lobby'||!s.suggestions.length||mediaBusy||demo;
 if(!s)return;
 $('roomCode').textContent=s.code;$('phase').textContent=s.phase.replaceAll('_',' ').toUpperCase();const now=s.server_time+(Date.now()-s.received)/1000,left=s.total_deadline?Math.max(0,Math.ceil(s.total_deadline-now)):0;$('timer').textContent=s.phase==='lobby'?'Ready':s.phase==='ended'?'Complete':Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
 const speaker=s.members.find(m=>m.id===s.speaker);$('floor').textContent=speaker?'Speaking: '+speaker.name:s.phase==='discussion'?'Open discussion':demo?'Scripted mechanics demo':'One round · '+s.phase.replaceAll('_',' ');
 $('seats').replaceChildren(...bundle.seats.map((seat,i)=>{const state=states[i],member=s.members.find(m=>m.id===state?.self),button=el('button',undefined,'seat'+(active===i?' selected':'')+(state?.self===s.speaker?' speaking':''));button.append(el('span',i===0?'YOU':i===1?'A':'M','avatar'),el('span',state?.self===s.speaker?'ON AIR':'','onair'),el('b',seat.name.split(' · ')[0]),el('small',(member?.role||'participant')+' · '+(active===i?'controlling':'click to control')));button.onclick=()=>{if(recording){say('Stop microphone recording before changing seats.');return;}active=i;render();};return button;}));
 $('activeSeat').textContent=bundle.seats[active].name.split(' · ')[0];$('turnHint').textContent=demo?'Scripted mode submits known text only after successful clip playback. End the round to stop.':canContribute()?'Speak or type for this selected seat. Commit separately to add it to the discussion.':'Wait for this seat’s speaking turn. Use room chat for informal text at any time.';
 $('situation').textContent=s.inject||'MapleCart scenario preview. Three finance laptops display ransom demands while checkout still works.';
 const lines=[...s.contributions.map(x=>({...x,label:'Contribution'})),...s.chat.map(x=>({...x,label:'Room chat'}))].sort((a,b)=>a.at-b.at);$('transcript').replaceChildren(...lines.map(x=>{const line=el('div',undefined,'line');line.append(el('b',(s.members.find(m=>m.id===x.member)?.name||'Seat')+' · '+x.label+' · '+x.source),el('p',x.text));return line;}));
 $('voteSection').hidden=!['voting','tie_break'].includes(s.phase);$('voteHeading').textContent=s.phase==='tie_break'?'CEO resolves the tie':'Vote as the selected seat';$('voteHint').textContent=demo?'The recorded demo selects the first prepared option for every test seat.':'Select each seat and cast its ballot. You may replace a ballot before voting closes.';
 $('choices').replaceChildren(...s.options.map(option=>{const button=el('button',option.label,'choice'+(s.own_vote===option.id?' selected':'')),tie=s.phase==='tie_break';button.disabled=demo||(tie?!(s.ties.includes(option.id)&&s.members.find(m=>m.id===s.self)?.role==='ceo'):s.phase!=='voting'||!s.electorate.includes(s.self));button.onclick=()=>cmd(tie?'tie':'vote',{option_id:option.id}).then(()=>{event(tie?'tie_selected':'vote_cast',{seat:active,option_id:option.id});return refresh();}).catch(e=>say(e.message));return button;}));
 $('outcome').textContent=s.history.at(-1)?.summary||(s.unresolved?'Custom action is unresolved. No outcome is invented.':'No decision has been committed. A spoken statement or proposal is not a vote result.');
 $('participation').replaceChildren(...s.members.map(m=>el('span',m.name.split(' · ')[0]+': '+(s.climate.contributions_by_member[m.id]||0)+' contributions')),el('span',s.climate.questions_recorded+' question marks recorded · no mood scoring'));
 $('replies').replaceChildren(...s.suggestions.slice(-6).reverse().map(r=>{const job=s.jobs.find(j=>j.id===r.id),card=el('div',undefined,'response');card.append(el('strong','LIVE · '+(roleNames[r.kind]||r.kind)+' · '+seconds(job?.timing?.total_ms)),el('p',r.text));if(r.spans)card.append(el('p',r.spans.map(span=>span.label+': '+span.text).join(' · ')));card.append(el('small',r.evidence_ids?.join(', ')||r.classification||''));return card;}));
 const job=s.jobs.at(-1);$('agentStatus').textContent=job?(roleNames[job.kind]||job.kind)+': '+job.status+(job.error?' · '+job.error:job.timing?' · '+seconds(job.timing.total_ms):''):'Live requests are optional and use the remaining Vertex budget.';
 const checks=[['played','A fixed recording played',bundle.activity.some(x=>x.type==='clip_finished')],['contributed','Contribution committed',s.contributions.length>0],['turns','Turn finished or skipped',s.events.some(x=>['speaker_finished','speaker_skipped'].includes(x.type))],['decision','One outcome committed',s.history.length===1],['agents','Live agent response received',s.suggestions.length>0],['transcription','Provisional transcription tested',bundle.activity.some(x=>x.type==='transcribed')]];
 $('checklist').replaceChildren(...checks.map(([id,label,done])=>{const row=el('div',undefined,'check'+(done?' done':''));row.append(el('span',done?'✓':'○'),el('span',label));return row;}));
 if(audioId&&s.requested>=audioInstalledAt&&(!s.speech||s.speech.id!==audioId)){cancelAudio(false);$('audioStatus').textContent='Playback stopped: the turn, phase or audio lease changed.';}
 if(recording&&!canContribute(recording.seat))stopRecording().catch(e=>say(e.message));
}
async function refresh(){if(!bundle||polling)return;polling=true;try{states=await Promise.all(bundle.seats.map((_,i)=>{const requested=Date.now();return api('/api/state',undefined,i).then(s=>({...s,requested,received:Date.now()}));}));render();void automate();}catch(error){if(error.status===401){cancelAudio(false);bundle=null;states=[];sessionStorage.removeItem('rehearsal_audio_lab');say('The server restarted or a seat was reclaimed. Create a new three seat room.');}else say(error.message);}finally{polling=false;}}
function cancelAudio(completed){clearTimeout(audioTimeout);audioTimeout=null;const done=finishAudio;finishAudio=null;const audio=$('audio');audio.pause();audio.removeAttribute('src');audio.hidden=true;if(audioURL)URL.revokeObjectURL(audioURL);audioURL=null;audioId=null;audioContext=null;if(done)done(completed);}
async function setupAudio(result,context){
 const blob=await mediaApi('/api/audio/'+result.id,undefined,context,{blob:true});
 if(!sameSeat(context)){await releaseLease(context,result.id);return null;}
 audioId=result.id;audioOwner=context.seat;audioContext=context;audioInstalledAt=Date.now();audioURL=URL.createObjectURL(blob);$('audio').src=audioURL;$('audio').hidden=false;
 audioTimeout=setTimeout(()=>{if(!sameSeat(context)||audioId!==result.id)return;cancelAudio(false);$('audioStatus').textContent='Audio lease expired. Select Play again if appropriate.';render();},Math.max(1000,Math.min(61000,(result.expires-(states[context.seat]?.server_time||result.expires))*1000+1000)));
 return {completed:new Promise(resolve=>{finishAudio=resolve;})};
}
async function playClip(clipId,seat=active,automatic=false){
 const context=captureSeat(seat),clip=catalog.find(c=>c.id===clipId);if(!clip?.available)throw new Error('This recording is not ready.');
 await mediaApi('/api/speech/stop',{},context);if(!sameSeat(context))return false;cancelAudio(false);
 const start=performance.now(),result=await mediaApi('/api/recordings/play',{command_id:uid(),clip_id:clipId},context);
 if(!sameSeat(context)){await releaseLease(context,result.id);return false;}
 event('clip_requested',{clip_id:clipId,seat,round:states[seat]?.round});
 const playback=await setupAudio(result,context);if(!playback||!sameSeat(context))return false;
 $('audioStatus').textContent='Prerecorded '+clip.role+': '+result.captions+' · Replay costs zero.';
 try{await $('audio').play();}catch{if(sameSeat(context))$('audioStatus').textContent+=' Press Play in the player to allow audio.';}
 const completed=await playback.completed;if(!sameSeat(context))return false;
 event(completed?'clip_finished':'clip_interrupted',{clip_id:clipId,seat,elapsed_ms:Math.round(performance.now()-start)});return completed;
}
$('audio').onended=async()=>{const id=audioId,context=audioContext;cancelAudio(true);if(!context)return;if(sameSeat(context))$('audioStatus').textContent='Playback finished. No contribution was submitted by playback alone.';try{await mediaApi('/api/speech/stop',{id,delivered:true},context);}catch{};render();};
$('audio').onerror=()=>{cancelAudio(false);say('The recording could not play. You can still load its known script and test by text.');};
async function automate(){if(!bundle?.demo||autoRunning||!states[0])return;autoRunning=true;const code=bundle.code;try{const s=states[0];if(s.phase==='discussion'&&s.speaker){const i=states.findIndex(x=>x.self===s.speaker),key='clip-'+i;if(i>=0&&!bundle.done.includes(key)){bundle.done.push(key);save();active=i;const id=['discussion_owner','discussion_containment','discussion_public_update'][i];selectedId=id;renderLibrary();render();const round=s.round,member=s.speaker,played=await playClip(id,i,true);const fresh=await api('/api/state',undefined,i);if(played&&bundle?.code===code&&bundle.demo&&fresh.phase==='discussion'&&fresh.round===round&&fresh.speaker===member){await cmd('contribute',{text:catalog.find(c=>c.id===id).text,source:'typed'},i);await cmd('finish',{},i);event('script_committed',{clip_id:id,seat:i,source:'known_fixture_text'});}else say('A demo clip was interrupted or its turn expired. Its text was not committed. The round continues.');}}
 if(s.phase==='voting'&&!bundle.done.includes('votes')){bundle.done.push('votes');save();const option=s.options.find(o=>o.kind==='prepared');if(option){await Promise.all(bundle.seats.map((_,i)=>cmd('vote',{option_id:option.id},i)));event('scripted_votes',{option_id:option.id,seats:3});}}
 if(s.phase==='ended'){bundle.demo=false;save();say('Recorded round complete. Replay made no provider calls. Use the optional live agent buttons to compare responses.');}
 }catch(error){say('Recorded demo: '+error.message);}finally{autoRunning=false;render();}}
async function ask(kind,data={},seat=active){const result=await api('/api/agent/'+kind,{command_id:uid(),...data},seat);event('live_agent_requested',{kind,job:result.id});await health();return result.id;}
async function compare(){const questions={facilitator:'What did the board decide in decision_1, and what should it clarify next?',it:'What technical outcome is recorded in decision_1?',journalist:'Which verified consequence in decision_1 can we communicate publicly?'};const results=await Promise.allSettled(Object.entries(questions).map(([kind,text])=>ask(kind,{text,review:true},0)));const errors=results.filter(r=>r.status==='rejected');if(errors.length)say(errors.map(r=>r.reason.message).join('; '));await refresh();}
bind('newRoom',newRoom);bind('demo',async()=>{await newRoom();bundle.demo=true;save();await cmd('start',{profile:'quick_90'},0);await refresh();});bind('start',async()=>{if(mediaBusy)throw new Error('Wait for the media request to finish before starting.');bundle.demo=false;save();await cmd('start',{profile:$('profile').value},0);await refresh();});bind('end',async()=>{bundle.demo=false;save();cancelAudio(false);await cmd('end',{},0);await refresh();});
bind('play',async()=>{mediaBusy=true;render();try{await playClip(selectedId);}finally{mediaBusy=false;}});bind('stop',async()=>{cancelAudio(false);await api('/api/speech/stop',{},active);event('audio_stopped',{seat:active});$('audioStatus').textContent='Room audio stopped.';});
bind('load',()=>{const clip=selected();$('message').value=clip.text;source='typed';if(clip.suggested_agent&&['facilitator','it','journalist'].includes(clip.suggested_agent))$('agent').value=clip.suggested_agent;$('pack').value=clip.pack_id||'';$('question').value=clip.text;event('script_loaded',{clip_id:clip.id,seat:active});say('Known script loaded as typed text. Edit it, then commit during this seat’s turn. No transcription was called.');});$('group').onchange=renderLibrary;
bind('commit',async()=>{const result=await cmd('contribute',{text:$('message').value,source});event('contribution_committed',{seat:active,contribution_id:result.contribution_id,source});$('message').value='';source='typed';micClip=null;await refresh();});bind('chat',async()=>{await cmd('chat',{text:$('message').value});$('message').value='';await refresh();});bind('finish',async()=>{await cmd('finish');await refresh();});bind('skip',async()=>{await cmd('skip',{},0);await refresh();});bind('propose',async()=>{await cmd('propose',{text:$('proposal').value});event('custom_proposal',{seat:active});await refresh();});bind('retry',async()=>{await cmd('retry',{},0);await refresh();});bind('check',async()=>{const result=await cmd('check_decision');$('decisionCheck').textContent=result.text+'\n'+result.ownership_note;event('decision_checked',{confirmed_decisions:result.confirmed_decisions});});
bind('ask',async()=>{const pack=$('pack').value;await ask(pack?'preparation':$('agent').value,{text:$('question').value,...(pack?{pack_id:pack}:current().phase==='ended'?{review:true}:{})});await refresh();});bind('extract',async()=>{await ask('tracker',{contribution_id:current().contributions.at(-1).id});await refresh();});bind('compare',compare);bind('debrief',async()=>{await ask('debrief');await refresh();});$('pack').onchange=render;
bind('speakReply',async()=>{
 const context=captureSeat(),replyId=current().suggestions.at(-1).id;mediaBusy=true;render();
 try{
  await mediaApi('/api/speech/stop',{},context);if(!sameSeat(context))return;cancelAudio(false);
  const result=await mediaApi('/api/speak',{command_id:uid(),source:'suggestion',id:replyId},context);
  if(!sameSeat(context)){await releaseLease(context,result.id);return;}
  const playback=await setupAudio(result,context);if(!playback||!sameSeat(context))return;
  $('audioStatus').textContent='Live reply speech: '+result.captions+(result.cached?' · cached':' · generated with ElevenLabs credits');await health();
  if(!sameSeat(context))return;try{await $('audio').play();}catch{if(sameSeat(context))$('audioStatus').textContent+=' · Press Play.';}
  await playback.completed;
 }finally{mediaBusy=false;}
});
function wavBlob(chunks,rate){const n=chunks.reduce((s,c)=>s+c.length,0),buffer=new ArrayBuffer(44+n*2),view=new DataView(buffer);const str=(p,t)=>[...t].forEach((x,i)=>view.setUint8(p+i,x.charCodeAt(0)));str(0,'RIFF');view.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,n*2,true);let at=44;for(const chunk of chunks)for(const sample of chunk){const x=Math.max(-1,Math.min(1,sample));view.setInt16(at,x<0?x*32768:x*32767,true);at+=2;}return new Blob([buffer],{type:'audio/wav'});}
bind('record',async()=>{
 const context=captureSeat(),seat=context.seat;mediaBusy=true;render();let stream;
 try{
  await mediaApi('/api/speech/stop',{},context);if(!sameSeat(context))return;cancelAudio(false);
  stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const fresh=await mediaApi('/api/state',undefined,context);
  if(!sameSeat(context)||fresh.phase!=='discussion'||!fresh.electorate.includes(fresh.self)||(fresh.speaker&&fresh.speaker!==fresh.self))throw new Error('The speaking turn changed while microphone permission was pending. No recording started.');
  active=seat;
  const audioCtx=new AudioContext(),input=audioCtx.createMediaStreamSource(stream),processor=audioCtx.createScriptProcessor(4096,1,1),mute=audioCtx.createGain(),chunks=[];
  mute.gain.value=0;processor.onaudioprocess=e=>{if(recording)chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};
  input.connect(processor);processor.connect(mute);mute.connect(audioCtx.destination);
  recording={stream,context:audioCtx,input,processor,mute,chunks,seat};recording.timer=setTimeout(()=>stopRecording().catch(e=>say(e.message)),29000);
  $('audioStatus').textContent='Recording locally. Stop, then explicitly transcribe and review.';
 }catch(error){stream?.getTracks().forEach(t=>t.stop());throw error;}finally{mediaBusy=false;}
});
async function stopRecording(){if(!recording)return;const r=recording;recording=null;clearTimeout(r.timer);r.processor.disconnect();r.input.disconnect();r.mute.disconnect();r.stream.getTracks().forEach(t=>t.stop());micClip=wavBlob(r.chunks,r.context.sampleRate);micSeat=r.seat;await r.context.close();$('audioStatus').textContent='Microphone clip ready locally. Transcribe only during this seat’s eligible turn.';render();}
bind('stopRecord',stopRecording);
async function transcribe(useLibrary){
 const context=captureSeat(),seat=context.seat,clipId=selectedId,inputClip=micClip;mediaBusy=true;render();
 try{
  const started=performance.now();
  const result=useLibrary?await mediaApi('/api/recordings/transcribe',{command_id:uid(),clip_id:clipId},context):await mediaApi('/api/transcribe',inputClip,context,{headers:{'Content-Type':'audio/wav','X-Command-ID':uid()}});
  if(!sameSeat(context))return;
  active=seat;$('message').value=result.text;source='speech';event('transcribed',{seat,input:useLibrary?'library':'microphone',clip_id:useLibrary?clipId:undefined,total_ms:Math.round(performance.now()-started),committed:false});
  $('audioStatus').textContent='Provisional transcript received. Review and edit, then click Commit contribution. Nothing was committed automatically.';
 }finally{mediaBusy=false;await health();}
}
bind('transcribeClip',()=>transcribe(true));bind('transcribeMic',()=>transcribe(false));
bind('export',()=>{const s=states[0],report={room:s.code,profile:s.profile,history:s.history,contributions:s.contributions,chat:s.chat,jobs:s.jobs,replies:s.suggestions,participation:s.climate,clip_events:bundle.activity,simulation:'Three explicitly controlled test memberships. Prerecorded clips are fixed fixtures; live agent requests are separately labelled.',notes:'Playback and loading known scripts do not run transcription. Provider timings include transport and queueing.'};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=el('a');link.href=url;link.download='rehearsal-audio-'+s.code+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('beforeunload',()=>recording?.stream.getTracks().forEach(t=>t.stop()));
async function init(){await health();render();if(bundle){await refresh();if(bundle)try{await loadCatalog();}catch(e){say(e.message);}}}void init();setInterval(refresh,500);setInterval(health,20000);
