"""Local authenticated XM adapter around the unchanged upstream Qt application."""
import hmac
import json
import os
from pathlib import Path
import threading
import time
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COMMON = {
    'scale': (0.3, 1.5), 'playback_speed': (0.5, 4.0), 'pet_opacity': (10, 100),
    'animation_gap_seconds': (0, 120), 'click_sound_volume': (0, 1),
    'no_move': bool, 'lock_position': bool, 'shift_drag': bool,
    'mouse_through': bool, 'on_top': bool, 'drag_physics': bool,
    'drop_gravity': bool, 'click_sound_enabled': bool, 'auto_hide_fullscreen': bool,
    'edge_probe_enabled': bool, 'self_talk_enabled': bool,
}


def clean_patch(value):
    if not isinstance(value, dict) or any(key not in COMMON for key in value):
        raise ValueError('无效的桌宠设置')
    result = {}
    for key, val in value.items():
        rule = COMMON[key]
        if rule is bool:
            if not isinstance(val, bool):
                raise ValueError('设置值必须为开关')
        else:
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not rule[0] <= val <= rule[1]:
                raise ValueError('设置值超出范围')
        result[key] = val
    return result


def install():
    if len(sys.argv) == 3 and sys.argv[1] == '--xm-prepare-update':
        from xm_companion_prepare import main
        main(sys.argv[2])
        return False
    data = os.environ.get('XM_COMPANION_DATA')
    token = os.environ.get('XM_COMPANION_TOKEN', '')
    if not data or len(token) < 32:
        # Direct launch and the upstream restart action return to the owning XM app.
        host = Path(sys.executable).resolve().parents[2] / '小马剪辑台.exe'
        if host.is_file():
            import subprocess
            subprocess.Popen([str(host), '--xm-pet-autostart'], cwd=host.parent)
            return False
        raise RuntimeError('请从 XM剪辑台启动桌宠')
    import pet.config as config
    config.APP_DIR_NAME = 'desktop-pet'
    config._default_base = lambda: Path(data)
    # The upstream Run entry must launch XM, which supplies the isolated profile.
    import pet.autostart as autostart
    import hashlib
    import subprocess
    autostart.VALUE_NAME = 'XM-Pet-' + hashlib.sha256(str(Path(data).resolve()).lower().encode()).hexdigest()[:12]
    autostart.KNOWN_VALUE_NAMES = (autostart.VALUE_NAME,)
    host = os.environ.get('XM_COMPANION_HOST')
    if host:
        args = json.loads(os.environ.get('XM_COMPANION_HOST_ARGS', '[]'))
        autostart._win_command = lambda: subprocess.list2cmdline([host, *args, '--xm-pet-autostart'])
        autostart._win_command_is_current = lambda command: command == autostart._win_command()
    if '--ocr-worker' in sys.argv:
        return True
    install_parent_guard()
    # Child settings/OCR modes retain their original entry and share this profile.
    if '--settings' in __import__('sys').argv or '--ocr-worker' in __import__('sys').argv:
        return True
    from pet.app import AppShell
    install_double_click(token)
    original = AppShell.start
    first_run = not (Path(data) / 'desktop-pet' / 'config.json').exists()

    def start(shell):
        # Qt's default AppDataLocation otherwise puts decoded sound caches on C:.
        import pet.click_sound as click_sound
        sound_cache = Path(data) / 'cache' / 'pet-sounds'
        sound_cache.mkdir(parents=True, exist_ok=True)
        click_sound._SOUND_CACHE_DIR = sound_cache
        click_sound._sound_cache_dir = lambda: sound_cache
        original(shell)
        shell._xm_bridge = start_bridge(shell, token, Path(data))
        if first_run and (Path(data) / 'companion-settings.json').is_file():
            legacy = json.loads((Path(data) / 'companion-settings.json').read_text(encoding='utf-8'))
            request = {'action': 'update', 'event': threading.Event(), 'deadline': time.monotonic() + 12,
                       'value': {'scale': {'small': .5, 'normal': .72, 'large': 1}.get(legacy.get('size'), .72),
                                 'no_move': not legacy.get('roam', False), 'click_sound_enabled': bool(legacy.get('sound', False)),
                                 'click_sound_volume': max(0, min(1, float(legacy.get('volume', 40)) / 100)),
                                 'animation_gap_seconds': max(0, min(120, int(legacy.get('idleInterval', 30))))}}
            shell._xm_bridge.execute(request)
    AppShell.start = start
    return True


