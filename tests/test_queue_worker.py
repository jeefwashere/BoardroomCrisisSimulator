import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
from rehearsal import queue_worker


class QueueWorkerTests(unittest.TestCase):
    def execute_worker(self, responses, pending=None):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.getcwd()
            try:
                os.chdir(directory)
                Path('config.json').write_text(json.dumps({'site_url':'https://test.invalid', 'sites_access_token':'test-only', 'worker_token':'test-only'}))
                Path('model-token').write_text('test-only')
                if pending:
                    Path('queue-outbox.json').write_text(json.dumps(pending))
                model = Mock()
                model.call.return_value = {'text':'A test response'}
                sent = []
                snapshots = []
                def urlopen(request, **kwargs):
                    sent.append(json.loads(request.data))
                    if sent[-1]['action'] == 'complete':
                        outbox = Path('queue-outbox.json')
                        snapshots.append((json.loads(outbox.read_text()), outbox.stat().st_mode & 0o777))
                    return io.BytesIO(json.dumps(next(responses)).encode())
                with patch.dict(os.environ, {'SLURM_JOB_ID':'20031'}), patch('sys.argv',['worker','--config','config.json']), patch.object(queue_worker, 'RemoteModel', return_value=model), patch.object(queue_worker.urllib.request, 'urlopen', side_effect=urlopen), patch.object(queue_worker.time, 'time', return_value=queue_worker.END-1000), contextlib.redirect_stdout(io.StringIO()):
                    queue_worker.main()
                self.assertFalse(Path('queue-outbox.json').exists())
                return sent,snapshots,model
            finally:
                os.chdir(previous)

    def test_completion_is_saved_privately_before_delivery(self):
        job={'id':'test-job','lease':'test-lease','model':'lfm3','prompt':'hello'}
        sent,snapshots,model=self.execute_worker(iter([{'job':job},{'ok':True},{'stop':True}]))
        self.assertEqual([r['action'] for r in sent],['claim','complete','claim'])
        self.assertEqual(snapshots[0][1],0o600)
        self.assertEqual(snapshots[0][0]['result'],{'text':'A test response'})
        model.call.assert_called_once_with('/generate',{'text':'hello'})

    def test_saved_completion_retries_without_inference(self):
        pending={'action':'complete','id':'test-job','lease':'test-lease','result':{'text':'Already generated'}}
        sent,snapshots,model=self.execute_worker(iter([{'ok':True},{'stop':True}]),pending)
        self.assertEqual(sent[0],pending)
        model.call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
