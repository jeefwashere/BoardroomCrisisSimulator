"""Compatibility entry point for the current guided round verification.

The historical X11 measurements remain in evaluations/preparation-stream.json.
New runs write evaluations/guided-round.json and use the current fixed ballot.
"""
from .guided_round_benchmark import main

if __name__ == '__main__':
    main()