def install_double_click(token):
    """Use Qt's native double-click event; don't change normal drag/click logic."""
    port = int(os.environ.get('XM_COMPANION_EVENT_PORT', '0'))
    if not 0 < port < 65536:
        return
    from PySide6.QtCore import Qt
    from pet.overlay_shell import ShellOverlayWindow
    from pet.window import PetWindow
    import urllib.request

    def notify(payload=None):
        try:
            req = urllib.request.Request(f'http://127.0.0.1:{port}/event',
                data=json.dumps(payload or {"action": "open-panel"}, ensure_ascii=False).encode("utf-8"),
                headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=3):
                pass
        except Exception:
            pass

    for cls in (ShellOverlayWindow, PetWindow):
        original = cls.mouseDoubleClickEvent
        def double_click(self, event, original=original):
            if event.button() == Qt.MouseButton.LeftButton:
                resolver = getattr(self, 'sprite_at', None)
                if not callable(resolver) or resolver(event.position()) is not None:
                    threading.Thread(target=notify, daemon=True, name='xm-pet-panel').start()
            original(self, event)
        cls.mouseDoubleClickEvent = double_click
        original_init = cls.__init__
        def initialize(self, *args, _original=original_init, **kwargs):
            _original(self, *args, **kwargs)
            self.setAcceptDrops(True)
        def drag_enter(self, event):
            if event.mimeData().hasUrls() and all(url.isLocalFile() for url in event.mimeData().urls()):
                event.acceptProposedAction()
            else:
                event.ignore()
        def drop(self, event):
            paths = [url.toLocalFile() for url in event.mimeData().urls() if url.isLocalFile()]
            if not paths:
                event.ignore()
                return
            event.acceptProposedAction()
            threading.Thread(target=notify, args=({'action': 'drop-paths', 'paths': paths},),
                             daemon=True, name='xm-pet-drop').start()
        cls.__init__ = initialize
        cls.dragEnterEvent = drag_enter
        cls.dragMoveEvent = drag_enter
        cls.dropEvent = drop


_parent_guard = None


def install_parent_guard():
    """Close only this session's Qt process when its owning process exits."""
    global _parent_guard
    parent = int(os.environ.get('XM_COMPANION_OWNER_PID') or os.environ.get('XM_COMPANION_PARENT_PID') or 0)
    if not parent or sys.platform != 'win32':
        return
    import ctypes
    from ctypes import wintypes
    from PySide6.QtCore import QObject, Signal, Slot, Qt
    from PySide6.QtWidgets import QApplication
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x100000, False, parent)
    if not handle:
        raise RuntimeError('剪辑台已退出，请重新打开桌宠')

    class Guard(QObject):
        stopped = Signal()

        def __init__(self):
            super().__init__()
            self.stopped.connect(self.quit, Qt.ConnectionType.QueuedConnection)

        @Slot()
        def quit(self):
            instance = QApplication.instance()
            if instance:
                instance.quit()

    _parent_guard = Guard()

    def watch():
        kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
        kernel.CloseHandle(handle)
        _parent_guard.stopped.emit()
    threading.Thread(target=watch, daemon=True, name='xm-pet-owner').start()


