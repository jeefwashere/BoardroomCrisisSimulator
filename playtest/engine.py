"""Authoritative, single process game engine. AI can only suggest allowed outcomes."""
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import secrets
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCENARIO = ROOT / 'scenarios/cybersecurity_demo/v2/scenario.json'


class RuleError(Exception):
    def __init__(self, message, status=409):
        self.message, self.status = message, status


def require(condition, message, status=409):
    if not condition:
        raise RuleError(message, status)


def bounded_text(value, limit=1000):
    require(isinstance(value, str) and 0 < len(value.strip()) <= limit,
            f'Text must contain 1 to {limit} characters', 422)
    return value.strip()


class Engine:
    def __init__(self, clock=time.time, round_limit=1):
        require(type(round_limit) is int and 1 <= round_limit <= 3, "Invalid round limit", 422)
        self.round_limit = round_limit
        self.clock = clock
        self.lock = threading.RLock()
        self.rooms, self.identities, self.receipts = {}, {}, {}
        self.scenario = json.loads(SCENARIO.read_text())
        self.nodes = {n['id']: n for n in self.scenario['nodes']}
        self.roles = {r['id'] for r in self.scenario['roles']}
        for node in self.nodes.values():
            outcomes = {o['id'] for o in node['outcomes']}
            assert node['no_decision_outcome_id'] in outcomes
            assert set(node['allowed_custom_outcome_ids']) <= outcomes
            assert all(o['outcome_id'] in outcomes for o in node['options'])
            assert all(o['terminal'] or o['next_node_id'] in self.nodes for o in node['outcomes'])

    def identity(self, token):
        require(token in self.identities, 'Join a room first', 401)
        code, mid = self.identities[token]
        room = self.rooms[code]
        room['members'][mid]['seen'] = self.clock()
        self.tick(room)
        return room, mid

    def event(self, r, kind, **details):
        r['version'] += 1
        event = {'id': f'e{r["version"]}', 'type': kind, 'at': self.clock(), **details}
        r['events'].append(event)
        return event

    def join(self, name, code=None, token=None):
        with self.lock:
            name = bounded_text(name, 40)
            if token in self.identities:
                old_code, _ = self.identities[token]
                if code == old_code:
                    return {'token': token, 'code': code}
            if code is None:
                require(len(self.rooms) < 50, 'Playtest room limit reached', 429)
                code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
                while code in self.rooms:
                    code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
                self.rooms[code] = {'code': code, 'members': {}, 'host': None, 'phase': 'lobby',
                    'version': 0, 'events': [], 'history': [], 'contributions': [], 'suggestions': [], 'chat': [],
                    'jobs': {}, 'node': self.scenario['initial_node_id'], 'round': 0,
                    'metrics': deepcopy(self.scenario['initial_metrics']),
                    'facts': deepcopy(self.scenario['initial_facts']), 'votes': {}, 'proposals': {},
                    'electorate': [], 'ties': [], 'deadline': None, 'total_deadline': None,
                    'speech': None, 'ai_ticket': None, 'unresolved': None, 'feedback': None}
            require(isinstance(code, str) and code in self.rooms, 'Room code not found', 404)
            r = self.rooms[code]
            self.tick(r)
            require(r['phase'] != 'ended', 'This exercise has ended')
            require(len(r['members']) < 30, 'Room is full')
            require(name.casefold() not in [m['name'].casefold() for m in r['members'].values()],
                    'That name already has a seat. Rejoin using the original browser tab.')
            mid, token = uuid.uuid4().hex, secrets.token_urlsafe(32)
            r['members'][mid] = {'id': mid, 'name': name, 'role': 'operations',
                                 'seen': self.clock(), 'eligible_round': r['round'] + 1}
            if not r['host']:
                r['host'] = mid
                r['members'][mid]['role'] = 'ceo'
            self.identities[token] = (code, mid)
            self.event(r, 'joined', member=mid, name=name, eligible_round=r['round'] + 1)
            return {'token': token, 'code': code}

    def command(self, token, action, data):
        with self.lock:
            r, mid = self.identity(token)
            cid = data.get('command_id')
            require(isinstance(cid, str) and 8 <= len(cid) <= 80, 'A command_id is required', 422)
            key = (token, cid)
            fingerprint = hashlib.sha256(json.dumps([action, data], sort_keys=True).encode()).hexdigest()
            if key in self.receipts:
                old, result = self.receipts[key]
                require(old == fingerprint, 'Command ID already used with different content')
                return deepcopy(result)
            require(len(self.receipts) < 100000, 'Playtest command capacity reached', 429)
            result = self.act(r, mid, action, data) or {'ok': True}
            self.receipts[key] = (fingerprint, deepcopy(result))
            return result

    def act(self, r, mid, action, d):
        now = self.clock()
        host = mid == r['host']
        phase = r['phase']
        if action == 'roles':
            require(host and phase == 'lobby', 'Only the host can assign lobby roles', 403)
            roles = d.get('roles')
            require(isinstance(roles, dict) and set(roles) == set(r['members']) and
                    all(v in self.roles for v in roles.values()), 'Assign a valid role to every member', 422)
            require(list(roles.values()).count('ceo') == 1, 'Exactly one CEO is required', 422)
            for member, role in roles.items():
                r['members'][member]['role'] = role
            self.event(r, 'roles_assigned')
        elif action == 'start':
            require(host and phase == 'lobby', 'Only the host can start the lobby', 403)
            require(3 <= len(r['members']) <= 30, 'Start requires 3 to 30 participants')
            require(all(now - m['seen'] < 30 for m in r['members'].values()), 'All lobby members must be connected')
            require(sum(m['role'] == 'ceo' for m in r['members'].values()) == 1, 'Exactly one CEO is required')
            profile = d.get('profile', 'standard_18')
            require(profile in ('standard_18', 'fast_15', 'test_3'), 'Unknown timing profile', 422)
            r['profile'] = profile
            if profile == 'test_3':
                r['timing'] = dict(briefing=4, reading=4, discussion=12, vote=8, result=4, tie=5, total=180, speaker=4)
            else:
                p = self.scenario['timing_profiles'][profile]
                r['timing'] = dict(briefing=p['briefing_seconds'], reading=p['reading_seconds_per_round'],
                    discussion=p['discussion_seconds_per_round'], vote=60, result=p['result_seconds_per_round'],
                    tie=30, total=p['gameplay_ceiling_from_briefing_start_seconds'], speaker=p['speaker_max_seconds'])
            if self.round_limit == 1:
                t = r['timing']
                t['total'] = sum(t[k] for k in ('briefing', 'reading', 'discussion', 'vote', 'tie')) + max(30, t['result']) + 5
            r['total_deadline'] = now + r['timing']['total']
            self.phase(r, 'briefing', now + r['timing']['briefing'])
        elif action == 'end':
            require(host and phase not in ('lobby', 'ended'), 'Only the host can end a running exercise', 403)
            self.end(r, 'host_ended')
        elif action == 'chat':
            text = bounded_text(d.get('text'))
            require(len(r['chat']) < 300, 'Room text chat limit reached', 429)
            event = self.event(r, 'chat', member=mid, text=text, source='typed', round=r['round'])
            r['chat'].append(event)
            return {'ok': True, 'message_id': event['id']}
        elif action == 'contribute':
            require(phase == 'discussion' and mid in r['electorate'], 'Contributions are open during your eligible round')
            require(r.get('speaker') in (None, mid), 'Another participant has the speaking turn')
            text = bounded_text(d.get('text'))
            require(d.get('source', 'typed') in ('typed', 'speech'), 'Invalid source', 422)
            require(len(r['contributions']) < 500, 'Contribution limit reached', 429)
            e = self.event(r, 'contribution', member=mid, text=text, source=d.get('source', 'typed'), round=r['round'])
            r['contributions'].append(e)
            return {'ok': True, 'contribution_id': e['id']}
        elif action == 'propose':
            require(phase == 'discussion' and mid in r['electorate'], 'Proposals are open during your eligible discussion')
            text = bounded_text(d.get('text'))
            r['proposals'][mid] = {'id': 'custom_' + mid, 'kind': 'custom', 'label': text, 'author': mid}
            self.event(r, 'proposal_updated', member=mid)
        elif action in ('finish', 'skip'):
            require(phase == 'discussion' and r.get('speaker'), 'No active speaking turn')
            require((action == 'finish' and r['speaker'] == mid) or (action == 'skip' and host), 'Not your speaking turn', 403)
            self.event(r, 'speaker_finished' if action == 'finish' else 'speaker_skipped', member=r['speaker'], by=mid)
            self.next_speaker(r, now)
        elif action == 'vote':
            require(phase == 'voting' and mid in r['electorate'], 'Voting is closed or you join voting next round')
            choice = d.get('option_id')
            require(choice in {o['id'] for o in r['options']}, 'Unknown option', 422)
            r['votes'][mid] = choice
            r['version'] += 1
        elif action == 'tie':
            require(phase == 'tie_break' and r['members'][mid]['role'] == 'ceo', 'Only the CEO can resolve a current tie', 403)
            require(d.get('option_id') in r['ties'], 'Choose one of the tied options', 422)
            self.select(r, d['option_id'], now, 'ceo_tie_break')
        elif action == 'reassign_ceo':
            require(host and phase == 'tie_break', 'CEO reassignment is only available to the host during a tie', 403)
            ceo = next(m for m in r['members'].values() if m['role'] == 'ceo')
            require(now - ceo['seen'] > 15, 'The CEO is still connected')
            target = d.get('member_id')
            require(target in r['electorate'] and now - r['members'][target]['seen'] < 15, 'Select a connected eligible member')
            ceo['role'] = 'operations'
            r['members'][target]['role'] = 'ceo'
            self.event(r, 'ceo_reassigned', old=ceo['id'], member=target)
        elif action == 'check_decision':
            latest = r['history'][-1] if r['history'] else None
            return {'ok': True, 'confirmed_decisions': len(r['history']),
                    'latest': deepcopy(latest), 'unresolved': deepcopy(r['unresolved']),
                    'text': ('The latest committed decision is: ' + latest['summary'] if latest else
                             'No decision has been committed. A proposal or spoken statement is not a vote result.'),
                    'ownership_note': 'Owner mentions are not separate accepted assignments in this voting prototype.',
                    'evidence': ('history round ' + str(latest['round'])) if latest else 'authoritative empty decision history'}
        elif action == 'retry':
            require(host and phase == 'resolution_failed' and r.get('attempts', 0) < 2, 'A custom resolution has at most one retry')
            require(not any(j['kind'] == 'resolve' and j['status'] == 'pending' for j in r['jobs'].values()),
                    'The original model job is still pending; it must finish before retry')
            require(now + 1 < r['resolution_deadline'], 'The custom result window has expired')
            self.begin_resolution(r, now)
        else:
            raise RuleError('Unknown command', 404)

    def phase(self, r, phase, deadline):
        r['phase'], r['deadline'], r['speech'] = phase, deadline, None
        self.event(r, 'phase', phase=phase, round=r['round'])

    def begin_round(self, r, at):
        r['round'] += 1
        r['electorate'] = list(r['members'])
        r['votes'], r['proposals'], r['ties'] = {}, {}, []
        r['options'] = [{k: o[k] for k in ('id', 'kind', 'label')} for o in self.nodes[r['node']]['options']]
        r['unresolved'], r['ai_ticket'] = None, None
        self.phase(r, 'reading', at + r['timing']['reading'])

    def next_speaker(self, r, at):
        r['speech'] = None
        r['speaker'] = None
        while r['speaker_index'] < len(r['electorate']):
            mid = r['electorate'][r['speaker_index']]
            r['speaker_index'] += 1
            if at - r['members'][mid]['seen'] <= 15:
                r['speaker'] = mid
                r['speaker_deadline'] = min(r['deadline'], at + r['slot'])
                self.event(r, 'speaker', member=mid)
                return
        r['speaker_deadline'] = None
        self.event(r, 'open_discussion')

    def tick(self, r):
        now = self.clock()
        if r['phase'] in ('lobby', 'ended'):
            return
        if now >= r['total_deadline']:
            self.end(r, 'total_timeout')
            return
        # Advance all expired phases using their old deadlines, never extend time on reconnect.
        for _ in range(100):
            phase = r['phase']
            if phase == 'discussion' and r.get('speaker'):
                if now >= r['speaker_deadline']:
                    self.next_speaker(r, r['speaker_deadline'])
                    continue
                if now - r['members'][r['speaker']]['seen'] > 15:
                    self.next_speaker(r, now)
            if r['deadline'] is None or now < r['deadline']:
                return
            at = r['deadline']
            if phase == 'briefing':
                self.begin_round(r, at)
            elif phase == 'reading':
                self.phase(r, 'discussion', at + r['timing']['discussion'])
                r['speaker_index'] = 0
                r['slot'] = min(r['timing']['speaker'], r['timing']['discussion'] / len(r['electorate']))
                self.next_speaker(r, at)
            elif phase == 'discussion':
                r['options'] += list(r['proposals'].values())
                r['speaker'] = None
                self.phase(r, 'voting', at + r['timing']['vote'])
            elif phase == 'voting':
                tally = Counter(r['votes'].values())
                r['tally'] = dict(tally)
                leaders = [k for k, n in tally.items() if n == max(tally.values())] if tally else []
                if len(leaders) > 1:
                    r['ties'] = leaders
                    self.phase(r, 'tie_break', at + r['timing']['tie'])
                else:
                    self.select(r, leaders[0] if leaders else None, at, 'vote' if leaders else 'zero_votes')
            elif phase == 'tie_break':
                self.select(r, None, at, 'tie_timeout')
            elif phase == 'resolving':
                r['ai_ticket'] = None
                self.phase(r, 'resolution_failed', r['resolution_deadline'])
                self.event(r, 'resolution_failed', reason='AI deadline exceeded. Selected action remains unresolved.')
            elif phase == 'resolution_failed':
                self.end(r, 'unresolved_custom_action')
            elif phase == 'result':
                if r.get('next_node') is None:
                    self.end(r, 'scenario_complete')
                elif r['round'] >= self.round_limit:
                    self.end(r, 'round_complete')
                else:
                    r['node'] = r['next_node']
                    self.begin_round(r, at)
            else:
                return

    def select(self, r, option_id, at, reason):
        r['selected'], r['selection_reason'] = option_id, reason
        node = self.nodes[r['node']]
        if option_id and option_id.startswith('custom_'):
            option = next(o for o in r['options'] if o['id'] == option_id)
            r['unresolved'] = {'node': r['node'], 'round': r['round'], 'option': deepcopy(option), 'reason': reason}
            r['attempts'] = 0
            r['resolution_deadline'] = at + 30
            self.begin_resolution(r, at)
        else:
            outcome = next((o['outcome_id'] for o in node['options'] if o['id'] == option_id), node['no_decision_outcome_id'])
            self.apply_outcome(r, outcome, at)

    def begin_resolution(self, r, at):
        r['attempts'] += 1
        r['ai_ticket'] = uuid.uuid4().hex
        self.phase(r, 'resolving', min(at + 15, r['resolution_deadline']))
        self.event(r, 'custom_selected', option=r['selected'], attempt=r['attempts'])

    def apply_outcome(self, r, outcome_id, at, explanation=None):
        node = self.nodes[r['node']]
        outcome = next(o for o in node['outcomes'] if o['id'] == outcome_id)
        before = deepcopy(r['metrics'])
        for k, change in outcome['metric_deltas'].items():
            r['metrics'][k] = min(100, max(0, r['metrics'][k] + change))
        r['facts'].update(outcome['fact_updates'])
        record = {'round': r['round'], 'node': r['node'], 'option_id': r['selected'],
                  'outcome_id': outcome_id, 'summary': outcome['summary'], 'metrics_before': before,
                  'metrics_after': deepcopy(r['metrics']), 'facts': deepcopy(r['facts']),
                  'reason': r['selection_reason'], 'tally': deepcopy(r.get('tally', {})),
                  'at': at, 'ai_explanation': explanation}
        r['history'].append(record)
        self.event(r, 'decision', **record)
        r['unresolved'], r['ai_ticket'] = None, None
        r['next_node'] = outcome['next_node_id']
        deadline = r['resolution_deadline'] if explanation is not None else at + r['timing']['result']
        self.phase(r, 'result', deadline)

    def end(self, r, reason):
        r['ai_ticket'] = None
        self.phase(r, 'ended', None)
        r['end_reason'] = reason
        self.event(r, 'ended', reason=reason)

    def inject(self, r):
        text = self.nodes[r['node']]['inject']
        return re.sub(r'\{\{(\w+)\}\}', lambda m: str(r['facts'].get(m[1], 'unknown')), text)

    def snapshot(self, token):
        with self.lock:
            r, mid = self.identity(token)
            now = self.clock()
            active = r['phase'] != 'lobby'
            members = [{**{k: m[k] for k in ('id', 'name', 'role', 'eligible_round')},
                        'connected': now - m['seen'] < 15} for m in r['members'].values()]
            counts = Counter(c['member'] for c in r['contributions'])
            questions = [c for c in r['contributions'] if '?' in c['text']]
            node = self.nodes[r['node']]
            return deepcopy({'code': r['code'], 'self': mid, 'host': r['host'], 'members': members,
                'version': r['version'], 'server_time': now, 'phase': r['phase'], 'round': r['round'], 'round_limit': self.round_limit,
                'profile': r.get('profile'), 'deadline': r['deadline'], 'total_deadline': r['total_deadline'],
                'speaker': r.get('speaker') if r['phase'] == 'discussion' else None,
                'speaker_deadline': r.get('speaker_deadline') if r['phase'] == 'discussion' else None,
                'electorate': r['electorate'], 'roles': self.scenario['roles'],
                'scenario': {'id': self.scenario['scenario_id'], 'version': self.scenario['version']},
                'title': self.scenario['title'], 'node_title': node['title'] if active else None,
                'inject': self.inject(r) if active else '', 'study_questions': node['study_questions'] if active else [],
                'options': (r.get('options', []) + (list(r['proposals'].values()) if r['phase'] == 'discussion' else [])),
                'own_vote': r['votes'].get(mid), 'ties': r['ties'],
                'tally': r.get('tally', {}) if r['phase'] in ('tie_break', 'resolving', 'resolution_failed', 'result', 'ended') else {},
                'metrics': r['metrics'], 'facts': r['facts'] if active else {}, 'history': r['history'],
                'contributions': r['contributions'], 'suggestions': r['suggestions'], 'chat': r['chat'],
                'jobs': list(r['jobs'].values()), 'unresolved': r['unresolved'], 'feedback': r['feedback'],
                'end_reason': r.get('end_reason'), 'events': r['events'][-100:],
                'climate': {'contributions_by_member': dict(counts), 'questions_recorded': len(questions),
                    'note': 'Observed text only. Questions may already have been answered. No emotion or competence score.'},
                'speech': r['speech'] if r['speech'] and r['speech']['expires'] > now else None})

    def documents(self):
        return [{'id': d['id'], 'text': (SCENARIO.parent / d['path']).read_text()}
                for d in self.scenario['public_documents']]
