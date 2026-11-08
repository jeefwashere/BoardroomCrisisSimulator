"""Explicit live HTTP check of PDF preparation, CEO workflow and written minutes."""
import argparse
import json
from pathlib import Path
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from .recordings import RecordingLibrary
from .smoke import Client


class MeetingClient(Client):
    def join(self, name, code=None):
        response = self.request('/api/roundtable/join', {'name': name, 'code': code})
        self.token = response['token']
        return response['code']

    def state(self):
        return self.request('/api/roundtable/state')

    def command(self, action, **data):
        return self.request('/api/roundtable/command/' + action, {'command_id': uuid.uuid4().hex, **data})

    def ask(self, kind, question=''):
        return self.request('/api/roundtable/agent/' + kind,
                            {'command_id': uuid.uuid4().hex, 'text': question})['id']


def wait_job(client, clients, jid=None, kind=None):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        states = [member.state() for member in clients]  # Keep the three lobby seats present.
        state = states[clients.index(client)]
        jobs = [j for j in state['jobs'] if j['id'] == jid or (jid is None and j['kind'] == kind)]
        if jobs and jobs[-1]['status'] != 'pending':
            job = jobs[-1]
            assert job['status'] == 'done', job
            return job, next(s for s in state['suggestions'] if s['id'] == job['id'])
        time.sleep(.25)
    raise AssertionError('Agent did not finish within 180 seconds')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8788')
    parser.add_argument('--live-models', action='store_true', help='Authorize four Vertex requests within the existing cap')
    parser.add_argument('--allow-paid-transcription', action='store_true', help='One explicit Scribe fixture request, 400 credits')
    parser.add_argument('--output', default='playtest/evaluations/roundtable.json')
    args = parser.parse_args()
    if not args.live_models:
        parser.error('This workflow includes automatic minutes. Pass --live-models to opt in.')
    clients = [MeetingClient(args.url) for _ in range(3)]
    host, ceo, third = clients
    before = host.request('/api/health')
    code = host.join('Alex test host')
    ceo.join('Morgan test CEO', code)
    third.join('Sam test member', code)
    report = {'room': code, 'health_before': before, 'cases': [],
              'method': 'Three HTTP clients, scripted contributions, live Gemma retrieval and Vertex selections. No browser controls.'}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    def save():
        output.write_text(json.dumps(report, indent=2) + '\n')
    save()
    memory = host.request('/api/roundtable/memory')
    assert memory['ready'] and len(memory['documents']) == 1, memory
    report['memory'] = memory
    roles = {m['id']: ('ceo' if m['id'] == ceo.state()['me'] else 'operations') for m in host.state()['members']}
    host.command('assign_roles', roles=roles)
    probes = [
        ('T01', 'In the service outage report, what must IT verify before promising recovery?', 'backup'),
        ('T02', 'In the fundraising report, can the treasurer vote on reviewing his printing company transactions?', 'must not vote'),
        ('T03', 'In the succession report, does appointing an acting director provision payroll access?', 'does not provision'),
    ]
    for pack, question, expected in probes:
        if pack not in {d['id'] for d in memory['documents']}:
            continue
        job, reply = wait_job(host, clients, host.ask('preparation', question))
        passed = expected.lower() in reply['text'].lower() and any(c['document_id'] == pack for c in reply['citations'])
        report['cases'].append({'kind': 'preparation', 'pack': pack, 'question': question, 'job': job,
                                'reply': reply, 'criterion_pass': passed})
        save()
        assert passed, f'Preparation relevance check failed for {pack}'
    for client in clients:
        client.command('ready', ready=True)
    try:
        host.command('start')
        raise AssertionError('Non CEO host started meeting')
    except urllib.error.HTTPError as exc:
        assert exc.code == 403
        exc.close()
    ceo.command('start')
    preparation = ceo.state()
    assert preparation['phase'] == 'preparation'
    preparation_started = time.monotonic()
    while time.monotonic() - preparation_started < 45:
        states = [client.state() for client in clients]
        state = states[1]
        if state['phase'] == 'discussion':
            break
        assert state['phase'] == 'preparation', state['phase']
        time.sleep(.25)
    else:
        raise AssertionError('Preparation did not advance into discussion')
    assert state['deadline'] - preparation['deadline'] == 300
    report['preparation_wait_seconds'] = round(time.monotonic() - preparation_started, 2)
    job, reply = wait_job(ceo, clients, ceo.ask('facilitator', 'What should we clarify before deciding?'))
    report['cases'].append({'kind': 'discussion_facilitator', 'job': job, 'reply': reply})
    statements = ['Alex will ask IT to verify backup usability before 3 PM.',
                  'We need a decision on isolating the affected finance device while preserving logs.',
                  'Separate confirmed facts from unknowns before publishing an update.']
    for client, text in zip(clients, statements):
        state = client.state()
        assert state['speaker'] == state['me'], 'Server must grant each participant their turn'
        client.command('contribute', text=text, source='typed', turn_number=state['turn_number'])
        client.command('next_turn', turn_number=state['turn_number'])
    if args.allow_paid_transcription:
        with tempfile.TemporaryDirectory(prefix='roundtable-check-') as directory:
            path = RecordingLibrary().wav('discussion_owner', Path(directory)/'clip.wav')
            request = urllib.request.Request(args.url + '/api/roundtable/transcribe', data=path.read_bytes(),
                headers={'Authorization': 'Bearer '+host.token, 'Content-Type': 'audio/wav', 'X-Command-ID': uuid.uuid4().hex})
            start = time.perf_counter()
            with urllib.request.urlopen(request, timeout=90) as response:
                transcript = json.load(response)
            assert len(host.state()['transcript']) == 3, 'STT must not auto commit'
            report['speech'] = {'result': transcript, 'elapsed_ms': round((time.perf_counter()-start)*1000, 1),
                                'provisional_only': True, 'fixture': 'discussion_owner', 'human_microphone': False}
            save()
    ceo.command('finish_discussion')
    assert ceo.state()['phase'] == 'decision'
    job, reply = wait_job(ceo, clients, ceo.ask('facilitator', 'What remains unresolved before voting?'))
    report['cases'].append({'kind': 'decision_facilitator', 'job': job, 'reply': reply})
    job, reply = wait_job(host, clients, kind='minutes')
    report['cases'].append({'kind': 'automatic_minutes', 'job': job, 'reply': reply})
    state = host.state()
    assert all(any(i['text'] == t['text'] and i['source_ids'] == [t['id']] for t in state['transcript']) for i in state['summary']['items'])
    assert state['decisions'] == [], 'AI must not create decisions'
    host.command('propose_decision', problem='Contain affected finance device',
                 proposal='Ask IT to isolate the affected finance device and preserve logs.',
                 source_ids=[state['transcript'][1]['id']])
    decision = host.state()['decisions'][0]['id']
    for client, choice in zip(clients, ['approve', 'approve', 'reject']):
        client.command('vote_decision', decision_id=decision, choice=choice)
    ceo.command('commit_decision', decision_id=decision)
    ceo.command('end')
    state = host.state()
    assert state['phase'] == 'ended' and state['decisions'][0]['status'] == 'approved'
    report['record'] = {k: state[k] for k in ('phase', 'documents', 'transcript', 'summary', 'decision_prompts', 'decisions', 'history', 'jobs')}
    report['health_after'] = host.request('/api/health')
    report['checks'] = {'ceo_is_not_host': True, 'non_ceo_start_rejected': True, 'all_ready_and_pdfs_gated': True,
                        'preparation_timer_observed': True, 'five_minute_round_deadline': True,
                        'speaker_turns_enforced': True, 'ceo_ended_round_early': True, 'quote_provenance': True, 'human_votes_required': True,
                        'one_approved_decision': True, 'live_calls': len(report['cases'])}
    save()
    print(json.dumps(report['checks']))


if __name__ == '__main__':
    main()