def start_bridge(shell, token, data):
    from PySide6.QtCore import QObject, QTimer, Signal, Slot, Qt
    from PySide6.QtWidgets import QApplication, QLabel
    import pet.config as config
    from pet import pet_profiles
    from types import SimpleNamespace
    app = QApplication.instance()
    # Detached original settings windows inherit this exact native owner.
    os.environ['XM_COMPANION_OWNER_PID'] = str(os.getpid())
    manifest = json.loads((Path(__import__('sys')._MEIPASS).parent / 'xm-manifest.json').read_text(encoding='utf-8'))
    clips = {item['id']: item for item in manifest['animations']}
    name_file = data / 'companion-settings.json'

    class Bridge(QObject):
        called = Signal(object)

        def __init__(self):
            super().__init__()
            self.called.connect(self.execute, Qt.ConnectionType.QueuedConnection)
            self.label = QLabel(None, Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.WindowTransparentForInput)
            self.label.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
            self.label.setStyleSheet('QLabel {color: white; background: rgba(20,36,61,190); border-radius: 7px; padding: 3px 10px; font: 11px "Microsoft YaHei UI";}')
            self.label_timer = QTimer(self)
            self.label_timer.timeout.connect(self.update_label)
            self.label_timer.start(120)
            self.name = '大肥鱼'
            self.show_name = True
            self.name_stamp = None
            self.busy = False

        def update_label(self):
            try:
                overlay = shell._overlay_shell
                stamp = name_file.stat().st_mtime_ns if name_file.exists() else None
                if stamp != self.name_stamp:
                    values = json.loads(name_file.read_text(encoding='utf-8'))
                    self.name = str(values.get('name') or '大肥鱼')[:20]
                    self.show_name = values.get('showName', True)
                    self.name_stamp = stamp
                sprite = overlay.sprite if overlay else None
                if not sprite or not self.show_name or not shell._aggregate_pet_visible():
                    self.label.hide()
                    return
                host = overlay.host_for_sprite(sprite)
                rect = sprite.rect()
                pos = host.overlay.mapToGlobal(rect.bottomLeft())
                self.label.setText(self.name)
                self.label.adjustSize()
                screen = (app.screenAt(pos) or app.primaryScreen()).availableGeometry()
                x = max(screen.left(), min(pos.x() + (rect.width() - self.label.width()) // 2, screen.right() - self.label.width()))
                y = max(screen.top(), min(pos.y(), screen.bottom() - self.label.height()))
                self.label.move(x, y)
                self.label.show()
            except Exception:
                self.label.hide()

        def state(self):
            overlay = shell._overlay_shell
            cfg = overlay._sprite_config(overlay.sprite) if overlay and overlay.sprite else shell.config
            return {'ready': True, 'visible': shell._aggregate_pet_visible(),
                    'settings': {key: cfg.get(key) for key in COMMON},
                    'animationCount': len(clips), 'version': manifest['version'],
                    'settingsOpen': shell._settings_process_running(),
                    'currentAnimation': getattr(getattr(overlay, 'sprite', None), '_clip_name', ''),
                    'petCount': len(overlay._all_sprites()) if overlay else 1}

        @Slot(object)
        def execute(self, request):
            if time.monotonic() > request['deadline']:
                request['error'] = '桌宠操作已超时，请重试'
                request['event'].set()
                return
            action, value, event = request['action'], request.get('value'), request['event']
            overlay = shell._overlay_shell
            try:
                if action == 'status':
                    pass
                elif action == 'visible':
                    if overlay:
                        overlay.set_pet_visible(bool(value))
                    elif shell.instance and shell.instance.win:
                        shell.instance.win.setVisible(bool(value))
                elif action == 'settings':
                    if not shell.open_settings_process(SimpleNamespace(config=SimpleNamespace(instance_id='slot-0'))):
                        shell.instance.open_modern_settings()
                elif action == 'update':
                    patch = clean_patch(value)
                    per_pet = {k: v for k, v in patch.items() if k in pet_profiles.PER_PET_KEYS}
                    global_values = {k: v for k, v in patch.items() if k not in per_pet}
                    if per_pet:
                        result = pet_profiles.write_profile_settings(shell.config.dir, 0, per_pet, user_customized=True)
                        if result.status not in ('written', 'updated', 'created', 'ok', 'no-changes'):
                            raise RuntimeError('无法保存桌宠档案: ' + result.status)
                    if global_values:
                        cfg = config.Config(instance_id='')
                        for key, val in global_values.items():
                            cfg.set(key, val)
                        if not cfg.save():
                            raise RuntimeError('无法保存桌宠设置')
                    shell.config.reload()
                    shell._apply_external_config_change()
                elif action == 'reset-position' and overlay:
                    for sprite in overlay._all_sprites():
                        overlay._go_default_corner(sprite)
                    overlay.save_position()
                elif action == 'play' and overlay:
                    if value not in clips:
                        raise ValueError('找不到该动画')
                    overlay.request_link_anim(clips[value]['name'])
                elif action == 'task-state' and overlay:
                    busy = bool(value)
                    if busy != self.busy:
                        overlay.request_link_anim('工作状态-忙碌点按' if busy else '工作状态-雀跃庆祝')
                        self.busy = busy
                elif action == 'spawn':
                    shell.spawn_pet()
                elif action == 'chat':
                    shell.instance.open_chat()
                elif action == 'todo':
                    shell.open_todo_panel()
                elif action == 'quit':
                    self.label.hide()
                    QTimer.singleShot(150, app.quit)
                else:
                    raise ValueError('未知桌宠操作')
                request['result'] = self.state()
            except Exception as error:
                request['error'] = str(error)
            finally:
                event.set()

    bridge = Bridge()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.path != '/command' or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token) or self.headers.get('Origin'):
                self.send_error(403)
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length < 16384:
                    raise ValueError('请求过大')
                request = json.loads(self.rfile.read(length))
                if not isinstance(request, dict):
                    raise ValueError('无效请求')
                request['event'] = threading.Event()
                request['deadline'] = time.monotonic() + 12
                bridge.called.emit(request)
                if not request['event'].wait(12):
                    raise TimeoutError('桌宠暂时没有响应')
                payload = {'error': request['error']} if 'error' in request else request['result']
                body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
                self.send_response(400 if 'error' in request else 200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as error:
                self.send_error(400, 'Invalid command')

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True, name='xm-companion-bridge').start()
    data.mkdir(parents=True, exist_ok=True)
    ready = data / 'companion-bridge.json'
    ready.write_text(json.dumps({'port': server.server_port, 'pid': os.getpid(), 'session': os.environ['XM_COMPANION_SESSION']}), encoding='utf-8')
    app.aboutToQuit.connect(bridge.label.hide)
    app.aboutToQuit.connect(lambda: threading.Thread(target=server.shutdown, daemon=True).start())
    return bridge
