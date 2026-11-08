"""Participant-only reference retrieval. Never reads hidden schedules or test answers."""
import json
from pathlib import Path
import re
from .engine import require

PUBLIC_PACKS = Path(__file__).parent / 'fixtures/participant-packs.json'
STOP = set('the and a an is are was were what which who how does do did can could should would we our in on of to for from this that it be have has with about'.split())


class References:
    def __init__(self):
        self.data = json.loads(PUBLIC_PACKS.read_text())
        self.packs = {p['id']: p for p in self.data['packs']}

    def public(self):
        return {'packs': list(self.packs.values()), 'common_rules': self.data['common_rules'],
                'note': 'These are separate draft fixture references. Their two votes plus chair confirmation rules do not change the live MapleCart vote or CEO permissions. Hidden schedules and expected answers are excluded.'}

    def evidence(self, pack_id, question):
        require(isinstance(pack_id, str) and pack_id in self.packs, 'Choose T01, T02, or T03', 422)
        pack = self.packs[pack_id]
        clauses = [dict(c) for d in pack['documents'] for c in d['clauses']]
        clauses += [{'id': pack_id + ':COMMON-' + str(i+1), 'text': text.strip('- ')}
                    for i, text in enumerate(self.data['common_rules'].splitlines()) if text.strip()]
        terms = set(re.findall(r'\w+', question.casefold())) - STOP
        def score(clause):
            words = set(re.findall(r'\w+', (clause['id'] + ' ' + clause['text']).casefold()))
            return len(terms & words) + (10 if clause['id'].casefold() in question.casefold() else 0)
        ranked = sorted(clauses, key=score, reverse=True)
        selected = [c for c in ranked if score(c) > 0][:8] or clauses[:2]
        # The shared hosted queue permits 4000 characters including instructions and question.
        result, length = [], 0
        for clause in selected:
            size = len(json.dumps(clause, ensure_ascii=False))
            if length + size <= 2800:
                result.append(clause)
                length += size
        return pack, result
