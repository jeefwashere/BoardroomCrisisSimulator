import argparse
import os
from pathlib import Path
import uvicorn
from rehearsal.adapters import load_env
from .server import create_app
from .engine import Engine
from .speech import Speech


def main():
    parser = argparse.ArgumentParser(description='Run the isolated Route A browser playtest')
    parser.add_argument('--env-file', default='.env.local')
    parser.add_argument('--port', type=int, default=8788)
    parser.add_argument('--speech-credit-cap', type=int, default=0)
    parser.add_argument('--data-dir', default='.local/ai-playtest')
    parser.add_argument('--allow-name-rejoin', action='store_true',
                        help='Local testing only: reclaim inactive seats with room code and display name')
    args = parser.parse_args()
    load_env(args.env_file)
    data = Path(args.data_dir)
    data.mkdir(parents=True, exist_ok=True)
    data.chmod(0o700)
    speech = Speech(os.environ.get('ELEVENLABS_API_KEY'), data, args.speech_credit_cap)
    uvicorn.run(create_app(engine=Engine(allow_name_rejoin=args.allow_name_rejoin), speech=speech, port=args.port), host='127.0.0.1', port=args.port,
                workers=1, access_log=False)


if __name__ == '__main__':
    main()
