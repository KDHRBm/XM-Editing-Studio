import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path('app/native/jianying').resolve()))
from engine import Engine, valid_filename, core


class EngineTests(unittest.TestCase):
    def test_initialize_and_close_with_all_desktop_hooks_mocked(self):
        with tempfile.TemporaryDirectory(prefix='xm-engine-init-') as directory:
            with patch.object(core.pyautogui, 'size', return_value=(2560, 1440)), patch.object(core.keyboard, 'Listener'), patch.object(core.mouse, 'Listener'):
                with patch.multiple(core, APP_DATA_DIR=Path(directory), CFG_FILE=str(Path(directory)/'settings.json'), COORD_TEMPLATE_FILE=str(Path(directory)/'template.json'), DELETED_COORD_TEMPLATE_DIR=Path(directory)/'deleted', LOG_FILE=str(Path(directory)/'engine.log'), LEGACY_CFG_FILES=()):
                    engine = Engine(directory)
                    state = engine.snapshot()
                    self.assertTrue(state['ready']); self.assertFalse(state['busy']); self.assertFalse(state['coordinatesReady'])
                    self.assertEqual(state['draftDir'], '')
                    config = json.loads(Path(core.CFG_FILE).read_text(encoding='utf-8'))
                    self.assertNotIn('api_key', config); self.assertNotIn('relay_api_key', config)
                    engine.dispatch('status', {}); engine.dispatch('stop', {}); engine.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='xm-engine-test-')
        self.root = Path(self.temp.name)
        self.old_data = core.APP_DATA_DIR
        core.APP_DATA_DIR = self.root
        self.engine = Engine.__new__(Engine)
        self.engine.view = {'logs': [], 'plan': []}
        self.engine._chk = lambda: None
        self.engine.rename_plan = []

    def tearDown(self):
        core.APP_DATA_DIR = self.old_data
        self.temp.cleanup()

    def source(self, name='episode1.mp4'):
        file = self.root / name; file.write_bytes(b'test-video-fixture'); return file

    def test_ai_rejects_traversal_reserved_names_and_extension_changes(self):
        source = self.source(); self.engine.sel_files = [str(source)]
        for target in ['../else.mp4', r'C:\outside.mp4', 'CON.mp4', 'aux.mp4', 'result.exe', 'dir/result.mp4', 'name.mp4.']:
            with self.assertRaises(ValueError): self.engine._fill_ai_ren([{'old': source.name, 'new': target}])
        self.assertTrue(source.exists())

    def test_unknown_duplicate_and_colliding_ai_results_do_not_rename(self):
        a, b = self.source(), self.source('episode2.mp4')
        self.engine.sel_files = [str(a), str(b)]
        for data in [[{'old': 'no.mp4', 'new': 'x.mp4'}], [{'old': a.name, 'new': 'x.mp4'}, {'old': a.name, 'new': 'y.mp4'}], [{'old': a.name, 'new': 'x.mp4'}, {'old': b.name, 'new': 'x.mp4'}], [{'old': a.name, 'new': b.name}]]:
            with self.assertRaises(ValueError): self.engine._fill_ai_ren(data)
        self.assertEqual(a.read_bytes(), b'test-video-fixture')

    def test_preview_and_execute_are_separate_with_change_detection(self):
        source = self.source(); self.engine.sel_files = [str(source)]
        self.engine._fill_ai_ren([{'old': source.name, 'new': '第1集.mp4'}])
        self.assertTrue(source.exists()); self.assertFalse((self.root/'第1集.mp4').exists())
        source.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, '变化'): self.engine._do_exec_rename()
        self.engine._fill_ai_ren([{'old': source.name, 'new': '第1集.mp4'}]); self.engine._do_exec_rename()
        self.assertEqual((self.root/'第1集.mp4').read_bytes(), b'changed')
        self.assertEqual(len(list(self.root.glob('rename-*.json'))), 1)

    def test_interruption_rolls_back_completed_renames(self):
        a, b = self.source(), self.source('episode2.mp4'); self.engine.sel_files = [str(a), str(b)]
        self.engine._fill_ai_ren([{'old': a.name, 'new': '第1集.mp4'}, {'old': b.name, 'new': '第2集.mp4'}])
        calls = [0]
        def check():
            calls[0] += 1
            if calls[0] == 2: raise ValueError('用户中断')
        self.engine._chk = check
        with self.assertRaisesRegex(ValueError, '中断'): self.engine._do_exec_rename()
        self.assertTrue(a.exists()); self.assertTrue(b.exists()); self.assertFalse((self.root/'第1集.mp4').exists())

    def fixture(self):
        return {'materials': {'texts': [{'id': 'subtitle', 'type': 'subtitle', 'content': json.dumps({'text': 'Hello, world.', 'styles': []})}, {'id': 'title', 'type': 'text', 'content': json.dumps({'text': 'Title'})}]}, 'tracks': [{'type': 'text', 'segments': [{'material_id': 'subtitle', 'visible': True, 'target_timerange': {'start': 1000000, 'duration': 2000000}}]}, {'type': 'text', 'segments': [{'material_id': 'title', 'visible': True}]}]}

    def test_subtitle_extraction_keeps_commas_dots_timing_and_title(self):
        data = self.fixture(); lines = self.engine._subtitle_lines(data)
        self.assertIn('Hello, world.', lines); self.assertIn('00:00:01,000 --> 00:00:03,000', lines)
        self.engine._set_subtitle_tracks_hidden(data, True)
        self.assertFalse(data['tracks'][0]['segments'][0]['visible']); self.assertTrue(data['tracks'][1]['segments'][0]['visible'])
        self.engine._set_subtitle_tracks_hidden(data, False); self.assertTrue(data['tracks'][0]['segments'][0]['visible'])

    def test_json_updates_keep_backups_and_roll_back_failed_verification(self):
        file = self.root/'draft_content.json'; original = self.fixture(); file.write_text(json.dumps(original),encoding='utf-8')
        changed = copy.deepcopy(original); self.engine._set_subtitle_tracks_hidden(changed, True)
        backups = self.engine._save_subtitle_jsons([(str(file), changed, 'plain')]); self.assertEqual(json.loads(Path(backups[0]).read_text()), original)
        self.assertEqual(json.loads(file.read_text()), changed)
        with patch.object(self.engine, '_load_plain_draft_json', return_value=None):
            with self.assertRaises(RuntimeError): self.engine._save_subtitle_jsons([(str(file), original, 'plain')])
        self.assertEqual(json.loads(file.read_text()), changed)

    def test_block_font_write_when_jianying_is_running(self):
        with patch.object(self.engine, '_jianying_is_running', return_value=True):
            with self.assertRaisesRegex(ValueError, '退出剪映'): self.engine._fix_fonts()

    def test_coordinate_bounds_and_config_has_no_keys(self):
        self.engine.default_coords = {'export': None, 'confirm': None, 'popup_close': None}
        self.engine.coords = {'export': [20, 20], 'confirm': [30, 30], 'popup_close': [40, 40]}
        self.engine.sys_res = (100,100); self.engine.export_mode = 'return_home'
        self.assertTrue(self.engine._mode_coords_ready()); self.engine.coords['export']=[200,20]; self.assertFalse(self.engine._mode_coords_ready())


if __name__ == '__main__': unittest.main()
