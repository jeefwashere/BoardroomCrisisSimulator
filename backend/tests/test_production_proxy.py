"""Production proxy, HTTPS cookies and browser-origin boundaries; no providers."""

import unittest
from uuid import uuid4

import httpx2 as httpx
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from backend.app.main import SESSION_HEADER, create_app


class ProductionProxyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.origin = 'https://boardroom.example.com'
        app = create_app(secure_cookie=True, allowed_origins=[self.origin])
        # Matches Uvicorn behind the isolated Nginx service, with no host API port.
        self.client = await self.enterAsyncContext(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=ProxyHeadersMiddleware(app, trusted_hosts='*')),
            base_url='http://backend:8000',
            headers={'Host': 'boardroom.example.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '172.20.0.2'},
        ))

    async def test_secure_session_cookie_and_https_redirect(self):
        response = await self.client.get('/api/session')
        self.assertEqual(response.status_code, 200)
        cookie = response.headers['set-cookie'].lower()
        for flag in ('secure', 'httponly', 'samesite=lax', 'path=/api'):
            self.assertIn(flag, cookie)
        redirected = await self.client.get('/api/scenarios/')
        self.assertEqual(redirected.status_code, 307)
        self.assertEqual(redirected.headers['location'], self.origin + '/api/scenarios')

    async def test_same_origin_tab_auth_can_create_a_room(self):
        initialized = await self.client.post('/api/tab-sessions', json={}, headers={'Origin': self.origin})
        self.assertEqual(initialized.status_code, 200)
        response = await self.client.post('/api/rooms', json={
            'command_id': str(uuid4()), 'room_code': 'PROD01', 'display_name': 'Production test',
        }, headers={'Origin': self.origin, SESSION_HEADER: initialized.json()['session_token']})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.headers['access-control-allow-origin'], self.origin)
        self.assertEqual(response.headers['cache-control'], 'no-store')

    async def test_preflight_supports_private_tab_header_and_rejects_other_origins(self):
        headers = {'Origin': self.origin, 'Access-Control-Request-Method': 'POST',
                   'Access-Control-Request-Headers': 'content-type,x-boardroom-session'}
        allowed = await self.client.options('/api/tab-sessions', headers=headers)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.headers['access-control-allow-credentials'], 'true')
        denied = await self.client.options('/api/tab-sessions', headers={**headers, 'Origin': 'https://other.example.com'})
        self.assertEqual(denied.status_code, 400)
        rejected = await self.client.post('/api/tab-sessions', json={}, headers={'Origin': 'https://other.example.com'})
        self.assertEqual(rejected.status_code, 403)

    def test_wildcard_cors_is_not_accepted(self):
        with self.assertRaises(ValueError):
            create_app(secure_cookie=True, allowed_origins=['*'])
