"""Outbound-only bridge from the private allocation to the team's HTTPS queue."""
import argparse
import json
import os
from pathlib import Path
import time
import urllib.request
from .adapters import RemoteModel

END = 1794152785  # 2026-11-08 15:46:25 UTC


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    if os.environ.get('SLURM_JOB_ID') != '20031':
        raise SystemExit('Worker requires allocation 20031')
    config = json.loads(Path(args.config).read_text())
    gateway = RemoteModel('http://127.0.0.1:8877', Path('model-token').read_text().strip(), timeout=90)
    pending = Path('queue-outbox.json')

    def call(payload):
        req = urllib.request.Request(config['site_url'] + '/api/worker', data=json.dumps(payload).encode(), headers={
            'Content-Type': 'application/json',
            'OAI-Sites-Authorization': 'Bearer ' + config['sites_access_token'],
            'Authorization': 'Bearer ' + config['worker_token'],
        })
        with urllib.request.urlopen(req, timeout=25) as response:
            return json.load(response)

    print('Outbound queue worker started', flush=True)
    while time.time() < END:
        try:
            if pending.exists():
                call(json.loads(pending.read_text()))
                pending.unlink()
                continue
            response = call({'action': 'claim'})
            if response.get('stop'):
                break
            job = response.get('job')
            if not job:
                time.sleep(3)
                continue
            completion = {'action': 'complete', 'id': job['id'], 'lease': job['lease']}
            try:
                if job['model'] == 'lfm3':
                    completion['result'] = gateway.call('/generate', {'text': job['prompt']})
                elif job['model'] == 'gliner-base':
                    completion['result'] = gateway.extract(job['prompt'])
                else:
                    raise ValueError('Unsupported model')
            except Exception as exc:
                completion['error'] = 'Inference unavailable'
                print('INFERENCE_FAILED', type(exc).__name__, flush=True)
            temporary = pending.with_suffix('.tmp')
            with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as handle:
                json.dump(completion, handle)
            temporary.replace(pending)
            print('Request processed', job['id'], 'failed' if completion.get('error') else 'done', flush=True)
        except Exception as exc:
            print('QUEUE_RETRY', type(exc).__name__, flush=True)
            time.sleep(8)
    print('Allocation deadline reached; worker stopped', flush=True)


if __name__ == '__main__':
    main()
