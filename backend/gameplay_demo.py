"""Real loopback HTTP acceptance with a controlled clock and no provider calls."""

import json
from pathlib import Path
import socket
import threading
import time
from uuid import uuid4

import httpx2 as httpx
import uvicorn

from backend.app.main import SESSION_HEADER, create_app
from backend.app.rooms import Rooms
from backend.app.scenarios import ScenarioCatalog


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


def command(**fields):
    return {'command_id': str(uuid4()), **fields}


def run(output: Path, model_env: Path | None = None, custom_first: bool = False):
    if model_env is not None:
        from rehearsal.adapters import load_env
        load_env(model_env)
    clock = Clock()
    rooms = Rooms(ScenarioCatalog(), clock)
    app = create_app(rooms=rooms)
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
    thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    thread.start()
    clients = []
    trace = []
    versions = []

    def client(token=None):
        value = httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=5)
        if token is None:
            token = value.post('/api/tab-sessions', json={}).json()['session_token']
        value.headers[SESSION_HEADER] = token
        clients.append(value)
        return value

    def checked(response, status=200):
        assert response.status_code == status, (response.status_code, response.text)
        return response.json()

    def view():
        value = checked(clients[0].get(path))
        versions.append(value['room_version'])
        key = (value['game']['round_number'], value['phase'])
        if not trace or (trace[-1]['round'], trace[-1]['phase']) != key:
            trace.append({'round': key[0], 'phase': key[1]})
        return value

    def advance(seconds):
        while seconds:
            delta = min(10, seconds)
            clock.now += delta
            seconds -= delta
            for value in clients:
                checked(value.get(path))
        return view()

    def reach(phase):
        for _ in range(250):
            value = view()
            if value['phase'] == phase:
                return value
            assert value['phase'] != 'ended', value
            advance(5)
        raise AssertionError('Missing phase ' + phase)

    def action(value, snapshot, endpoint, **fields):
        return checked(value.post(path + '/rounds/' + snapshot['game']['round_id'] + '/' + endpoint,
                                  json=command(phase_id=snapshot['game']['phase_id'], **fields)))

    try:
        for _ in range(500):
            if server.started:
                break
            if not thread.is_alive():
                raise RuntimeError('Acceptance server failed to start')
            time.sleep(0.01)
        assert server.started
        ids = []
        for index in range(3):
            value = client()
            joined = checked(value.post('/api/rooms' if index == 0 else '/api/rooms/join',
                                        json=command(room_code='DEMO01', display_name=f'Participant {index}')),
                             201 if index == 0 else 200)
            ids.append(joined['self_member_id'])
        path = '/api/rooms/' + joined['room_id']
        started = checked(clients[0].post(path + '/start', json=command(
            room_code='DEMO01', scenario_id='maplecart_cybersecurity', scenario_version=3,
            timing_profile='standard_18', players=[
                {'member_id': member, 'role_id': 'ceo' if index == 1 else 'security'}
                for index, member in enumerate(ids)])))
        view()
        for round_number in range(1, 4):
            speaking = reach('speaking')
            for index, value in enumerate(clients[:3]):
                checked(value.post(path + '/contributions', json=command(
                    phase_id=speaking['game']['phase_id'], kind='answer', source='typed',
                    text=f'Round {round_number} participant {index} evidence.')), 201)
            if round_number == 1 and custom_first:
                proposed = checked(clients[0].post(path + '/rounds/' + speaking['game']['round_id'] + '/proposal',
                    json=command(phase_id=speaking['game']['phase_id'], text='Isolate affected finance devices and suspend the suspicious account while preserving available logs and appointing an incident lead.')))
                custom_id = proposed['game']['proposals'][0]['option_id']
            if round_number == 1:
                # Late admission remains outside the first electorate.
                newcomer = client()
                late = checked(newcomer.post('/api/rooms/join', json=command(
                    room_code='DEMO01', display_name='Late participant', role_id='finance')))
                late_id = late['self_member_id']
                assert late_id not in late['game']['eligible_member_ids']
            voting = reach('voting')
            options = voting['game']['current_node']['options']
            if round_number == 1:
                first = action(clients[0], voting, 'vote', option_id=custom_id if custom_first else options[0]['option_id'])
                action(clients[1], voting, 'vote', option_id=options[1]['option_id'])
                assert first['game']['vote_counts'] is None
                resumed = client(clients[0].headers[SESSION_HEADER])
                recovered = checked(resumed.get(path))
                assert recovered['self_member_id'] == ids[0]
                assert recovered['game']['self_vote'] == (custom_id if custom_first else options[0]['option_id'])
                assert len(recovered['members']) == 4
                tied = advance(60)
                assert tied['phase'] == 'tie_break'
                result = action(clients[1], tied, 'tie-decision', option_id=custom_id if custom_first else options[0]['option_id'])
                if custom_first:
                    for _ in range(200):
                        result = view()
                        if result['phase'] != 'resolving': break
                        time.sleep(.1)
                    if result['phase'] == 'resolution_failed' and result['game']['resolution']['attempt'] == 1:
                        action(clients[0], result, 'resolution/retry')
                        for _ in range(200):
                            result = view()
                            if result['phase'] != 'resolving': break
                            time.sleep(.1)
                    if result['phase'] != 'result':
                        Path('artifacts/failed-custom-resolution.json').write_text(json.dumps({str(key): value for key, value in app.state.resolver.traces.items()}, indent=2))
                    assert result['phase'] == 'result', result
                    assert result['game']['last_result']['resolution_kind'] == 'custom'
            else:
                assert late_id in voting['game']['eligible_member_ids']
                # First client and its resumed connection remain one voter.
                for value in clients:
                    action(value, voting, 'vote', option_id=options[0]['option_id'])
                result = advance(60)
                assert sum(result['game']['vote_counts'].values()) == 4
            assert result['phase'] == ('ended' if round_number == 3 else 'result')
            view()
            if round_number < 3:
                advance(30)
        final = view()
        evidence = checked(clients[0].get(path + '/evaluation-evidence'))
        assert len(evidence['decisions']) == 3
        assert len(evidence['contributions']) == (10 if custom_first else 9)
        assert len(evidence['turns']) == 11
        assert versions == sorted(versions)
        original = evidence
        advance(120)
        assert checked(clients[0].get(path + '/evaluation-evidence')) == original
        result = {
            'mode': 'real_loopback_http_with_controlled_server_clock',
            'provider_calls': 0, 'distinct_members': 4, 'resumed_member_preserved': True,
            'phases': trace, 'decisions': len(evidence['decisions']),
            'retained_contributions': len(evidence['contributions']), 'custom_winner': custom_first,
            'recorded_speaking_turns': len(evidence['turns']), 'ending': final['game']['ending_label'],
            'monotonic_snapshot_versions': True, 'final_evidence_frozen': True,
            'boundary': 'HTTP backend acceptance only. No browser UI, microphone, paid speech or live model.',
        }
        if model_env is not None:
            checked(clients[0].post(path + '/feedback', json=command(phase_id=final['game']['phase_id'])))
            for _ in range(90):
                feedback = checked(clients[0].get(path + '/extras'))['feedback']
                if feedback['status'] not in ('pending', 'running'):
                    break
                time.sleep(2)
            result['live_feedback'] = feedback
            result['provider_calls'] = feedback['completed_parts']
            result['paid_speech_calls'] = 0
            result['boundary'] = 'Real HTTP with controlled server clock and actual hosted LFM3 reflection questions. No browser or paid speech.'
            if feedback['status'] != 'ready':
                entry = app.state.feedback.entries[next(iter(rooms.rooms))]
                Path('artifacts/failed-live-feedback.json').write_text(json.dumps({'feedback': feedback, 'failure_kind': entry.get('failure_kind'), 'responses': entry.get('responses')}, indent=2))
            assert feedback['status'] == 'ready', feedback
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
    finally:
        for value in clients:
            value.close()
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()
        if thread.is_alive():
            raise RuntimeError('Owned acceptance server did not stop')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('artifacts/gameplay-http.json'))
    parser.add_argument('--model-env', type=Path, help='Explicit backend model environment file for a live LFM feedback check')
    parser.add_argument('--custom-first', action='store_true', help='Include a real custom winning action and CEO tie')
    args = parser.parse_args()
    run(args.output, args.model_env, args.custom_first)
