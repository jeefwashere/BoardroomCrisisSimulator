"""Isolated, single round meeting authority. Model output is advisory only."""
from copy import deepcopy
import hashlib
import json
import secrets
import threading
import time
import uuid

from .engine import RuleError, SCENARIO, bounded_text, require
from .roundtable_scenario import DECISION
from .round_one import RoundOne, EXPERTS


class Roundtable(RoundOne):
    """An ephemeral meeting whose membership tokens never enter public snapshots."""

    DURATIONS = {'preparation': 30, 'discussion': 300, 'consultation': 60}
    NEXT = {'preparation': 'discussion', 'discussion': 'consultation', 'consultation': 'decision'}
    RECORDING_POLICY = ('Written contributions and summaries only. Microphone transcription '
                        'requires an explicit recording action and participant review before submission.')

    def __init__(self, clock=time.time):
        self.clock = clock
        self.lock = threading.RLock()
        self.rooms, self.identities, self.receipts = {}, {}, {}
        self.roles = [{k: role[k] for k in ('id', 'name')}
                      for role in json.loads(SCENARIO.read_text())['roles']]
        self.role_ids = {role['id'] for role in self.roles}

    def event(self, room, kind, at=None, **details):
        room['version'] += 1
        entry = {'id': f'{room["code"]}_e{room["version"]}', 'type': kind,
                 'at': self.clock() if at is None else at, **details}
        room['events'].append(entry)
        return entry

    def identity(self, token):
        with self.lock:
            require(isinstance(token, str) and token in self.identities, 'Join a room first', 401)
            code, mid = self.identities[token]
            room = self.rooms[code]
            room['members'][mid].update(seen=self.clock(), active=True)
            self.tick(room)
            return room, mid

    def tick(self, room):
        lease = room.get('active_audio')
        if lease and (lease.get('expires', float('inf')) <= self.clock() or
                      lease.get('phase', room['phase']) != room['phase'] or
                      (room['phase'] == 'discussion' and
                       (lease.get('member') != room['speaker'] or
                        lease.get('turn_number', room['turn_number']) != room['turn_number']))):
            self.cancel_audio(room, 'lease_expired_or_stale')
        while room['deadline'] is not None and self.clock() >= room['deadline']:
            self._transition(room, self.NEXT[room['phase']], room['deadline'], 'deadline')

    def _transition(self, room, phase, at=None, reason='command'):
        at = self.clock() if at is None else at
        self.cancel_audio(room, 'phase_changed')
        room['phase'] = phase
        if phase == 'discussion':
            room['turn_index'], room['turn_number'] = 0, 1
            room['speaker'] = room['electorate'][0]
        else:
            room['speaker'], room['turn_index'] = None, None
        room['deadline'] = at + self.DURATIONS[phase] if phase in self.DURATIONS else None
        if self.is_round_one(room) and phase == 'consultation':
            room['deadline'] = None
        self.event(room, 'phase', at=at, phase=phase, deadline=room['deadline'], reason=reason)
        if phase == 'decision' and self._fixed_scenario(room) and not self.is_round_one(room):
            self._open_fixed_decision(room, at)

    @staticmethod
    def _fixed_scenario(room):
        return 'T01' if [document['id'] for document in room['documents']] == ['T01'] else None

    def _open_fixed_decision(self, room, at):
        if any(item['id'] == DECISION['id'] for item in room['decisions']):
            return
        decision = {**deepcopy(DECISION), 'mode': 'fixed_choice', 'proposal': '', 'option_id': None,
                    'source_ids': [entry['id'] for entry in room['transcript']], 'document_ids': ['T01'],
                    'member': None, 'at': at, 'status': 'pending', 'votes': {}, 'ballot_version': 1}
        room['decisions'].append(decision)
        self.event(room, 'fixed_decision_opened', at=at, decision_id=decision['id'], document_ids=['T01'])

    def cancel_audio(self, room, reason='cancelled'):
        """Trusted service helper; callers may hold the reentrant engine lock."""
        with self.lock:
            lease = room.get('active_audio')
            if lease:
                lease['status'] = 'cancelled'
                room['active_audio'] = None
                self.event(room, 'audio_cancelled', audio_id=lease.get('id'), reason=reason)

    def contribute_recorded(self, token, text, recording_id, command_id, turn_number=None):
        """Trusted API commits its catalog caption after verified playback completion.

        The HTTP command endpoint cannot select this trusted source. The caller
        must check the playback lease and pass its turn_number to reject stale audio.
        """
        data = {'command_id': command_id, 'text': bounded_text(text, 4000),
                'source': 'recorded', 'recording_id': bounded_text(recording_id, 200)}
        if turn_number is not None:
            data['turn_number'] = turn_number
        return self._command(token, 'contribute_recorded', data, trusted_recording=True)

    def _connected(self, member):
        return member['active'] and self.clock() - member['seen'] < 30

    def _ceo(self, room):
        return next((mid for mid, member in room['members'].items() if member['role'] == 'ceo'), None)

    def _start_blockers(self, room):
        blockers = []
        if room['phase'] != 'lobby':
            return ['The meeting has already started.']
        if not 3 <= len(room['members']) <= 30:
            blockers.append('At least three participants must join.')
        if any(not self._connected(member) for member in room['members'].values()):
            blockers.append('All joined participants must be connected.')
        if any(not member['ready'] for member in room['members'].values()):
            blockers.append('All participants must mark themselves ready.')
        if not room['documents_ready'] or not room['documents']:
            blockers.append('Selected documents must finish indexing.')
        if sum(member['role'] == 'ceo' for member in room['members'].values()) != 1:
            blockers.append('Exactly one participant must hold the CEO role.')
        return blockers

    def join(self, name, code=None, token=None, role=None, flow=None):
        with self.lock:
            name = bounded_text(name, 40)
            require(flow in (None, "legacy", "board_round1"), "Unknown meeting flow", 422)
            if isinstance(token, str) and token in self.identities:
                old_code, _ = self.identities[token]
                require(code in (None, old_code), 'Membership belongs to another room', 403)
                self.identity(token)
                return {'token': token, 'code': old_code}
            require(role is None or (isinstance(role, str) and role in self.role_ids - {'ceo'}),
                    'Only the host can assign the CEO role', 422)
            if code is None:
                require(len(self.rooms) < 50, 'Playtest room limit reached', 429)
                code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
                while code in self.rooms:
                    code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
                self.rooms[code] = {'code': code, 'members': {}, 'host': None, 'phase': 'lobby',
                    'version': 0, 'events': [], 'deadline': None, 'electorate': [],
                    'flow': flow or 'legacy', 'expert_briefings': {}, 'individual_decisions': {},
                    'speaker': None, 'turn_index': None, 'turn_number': 0, 'active_audio': None, 'active_stream': None,
                    'documents': [], 'documents_ready': False, 'transcript': [], 'summary': {'items': []},
                    'decision_prompts': [], 'decisions': [], 'history': [], 'jobs': {}, 'suggestions': []}
            require(isinstance(code, str) and code in self.rooms, 'Room code not found', 404)
            room = self.rooms[code]
            self.tick(room)
            require(room['phase'] == 'lobby', 'New participants can join only before this test meeting starts')
            require(len(room['members']) < 30, 'Room is full')
            require(not any(member['name'].casefold() == name.casefold()
                            for member in room['members'].values()),
                    'That name already has a seat. Rejoin with the original membership token.')
            mid, token = uuid.uuid4().hex, secrets.token_urlsafe(32)
            room['members'][mid] = {'id': mid, 'name': name, 'role': role or 'operations',
                                    'ready': False, 'seen': self.clock(), 'active': True}
            if room['host'] is None:
                room['host'] = mid
                room['members'][mid]['role'] = 'ceo'
            self.identities[token] = (code, mid)
            self.event(room, 'joined', member=mid, name=name)
            return {'token': token, 'code': code}

    def set_documents(self, code, documents, ready):
        """Trusted server operation, never routed directly from a client command."""
        with self.lock:
            require(code in self.rooms, 'Room code not found', 404)
            room = self.rooms[code]
            self.tick(room)
            require(room['phase'] == 'lobby', 'Documents are frozen once the meeting starts')
            require(isinstance(documents, list) and len(documents) <= 100, 'Invalid documents', 422)
            require(type(ready) is bool, 'Invalid index readiness', 422)
            public = []
            for document in documents:
                if isinstance(document, str):
                    document = {'id': document, 'title': document}
                require(isinstance(document, dict), 'Invalid document', 422)
                identifier = bounded_text(document.get('id'), 200)
                require(identifier not in {item['id'] for item in public}, 'Duplicate document', 422)
                public.append({key: deepcopy(value) for key, value in document.items()
                               if key in {'id', 'title', 'filename', 'pages'}})
            changed = public != room['documents']
            room['documents'], room['documents_ready'] = public, bool(public) and ready
            if changed:
                for member in room['members'].values():
                    member['ready'] = False
            self.event(room, 'documents_updated', document_ids=[d['id'] for d in public],
                       ready=room['documents_ready'])

    def command(self, token, action, data):
        return self._command(token, action, data)

    def _command(self, token, action, data, trusted_recording=False):
        with self.lock:
            room, mid = self.identity(token)
            require(isinstance(data, dict) and isinstance(action, str), 'Invalid command', 422)
            cid = data.get('command_id')
            require(isinstance(cid, str) and 8 <= len(cid) <= 80, 'A command_id is required', 422)
            digest = hashlib.sha256(json.dumps([action, data], sort_keys=True).encode()).hexdigest()
            key = (token, cid)
            if key in self.receipts:
                old_digest, receipt = self.receipts[key]
                require(old_digest == digest, 'command_id was already used for another command')
                return deepcopy(receipt)
            require(len(self.receipts) < 100000, 'Playtest command limit reached', 429)
            self._apply(room, mid, action, data, trusted_recording=trusted_recording)
            receipt = self._snapshot(room, mid)
            self.receipts[key] = (digest, deepcopy(receipt))
            return receipt

    def _apply(self, room, mid, action, data, trusted_recording=False):
        phase = room['phase']
        member = room['members'][mid]
        if action == 'leave':
            member['active'] = False
            if room.get('active_audio') and room['active_audio'].get('member') == mid:
                self.cancel_audio(room, 'member_left')
            if phase == 'lobby':
                member['ready'] = False
            self.event(room, 'left', member=mid)
            return
        if action == 'ready':
            require(phase == 'lobby', 'Readiness is fixed once the meeting starts')
            require(type(data.get('ready')) is bool, 'ready must be a boolean', 422)
            member['ready'] = data['ready']
            self.event(room, 'ready', member=mid, ready=member['ready'])
            return
        if action == 'assign_roles':
            require(phase == 'lobby', 'Roles are frozen once the meeting starts')
            require(mid == room['host'], 'Only the host can assign lobby roles', 403)
            roles = data.get('roles')
            require(isinstance(roles, dict) and set(roles) == set(room['members']),
                    'Assign a role to every joined participant', 422)
            require(all(isinstance(role, str) and role in self.role_ids for role in roles.values()) and
                    list(roles.values()).count('ceo') == 1, 'Assign exactly one CEO and valid roles', 422)
            for target, role in roles.items():
                room['members'][target].update(role=role, ready=False)
            self.event(room, 'roles_assigned', member=mid, roles=deepcopy(roles))
            return
        if self.round_one_command(room, mid, action, data):
            return
        if action in {'start', 'finish_discussion', 'skip_consultation', 'commit_decision', 'cancel_decision', 'end'}:
            require(mid == self._ceo(room), 'Only the CEO can perform this action', 403)
        if action == 'start':
            blockers = self._start_blockers(room)
            require(not blockers, ' '.join(blockers))
            room['electorate'] = list(room['members'])
            self.event(room, 'started', member=mid, electorate=list(room['electorate']))
            self._transition(room, 'preparation')
        elif action == 'finish_discussion':
            require(phase == 'discussion', 'Discussion is not active')
            self.event(room, 'discussion_finished', member=mid)
            self._transition(room, 'consultation', reason='ceo_finish')
        elif action == 'skip_consultation':
            require(phase == 'consultation', 'Consultation is not active')
            if self.is_round_one(room):
                require(all(kind in room['expert_briefings'] for kind in EXPERTS),
                        'Hear all three expert perspectives before individual decisions', 409)
                require(not room.get('active_stream'), 'Wait for the current expert to finish', 409)
            self.event(room, 'consultation_skipped', member=mid)
            self._transition(room, 'decision', reason='ceo_skip')
        elif action == 'next_turn':
            require(phase == 'discussion', 'Discussion is not active')
            require(mid in (room['speaker'], self._ceo(room)),
                    'Only the current speaker or CEO can pass the turn', 403)
            if 'turn_number' in data:
                require(data['turn_number'] == room['turn_number'], 'This speaking turn has ended')
            self.cancel_audio(room, 'turn_changed')
            room['turn_index'] = (room['turn_index'] + 1) % len(room['electorate'])
            room['turn_number'] += 1
            room['speaker'] = room['electorate'][room['turn_index']]
            self.event(room, 'turn_changed', member=mid, speaker=room['speaker'],
                       turn_number=room['turn_number'])
        elif action == 'contribute' or (action == 'contribute_recorded' and trusted_recording):
            require(phase == 'discussion', 'Contributions are accepted during discussion')
            require(mid == room['speaker'], 'Wait for your speaking turn', 403)
            if 'turn_number' in data:
                require(data['turn_number'] == room['turn_number'], 'This speaking turn has ended')
            text = bounded_text(data.get('text'), 4000)
            source = data.get('source', 'typed')
            allowed = {'recorded'} if trusted_recording else {'typed', 'speech'}
            require(isinstance(source, str) and source in allowed, 'Invalid contribution source', 422)
            details = {'recording_id': data['recording_id']} if trusted_recording else {}
            entry = self.event(room, 'contribution', member=mid, name=member['name'], text=text,
                               source=source, turn_number=room['turn_number'], **details)
            room['transcript'].append(deepcopy(entry))
        elif action == 'add_custom_option':
            require(phase == 'decision', 'Add a response during the decision stage')
            require(mid == self._ceo(room), 'Only the CEO can add a custom response', 403)
            decision = next((item for item in room['decisions'] if item['id'] == data.get('decision_id')), None)
            require(decision is not None and decision.get('mode') == 'fixed_choice', 'Choice ballot not found', 404)
            require(decision['status'] == 'pending', 'This decision is already final')
            self._check_ballot_version(decision, data, required=True)
            require(len(decision['options']) < 6, 'This ballot already has three custom responses', 422)
            title, proposal = bounded_text(data.get('title'), 80), bounded_text(data.get('proposal'), 1500)
            require(not any(o['proposal'].casefold() == proposal.casefold() for o in decision['options']),
                    'That response is already on this ballot', 422)
            require(type(data.get('acknowledge_reset', False)) is bool, 'acknowledge_reset must be a boolean', 422)
            require(not decision['votes'] or data.get('acknowledge_reset') is True,
                    'Adding a response clears existing votes. Confirm that everyone will vote again', 409)
            option = {'id': 'custom_'+uuid.uuid4().hex, 'label': title, 'proposal': proposal,
                      'custom': True, 'proposed_by': mid}
            decision['options'].append(option)
            cleared = len(decision['votes'])
            decision['votes'] = {}
            decision['ballot_version'] = decision.get('ballot_version', 1)+1
            self.cancel_audio(room, 'ballot_changed')
            self.event(room, 'custom_option_added', member=mid, decision_id=decision['id'],
                       option=deepcopy(option), ballot_version=decision['ballot_version'], votes_cleared=cleared)
        elif action == 'propose_decision':
            require(phase == 'decision', 'Decisions follow the consultation minute')
            require(not self._fixed_scenario(room), 'Use the current choice ballot or add a custom response for this T01 meeting')
            problem = bounded_text(data.get('problem'), 1000)
            proposal = bounded_text(data.get('proposal'), 2000)
            sources = data.get('source_ids')
            known = {entry['id'] for entry in room['transcript']}
            require(isinstance(sources, list) and 0 < len(sources) <= 100 and
                    all(isinstance(source, str) and source in known for source in sources),
                    'Link the decision to contributions in this meeting', 422)
            require(len(room['decisions']) < 100, 'Decision limit reached', 429)
            decision = {'id': uuid.uuid4().hex, 'mode': 'approval', 'problem': problem, 'proposal': proposal,
                        'source_ids': list(dict.fromkeys(sources)), 'member': mid, 'at': self.clock(),
                        'status': 'pending', 'votes': {}}
            room['decisions'].append(decision)
            self.event(room, 'decision_proposed', member=mid, decision_id=decision['id'],
                       problem=problem, proposal=proposal, source_ids=decision['source_ids'])
        elif action in {'vote_decision', 'vote_option', 'commit_decision', 'cancel_decision'}:
            require(phase == 'decision', 'Decision voting is not active')
            decision = next((item for item in room['decisions'] if item['id'] == data.get('decision_id')), None)
            require(decision is not None, 'Decision not found in this room', 404)
            require(decision['status'] == 'pending', 'This decision is already final')
            fixed = decision.get('mode') == 'fixed_choice'
            if fixed and action in {'vote_option', 'commit_decision'}:
                self._check_ballot_version(decision, data)
            if action == 'vote_option':
                require(fixed, 'Use approve, reject or abstain for this proposal', 422)
                require(mid in room['electorate'], 'Only eligible members can vote', 403)
                require(mid in decision['votes'] or mid == self.next_voter(room, decision),
                        'Wait until you are asked for your decision', 403)
                option = data.get('option_id')
                require(isinstance(option, str) and option in {item['id'] for item in decision['options']},
                        'Choose a response on the current ballot', 422)
                decision['votes'][mid] = option
                self.event(room, 'ballot_received', member=mid, decision_id=decision['id'])
            elif action == 'vote_decision':
                require(not fixed, 'Choose a prepared or custom response for this decision', 422)
                require(mid in room['electorate'], 'Only eligible members can vote', 403)
                choice = data.get('choice')
                require(isinstance(choice, str) and choice in {'approve', 'reject', 'abstain'}, 'Invalid vote', 422)
                decision['votes'][mid] = choice
                self.event(room, 'ballot_received', member=mid, decision_id=decision['id'])
            elif action == 'cancel_decision':
                require(not fixed, 'The authored ballot must be resolved by participant votes')
                reason = bounded_text(data.get('reason'), 1000)
                self._finalize(room, decision, mid, 'cancelled', reason=reason)
            else:
                require(set(decision['votes']) == set(room['electorate']), 'Every participant must vote before commitment')
                if fixed:
                    self._commit_fixed(room, decision, mid, data)
                    return
                tally = self._tally(decision)
                tied = tally['approve'] == tally['reject'] and tally['approve'] > 0
                tie_break = data.get('tie_break')
                if tied:
                    require(isinstance(tie_break, str) and tie_break in {'approve', 'reject'}, 'The CEO must explicitly resolve this tie', 422)
                    status = 'approved' if tie_break == 'approve' else 'rejected'
                    reason = 'ceo_tie_break'
                else:
                    require(tie_break is None, 'A CEO override is allowed only for a tied vote', 422)
                    status = 'approved' if tally['approve'] > len(room['electorate']) / 2 else 'rejected'
                    reason = 'majority' if status == 'approved' or tally['reject'] > len(room['electorate']) / 2 else 'no_majority'
                self._finalize(room, decision, mid, status, reason=reason, tie_break=tie_break)
        elif action == 'end':
            require(phase == 'decision', 'End the meeting after its decision phase')
            require(all(item['status'] != 'pending' for item in room['decisions']),
                    'Resolve every pending decision before ending the meeting')
            self.event(room, 'ended', member=mid)
            self._transition(room, 'ended')
        else:
            raise RuleError('Unknown roundtable command', 422)

    @staticmethod
    def _check_ballot_version(decision, data, required=False):
        version = data.get('ballot_version', None if required else 1)
        require(type(version) is int and version == decision.get('ballot_version', 1),
                'The ballot changed. Review the current choices and vote again', 409)

    @staticmethod
    def next_voter(room, decision):
        if decision.get('mode') != 'fixed_choice' or decision['status'] != 'pending':
            return None
        return next((mid for mid in room['electorate'] if mid not in decision['votes']), None)

    def _commit_fixed(self, room, decision, mid, data):
        options = {option['id']: option for option in decision['options']}
        require(all(vote in options for vote in decision['votes'].values()), 'Invalid stored option ballot')
        tally = self._tally(decision)
        most = max(tally.values(), default=0)
        require(most > 0, 'Participants must explicitly select an option')
        leaders = [option for option, count in tally.items() if count == most]
        selected = data.get('option_id')
        if len(leaders) > 1:
            require(isinstance(selected, str) and selected in leaders,
                    'The CEO must choose one of the tied leading options', 422)
            reason = 'ceo_tie_break'
        else:
            require(selected is None or selected == leaders[0],
                    'The CEO cannot override the winning option', 422)
            selected, reason = leaders[0], 'plurality'
        require(data.get('tie_break') is None, 'Resolve a choice tie using option_id', 422)
        decision.update(option_id=selected, proposal=options[selected]['proposal'],
                        option_label=options[selected]['label'],
                        option_kind='custom' if options[selected].get('custom') else 'prepared')
        self._finalize(room, decision, mid, 'approved', reason=reason)

    @staticmethod
    def _tally(decision):
        choices = ([option['id'] for option in decision['options']] if decision.get('mode') == 'fixed_choice'
                   else ('approve', 'reject', 'abstain'))
        return {choice: list(decision['votes'].values()).count(choice) for choice in choices}

    def _finalize(self, room, decision, mid, status, **details):
        decision.update(status=status, committed_by=mid, committed_at=self.clock(),
                        tally=self._tally(decision), **details)
        room['history'].append(deepcopy(decision))
        self.event(room, 'decision_committed', member=mid, decision_id=decision['id'], status=status, **details)

    def snapshot(self, token):
        with self.lock:
            room, mid = self.identity(token)
            return self._snapshot(room, mid)

    def _snapshot(self, room, mid):
        public = {key: deepcopy(room[key]) for key in ('code', 'host', 'phase', 'version', 'deadline',
            'electorate', 'documents', 'documents_ready', 'transcript', 'summary', 'decision_prompts',
            'history', 'suggestions', 'speaker', 'turn_index', 'turn_number', 'active_stream', 'flow')}
        public.update(self.round_one_snapshot(room, mid))
        public.update(me=mid, ceo=self._ceo(room), fixed_scenario=self._fixed_scenario(room), server_time=self.clock(), roles=deepcopy(self.roles),
                      recording_policy=self.RECORDING_POLICY, speaking=list(room['electorate']) if room['phase'] == 'discussion' else [])
        lease = room.get('active_audio')
        public['active_audio'] = ({key: deepcopy(value) for key, value in lease.items()
                                   if key in {'id', 'recording_id', 'member', 'phase', 'turn_number',
                                              'status', 'expires', 'captions', 'clip_id', 'text', 'started_at', 'complete_after'}} if lease else None)
        public['members'] = [{**{key: member[key] for key in ('id', 'name', 'role', 'ready')},
                              'connected': self._connected(member), 'speaking': member['id'] == room['speaker']} for member in room['members'].values()]
        public['start_blockers'] = self._start_blockers(room)
        public['can_start'] = mid == self._ceo(room) and not public['start_blockers']
        public['decisions'] = []
        for item in room['decisions']:
            decision = deepcopy(item)
            decision['my_vote'] = item['votes'].get(mid)
            decision['ballot_count'] = len(item['votes'])
            decision['voted_members'] = list(item['votes'])
            decision['next_voter'] = self.next_voter(room, item)
            decision['waiting_members'] = [person for person in room['electorate'] if person not in item['votes']]
            if item['status'] == 'pending':
                decision.pop('votes')
                if mid == self._ceo(room) and set(item['votes']) == set(room['electorate']):
                    decision['tally'] = self._tally(item)
            public['decisions'].append(decision)
        public['jobs'] = [{key: deepcopy(value) for key, value in job.items()
                           if key in {'id', 'kind', 'member', 'status', 'error', 'submitted_at', 'completed_at',
                                      'timing', 'question', 'result', 'text', 'sources'}}
                          for job in room['jobs'].values()]
        return public
