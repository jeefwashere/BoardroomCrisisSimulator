"""Copy selected, nonsecret team docs into the model lab's protected static assets."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'sites/rehearsal-lab/public/docs'
GITHUB = 'https://github.com/jeefwashere/BoardroomCrisisSimulator/blob/main/'


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name in ('ai-architecture.md', 'agent-integration.md'):
        source = ROOT / 'docs' / name
        def rewrite(match):
            label, target = match.groups()
            if '://' in target or target.startswith('#'):
                return match.group(0)
            path, separator, fragment = target.partition('#')
            relative = (source.parent / path).resolve().relative_to(ROOT).as_posix()
            return f'[{label}]({GITHUB}{relative}' + (f'#{fragment}' if separator else '') + ')'
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', rewrite, source.read_text())
        (DESTINATION / name).write_text(text)
        print('Synced', name)


if __name__ == '__main__':
    main()
