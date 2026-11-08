"""Authority for parallel private coaching, assessment and a shared reunion."""
from copy import deepcopy
import json
from pathlib import Path
import uuid
from .engine import bounded_text, require

CARD_FIELDS = ('action','responsibility','evidence','dependencies','fallback','communication','review')
COACH_QUESTIONS = (
    'The IT specialist is now unavailable. Your original response relied on their advice. What would you do next?',
    'Scenario update: an alternate provider can investigate, but needs an authorized contact. What authority, access and dependencies must you establish?',
    'Review your proposed response: who should act, what is the fallback, who needs an update, and when would you review progress?',
)
EXAM_QUESTIONS = (
    'Explain your response as if briefing the rest of the board. What should happen first, and why?',
    'Scenario update: the alternate provider cannot begin immediately. Staff still need instructions. What changes in your plan?',
    'Give your final instruction: who does what, under whose authority, what happens if it fails, and when will you review it?',
)
RUBRICS = (
    ('facts_uncertainty','reasoning','communication'),
    ('new_constraint','feasible_adjustment','tradeoff','responsive_answer'),
    ('action_owner_authority','fallback','update_review'),
)


class FourRounds:
    @staticmethod
    def is_four_rounds(room):
        return room.get('flow') == 'four_rounds'

    def start_private(self, room):
        for mid in room['electorate']:self.clear_fixture(room,mid)
        room['private_sessions'] = {mid: {'agent_id':uuid.uuid4().hex,'phase':'coaching','turn':1,
            'revision':1,'prompt':None,'history':[],'answers':{},'card':None,'scores':{},
            'busy':False,'error':None,'appeals':{}} for mid in room['electorate']}
        room.update(reunion_discussion=[],reviews={},score_version=1,reunion_summary=None,winners=[])
        self._transition(room,'private')

    @staticmethod
    def private_total(session):
        return sum(score['total'] for score in session['scores'].values())

    def maybe_reunion(self, room):
        if room['phase']=='private' and all(s['phase']=='assessment_done' for s in room['private_sessions'].values()):
            self._transition(room,'reunion')

    def test_skip_controls(self, room):
        phase=room['phase'];actions=[]
        if phase=='preparation':actions.append({'stage':'opening','label':'Skip introduction → discussion'})
        elif phase=='discussion':actions.append({'stage':'discussion','label':'Finish discussion → expert perspectives'})
        elif phase=='consultation' and all(k in room['expert_briefings'] for k in ('it','operations','governance')):
            actions.append({'stage':'consultation','label':'Continue to individual decisions'})
        return {'version':2,'actions':actions,'revision':room.get('skip_revision',0),
                'blocked':bool(room.get('active_stream')) if phase=='consultation' else False,
                'history':deepcopy(room.get('test_skips',[])),
                'ranking_disabled':any(x['stage'] in ('round1','coaching','assessment') for x in room.get('test_skips',[]))}

    def skip_test_stage(self, room, mid, data):
        require(mid==self._ceo(room),'Only the CEO can advance a shared section',403)
        controls=self.test_skip_controls(room)
        require(data.get('expected_phase')==room['phase'] and type(data.get('skip_revision')) is int and
                data['skip_revision']==controls['revision'],'The section changed. Review the current control',409)
        stage=data.get('stage')
        require(stage in [a['stage'] for a in controls['actions']],
                'Decisions, private answers, response cards and assessment cannot be skipped',409)
        require(not controls['blocked'],'Wait for the current expert response',409)
        if stage=='opening':self._transition(room,'discussion',reason='section_skip')
        else:self._apply(room,mid,'finish_discussion' if stage=='discussion' else 'skip_consultation',{})
        room.setdefault('test_skips',[]).append({'stage':stage,'by':mid,'at':self.clock()})
        room['skip_revision']=controls['revision']+1
        self.event(room,'test_section_advanced',member=mid,stage=stage)

    def four_round_command(self, room, mid, action, data):
        if not self.is_four_rounds(room):
            return False
        if action=='skip_test_stage':
            self.skip_test_stage(room,mid,data)
            return True
        if action=='submit_sequence_answer':
            require(room.get('solo_test') and room.get('beta_mode',True),'Saved sequences require a solo beta test',403)
            require(data.get('approved') is True,'Approve the saved test answers first',422)
            require(room['phase']=='private','Private testing is not active',409)
            session=room['private_sessions'][mid]
            source=next((h for h in session.get('live_history',[]) if h['id']==data.get('live_session_id') and h['revision']==session['revision']),None)
            require(source is not None,'Wait for the Live recording session to close',409)
            round_number={'coaching':2,'assessment':3}.get(session['phase'])
            clips=json.loads((Path(__file__).parent/'fixtures/four-round-audio.json').read_text())['clips']
            clip=next((c for c in clips if c['seat']==0 and c['round']==round_number and c['step']==session['turn']),None)
            require(clip is not None and clip['id'] in source.get('completed_clips',[]),'Play the full recording for this question before submitting',409)
            data={**data,'text':clip['text']}
            action='private_answer'
        if action=='finish_solo_test':
            require(room.get('solo_test') and room['phase']=='reunion' and mid==self._ceo(room),'Finish your solo test from its results',409)
            require(room['reviews'].get(mid) and room.get('reunion_summary') and room['reunion_summary']['score_version']==room['score_version'], 'Review your results and current summary first',409)
            require(not room['private_sessions'][mid]['busy'] and not room.get('_reunion_busy'),'Wait for the active review',409)
            room['winners']=[];self._transition(room,'ended');self.event(room,'solo_test_completed',member=mid)
            return True
        if action=='set_beta_mode':
            require(room['phase']=='lobby' and mid==self._ceo(room),'Only the CEO can change beta mode before Start',403)
            require(type(data.get('enabled')) is bool,'Choose true or false',422)
            room['beta_mode']=data['enabled']
            self.event(room,'beta_mode_changed',enabled=room['beta_mode'],member=mid)
            return True
        if action in ('private_answer','confirm_response_card'):
            require(room['phase']=='private','Private sessions are not active',409)
            session=room['private_sessions'][mid]
            require(not session['busy'],'Wait for the current agent request',409)
            require(type(data.get('revision')) is int and data['revision']==session['revision'],
                    'This private turn changed. Review the current question',409)
            require(not any(k in data for k in ('member','member_id','score','points','stage')),
                    'Submit only your own response; the server owns the stage and score',422)
            if action=='confirm_response_card':
                require(session['phase']=='card_review' and session['card'] is not None,'Review the generated response card first',409)
                card={field:bounded_text(data.get(field),800) for field in CARD_FIELDS}
                session.update(card=card,phase='assessment',turn=1,prompt=None,revision=session['revision']+1,error=None)
                self.event(room,'private_preparation_confirmed',member=mid)
                return True
            require(session['phase'] in ('coaching','assessment') and session['prompt'],
                    'Wait for your coach or examiner question',409)
            text=bounded_text(data.get('text'),2500)
            scripted=False
            live_source=None
            if data.get('live_session_id'):
                live_source=next((h for h in session.get('live_history',[]) if h['id']==data['live_session_id'] and
                    h['revision']==session['revision']),None)
                require(live_source is not None,'This Live transcript belongs to another question or member',409)
                scripted=bool(live_source.get('recorded_clips'))
            if data.get('recording_lease'):
                lease=self.fixture_lease(room,mid,data['recording_lease'])
                require(lease.get('completed'),'Finish and review the recorded answer first',409)
                scripted=True
            phase,turn=session['phase'],session['turn']
            session['history'].append({'phase':phase,'turn':turn,'question':session['prompt'],
                'answer':text,'scripted':scripted,'live_session_id':data.get('live_session_id'),'at':self.clock()})
            session['answers'][f'{phase}_{turn}']={'text':text,'question':session['prompt'],'scripted':scripted,'at':self.clock()}
            session.update(prompt=None,revision=session['revision']+1,error=None)
            self.clear_fixture(room,mid)
            if phase=='assessment':
                session['phase']='grading'
            elif turn==3:
                session['phase']='card_review'
            else:
                session['turn']+=1
            self.event(room,'private_response_received',member=mid,private_phase=phase,turn=turn)
            return True
        if action=='reunion_contribute':
            require(room['phase']=='reunion','The reunion is not active',409)
            text=bounded_text(data.get('text'),2500)
            if data.get('recording_lease'):
                require(self.fixture_lease(room,mid,data['recording_lease']).get('completed'),'Review the clip before submitting',409)
            room['reunion_discussion'].append({'id':uuid.uuid4().hex,'member':mid,'name':room['members'][mid]['name'],
                'text':text,'scripted':bool(data.get('recording_lease')),'at':self.clock()})
            self.clear_fixture(room,mid)
            self.event(room,'reunion_contribution',member=mid)
            return True
        if action=='confirm_score_review':
            require(room['phase']=='reunion','Review results during the reunion',409)
            require(not room['private_sessions'][mid]['busy'],'Wait for the review request',409)
            require(not any(a['status'] in ('pending','failed') for a in room['private_sessions'][mid]['appeals'].values()),
                    'Resolve or withdraw your outstanding review request first',409)
            room['reviews'][mid]=True
            self.event(room,'score_review_confirmed',member=mid)
            return True
        if action=='withdraw_score_review':
            require(room['phase']=='reunion','Review results during the reunion',409)
            session=room['private_sessions'][mid]
            require(not session['busy'],'Wait for the review request',409)
            stage=data.get('review_stage')
            require(type(stage) is int and str(stage) in session['appeals'],'Review not found',404)
            appeal=session['appeals'][str(stage)]
            require(appeal['status']=='failed','Only a failed review may be withdrawn',409)
            appeal['status']='withdrawn'
            self.event(room,'score_review_withdrawn',member=mid,stage=stage)
            return True
        if action=='announce_winner':
            require(not room.get('solo_test'),'Solo tests finish without a competition winner',409)
            require(not self.test_skip_controls(room)['ranking_disabled'],'This test skipped rounds; finish without a winner',409)
            require(room['phase']=='reunion' and mid==self._ceo(room),'Only the CEO can finish the reunion',403)
            require(all(room['reviews'].get(person) for person in room['electorate']),
                    'Every member must review their results before the winner is announced',409)
            require(not any(s['busy'] for s in room['private_sessions'].values()),'Wait for pending reviews',409)
            summary=room.get('reunion_summary')
            require(summary and summary['score_version']==room['score_version'],'Hear the current reunion summary first',409)
            best=max(self.private_total(s) for s in room['private_sessions'].values())
            room['winners']=[person for person,s in room['private_sessions'].items() if self.private_total(s)==best]
            self.event(room,'winner_announced',winners=room['winners'],score=best)
            self._transition(room,'ended')
            return True
        return False

    def four_round_snapshot(self, room, mid):
        if not self.is_four_rounds(room):
            return {}
        result={'beta_mode':room.get('beta_mode',True),'exercise_round':1,'private_session':None,
                'private_progress':[],'reunion':None,'test_skip':self.test_skip_controls(room)}
        if 'private_sessions' not in room:
            return result
        own=room['private_sessions'][mid]
        visible=deepcopy(own)
        visible['total']=self.private_total(own)
        if own['phase']!='assessment_done':
            visible['scores']={stage:{'stage':score['stage'],'total':score['total'],'maximum':score['maximum']} for stage,score in own['scores'].items()}
        result.update(private_session=visible,exercise_round=2 if own['phase'] in ('coaching','card_review') else 3,
            private_progress=[{'member':person,'phase':s['phase']} for person,s in room['private_sessions'].items()])
        if room['phase'] in ('reunion','ended'):
            result['exercise_round']=4
            result['reunion']={'branches':[{'member':person,'name':room['members'][person]['name'],
                'original_decision':deepcopy(room['individual_decisions'][person]),'response_card':deepcopy(s['card']),
                'assessment_answers':{k:deepcopy(v) for k,v in s['answers'].items() if k.startswith('assessment_')},
                'assessment_skipped':bool(s.get('assessment_skipped')),'preparation_skipped':bool(s.get('preparation_skipped')),
                'scores':deepcopy(s['scores']),'total':self.private_total(s),'reviewed':bool(room['reviews'].get(person))}
                for person,s in room['private_sessions'].items()], 'discussion':deepcopy(room['reunion_discussion']),
                'summary':deepcopy(room.get('reunion_summary')),'score_version':room['score_version'],
                'winners':list(room['winners'])}
        return result

    def fixture_lease(self, room, mid, ident):
        lease=room.get('fixture_leases',{}).get(mid)
        require(lease and lease['id']==ident and lease['expires']>self.clock(),'Recorded response is no longer available',409)
        require(lease['context']==self.fixture_context(room,mid),'The recorded response belongs to an earlier turn',409)
        return lease

    def fixture_context(self, room, mid):
        session=room.get('private_sessions',{}).get(mid,{})
        return [room['phase'],session.get('phase'),session.get('turn'),session.get('revision')]

    def clear_fixture(self, room, mid):
        lease=room.get('fixture_leases',{}).pop(mid,None)
        if lease and room.get('active_audio',{} ) and room['active_audio'].get('id')==lease['id']:
            self.cancel_audio(room,'fixture_finished')
