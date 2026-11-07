"""Server-side client for the shared HTTPS model API. No Velocity login required."""
import argparse
import json
import os
import time
import urllib.request
import uuid
from .adapters import load_env


class HostedModels:
    def __init__(self, base_url=None, app_key=None, site_token=None):
        self.base_url = (base_url or os.environ['REHEARSAL_API_URL']).rstrip('/')
        if not self.base_url.startswith('https://'):
            raise ValueError('Hosted model API requires HTTPS')
        self.headers = {'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + (app_key or os.environ['REHEARSAL_APP_KEY']),
                        'OAI-Sites-Authorization': 'Bearer ' + (site_token or os.environ['REHEARSAL_SITE_TOKEN'])}

    def request(self, path, payload=None):
        req = urllib.request.Request(self.base_url + path,
                                     data=json.dumps(payload).encode() if payload is not None else None,
                                     headers=self.headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)

    def run(self, prompt, model='lfm3', timeout=120):
        job_id = str(uuid.uuid4())
        self.request('/api/jobs', {'request_id': job_id, 'model': model, 'prompt': prompt})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            jobs = self.request('/api/jobs?id=' + job_id)['jobs']
            if jobs and jobs[0]['status'] == 'done':
                return json.loads(jobs[0]['result'])
            if jobs and jobs[0]['status'] == 'failed':
                raise RuntimeError(jobs[0]['error'])
            time.sleep(2)
        raise TimeoutError('Request is still pending; retrieve it by id: ' + job_id)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('prompt')
    p.add_argument('--model', choices=['lfm3', 'gliner-base'], default='lfm3')
    args = p.parse_args()
    load_env()
    print(json.dumps(HostedModels().run(args.prompt, args.model), indent=2))
