import copy
import ctypes
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path('app/native/jianying').resolve()))
from engine import Engine, valid_filename, core
from draft_scan import LOCATE_PROMPT
from PIL import Image


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

    def test_one_unreadable_timeline_blocks_partial_subtitle_changes(self):
        root = self.root/'draft_content.json'
        root.write_text(json.dumps(self.fixture()), encoding='utf-8')
        timeline = self.root/'Timelines'/'test-timeline'/'draft_content.json'
        timeline.parent.mkdir(parents=True)
        timeline.write_bytes(b'encrypted-fixture')
        originals = {path: path.read_bytes() for path in (root, timeline)}
        with patch.object(self.engine, '_encrypted_draft_io') as get_io:
            get_io.return_value.read_json.side_effect = RuntimeError('native read failed (6)')
            with self.assertRaisesRegex(RuntimeError, '未全部读取成功'):
                self.engine._find_subtitle_jsons(self.root)
            get_io.return_value.write_json.assert_not_called()
        for path, content in originals.items():
            self.assertEqual(path.read_bytes(), content)

    def test_readable_root_and_timeline_are_both_returned(self):
        root = self.root/'draft_content.json'
        root.write_text(json.dumps(self.fixture()), encoding='utf-8')
        timeline = self.root/'Timelines'/'test-timeline'/'draft_content.json'
        timeline.parent.mkdir(parents=True)
        timeline.write_text(json.dumps(self.fixture()), encoding='utf-8')
        with patch.object(self.engine, '_encrypted_draft_io') as get_io:
            copies, encoded = self.engine._find_subtitle_jsons(self.root)
            get_io.assert_not_called()
        self.assertEqual({Path(path) for path, _, _ in copies}, {root, timeline})
        self.assertEqual(encoded, [])

    def test_native_read_failure_reports_compatibility_before_decoding_payload(self):
        io = core.JianyingDraftIO.__new__(core.JianyingDraftIO)
        io.dll_path = Path('JianyingPro/11.7.5.14616/videoeditor.dll')

        def failed_read(pointer, result_address):
            ctypes.c_uint32.from_address(result_address + 72).value = 6
            # Failed native calls need not populate a usable payload string.
            core._MsvcString.from_address(result_address + 8).size = 1024**3

        with patch.object(io, '_open', return_value=1), patch.object(io, '_virtual', return_value=failed_read):
            with self.assertRaisesRegex(RuntimeError, '错误 6，接口版本 11.7.5.14616') as caught:
                io.read_json(self.root/'draft_content.json')
        self.assertIn('不能据此判断草稿损坏', str(caught.exception))
        self.assertIn('字幕导出', str(caught.exception))

    def test_block_font_write_when_jianying_is_running(self):
        with patch.object(self.engine, '_jianying_is_running', return_value=True):
            with self.assertRaisesRegex(ValueError, '退出剪映'): self.engine._fix_fonts()

    def test_coordinate_bounds_and_config_has_no_keys(self):
        self.engine.default_coords = {'export': None, 'confirm': None, 'popup_close': None}
        self.engine.coords = {'export': [20, 20], 'confirm': [30, 30], 'popup_close': [40, 40]}
        self.engine.sys_res = (100,100); self.engine.export_mode = 'return_home'
        self.assertTrue(self.engine._mode_coords_ready()); self.engine.coords['export']=[200,20]; self.assertFalse(self.engine._mode_coords_ready())


