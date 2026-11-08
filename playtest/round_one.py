"""Group Round 1 with independent member decisions and no scoring."""
from copy import deepcopy
from .engine import bounded_text, require

EXPERTS = ('it', 'operations', 'governance')
FIELDS = ('action', 'reasoning', 'evidence', 'unknowns')


class RoundOne:
    @staticmethod
    def is_round_one(room):
        return room.get('flow') in ('board_round1','four_rounds')

    def round_one_command(self, room, mid, action, data):
        if not self.is_round_one(room):
            return False
        require(action not in {'add_custom_option', 'propose_decision', 'vote_option',
                              'vote_decision', 'commit_decision', 'cancel_decision'},
                'Round 1 collects individual decisions, not a winning board ballot', 409)
        if action == 'submit_individual_decision':
            require(room['phase'] == 'decision', 'Submit after the three expert perspectives', 409)
            require(mid in room['electorate'], 'Only participating members may submit', 403)
            require(not any(k in data for k in ('member', 'member_id', 'score', 'points')),
                    'Submit your own decision without scoring or another member identity', 422)
            old = room['individual_decisions'].get(mid)
            revision = old['revision'] if old else 0
            require(type(data.get('revision')) is int and data['revision'] == revision,
                    'Your decision changed. Review the current version before submitting', 409)
            card = {field: bounded_text(data.get(field), 1200) for field in FIELDS}
            card.update(member=mid, revision=revision+1, submitted_at=self.clock())
            room['individual_decisions'][mid] = card
            if self.is_four_rounds(room):self.clear_fixture(room,mid)
            self.event(room, 'individual_decision_submitted', member=mid, revision=revision+1)
            return True
        if action == 'end':
            require(mid == self._ceo(room), 'Only the CEO can complete Round 1', 403)
            require(room['phase'] == 'decision', 'Complete Round 1 after individual decisions', 409)
            require(set(room['individual_decisions']) == set(room['electorate']),
                    'Every member must submit their own decision before Round 1 ends', 409)
            self.event(room, 'round_one_completed', member=mid)
            if self.is_four_rounds(room):
                self.start_private(room)
            else:
                self._transition(room, 'ended')
            return True
        return False

    def record_expert(self, room, kind, text, citations, job_id, context_ids):
        """Trusted stream completion only; never exposed as a client command."""
        if not self.is_round_one(room) or room['phase'] != 'consultation' or kind not in EXPERTS:
            return
        room['expert_briefings'][kind] = {'kind': kind, 'text': text, 'citations': deepcopy(citations),
            'job_id': job_id, 'discussion_source_ids': list(context_ids), 'at': self.clock()}
        self.event(room, 'expert_perspective_ready', expert=kind, job=job_id)

    def round_one_snapshot(self, room, mid):
        if not self.is_round_one(room):
            return {}
        return {'round_number': 1, 'scoring': 'none', 'expert_order': list(EXPERTS),
            'expert_briefings': deepcopy(room['expert_briefings']),
            'individual_decision': deepcopy(room['individual_decisions'].get(mid)),
            'decision_submissions': [{'member': person, 'submitted': person in room['individual_decisions']}
                                     for person in room['electorate']],
            'round_one_complete': room['phase'] in ('private','reunion','ended'), 'private_rounds_available': self.is_four_rounds(room)}

    def round_one_context(self, token):
        with self.lock:
            room, mid = self.identity(token)
            require(self.is_round_one(room), 'This room does not use the four round design', 409)
            require(room['phase'] in ('private','reunion','ended'), 'Complete Round 1 before exporting the private preparation context', 409)
            return {'round': 1, 'branch_owner': mid, 'score': None, 'private_session_implemented': self.is_four_rounds(room),
                'documents': deepcopy(room['documents']),
                'preparation': deepcopy([r for r in room['suggestions'] if r['kind'] == 'preparation_stream']),
                'shared_discussion': deepcopy(room['transcript']),
                'member_contributions': deepcopy([t for t in room['transcript'] if t['member'] == mid]),
                'expert_briefings': deepcopy(room['expert_briefings']),
                'individual_decision': deepcopy(room['individual_decisions'][mid])}
