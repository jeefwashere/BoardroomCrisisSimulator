"""Authored choices for the public T01 service outage meeting.

These are possible board actions, not hidden outcomes or model judgments.
The engine supplies the voting rules; participant PDF fixture rules do not.
"""

DECISION = {
    'id': 't01_response',
    'problem': 'How should the board respond to the service outage and unavailable director?',
    'options': [
        {
            'id': 'controlled_continuity',
            'label': 'Controlled continuity',
            'proposal': (
                'Appoint an interim incident coordinator, authorize the approved paper appointment process, '
                'ask IT to verify backup usability, recovery dependencies and a restoration estimate '
                'before any restoration promise, and issue a factual update that separates confirmed '
                'facts from unknowns and states the next update time.'
            ),
        },
        {
            'id': 'technical_first',
            'label': 'Technical checks first',
            'proposal': (
                'Appoint an interim incident coordinator, keep appointments paused until IT verifies '
                'recovery, and issue a factual update that separates confirmed facts from unknowns '
                'and states the next update time.'
            ),
        },
        {
            'id': 'wait_for_director',
            'label': 'Wait for the director',
            'proposal': (
                'Keep appointments paused and defer the interim coordinator appointment and paper '
                'appointment process while awaiting the director.'
            ),
        },
    ],
}
