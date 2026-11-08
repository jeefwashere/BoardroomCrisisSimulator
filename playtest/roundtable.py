"""Isolated, single round meeting authority. Model output is advisory only."""
from copy import deepcopy
import hashlib
import json
import secrets
import threading
import time
import uuid

from .engine import RuleError, SCENARIO, bounded_text, require


class Roundtable:
    """An ephemeral meeting whose membership tokens never enter public snapshots."""

    DURATIONS = {'preparation': 30, 'discussion': 300}
    NEXT = {'preparation': 'discussion', 'discussion': 'decision'}
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
        self.event(room, 'phase', at=at, phase=phase, deadline=room['deadline'], reason=reason)

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

    def join(self, name, code=None, token=None, role=None):
        with self.lock:
            name = bounded_text(name, 40)
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
        if action in {'start', 'finish_discussion', 'commit_decision', 'cancel_decision', 'end'}:
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
            self._transition(room, 'decision', reason='ceo_finish')
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
        elif action == 'propose_decision':
            require(phase == 'decision', 'Decisions follow the discussion round')
            problem = bounded_text(data.get('problem'), 1000)
            proposal = bounded_text(data.get('proposal'), 2000)
            sources = data.get('source_ids')
            known = {entry['id'] for entry in room['transcript']}
            require(isinstance(sources, list) and 0 < len(sources) <= 100 and
                    all(isinstance(source, str) and source in known for source in sources),
                    'Link the decision to contributions in this meeting', 422)
            require(len(room['decisions']) < 100, 'Decision limit reached', 429)
            decision = {'id': uuid.uuid4().hex, 'problem': problem, 'proposal': proposal,
                        'source_ids': list(dict.fromkeys(sources)), 'member': mid, 'at': self.clock(),
                        'status': 'pending', 'votes': {}}
            room['decisions'].append(decision)
            self.event(room, 'decision_proposed', member=mid, decision_id=decision['id'],
                       problem=problem, proposal=proposal, source_ids=decision['source_ids'])
        elif action in {'vote_decision', 'commit_decision', 'cancel_decision'}:
            require(phase == 'decision', 'Decision voting is not active')
            decision = next((item for item in room['decisions'] if item['id'] == data.get('decision_id')), None)
            require(decision is not None, 'Decision not found in this room', 404)
            require(decision['status'] == 'pending', 'This decision is already final')
            if action == 'vote_decision':
                require(mid in room['electorate'], 'Only eligible members can vote', 403)
                choice = data.get('choice')
                require(isinstance(choice, str) and choice in {'approve', 'reject', 'abstain'}, 'Invalid vote', 422)
                decision['votes'][mid] = choice
                self.event(room, 'ballot_received', member=mid, decision_id=decision['id'])
            elif action == 'cancel_decision':
                reason = bounded_text(data.get('reason'), 1000)
                self._finalize(room, decision, mid, 'cancelled', reason=reason)
            else:
                require(set(decision['votes']) == set(room['electorate']), 'Every participant must vote before commitment')
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
                    'Resolve or explicitly cancel every pending decision first')
            self.event(room, 'ended', member=mid)
            self._transition(room, 'ended')
        else:
            raise RuleError('Unknown roundtable command', 422)

    @staticmethod
    def _tally(decision):
        return {choice: list(decision['votes'].values()).count(choice)
                for choice in ('approve', 'reject', 'abstain')}

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
            'history', 'suggestions', 'speaker', 'turn_index', 'turn_number', 'active_stream')}
        public.update(me=mid, ceo=self._ceo(room), server_time=self.clock(), roles=deepcopy(self.roles),
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
