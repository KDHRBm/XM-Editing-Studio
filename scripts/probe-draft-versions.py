"""Read-only compatibility check for encrypted Jianying drafts."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app' / 'native' / 'jianying'))
from upstream_core import JianyingDraftIO


def main(paths):
    io = JianyingDraftIO()
    print('Installed Jianying interface:', io.dll_path.parent.name)
    for raw_path in paths:
        draft = Path(raw_path).resolve()
        source = draft / 'draft_content.json' if draft.is_dir() else draft
        try:
            data = io.read_json(source)
            print(draft.name, 'readable', 'top-level fields:', sorted(data)[:20])
            print('  version:', data.get('version'), 'new_version:', data.get('new_version'),
                  'tracks:', len(data.get('tracks', [])),
                  'material categories:', sorted(data.get('materials', {})))
            for name in ('draft_meta_info.json', 'draft_virtual_store.json'):
                file = draft / name
                if not file.is_file():
                    continue
                try:
                    metadata = json.loads(file.read_text(encoding='utf-8-sig'))
                    if isinstance(metadata, dict):
                        print(' ', name, 'fields:', sorted(metadata)[:20],
                              'version:', metadata.get('version'),
                              'draft_version:', metadata.get('draft_version'))
                except (UnicodeError, json.JSONDecodeError):
                    try:
                        metadata = io.read_json(file)
                        print(' ', name, 'encrypted fields:', sorted(metadata)[:20],
                              'version:', metadata.get('version'),
                              'draft_version:', metadata.get('draft_version'))
                    except Exception as error:
                        print(' ', name, 'unavailable:', type(error).__name__)
            for timeline in sorted((draft / 'Timelines').glob('*/draft_content.json')):
                try:
                    content = io.read_json(timeline)
                    print('  timeline:', 'readable', 'version:', content.get('version'),
                          'new_version:', content.get('new_version'))
                except Exception as error:
                    print('  timeline:', 'unavailable:', type(error).__name__)
        except Exception as error:
            print(draft.name, 'unreadable:', type(error).__name__, str(error)[:300])


if __name__ == '__main__':
    main(sys.argv[1:])
