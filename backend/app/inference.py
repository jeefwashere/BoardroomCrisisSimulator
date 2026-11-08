"""Bounded HTTPS inference transport with stable request IDs and verified TLS."""

import asyncio
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from uuid import UUID


class HostedInference:
    def __init__(self):
        self.url = os.getenv('REHEARSAL_API_URL', '').rstrip('/')
        self.key = os.getenv('REHEARSAL_APP_KEY', '')
        self.site = os.getenv('REHEARSAL_SITE_TOKEN', '')

    @property
    def configured(self):
        return self.url.startswith('https://') and bool(self.key and self.site)

    def request(self, path, payload=None, timeout=10):
        if not self.configured:
            raise RuntimeError('Model service is not configured')
        headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.key,
                   'OAI-Sites-Authorization': 'Bearer ' + self.site}
        request = urllib.request.Request(self.url + path, headers=headers,
                    data=json.dumps(payload).encode() if payload is not None else None)
        # truststore uses the operating system roots, including macOS certificates.
        try:
            import truststore
            context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        except ImportError:
            context = ssl.create_default_context()
        with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
            return json.load(response)

    async def run(self, prompt: str, request_id: UUID, timeout: float):
        if not 0 < len(prompt) <= 4000:
            raise ValueError('Model prompt must contain 1 to 4000 characters')
        end = time.monotonic() + timeout
        async def request(path, payload=None):
            remaining = end - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Model deadline elapsed')
            return await asyncio.wait_for(asyncio.to_thread(self.request, path, payload, min(10, remaining)), remaining)
        await request('/api/jobs', {'request_id': str(request_id), 'model': 'lfm3', 'prompt': prompt})
        while time.monotonic() < end:
            response = await request('/api/jobs?id=' + str(request_id))
            jobs = response.get('jobs', [])
            if jobs and jobs[0]['status'] == 'done':
                data = json.loads(jobs[0]['result'])
                text = data.get('text')
                if not isinstance(text, str) or not text.strip():
                    raise ValueError('Model did not return text')
                return text
            if jobs and jobs[0]['status'] == 'failed':
                raise RuntimeError('Model request failed')
            await asyncio.sleep(min(2, max(0, end - time.monotonic())))
        raise TimeoutError('Model deadline elapsed')
