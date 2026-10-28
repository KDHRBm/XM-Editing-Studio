"""JSON-lines worker. Starts no operation until an explicit command arrives."""
import base64
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import threading
import time
import uuid
import upstream_core as core
from draft_scan import LOCATE_PROMPT, CARDS_PROMPT, locate_region, parse_cards, validate_queue

OUTPUT = sys.stdout
WRITE_LOCK = threading.Lock()


def send(payload):
    with WRITE_LOCK:
        OUTPUT.write(json.dumps(payload, ensure_ascii=False) + '\n')
        OUTPUT.flush()


def valid_filename(name):
    return isinstance(name, str) and 0 < len(name) <= 240 and not re.search(r'[<>:"/\\|?*\x00-\x1f]', name) and not name.endswith((' ', '.')) and not re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name, re.I)


class Engine(core.App):
    def __init__(self, directory):
        directory = Path(directory).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        core.APP_DATA_DIR = directory
        core.CFG_FILE = str(directory / 'settings.json')
        core.COORD_TEMPLATE_FILE = str(directory / '模板1.json')
        core.DELETED_COORD_TEMPLATE_DIR = directory / 'deleted_templates'
        core.LOG_FILE = str(directory / 'engine.log')
        core.LEGACY_CFG_FILES = ()
        self.view = {'status': '引擎就绪', 'logs': [], 'queue': [], 'plan': [], 'modal': None, 'notice': '', 'guide': '请先录制坐标', 'recordingError': ''}
        self._busy = False
        self._ai_requests = {}
        self._scan_capture = None
        self._draft_scan_scope = None
        self._export_progress_state = None
        self._export_start_index = 0
        self._last_stop_source = ''
        self._recording_progress_state = None
        self._recording_capture = None
        self._recorded_pointer_sample = None
        self.subtitle_output = str(directory / '字幕导出')
        super().__init__()
        self.draft_dir_val = getattr(self, '_saved_draft_dir', '')
        self.api_key = self.relay_api_key = ''  # Keys stay in Electron, never in this worker.
        self._ui_ready = True
        # Never use the upstream author's monitor coordinates as a local default.
        if not self.active_coord_template:
            self.coords = {key: None for key in self.default_coords}
        self._refresh_export_mode_badge()
        self._save_cfg()

    def _js(self, name, *args):
        if name == 'setStatus': self.view['status'] = str(args[0])
        elif name == 'renderQueue': self.view['queue'] = args[0]
        elif name == 'updateQueueItemStatus' and 0 <= args[0] < len(self.view['queue']): self.view['queue'][args[0]]['st'] = args[1]
        elif name == 'renderRenamePlan': self.view['plan'] = args[0]
        elif name == 'updateGuideBadge': self.view['guide'] = args[0]
        elif name == 'showToast': self.view['notice'] = str(args[0]) + '：' + str(args[1])
        elif name == 'cancelActiveOperationUi': self.view['modal'] = None

    def _log(self, message):
        self.view['logs'] = (self.view['logs'] + [time.strftime('%H:%M:%S') + ' ' + str(message)])[-160:]

    def _load_cfg(self):
        try:
            data = json.loads(Path(core.CFG_FILE).read_text(encoding='utf-8'))
            self.export_mode = data.get('export_mode') if data.get('export_mode') in {'return_home', 'wait_close'} else 'return_home'
            for key, default in core.DEFAULT_STEP_WAITS.items():
                value = float(data.get('step_waits', {}).get(key, default))
                self.step_waits[key] = value if math.isfinite(value) and .1 <= value <= 600 else default
            selected = Path(str(data.get('template', ''))).name
            self.active_coord_template_path = str(core.APP_DATA_DIR / selected) if selected else ''
            self._saved_draft_dir = str(data.get('draft_dir', ''))
            self.subtitle_output = str(data.get('subtitle_output') or self.subtitle_output)
        except (OSError, ValueError, TypeError):
            pass

    def _save_cfg(self):
        try:
            core._atomic_write_json(core.CFG_FILE, {'export_mode': self.export_mode, 'step_waits': self.step_waits, 'template': Path(self.active_coord_template_path).name if self.active_coord_template_path else '', 'draft_dir': getattr(self, 'draft_dir_val', ''), 'subtitle_output': self.subtitle_output})
            return True
        except OSError:
            self._log('参数保存失败，请检查目录权限或磁盘空间。')
            return False

    def snapshot(self):
        return {**self.view, 'ready': True, 'busy': self._busy, 'recording': bool(self.rec_state), 'exporting': self._export_active, 'mode': self.export_mode, 'waits': self.step_waits, 'templates': self._coordinate_template_summaries(), 'templateId': self._active_coordinate_template_id(), 'resolution': list(self.sys_res), 'coordinatesReady': self._mode_coords_ready() and not self.coord_template_resolution_mismatch, 'draftDir': self.draft_dir_val, 'subtitleOutput': self.subtitle_output, 'fileCount': len(self.sel_files)}

    def _begin_operation(self, target, *args):
        with self._operation_lock:
            if self._busy: raise ValueError('当前任务尚未结束，请等待或中断。')
            self._busy = True
            self._operation_generation += 1
            generation = self._operation_generation
            self.stop_flag = False
        def run():
            self._operation_context.generation = generation
            try:
                target(*args)
            except Exception as error:
                self._log(str(error)); self.view['notice'] = str(error)
            finally:
                self._operation_context.generation = None
                self._busy = False
        threading.Thread(target=run, daemon=True).start()

    def _ask_yes_no(self, title, message, on_yes, show_cancel=True):
        self._modal_cb = on_yes
        self.view['modal'] = {'id': uuid.uuid4().hex, 'title': title, 'message': message}

    def _generate_ai_text(self, prompt, image=None, **_):
        token = uuid.uuid4().hex
        event = threading.Event()
        slot = {'event': event}
        self._ai_requests[token] = slot
        encoded = None
        if image is not None:
            bitmap = image.convert('RGB'); bitmap.thumbnail((2560, 2560))
            buffer = io.BytesIO(); bitmap.save(buffer, format='JPEG', quality=88)
            encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
        send({'event': 'ai', 'token': token, 'prompt': prompt, 'image': encoded})
        try:
            deadline = time.monotonic() + (510 if getattr(self, '_web_scan', False) else 150)
            while not event.wait(.1):
                self._chk()
                if time.monotonic() > deadline: raise TimeoutError('AI 请求超时，请重试。')
            self._chk()
            if slot.get('error'): raise ValueError(slot['error'])
            return slot.get('text', '')
        finally:
            self._ai_requests.pop(token, None)

    def _scan_progress(self, scan_id, stage, message, count=None):
        progress = {'id': scan_id, 'stage': stage, 'message': message}
        if count is not None: progress['count'] = count
        self.view['scanProgress'] = progress
        self.view['status'] = message
        send({'event': 'scan-progress', **progress})

    def _scan(self):
        scan_id = uuid.uuid4().hex
        try:
            send({'event': 'minimize'})
            self._scan_progress(scan_id, 'preparing', '请切回剪映首页，3 秒后截图')
            self._interruptible_wait(3)
            # Wait for Electron to hide the overlay before capturing the desktop.
            slot = {'id': scan_id, 'event': threading.Event(), 'error': ''}
            self._scan_capture = slot
            send({'event': 'scan-capture', 'id': scan_id})
            deadline = time.monotonic() + 10
            while not slot['event'].wait(.05):
                self._chk()
                if time.monotonic() >= deadline: raise TimeoutError('进度卡未能隐藏，请重新扫描。')
            self._chk()
            if slot['error']: raise RuntimeError(slot['error'])
            self._require_jianying_foreground()
            image = core.pyautogui.screenshot()
            if tuple(image.size) != tuple(self.sys_res):
                raise ValueError('屏幕尺寸已变化，请重新打开功能页后再扫描。')
            self._scan_progress(scan_id, 'locating', 'AI 正在定位“草稿”标题下方的项目区域')
            location = self._generate_ai_text(LOCATE_PROMPT, image=image)
            self._chk()
            scope = locate_region(location, image.size)
            self._scan_progress(scan_id, 'analyzing', 'AI 正在识别草稿分区，已排除功能卡片和文件夹')
            crop = image.crop(scope['box'])
            prompt = CARDS_PROMPT
            for attempt in range(2):
                self._chk()
                text = self._generate_ai_text(prompt, image=crop) if scope['count'] != 0 else '{"drafts":[]}'
                self._chk()
                self._scan_progress(scan_id, 'organizing', '正在整理草稿名称与位置')
                try:
                    drafts = parse_cards(text, scope)
                    break
                except ValueError as error:
                    if attempt == 1 or scope['count'] == 0:
                        raise ValueError(f'草稿识别结果校验失败，原队列已保留。{error}') from error
                    self._chk()
                    self._scan_progress(scan_id, 'analyzing', 'AI 返回的草稿坐标无效，正在自动纠正一次')
                    self._log(f'草稿结果校验未通过，正在重新识别：{error}')
                    prompt = (CARDS_PROMPT + '\nThis is the ONLY correction attempt for the SAME cropped screenshot. '
                              'The previous answer failed validation: ' + str(error)[:500] + '\n'
                              'Re-read all thumbnail positions from this image and return the COMPLETE corrected list. '
                              'Do not reuse the previous invalid boxes. Use named bounds with right > left and bottom > top. '
                              'right and bottom are absolute edges, NEVER width or height. Do not guess from text alone.')
            with self._operation_lock:
                self._chk()
                self.drafts = drafts
                self._draft_scan_scope = scope
                self._fill_queue()
                message = f'扫描完成，已识别 {len(drafts)} 个草稿' if drafts else '扫描完成，当前页面未识别到草稿'
                self._scan_progress(scan_id, 'complete', message, len(drafts))
                self.view['notice'] = message
                self._log(message)
        except Exception as error:
            cancelled = self.stop_flag or getattr(self._operation_context, 'generation', None) != self._operation_generation
            message = '扫描已中断，原草稿列表已保留' if cancelled else f'扫描失败：{error}'
            self._scan_progress(scan_id, 'cancelled' if cancelled else 'error', message)
            self.view['notice'] = message
            self._log(message)
        finally:
            self._scan_capture = None
            self._web_scan = False

    def _start_wizard(self):
        # pynput listeners cannot restart after stopping. Recreate a dead hook
        # before opening the wizard so the UI cannot get stuck at step one.
        if not self.kb.is_alive():
            self.kb = core.keyboard.Listener(on_release=self._on_key)
            self.kb.start()
        self.view['recordingError'] = ''
        self.view['notice'] = ''
        super()._start_wizard()
        total = 4 if self.export_mode == 'wait_close' else 3
        self._recording_progress_state = {'id': uuid.uuid4().hex, 'operation': 'recording', 'mode': self.export_mode,
            'total': total, 'completed': 0, 'current': 1, 'step': self.rec_state, 'skipAvailable': False}
        send({'event': 'minimize'})
        self._sync_recording_progress('preparing')

    def _recording_progress(self, stage, message):
        state = self._recording_progress_state
        if not state: return
        state.update(stage=stage, message=message)
        self.view['recordingProgress'] = dict(state)
        send({'event': 'recording-progress', **state})

    def _sync_recording_progress(self, stage='recording'):
        state = self._recording_progress_state
        if not state or not self.rec_state: return
        steps = ['export', 'confirm', 'close_btn', 'draft_close'] if state['mode'] == 'wait_close' else ['export', 'confirm', 'popup_close']
        skip = self.rec_state == 'popup_close' and state['mode'] == 'wait_close'
        current = 3 if skip else steps.index(self.rec_state) + 1
        completed = sum((self._recording_coords or {}).get(key) is not None for key in steps)
        prompts = {'export': '请切回剪映，将鼠标移到【导出】按钮，按下并松开 F8',
            'confirm': '在剪映打开导出弹窗，将鼠标移到【确认导出】，按下并松开 F8',
            'popup_close': '确认导出后，将鼠标移到【收起至首页】，按下并松开 F8',
            'close_btn': '等待剪映导出完成，将鼠标移到弹窗【关闭(X)】，按下并松开 F8',
            'draft_close': '关闭导出弹窗，将鼠标移到【关闭草稿/返回首页】，按 F8 保存模板'}
        state.update(current=current, completed=completed, step=self.rec_state, skipAvailable=skip)
        message = '等待完成模式：请按 F9 跳过“收起至首页”，继续录制关闭按钮' if skip else prompts[self.rec_state]
        self._recording_progress(stage, message)

    def _prepare_recording_capture(self):
        # Freeze the position at the F8 release, before waiting for the overlay to disappear.
        self._recorded_pointer_sample = core.pyautogui.position()
        state = self._recording_progress_state
        if not state: return
        slot = {'id': state['id'], 'token': uuid.uuid4().hex, 'event': threading.Event(), 'error': ''}
        self._recording_capture = slot
        try:
            send({'event': 'recording-capture', 'id': slot['id'], 'token': slot['token']})
            deadline = time.monotonic() + 3
            while not slot['event'].wait(.05):
                self._chk()
                if not self.rec_state: return
                if time.monotonic() >= deadline: raise TimeoutError('进度卡未能隐藏，请重按 F8。')
            self._chk()
            if slot['error']: raise RuntimeError(slot['error'])
        finally:
            self._recording_capture = None

    def _coordinate_recording_position(self):
        return self._recorded_pointer_sample if self._recorded_pointer_sample is not None else super()._coordinate_recording_position()

    def _finish_coordinate_recording(self):
        saved = super()._finish_coordinate_recording()
        state = self._recording_progress_state
        if state:
            if saved:
                state.update(completed=state['total'], current=state['total'], step='', skipAvailable=False)
                self._recording_progress('complete', f"录制完成，{self.active_coord_template} 已保存，可用于批量导出")
            else:
                self._recording_progress('error', '坐标模板保存失败，请返回工作台查看日志并重新录制')
        return saved

    def _on_key(self, key):
        if key not in (core.keyboard.Key.f8, core.keyboard.Key.f9, core.keyboard.Key.f10):
            return
        try:
            if key == core.keyboard.Key.f8 and self.rec_state and not (self.rec_state == 'popup_close' and self.export_mode == 'wait_close'):
                self._prepare_recording_capture()
            # Match the original tool: recording only samples the mouse position.
            # Hovering another window does not focus it. Foreground validation
            # remains in the export actions that actually click or press keys.
            super()._on_key(key)
            self.view['recordingError'] = ''
            self._sync_recording_progress()
        except Exception as error:
            # An exception escaping a pynput callback stops the keyboard listener.
            # Keep the current step retryable and make the failure visible.
            message = f'快捷键处理失败：{error}。请将鼠标移到目标按钮后重按；也可点击“中断任务”重新录制。'
            if not self.rec_state: return
            self.view['recordingError'] = message
            self._log(message)
            core._append_diagnostic_log(message)
            self._recording_progress('retry', message)
        finally:
            self._recorded_pointer_sample = None

    def _start_export_thread(self, idx, mode=None):
        if self.coord_template_resolution_mismatch: raise ValueError('显示分辨率与模板不同，请重新录制坐标。')
        validate_queue(self.drafts, self._draft_scan_scope, core.pyautogui.size())
        send({'event': 'minimize'})
        super()._start_export_thread(idx, mode)

    def _export_progress(self, stage, message):
        state = self._export_progress_state
        if not state: return
        state.update(stage=stage, message=message)
        self.view['exportProgress'] = dict(state)
        send({'event': 'export-progress', **state})

    def _stop(self, source='中断按钮'):
        recording = self._recording_progress_state
        was_recording = bool(self.rec_state and recording and recording.get('stage') not in ('complete', 'error', 'cancelled'))
        state = self._export_progress_state
        active = state and state['stage'] not in ('complete', 'error', 'cancelled')
        if active: self._last_stop_source = source
        super()._stop(source)
        if was_recording:
            message = '已按 F10 结束录制' if source == 'F10' else '录制已结束'
            self._recording_progress('cancelled', message + '，原坐标模板已保留')
        if active:
            self._export_progress('stopping', '已收到 F10，正在结束运行' if source == 'F10' else '已收到中断请求，正在结束运行')

    def _qst(self, index, status):
        state = self._export_progress_state
        if state and state['stage'] not in ('complete', 'error', 'cancelled'):
            if status == '失败' and self.stop_flag: status = '已中断'
            if status == '▶ 处理中':
                state.update(current=index - self._export_start_index + 1, draftName=self.drafts[index][2])
                self._export_progress('running', f"正在处理 {state['current']}/{state['total']}：{state['draftName']}")
            elif status == '完成':
                state['completed'] = index - self._export_start_index + 1
                verb = '已提交后台导出' if state['mode'] == 'return_home' else '已完成导出'
                self._export_progress('running', f"{verb} {state['completed']}/{state['total']}：{state['draftName']}")
        super()._qst(index, status)

    def _export_loop(self, start, mode=None):
        mode = mode or self.export_mode
        self._export_start_index = start
        self._last_stop_source = ''
        self._export_progress_state = {'id': uuid.uuid4().hex, 'operation': 'export', 'stage': 'preparing',
            'mode': mode, 'total': len(self.drafts) - start, 'completed': 0, 'current': 0, 'draftName': '',
            # Keep the card clear of project clicks, controls and their recognition areas.
            'avoid': [list(point) for point in self.coords.values() if point] + [[x, y] for x, y, _ in self.drafts[start:]]}
        self._export_progress('preparing', '准备执行导出任务 · 按 F10 结束运行')
        error = ''
        try:
            super()._export_loop(start, mode)
        except Exception as failure:
            error = str(failure)
        state = self._export_progress_state
        if state['completed'] == state['total'] and not error:
            message = f"已提交 {state['completed']}/{state['total']} 个草稿，剪映正在后台导出" if mode == 'return_home' else f"导出完成，共 {state['completed']}/{state['total']} 个草稿"
            stage = 'complete'
        elif self.stop_flag or getattr(self._operation_context, 'generation', None) != self._operation_generation:
            prefix = '已按 F10 结束运行' if self._last_stop_source == 'F10' else '导出运行已结束'
            verb = '已提交' if mode == 'return_home' else '已完成'
            message = f"{prefix}，{verb} {state['completed']}/{state['total']} 个草稿"
            if mode == 'return_home': message += '；已提交的任务仍由剪映处理'
            stage = 'cancelled'
        else:
            detail = error or self.view.get('notice') or '请返回工作台查看日志'
            message = f"导出已停止（{state['completed']}/{state['total']}）：{detail}"
            stage = 'error'
        self.view['notice'] = message
        self._export_progress(stage, message)

    def _mode_coords_ready(self, mode=None):
        if not super()._mode_coords_ready(mode): return False
        width, height = self.sys_res
        return all(point is None or len(point) == 2 and 0 <= point[0] < width and 0 <= point[1] < height for point in self.coords.values())

    def _fix_fonts(self):
        if self._jianying_is_running(): raise ValueError('请先完全退出剪映，再修改草稿字体。')
        super()._fix_fonts()

    def _fill_ai_ren(self, data):
        if not isinstance(data, list) or len(data) > 2000: raise ValueError('AI 改名方案无效。')
        mapping = {}
        for file in self.sel_files:
            basename = Path(file).name
            if basename in mapping: raise ValueError('所选文件含同名文件，请分文件夹处理。')
            mapping[basename] = Path(file)
        plan, seen = [], set()
        for item in data:
            old, new = item.get('old'), item.get('new')
            if old not in mapping or old in seen or not valid_filename(new): raise ValueError('AI 返回未知、重复或不合法文件名。')
            seen.add(old)
            source = mapping[old]
            if source.suffix.casefold() != Path(new).suffix.casefold(): raise ValueError('改名不能改变文件扩展名。')
            plan.append({'source': str(source), 'target': str(source.with_name(new)), 'old_name': old, 'new_name': new, 'mode': 'AI重命名'})
        self.rename_plan = plan
        self._validate_plan(capture=True)
        self._js('renderRenamePlan', plan)
        self._log(f'已生成 {len(plan)} 个文件的改名预览。')

    def _regex_preview_thread(self):
        super()._regex_preview_thread()
        self._validate_plan(capture=True)

    def _validate_plan(self, capture=False):
        targets = set()
        for item in self.rename_plan:
            source, target = Path(item['source']), Path(item['target'])
            if not source.is_file() or source.is_symlink() or not valid_filename(target.name) or source.parent.resolve() != target.parent.resolve(): raise ValueError('文件路径已变化或超出所选目录，请重新预览。')
            if source.suffix.casefold() != target.suffix.casefold(): raise ValueError('不允许改变扩展名。')
            identity = str(target).casefold()
            if identity in targets: raise ValueError('多份文件被命名为同一名称，请修改模板。')
            targets.add(identity)
            if target.exists() and source.resolve() != target.resolve(): raise ValueError('目标文件已经存在：' + target.name)
            info = source.stat(); fingerprint = [info.st_size, info.st_mtime_ns]
            if capture: item['fingerprint'] = fingerprint
            elif item.get('fingerprint') != fingerprint: raise ValueError('预览后源文件已变化，请重新预览。')

    def _do_exec_rename(self):
        self._validate_plan()
        done = []
        journal = core.APP_DATA_DIR / ('rename-' + uuid.uuid4().hex + '.json')
        core._atomic_write_json(journal, {'state': 'planned', 'files': self.rename_plan})
        try:
            for item in self.rename_plan:
                self._chk()
                if item['source'] == item['target']: continue
                os.rename(item['source'], item['target']); done.append(item)
            core._atomic_write_json(journal, {'state': 'complete', 'files': done})
        except Exception:
            for item in reversed(done): os.rename(item['target'], item['source'])
            raise
        self.rename_plan = []; self._js('renderRenamePlan', [])
        self._log(f'已完成 {len(done)} 个文件改名。'); self.view['notice'] = f'已完成 {len(done)} 个文件改名。'

    def dispatch(self, action, args):
        if action == 'recording_capture_ready':
            slot = self._recording_capture
            if slot and slot['id'] == args.get('id') and slot['token'] == args.get('token'):
                slot['error'] = str(args.get('error') or '')[:300]
                slot['event'].set()
            return
        if action == 'scan_capture_ready':
            slot = self._scan_capture
            if slot and slot['id'] == args.get('id'):
                slot['error'] = str(args.get('error') or '')[:300]
                slot['event'].set()
            return
        if action == 'ai_result':
            slot = self._ai_requests.get(args.get('token'))
            if slot: slot.update(text=args.get('text', ''), error=args.get('error', '')); slot['event'].set()
            return
        if action == 'status': return
        if action == 'stop': self.stop_export(); return
        if action == 'modal':
            modal = self.view.get('modal')
            if not modal or modal['id'] != args.get('id'): raise ValueError('确认已失效。')
            self.view['modal'] = None
            self.on_modal_result(args.get('confirmed') is True); return
        if self._busy or self._export_active or self.view.get('modal'): raise ValueError('请先完成、取消或中断当前任务。')
        if self.rec_state and action != 'stop': raise ValueError('请先完成或中断坐标录制。')
        if action == 'scan':
            self._web_scan = args.get('webScan') is True
            self._begin_operation(self._scan)
        elif action == 'wizard': self.start_wizard()
        elif action == 'export': self.request_start_export(int(args.get('index', 0)))
        elif action == 'extract': self.trigger_extract_subs()
        elif action == 'fonts': self.trigger_fix_fonts()
        elif action == 'unhide': self.trigger_unhide_tracks()
        elif action == 'paths':
            for key, attr in [('draftDir', 'draft_dir_val'), ('subtitleOutput', 'subtitle_output')]:
                if key in args:
                    value = str(args[key]); path = Path(value)
                    if not path.is_absolute() or not path.is_dir(): raise ValueError('请选择存在的本地文件夹。')
                    setattr(self, attr, str(path))
            self._save_cfg()
        elif action == 'files':
            files = args.get('files', [])
            if not isinstance(files, list) or len(files) > 2000 or any(not Path(f).is_absolute() or not Path(f).is_file() for f in files): raise ValueError('文件列表无效。')
            self.sel_files = files; self.rename_plan = []; self._js('renderRenamePlan', [])
        elif action == 'preview':
            folder, template = str(args.get('folder', '')), str(args.get('template', ''))
            if not template or len(template) > 500: raise ValueError('请输入最多 500 字符的命名模板。')
            self.on_rename_mode_change('AI 智能重命名' if args.get('ai') else '正则匹配重命名')
            if args.get('ai'):
                if folder:
                    if not Path(folder).is_absolute() or not Path(folder).is_dir(): raise ValueError('请选择存在的文件夹。')
                    self.sel_files = []
                    self.load_folder_for_ai(folder)
                if not self.sel_files: raise ValueError('请先选择需要改名的文件。')
                self.ai_preview(folder, template)
            else: self.regex_preview(folder, template)
        elif action == 'rename': self.trigger_exec_rename()
        elif action == 'settings':
            if 'mode' in args and not self.set_export_mode(args['mode']): raise ValueError('无法保存导出模式。')
            if 'waits' in args and not self.save_step_waits(args['waits']): raise ValueError('等待时间应为 0.1–600 秒。')
        elif action == 'select_template': self.select_coordinate_template(args.get('id'))
        elif action == 'rename_template': self.rename_coordinate_template(args.get('id'), args.get('name'))
        elif action == 'delete_template': self.request_delete_coordinate_template(args.get('id'))
        else: raise ValueError('不支持的操作。')

    def close(self):
        self._stop('退出工具')
        deadline = time.monotonic() + 8
        while self._busy and time.monotonic() < deadline: time.sleep(.1)
        self.kb.stop(); self.mouse_listener.stop()


def main():
    sys.stdin.reconfigure(encoding='utf-8'); OUTPUT.reconfigure(encoding='utf-8')
    if sys.argv[1:] == ['--verify-runtime']:
        import cv2
        import PIL
        send({'ok': True, 'opencv': cv2.__version__, 'pillow': PIL.__version__, 'operationsStarted': False})
        return
    if len(sys.argv) != 3 or sys.argv[1] != '--data-dir': raise ValueError('需要独立数据目录。')
    engine = Engine(sys.argv[2])
    try:
        for line in sys.stdin:
            request = {}
            try:
                if len(line) > 2_000_000: raise ValueError('请求过大。')
                request = json.loads(line)
                if request.get('action') == 'shutdown':
                    engine.close(); send({'id': request.get('id'), 'state': engine.snapshot()}); return
                engine.dispatch(request.get('action'), request.get('args') or {})
                send({'id': request.get('id'), 'state': engine.snapshot()})
            except Exception as error:
                send({'id': request.get('id'), 'error': str(error)[:500]})
    finally:
        engine.close()


if __name__ == '__main__':
    main()
