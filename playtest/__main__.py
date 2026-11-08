import argparse
import os
from pathlib import Path
import uvicorn
from rehearsal.adapters import load_env
from .server import create_app
from .engine import Engine
from .speech import Speech
from .vertex import VertexModels


def main():
    parser = argparse.ArgumentParser(description='Run the isolated Vertex and ElevenLabs browser playtest')
    parser.add_argument('--env-file', default='.env.local')
    parser.add_argument('--port', type=int, default=8788)
    parser.add_argument('--speech-credit-cap', type=int, default=0)
    parser.add_argument('--vertex-cap-cents', type=int, default=2000, help='Persistent Vertex test cap, maximum 2000 US cents')
    parser.add_argument('--authorize-budget-increase', action='store_true',
                        help='Explicitly raise stored caps to the requested amounts while retaining prior reservations')
    parser.add_argument('--unlimited-budget', action='store_true',
                        help='Explicitly remove both application spending caps while retaining usage tracking')
    parser.add_argument('--data-dir', default='.local/ai-playtest')
    parser.add_argument('--allow-name-rejoin', action='store_true',
                        help='Local testing only: reclaim inactive seats with room code and display name')
    args = parser.parse_args()
    load_env(args.env_file)
    os.environ["REHEARSAL_ENV_FILE"] = str(Path(args.env_file).resolve())
    data = Path(args.data_dir)
    data.mkdir(parents=True, exist_ok=True)
    data.chmod(0o700)
    speech = Speech(os.environ.get('ELEVENLABS_API_KEY'), data, args.speech_credit_cap)
    provider = VertexModels(directory=data, cap_cents=args.vertex_cap_cents)
    if args.authorize_budget_increase:
        speech.budget.authorize_increase(args.speech_credit_cap)
        provider.budget.authorize_increase(args.vertex_cap_cents)
    if args.unlimited_budget:
        speech.budget.authorize_unlimited()
        provider.budget.authorize_unlimited()
    app = create_app(provider=provider, engine=Engine(allow_name_rejoin=args.allow_name_rejoin), speech=speech, port=args.port)
    # Warm the cached local reader before readiness permits the timed introduction.
    # This performs no download, Vertex generation or speech call.
    app.state.roundtable_service.warm_memory = True
    uvicorn.run(app, host='127.0.0.1', port=args.port,
                workers=1, access_log=False, ws_max_size=65536)


if __name__ == '__main__':
    main()
