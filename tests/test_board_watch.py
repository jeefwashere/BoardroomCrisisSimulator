import importlib.util
import contextlib
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('board_watch', Path(__file__).parents[1] / 'tools' / 'board_watch.py')
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)


def comment(number, author='jeefwashere', body='@RicadoGz Which API should I use?'):
    return {'id': number, 'user': {'login': author}, 'body': body,
            'html_url': f'https://github.com/jeefwashere/BoardroomCrisisSimulator/issues/6#issuecomment-{number}',
            'created_at': f'2026-11-07T20:00:{number:02d}Z'}


class BoardWatcherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'state.json'
        self.state = {'last_id': 0}
        self.args = SimpleNamespace(repo='jeefwashere/BoardroomCrisisSimulator', issue=6,
                                    thread='01a1b76e-7361-7740-a458-e9bdc05975a2',
                                    repo_dir=Path(self.directory.name), me='RicadoGz', peer='jeefwashere')
        self.calls = []

    def accept(self, command):
        self.calls.append(command)
        return subprocess.CompletedProcess(command, 0,
            f'Queued message test-message for thread {self.args.thread}.\n', '')

    def test_only_peer_messages_enter_exact_existing_session(self):
        text = '@RicadoGz literal $(touch /tmp/should-not-exist)'
        rows = [comment(1, 'RicadoGz'), comment(2, 'unrelated-user'), comment(3, 'JEEFWASHERE', text)]
        self.assertTrue(board.deliver(self.args, self.state, self.path, rows, self.accept))
        command = self.calls[0]
        self.assertEqual(command[:4], ['codex', 'queue', '--thread', self.args.thread])
        self.assertIn('--resume', command)
        self.assertIn(text, command[5])
        self.assertNotIn('unrelated-user', command[5])
        self.assertEqual(self.state['last_id'], 3)

    def test_restart_does_not_repeat_delivered_comments(self):
        rows = [comment(1)]
        board.deliver(self.args, self.state, self.path, rows, self.accept)
        restored = json.loads(self.path.read_text())
        self.assertFalse(board.deliver(self.args, restored, self.path, rows, self.accept))
        self.assertEqual(len(self.calls), 1)

    def test_own_messages_advance_cursor_without_waking_itself(self):
        self.assertFalse(board.deliver(self.args, self.state, self.path, [comment(1, 'RicadoGz')], self.accept))
        self.assertEqual(self.state['last_id'], 1)
        self.assertEqual(self.calls, [])

    def test_uncertain_delivery_is_not_retried_after_restart(self):
        def timeout(_):
            raise subprocess.TimeoutExpired('codex queue', 45)
        with self.assertRaises(board.DeliveryUncertain):
            board.deliver(self.args, self.state, self.path, [comment(1)], timeout)
        restored = json.loads(self.path.read_text())
        self.assertEqual(restored['pending']['comment_ids'], [1])
        with self.assertRaises(board.DeliveryUncertain):
            board.deliver(self.args, restored, self.path, [comment(1)], self.accept)
        self.assertEqual(self.calls, [])

    def test_resume_warning_preserves_accepted_receipt_without_duplicate(self):
        def warn(command):
            result = self.accept(command)
            result.stderr = 'Warning: failed to resume thread'
            return result
        with self.assertRaises(board.DeliveryUncertain):
            board.deliver(self.args, self.state, self.path, [comment(1)], warn)
        self.assertEqual(self.state['last_id'], 1)
        self.assertNotIn('pending', self.state)
        self.assertFalse(board.deliver(self.args, self.state, self.path, [comment(1)], self.accept))
        self.assertEqual(len(self.calls), 1)

    def test_batches_preserve_later_messages(self):
        rows = [comment(i) for i in range(1, 13)]
        board.deliver(self.args, self.state, self.path, rows, self.accept)
        self.assertEqual(self.state['last_id'], 10)
        board.deliver(self.args, self.state, self.path, rows, self.accept)
        self.assertEqual(self.state['last_id'], 12)
        self.assertEqual(len(self.calls), 2)

    def test_second_listener_cannot_acquire_same_session_lock(self):
        with board.lock(self.path.with_suffix('.lock')):
            with self.assertRaises(OSError):
                with board.lock(self.path.with_suffix('.lock')):
                    self.fail('duplicate listener acquired lock')

    def test_incremental_fetch_uses_saved_timestamp_and_all_pages(self):
        answer = subprocess.CompletedProcess([], 0, json.dumps([[comment(1)], [comment(2)]]), '')
        with patch.object(board, 'run', return_value=answer) as runner:
            result = board.comments(self.args.repo, 6, '2026-11-07T20:00:00Z')
        self.assertEqual([c['id'] for c in result], [1, 2])
        self.assertIn('since=2026-11-07T20%3A00%3A00Z', runner.call_args.args[0][-1])

    def test_state_is_reloaded_after_acquiring_lock(self):
        real_lock = board.lock
        @contextlib.contextmanager
        def prior_watcher_finishes(lock_path):
            with real_lock(lock_path):
                board.save(lock_path.with_suffix('.json'), {'last_id': 77,
                           'pending': {'comment_ids': [78], 'through': 78}})
                yield
        def fake_run(command):
            if command[0] == 'git':
                return subprocess.CompletedProcess(command, 0, self.directory.name, '')
            if command[:3] == ['gh', 'api', 'user']:
                return subprocess.CompletedProcess(command, 0, 'RicadoGz\n', '')
            self.fail('No fetch or queue is allowed after finding pending state')
        arguments = ['board_watch.py', 'once', '--thread', self.args.thread,
                     '--repo-dir', self.directory.name]
        with patch.object(board, 'run', side_effect=fake_run), \
             patch.object(board, 'lock', prior_watcher_finishes), \
             patch.object(board.sys, 'argv', arguments):
            with self.assertRaisesRegex(SystemExit, 'Pending delivery'):
                board.main()
        saved = list((Path(self.directory.name) / 'agent-board').glob('*.json'))
        self.assertEqual(json.loads(saved[0].read_text())['pending']['comment_ids'], [78])

    def test_git_worktrees_share_the_same_state_and_lock_directory(self):
        main = Path(self.directory.name) / 'main'
        other = Path(self.directory.name) / 'other'
        subprocess.run(['git', 'init', '-q', str(main)], check=True)
        subprocess.run(['git', '-C', str(main), '-c', 'user.name=Test',
                        '-c', 'user.email=test@example.invalid', 'commit',
                        '--allow-empty', '-qm', 'fixture'], check=True)
        subprocess.run(['git', '-C', str(main), 'worktree', 'add',
                        '--detach', '-q', str(other), 'HEAD'], check=True)
        self.assertEqual(board.storage_root(main), board.storage_root(other))


if __name__ == '__main__':
    unittest.main()