class RecordingTests(unittest.TestCase):
    def setUp(self):
        self.context = ExitStack()
        self.addCleanup(self.context.close)
        self.root = Path(self.context.enter_context(tempfile.TemporaryDirectory(prefix='xm-recording-test-')))
        self.context.enter_context(patch.multiple(core, APP_DATA_DIR=self.root, CFG_FILE=str(self.root/'settings.json'), COORD_TEMPLATE_FILE=str(self.root/'template.json'), DELETED_COORD_TEMPLATE_DIR=self.root/'deleted', LOG_FILE=str(self.root/'engine.log'), LEGACY_CFG_FILES=()))
        self.context.enter_context(patch.object(core.pyautogui, 'size', return_value=(1920, 1080)))
        self.listener = self.context.enter_context(patch.object(core.keyboard, 'Listener'))
        self.context.enter_context(patch.object(core.mouse, 'Listener'))
        self.position = self.context.enter_context(patch.object(core.pyautogui, 'position', return_value=(120, 80)))
        self.context.enter_context(patch.object(core.pyautogui, 'pixel', return_value=(25, 50, 75)))
        self.screenshot = self.context.enter_context(patch.object(core.pyautogui, 'screenshot'))
        self.click = self.context.enter_context(patch.object(core.pyautogui, 'click'))
        self.press = self.context.enter_context(patch.object(core.pyautogui, 'press'))
        self.engine = Engine(str(self.root))
        self.record_events = []
        self.capture_hook = None
        self.context.enter_context(patch('engine.send', side_effect=lambda value: RecordingTests.record_event(self, value)))
        self.foreground = self.context.enter_context(patch.object(self.engine, '_foreground_process_name', return_value='小马剪辑台.exe'))
        self.addCleanup(self.engine.close)

    def release(self, key):
        # Exercise the callback registered on the actual worker, not a UI-only action.
        return self.listener.call_args.kwargs['on_release'](key)

    def record_event(self, value):
        self.record_events.append(value)
        if value['event'] == 'recording-capture':
            self.engine.dispatch('recording_capture_ready', {'id': value['id'], 'token': 'stale-token'})
            self.assertFalse(self.engine._recording_capture['event'].is_set())
            if self.capture_hook: self.capture_hook(value)
            else: self.engine.dispatch('recording_capture_ready', {'id': value['id'], 'token': value['token']})

    def test_recording_card_tracks_three_steps_and_confirms_template_save(self):
        self.engine.dispatch('wizard', {})
        first = self.engine.snapshot()['recordingProgress']
        self.assertEqual(first['stage'], 'preparing'); self.assertEqual(first['current'], 1)
        self.assertEqual(first['total'], 3); self.assertEqual(first['completed'], 0)
        self.assertEqual(self.record_events[0]['event'], 'minimize')
        for index in range(3): self.release(core.keyboard.Key.f8)
        states = [value for value in self.record_events if value['event'] == 'recording-progress']
        self.assertEqual([value['current'] for value in states], [1,2,3,3])
        self.assertEqual([value['completed'] for value in states], [0,1,2,3])
        self.assertEqual(states[-1]['stage'], 'complete'); self.assertIn('已保存', states[-1]['message'])
        self.assertEqual(len({value['id'] for value in states}), 1)

    def test_wait_mode_card_prompts_f9_without_counting_skipped_position(self):
        self.engine.export_mode = 'wait_close'; self.engine.dispatch('wizard', {})
        self.release(core.keyboard.Key.f8); self.release(core.keyboard.Key.f8)
        state = self.engine.snapshot()['recordingProgress']
        self.assertEqual(state['total'], 4); self.assertEqual(state['completed'], 2)
        self.assertTrue(state['skipAvailable']); self.assertIn('F9', state['message'])
        count = len([v for v in self.record_events if v['event'] == 'recording-capture'])
        self.release(core.keyboard.Key.f8)
        self.assertEqual(len([v for v in self.record_events if v['event'] == 'recording-capture']), count)
        self.release(core.keyboard.Key.f9)
        state = self.engine.snapshot()['recordingProgress']
        self.assertFalse(state['skipAvailable']); self.assertEqual(state['completed'], 2)
        self.assertEqual(state['step'], 'close_btn')

    def test_pointer_is_frozen_at_f8_before_overlay_hides(self):
        self.engine.dispatch('wizard', {})
        def move_then_ack(value):
            self.position.return_value = (999,888)
            self.engine.dispatch('recording_capture_ready', {'id': value['id'], 'token': value['token']})
        self.capture_hook = move_then_ack
        self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine._recording_coords['export'], [120,80])
        self.assertEqual(self.engine.snapshot()['recordingProgress']['current'], 2)

    def test_hide_failure_keeps_step_retryable_and_cancel_is_reported(self):
        self.engine.dispatch('wizard', {})
        self.capture_hook = lambda value: self.engine.dispatch('recording_capture_ready', {**value, 'error': '进度卡隐藏失败'})
        self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine.rec_state, 'export')
        self.assertIsNone(self.engine._recording_coords['export'])
        self.assertEqual(self.engine.snapshot()['recordingProgress']['stage'], 'retry')
        self.capture_hook = None; self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine.snapshot()['recordingProgress']['current'], 2)
        self.release(core.keyboard.Key.f10)
        state = self.engine.snapshot()['recordingProgress']
        self.assertEqual(state['stage'], 'cancelled'); self.assertIn('F10', state['message'])
        self.assertEqual(state['completed'], 1)

    def test_stop_during_overlay_handshake_cannot_record_late_coordinates(self):
        self.engine.dispatch('wizard', {})
        def cancel(value):
            self.engine.dispatch('stop', {})
            self.engine.dispatch('recording_capture_ready', value)
        self.capture_hook = cancel
        self.release(core.keyboard.Key.f8)
        self.assertFalse(self.engine.rec_state)
        self.assertEqual(self.engine.snapshot()['recordingProgress']['stage'], 'cancelled')
        self.assertFalse(self.engine.snapshot()['templates'])

    def test_template_save_failure_is_not_announced_as_completed(self):
        self.engine.dispatch('wizard', {})
        self.release(core.keyboard.Key.f8); self.release(core.keyboard.Key.f8)
        with patch.object(self.engine, '_save_coordinate_template', return_value=False):
            self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine.snapshot()['recordingProgress']['stage'], 'error')
        self.assertIn('保存失败', self.engine.snapshot()['recordingProgress']['message'])

    def test_f8_records_while_hovering_without_focus_and_saves_three_step_template(self):
        self.engine.dispatch('wizard', {})
        for point, next_step in [((120,80),'confirm'), ((800,600),'popup_close'), ((920,700),None)]:
            self.position.return_value = point
            self.release(core.keyboard.Key.f8)
            self.assertEqual(self.engine.rec_state, next_step)
        state = self.engine.snapshot()
        self.assertTrue(state['coordinatesReady']); self.assertFalse(state['recording'])
        self.assertEqual(self.engine.coords['export'], [120,80])
        self.assertEqual(self.engine.coords['confirm'], [800,600])
        self.assertEqual(self.engine.coords['popup_close'], [920,700])
        self.assertEqual(self.engine.close_color, (25,50,75))
        template = self.root/state['templateId']
        self.assertTrue(template.is_file())
        self.assertEqual(json.loads(template.read_text(encoding='utf-8'))['coords'], self.engine.coords)
        self.foreground.assert_not_called(); self.click.assert_not_called(); self.press.assert_not_called()
        self.engine.coords = {}
        self.assertTrue(self.engine._load_coordinate_template(template))
        self.assertEqual(self.engine.coords['export'], [120,80])

    def test_f9_skip_wait_mode_and_f10_cancel_do_not_overwrite_saved_template(self):
        self.engine.export_mode = 'wait_close'
        self.engine.dispatch('wizard', {})
        self.release(core.keyboard.Key.f8); self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine.rec_state, 'popup_close')
        self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine.rec_state, 'popup_close')
        self.assertIn('F9', self.engine.view['notice'])
        self.release(core.keyboard.Key.f9)
        self.assertEqual(self.engine.rec_state, 'close_btn')
        self.release(core.keyboard.Key.f8); self.release(core.keyboard.Key.f8)
        self.assertTrue(self.engine.snapshot()['coordinatesReady'])
        template = self.root/self.engine.snapshot()['templateId']; original=template.read_bytes()
        self.engine.dispatch('wizard', {}); self.release(core.keyboard.Key.f8)
        self.release(core.keyboard.Key.f10)
        self.assertFalse(self.engine.snapshot()['recording'])
        self.assertEqual(template.read_bytes(), original)
        self.click.assert_not_called(); self.press.assert_not_called()

    def test_transient_capture_failure_is_visible_and_next_f8_still_records(self):
        self.engine.dispatch('wizard', {})
        self.position.side_effect = OSError('暂时无法读取鼠标')
        self.assertIsNone(self.release(core.keyboard.Key.f8))
        self.assertEqual(self.engine.rec_state, 'export')
        self.assertIn('暂时无法读取鼠标', self.engine.snapshot()['recordingError'])
        self.assertIn('暂时无法读取鼠标', (self.root/'engine.log').read_text(encoding='utf-8'))
        self.position.side_effect = None
        self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine.rec_state, 'confirm')
        self.assertEqual(self.engine.snapshot()['recordingError'], '')
        self.release(core.keyboard.Key.f8)
        with patch.object(core.pyautogui, 'pixel', side_effect=OSError('暂时无法读取颜色')):
            self.release(core.keyboard.Key.f8)
        self.assertEqual(self.engine.rec_state, 'popup_close')
        self.release(core.keyboard.Key.f8)
        self.assertTrue(self.engine.snapshot()['coordinatesReady'])

    def test_starting_new_recording_recreates_a_stopped_listener(self):
        old = self.engine.kb; old.is_alive.return_value = False
        with patch.object(core.keyboard, 'Listener') as replacement:
            self.engine.dispatch('wizard', {})
            replacement.assert_called_once_with(on_release=self.engine._on_key)
            replacement.return_value.start.assert_called_once()
            self.assertIs(self.engine.kb, replacement.return_value)
        self.assertEqual(self.engine.rec_state, 'export')

    def test_export_still_refuses_input_to_other_apps(self):
        with self.assertRaisesRegex(RuntimeError, '不是 JianyingPro'):
            self.engine._safe_click(120, 80)
        with self.assertRaisesRegex(RuntimeError, '不是 JianyingPro'):
            self.engine._safe_press('enter')
        self.click.assert_not_called(); self.press.assert_not_called()


