from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

from playtest.vertex import DollarBudget, ENDPOINT, MODEL, VertexError, VertexModels


class Opener:
    def __init__(self, text='{"ready":true}', error=None):
        self.text, self.error, self.requests = text, error, []

    def open(self, request, timeout):
        self.requests.append(request)
        if self.error:
            raise self.error
        return io.BytesIO(json.dumps({'candidates': [{'finishReason': 'STOP',
            'content': {'parts': [{'text': self.text}]}}],
            'usageMetadata': {'promptTokenCount': 20, 'candidatesTokenCount': 10,
                              'thoughtsTokenCount': 5, 'totalTokenCount': 35}}).encode())


class VertexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def test_exact_endpoint_low_reasoning_and_header_only_key(self):
        opener = Opener()
        p = VertexModels('test-secret', self.temp.name, opener=opener)
        self.assertFalse(p.request('/api/status')['verified'])
        self.assertEqual(opener.requests, [])  # health never spends
        result = p.run('Return a ready JSON object')
        req = opener.requests[0]
        self.assertEqual(req.full_url, ENDPOINT)
        self.assertNotIn('test-secret', req.full_url)
        self.assertEqual(req.get_header('X-goog-api-key'), 'test-secret')
        config = json.loads(req.data)['generationConfig']
        self.assertEqual(config['thinkingConfig'], {'thinkingLevel': 'LOW'})
        self.assertEqual(config['maxOutputTokens'], 2048)
        self.assertEqual(result['model'], MODEL)
        self.assertEqual(result['usage']['thoughtsTokenCount'], 5)
        self.assertTrue(p.request('/api/status')['verified'])

    def test_extraction_requires_literal_source_spans_and_does_not_invent_scores(self):
        text = 'Jeff will call IT before 3 PM. Is the backup verified?'
        obj = {'kind': 'mixed', 'spans': [{'label': 'person', 'text': 'Jeff'},
               {'label': 'deadline', 'text': '3 PM'}, {'label': 'person', 'text': 'Alice'},
               {'label': 'secret', 'text': 'backup'}, {'label': 'action', 'text': ''}]}
        p = VertexModels('test-secret', self.temp.name, opener=Opener(json.dumps(obj)))
        result = p.run(text, model='extract')
        self.assertEqual(result['kind'], 'mixed')
        self.assertEqual(len(result['spans']), 2)
        for span in result['spans']:
            self.assertEqual(text[span['start']:span['end']], span['text'])
            self.assertIsNone(span['raw_score'])

    def test_atomic_budget_persists_and_does_not_expand_on_restart(self):
        path = Path(self.temp.name) / 'budget.sqlite'
        budget = DollarBudget(path, 100)
        def attempt(_):
            try:
                budget.reserve()
                return True
            except VertexError:
                return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(40)))
        self.assertEqual(sum(results), 20)
        restarted = DollarBudget(path, 200)
        self.assertEqual(restarted.status()['cap_usd'], 1)
        self.assertEqual(restarted.status()['reserved_usd'], 1)
        with self.assertRaises(VertexError):
            restarted.reserve()

    def test_error_is_sanitized_reserved_and_never_retried(self):
        error = urllib.error.HTTPError(ENDPOINT, 403, 'test-secret', {}, io.BytesIO(b'test-secret'))
        opener = Opener(error=error)
        p = VertexModels('test-secret', self.temp.name, opener=opener)
        with self.assertRaises(VertexError) as caught:
            p.run('Return JSON')
        self.assertNotIn('test-secret', str(caught.exception))
        self.assertEqual(len(opener.requests), 1)
        self.assertEqual(p.budget.status()['reserved_usd'], .05)
        self.assertFalse(p.request('/api/status')['online'])

    def test_invalid_outputs_fail_and_oversize_input_never_spends(self):
        opener = Opener('not JSON')
        p = VertexModels('test-secret', self.temp.name, opener=opener)
        with self.assertRaises(ValueError):
            p.run('x'*20001)
        self.assertEqual(p.budget.status()['attempts'], 0)
        with self.assertRaises(VertexError):
            p.run('Return JSON')
        self.assertEqual(p.budget.status()['attempts'], 1)


if __name__ == '__main__':
    unittest.main()