class ScanTests(unittest.TestCase):
    def setUp(self):
        RecordingTests.setUp(self)
        self.engine._operation_context.generation = self.engine._operation_generation
        self.foreground.return_value = 'jianyingpro.exe'
        self.context.enter_context(patch.object(self.engine, '_interruptible_wait'))
        self.location = json.dumps({'heading': {'text': '草稿 (15)', 'box': [480, 90, 505, 140]}, 'region': [515, 90, 800, 980]})
        self.cards = '{"drafts":[{"kind":"draft","box":[100,100,300,300],"name":"第1集"}]}'
        self.ai = self.context.enter_context(patch.object(self.engine, '_generate_ai_text', side_effect=lambda prompt, **kwargs: self.location if prompt == LOCATE_PROMPT else self.cards))
        self.screenshot.return_value = Image.new('RGB', (1920, 1080))
        self.engine.drafts = [(20, 30, '原草稿')]
        self.engine._fill_queue()
        self.before = copy.deepcopy(self.engine.view['queue'])
        self.events = []
        self.ack_error = ''
        self.cancel_capture = False
        self.context.enter_context(patch('engine.send', side_effect=self.on_event))

    def on_event(self, event):
        self.events.append(event)
        if event['event'] == 'scan-capture':
            self.screenshot.assert_not_called()
            self.engine.dispatch('scan_capture_ready', {'id': 'old-id'})
            self.assertFalse(self.engine._scan_capture['event'].is_set())
            if self.cancel_capture: self.engine.dispatch('stop', {})
            self.engine.dispatch('scan_capture_ready', {'id': event['id'], 'error': self.ack_error})

    def stages(self):
        return [event['stage'] for event in self.events if event['event'] == 'scan-progress']

    def test_scan_reports_real_stages_and_commits_only_after_capture_ack(self):
        self.engine._scan()
        self.assertEqual(self.events[0]['event'], 'minimize')
        self.assertEqual(self.stages(), ['preparing', 'locating', 'analyzing', 'organizing', 'complete'])
        self.screenshot.assert_called_once()
        self.assertEqual(self.engine.view['queue'][0]['name'], '第1集')
        self.assertEqual(self.engine.view['scanProgress']['count'], 1)
        self.assertIsNone(self.engine._scan_capture)
        self.assertEqual(len({e['id'] for e in self.events if e.get('id')}), 1)
        self.assertEqual(self.ai.call_count, 2)
        self.assertEqual(self.ai.call_args_list[0].kwargs['image'].size, (1920, 1080))
        left, top, right, bottom = self.engine._draft_scan_scope['box']
        self.assertEqual(self.ai.call_args_list[1].kwargs['image'].size, (right-left, bottom-top))
        self.assertGreater(top, 540)
        x, y, _ = self.engine.drafts[0]
        self.assertTrue(left <= x < right and top <= y < bottom)

    def test_empty_result_finishes_without_fake_success_count(self):
        self.cards = '{"drafts":[]}'
        self.engine._scan()
        self.assertEqual(self.engine.view['queue'], [])
        self.assertEqual(self.engine.view['scanProgress']['count'], 0)
        self.assertIn('未识别', self.engine.view['notice'])

    def test_malformed_model_result_keeps_previous_drafts(self):
        self.cards = '{"drafts":[{"kind":"draft","box":[0,0,2000,100],"name":"错误"}]}'
        self.engine._scan()
        self.assertEqual(self.stages()[-1], 'error')
        self.assertEqual(self.engine.view['queue'], self.before)
        self.assertIn('坐标', self.engine.view['notice'])
        self.assertEqual(self.ai.call_count, 3)  # Locate + first recognition + one correction.
        self.assertIn('原队列已保留', self.engine.view['notice'])

    def test_reported_deepseek_boxes_get_one_correction_on_same_crop_before_committing(self):
        broken = json.dumps({'drafts': [{'kind': 'draft', 'name': str(i), 'box': [0, x, 600, 175]} for i, x in enumerate([18, 135, 252, 370])]})
        fixed = json.dumps({'drafts': [{'kind': 'draft', 'name': str(i), 'bounds': {'left': x, 'top': 0, 'right': x+175, 'bottom': 600}} for i, x in enumerate([18, 252, 486, 720])]})
        def respond(prompt, **kwargs):
            self.assertEqual(self.engine.view['queue'], self.before)
            if prompt == LOCATE_PROMPT: return self.location
            if 'ONLY correction attempt' not in prompt: return broken
            self.assertIn('left=252', prompt)
            self.assertIn('right=175', prompt)
            self.assertIs(kwargs['image'], self.ai.call_args_list[1].kwargs['image'])
            return fixed
        self.ai.side_effect = respond
        self.engine._scan()
        self.assertEqual(self.ai.call_count, 3)
        self.screenshot.assert_called_once()
        self.assertEqual(self.stages()[-1], 'complete')
        self.assertEqual(len(self.engine.view['queue']), 4)
        self.assertEqual(self.engine.view['scanProgress']['count'], 4)
        self.assertTrue(any('自动纠正' in event.get('message', '') for event in self.events))

    def test_incomplete_visible_count_gets_one_correction_and_retains_old_queue_until_complete(self):
        location = {'heading': {'text': '本地草稿 / 一心求死', 'box': [313, 91, 331, 226]},
                    'region': [341, 92, 456, 456]}
        self.location = json.dumps(location, ensure_ascii=False)
        self.engine.sys_res = (2544, 1217)
        self.screenshot.return_value = Image.new('RGB', (2544, 1217))
        cards = [{'kind': 'draft', 'name': f'第{i+1}集',
                  'bounds': {'left': i%7*130, 'top': i//7*350, 'right': i%7*130+100, 'bottom': i//7*350+300}}
                 for i in range(13)]
        def respond(prompt, **kwargs):
            self.assertEqual(self.engine.view['queue'], self.before)
            if prompt == LOCATE_PROMPT: return self.location
            self.assertGreater(kwargs['image'].width, 2200)
            self.assertGreater(kwargs['image'].height, 750)
            if 'ONLY correction attempt' not in prompt:
                return json.dumps({'visibleCount': 13, 'drafts': cards[:8]}, ensure_ascii=False)
            return json.dumps({'visibleCount': 13, 'drafts': cards}, ensure_ascii=False)
        self.ai.side_effect = respond
        self.engine._scan()
        self.assertEqual(self.stages()[-1], 'complete')
        self.assertEqual(self.ai.call_count, 3)
        self.assertEqual(len(self.engine.view['queue']), 13)

    def test_unnumbered_local_folder_page_is_scanned_instead_of_treated_as_empty(self):
        location = json.loads(self.location)
        location['heading']['text'] = '本地草稿 / 一心求死'
        self.location = json.dumps(location)
        self.engine._scan()
        self.assertEqual(self.ai.call_count, 2)
        self.assertEqual(self.stages()[-1], 'complete')
        self.assertEqual(self.engine.view['scanProgress']['count'], 1)
        self.assertIsNone(self.engine._draft_scan_scope['count'])

    def test_cancellation_before_correction_prevents_another_request(self):
        self.cards = '{"drafts":[{"kind":"draft","name":"bad","box":[0,252,600,175]}]}'
        def on_event(event):
            self.on_event(event)
            if '自动纠正' in event.get('message', ''): self.engine.dispatch('stop', {})
        with patch('engine.send', side_effect=on_event): self.engine._scan()
        self.assertEqual(self.ai.call_count, 2)
        self.assertEqual(self.stages()[-1], 'cancelled')
        self.assertEqual(self.engine.view['queue'], self.before)

    def test_cancel_during_correction_cannot_commit_late_results(self):
        def respond(prompt, **kwargs):
            if prompt == LOCATE_PROMPT: return self.location
            if 'ONLY correction attempt' not in prompt:
                return '{"drafts":[{"kind":"draft","name":"bad","box":[0,252,600,175]}]}'
            self.engine.dispatch('stop', {})
            return self.cards
        self.ai.side_effect = respond
        self.engine._scan()
        self.assertEqual(self.ai.call_count, 3)
        self.assertEqual(self.stages()[-1], 'cancelled')
        self.assertEqual(self.engine.view['queue'], self.before)

    def test_model_error_and_foreground_error_finish_with_visible_failure(self):
        self.ai.side_effect = TimeoutError('模型超时')
        self.engine._scan()
        self.assertEqual(self.stages()[-1], 'error')
        self.assertIn('模型超时', self.engine.view['notice'])
        self.assertEqual(self.engine.view['queue'], self.before)
        self.screenshot.reset_mock(); self.events.clear()
        self.foreground.return_value = 'another.exe'
        self.engine._scan()
        self.screenshot.assert_not_called()
        self.assertEqual(self.stages(), ['preparing', 'error'])

    def test_cancel_before_screenshot_or_late_model_result_preserves_queue(self):
        self.cancel_capture = True
        self.engine._scan()
        self.assertEqual(self.stages(), ['preparing', 'cancelled'])
        self.screenshot.assert_not_called(); self.ai.assert_not_called()
        self.assertEqual(self.engine.view['queue'], self.before)
        self.cancel_capture = False; self.engine.stop_flag = False
        self.engine._operation_context.generation = self.engine._operation_generation
        self.events.clear()
        def finish_late(*args, **kwargs):
            if args[0] == LOCATE_PROMPT: return self.location
            self.engine.dispatch('stop', {})
            return self.cards
        self.ai.side_effect = finish_late
        self.engine._scan()
        self.assertEqual(self.stages(), ['preparing', 'locating', 'analyzing', 'cancelled'])
        self.assertEqual(self.engine.view['queue'], self.before)

    def test_hide_failure_never_captures_overlay_or_calls_model(self):
        self.ack_error = '进度卡未能隐藏'
        self.engine._scan()
        self.assertEqual(self.stages(), ['preparing', 'error'])
        self.screenshot.assert_not_called(); self.ai.assert_not_called()
        self.assertEqual(self.engine.view['queue'], self.before)

    def test_cancel_during_countdown_restores_card_with_terminal_state(self):
        def cancel(*args):
            self.engine.dispatch('stop', {})
            self.engine._chk()
        self.engine._interruptible_wait.side_effect = cancel
        self.engine._scan()
        self.assertEqual(self.stages(), ['preparing', 'cancelled'])
        self.screenshot.assert_not_called(); self.ai.assert_not_called()

    def test_missing_draft_heading_never_falls_back_to_generic_thumbnails(self):
        self.location = 'null'
        self.engine._scan()
        self.assertEqual(self.stages(), ['preparing', 'locating', 'error'])
        self.assertEqual(self.ai.call_count, 1)
        self.assertEqual(self.engine.view['queue'], self.before)
        self.assertIsNone(self.engine._draft_scan_scope)

    def test_failed_rescan_preserves_previous_verified_scope_and_queue(self):
        self.engine._scan()
        scope, queue = copy.deepcopy(self.engine._draft_scan_scope), copy.deepcopy(self.engine.view['queue'])
        self.location = 'null'
        self.engine._scan()
        self.assertEqual(self.engine._draft_scan_scope, scope)
        self.assertEqual(self.engine.view['queue'], queue)

    def test_zero_drafts_does_not_request_thumbnail_recognition(self):
        location = json.loads(self.location); location['heading']['text'] = '草稿（0）'
        self.location = json.dumps(location)
        self.engine._scan()
        self.assertEqual(self.ai.call_count, 1)
        self.assertEqual(self.engine.view['scanProgress']['count'], 0)

    def test_changed_screen_size_stops_before_model_request(self):
        self.screenshot.return_value = Image.new('RGB', (2560, 1440))
        self.engine._scan()
        self.ai.assert_not_called()
        self.assertEqual(self.stages(), ['preparing', 'error'])

    def test_unverified_queue_is_rejected_before_export_can_click(self):
        self.engine.coord_template_resolution_mismatch = False
        with self.assertRaisesRegex(ValueError, '重新扫描'):
            self.engine._start_export_thread(0)
        self.click.assert_not_called()


class ExportProgressTests(unittest.TestCase):
    def setUp(self):
        RecordingTests.setUp(self)
        self.engine._operation_context.generation = self.engine._operation_generation
        self.engine.coords = {'export': [1800,20], 'confirm': [1000,700], 'popup_close': [1200,800], 'close_btn': [1200,800], 'draft_close': [1880,20]}
        self.engine.drafts = [(300,650,'第1集'), (430,650,'第2集'), (560,650,'第3集')]
        self.engine._fill_queue()
        self.engine._export_active = True
        self.context.enter_context(patch.object(self.engine, '_interruptible_wait', side_effect=lambda *args: self.engine._chk()))
        self.context.enter_context(patch.object(self.engine, '_safe_click', side_effect=lambda *args: self.engine._chk()))
        self.context.enter_context(patch.object(self.engine, '_safe_press', side_effect=lambda *args: self.engine._chk()))
        self.wait = self.context.enter_context(patch.object(self.engine, '_wait_done', return_value='close'))
        self.events = []
        self.context.enter_context(patch('engine.send', side_effect=lambda value: self.events.append(value)))

    def progress(self):
        return [value for value in self.events if value['event'] == 'export-progress']

    def test_wait_mode_reports_subset_counts_current_title_and_completion(self):
        self.engine._export_loop(1, 'wait_close')
        events = self.progress()
        self.assertEqual(events[0]['stage'], 'preparing')
        self.assertEqual(events[0]['total'], 2)
        self.assertIn('F10', events[0]['message'])
        self.assertTrue(any(event['current'] == 1 and event['draftName'] == '第2集' for event in events))
        self.assertEqual(events[-1]['stage'], 'complete')
        self.assertEqual(events[-1]['completed'], 2)
        self.assertIn('导出完成', events[-1]['message'])
        self.assertEqual(self.engine.view['queue'][0]['st'], '待处理')
        self.assertFalse(self.engine._export_active)
        self.click.assert_not_called(); self.press.assert_not_called()

    def test_background_mode_reports_submission_and_does_not_claim_rendering_finished(self):
        self.wait.return_value = 'return_home'
        self.engine._export_loop(0, 'return_home')
        last = self.progress()[-1]
        self.assertEqual(last['stage'], 'complete')
        self.assertEqual(last['completed'], 3)
        self.assertIn('已提交 3/3', last['message'])
        self.assertIn('后台导出', last['message'])
        self.assertNotIn('导出完成', last['message'])

    def test_f10_immediately_reports_stopping_then_cancelled_and_never_opens_next_project(self):
        def stop(*args):
            self.engine._on_key(core.keyboard.Key.f10)
            self.engine._chk()
        self.wait.side_effect = stop
        self.engine._export_loop(0, 'wait_close')
        events = self.progress()
        self.assertEqual([value['stage'] for value in events][-2:], ['stopping','cancelled'])
        self.assertIn('F10', events[-1]['message'])
        self.assertEqual(events[-1]['completed'], 0)
        self.assertEqual(self.wait.call_count, 1)
        self.assertEqual(self.engine.view['queue'][0]['st'], '已中断')
        self.assertEqual(self.engine.view['queue'][1]['st'], '待处理')
        self.assertFalse(self.engine._export_active)

    def test_button_stop_has_a_distinct_message_and_keeps_finished_count(self):
        def second_stop(*args):
            if self.wait.call_count == 2:
                self.engine.dispatch('stop', {})
                self.engine._chk()
            return 'return_home'
        self.wait.side_effect = second_stop
        self.engine._export_loop(0, 'return_home')
        last = self.progress()[-1]
        self.assertEqual(last['stage'], 'cancelled')
        self.assertEqual(last['completed'], 1)
        self.assertNotIn('已按 F10', last['message'])
        self.assertIn('仍由剪映处理', last['message'])

    def test_failure_has_a_terminal_event_and_does_not_count_the_failed_project(self):
        self.wait.side_effect = TimeoutError('等待导出超时')
        self.engine._export_loop(0, 'wait_close')
        last = self.progress()[-1]
        self.assertEqual(last['stage'], 'error')
        self.assertEqual(last['completed'], 0)
        self.assertIn('超时', last['message'])
        self.assertEqual(self.engine.view['queue'][0]['st'], '失败')

    def test_unrelated_f10_does_not_create_an_export_card(self):
        self.engine._on_key(core.keyboard.Key.f10)
        self.assertEqual(self.progress(), [])


if __name__ == '__main__': unittest.main()
