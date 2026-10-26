# Adapted from the user-provided JianYing-AI-Pro main.py.
"""
剪映 AI ToolBox — 全自动生产力工具箱
Built with CustomTkinter for a modern native look.
"""
import ctypes
import base64
from io import BytesIO
import threading, sys, time, os, re, json, subprocess, shutil, math
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import pyautogui
import requests
from PIL import Image
from pynput import keyboard, mouse
pyautogui.FAILSAFE = True
VERSION = '2.1'
DEFAULT_KEY = ''
APP_DATA_DIR = Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'JianYing-AI-Pro'
CFG_FILE = str(APP_DATA_DIR / 'config.json')
LOG_FILE = str(APP_DATA_DIR / 'app.log')
COORD_TEMPLATE_NAME = '模板1'
COORD_TEMPLATE_FILE = str(APP_DATA_DIR / f'{COORD_TEMPLATE_NAME}.json')
DELETED_COORD_TEMPLATE_DIR = APP_DATA_DIR / 'deleted_templates'
LEGACY_CFG_FILES = tuple(dict.fromkeys([str(Path.cwd() / 'config.json'), str(Path(__file__).resolve().parent / 'config.json')]))
UI_THEME_IDS = {'swiss', 'paper', 'snow', 'blueprint', 'tech', 'screen', 'jade', 'midnight', 'ios'}
EXPORT_TIMEOUT_SECONDS = 30 * 60
DEFAULT_STEP_WAITS = {'open_draft': 8.0, 'export': 3.0, 'confirm': 1.0, 'popup_close': 1.5, 'close_btn': 2.0, 'draft_close': 1.5}
_CONFIG_LOCK = threading.RLock()
_LOG_LOCK = threading.Lock()

def _normalize_api_key(value):
    key = str(value or '').strip().replace('․', '.')
    for index, char in enumerate(key, 1):
        if not 33 <= ord(char) <= 126:
            raise ValueError(f'API Key 第 {index} 个字符不是英文半角字符，请从原页面重新复制')
    return key

def _normalize_model_name(value):
    model = str(value or '').strip().replace('․', '.')
    for index, char in enumerate(model, 1):
        if not 33 <= ord(char) <= 126:
            raise ValueError(f'模型名第 {index} 个字符不是英文半角字符，请核对中转站模型列表')
    return model

class RelayAPIError(RuntimeError):

    def __init__(self, status, detail=''):
        self.status = status
        self.detail = detail
        super().__init__(f'中转站 HTTP {status}')

def _relay_error_detail(response, api_key):
    try:
        payload = response.json()
    except ValueError:
        return ''
    if not isinstance(payload, dict):
        return ''
    error = payload.get('error')
    if not isinstance(error, dict):
        return ''
    detail = error.get('message')
    if not isinstance(detail, str):
        return ''
    detail = re.sub('https?://\\S+', '[地址]', detail)
    if api_key:
        detail = detail.replace(api_key, '[密钥]')
    return detail.replace('\n', ' ').replace('\r', ' ')[:160]

def _relay_chat_endpoint(value):
    url = str(value or '').strip().replace('․', '.')
    parts = urlsplit(url)
    if not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError('中转站地址需为不含账号、参数的 API 地址')
    if parts.scheme != 'https' and (not (parts.scheme == 'http' and parts.hostname in {'localhost', '127.0.0.1', '::1'})):
        raise ValueError('中转站地址必须使用 HTTPS（本机服务可用 HTTP）')
    try:
        parts.port
    except ValueError as exc:
        raise ValueError('中转站地址的端口无效') from exc
    path = parts.path.rstrip('/')
    if path.endswith('/chat/completions'):
        pass
    elif path in ('', '/'):
        path = '/v1/chat/completions'
    elif path.endswith('/v1'):
        path += '/chat/completions'
    else:
        raise ValueError('中转站地址应以 /v1 或 /v1/chat/completions 结尾')
    return urlunsplit((parts.scheme, parts.netloc, path, '', ''))

def _relay_content_text(data):
    try:
        content = data['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError('中转站响应缺少 choices[0].message.content') from exc
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ''.join((part.get('text', '') for part in content if isinstance(part, dict) and part.get('type') == 'text'))
    raise ValueError('中转站返回了无法识别的内容格式')

def _tiny_test_image():
    image = Image.new('RGB', (256, 256), (255, 255, 255))
    for x in range(48, 208):
        for y in range(48, 208):
            image.putpixel((x, y), (0, 0, 0))
    return image
C_BG = '#f0f2f5'
C_CARD = '#ffffff'
C_PRIMARY = '#3b82f6'
C_SUCCESS = '#22c55e'
C_DANGER = '#ef4444'
C_WARN = '#f59e0b'
C_TEXT = '#1e293b'
C_MUTED = '#94a3b8'
C_LOG_BG = '#f8fafc'
C_BORDER = '#e2e8f0'

class _DataBlob(ctypes.Structure):
    _fields_ = [('cbData', ctypes.c_ulong), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]

def _protect_secret(secret):
    """使用当前 Windows 用户的 DPAPI 保护敏感配置。"""
    if not secret:
        return ''
    if os.name != 'nt':
        raise RuntimeError('API Key 加密存储仅支持 Windows')
    raw = secret.encode('utf-8')
    raw_buffer = ctypes.create_string_buffer(raw)
    source = _DataBlob(len(raw), ctypes.cast(raw_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not crypt32.CryptProtectData(ctypes.byref(source), ctypes.c_wchar_p('JianYing-AI-Pro API Key'), None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError()
    try:
        encrypted = ctypes.string_at(target.pbData, target.cbData)
        return base64.b64encode(encrypted).decode('ascii')
    finally:
        kernel32.LocalFree(ctypes.cast(target.pbData, ctypes.c_void_p))

def _unprotect_secret(value):
    if not value:
        return ''
    if os.name != 'nt':
        raise RuntimeError('API Key 解密仅支持 Windows')
    raw = base64.b64decode(value, validate=True)
    raw_buffer = ctypes.create_string_buffer(raw)
    source = _DataBlob(len(raw), ctypes.cast(raw_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData).decode('utf-8')
    finally:
        kernel32.LocalFree(ctypes.cast(target.pbData, ctypes.c_void_p))

def _atomic_write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(path.name + '.tmp')
    try:
        with open(temp_path, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass

def _append_diagnostic_log(message):
    try:
        APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message.rstrip()}\n"
        with _LOG_LOCK, open(LOG_FILE, 'a', encoding='utf-8') as handle:
            handle.write(line)
    except OSError:
        pass

def _rename_get_episode(name):
    """从文件名中提取集数，优先识别“第 N 集”格式。"""
    cleaned = re.sub('\\(\\d+\\)\\s*$', '', name).strip()
    match = re.search('第\\s*(\\d+)\\s*集', cleaned)
    if match:
        return int(match.group(1))
    match = re.search('(\\d+)\\s*集', cleaned)
    if match:
        return int(match.group(1))
    matches = re.findall('\\d+', cleaned)
    return int(matches[-1]) if matches else None

def _rename_is_duplicate_copy(name):
    return re.search('\\(\\d+\\)\\s*$', name) is not None

def _rename_parse_template(template):
    """将包含数字的示例模板拆成数字前缀和后缀。"""
    match = re.search('\\d+', template)
    if not match:
        return None
    return (template[:match.start()], template[match.end():])

def _rename_plan(folder, prefix, suffix, extensions=('.mp4', '.srt', '.mp3', '.wav', '.mkv')):
    """生成重命名计划，不修改文件。"""
    ext_set = tuple((ext.lower() for ext in extensions))
    files = [filename for filename in sorted(os.listdir(folder)) if os.path.isfile(os.path.join(folder, filename)) and filename.lower().endswith(ext_set)]
    files.sort(key=lambda filename: _rename_is_duplicate_copy(os.path.splitext(filename)[0]))
    planned = []
    skipped_duplicates = []
    skipped_without_number = []
    used_targets = set()
    for filename in files:
        stem, extension = os.path.splitext(filename)
        number = _rename_get_episode(stem)
        if number is None:
            skipped_without_number.append(filename)
            continue
        new_name = f'{prefix}{number}{suffix}{extension}'
        if new_name in used_targets:
            skipped_duplicates.append((filename, new_name))
            continue
        used_targets.add(new_name)
        planned.append((filename, new_name))
    return (planned, skipped_duplicates, skipped_without_number)

def fmt_time(us):
    ms = int(us) // 1000
    s, ms = divmod(ms, 1000)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

class _MsvcString(ctypes.Structure):
    _fields_ = [('storage', ctypes.c_ubyte * 16), ('size', ctypes.c_size_t), ('capacity', ctypes.c_size_t)]

def _msvc_input_string(raw):
    if isinstance(raw, str):
        raw = raw.encode('utf-8')
    backing = ctypes.create_string_buffer(raw + b'\x00')
    value = _MsvcString()
    if len(raw) < 16:
        value.storage[:len(raw)] = raw
    else:
        ctypes.c_void_p.from_buffer(value.storage).value = ctypes.addressof(backing)
    value.size = len(raw)
    value.capacity = max(15, len(raw))
    return (value, backing)

def _msvc_output_string(value):
    if value.size > 256 * 1024 * 1024:
        raise ValueError(f'剪映接口返回了异常的数据长度: {value.size}')
    if value.capacity < 16:
        return bytes(value.storage[:value.size])
    pointer = ctypes.c_void_p.from_buffer(value.storage).value
    if not pointer:
        raise ValueError('剪映接口返回了空数据指针')
    return ctypes.string_at(pointer, value.size)

class JianyingDraftIO:
    """使用当前安装的剪映接口读写新版加密 draft_content.json。"""
    FACTORY_CTOR = b'??0DraftIOFactoryBase@draft_store@@QEAA@XZ'
    CREATE_IO = b'?createIO@DraftIOFactoryBase@draft_store@@UEAA?AV?$shared_ptr@UIDraftIO@draft_store@@@std@@PEBV?$array@D$0CA@@4@AEBV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@4@@Z'
    CALC_ENTROPY = b'?calcEntropyDynamicString@DraftIOFactoryBase@draft_store@@UEAA?AU?$pair@V?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@std@@V?$array@D$0CA@@2@@std@@AEBV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@4@@Z'

    def __init__(self, dll_path=None):
        if os.name != 'nt':
            raise RuntimeError('加密草稿读写仅支持 Windows')
        self.dll_path = Path(dll_path or self._find_videoeditor_dll()).resolve()
        self._dll_dir = os.add_dll_directory(str(self.dll_path.parent))
        self.library = ctypes.WinDLL(str(self.dll_path))
        self._kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        self._kernel32.GetProcAddress.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        self._kernel32.GetProcAddress.restype = ctypes.c_void_p
        self.factory = (ctypes.c_ubyte * 24)()
        constructor = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(self._address(self.FACTORY_CTOR))
        constructor(ctypes.addressof(self.factory))
        self._create_io = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(self._address(self.CREATE_IO))
        self._calc_entropy = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(self._address(self.CALC_ENTROPY))

    @staticmethod
    def _find_videoeditor_dll():
        candidates = []
        searched_roots = []
        override = os.environ.get('JIANYING_VIDEOEDITOR_DLL', '').strip()
        if override:
            override_path = Path(os.path.expandvars(override.strip('"')))
            if override_path.is_file():
                return override_path.resolve()
            if override_path.is_dir():
                searched_roots.append(override_path)

        def add_registry_path(raw_value):
            if raw_value is None:
                return
            raw_value = os.path.expandvars(str(raw_value).strip())
            if not raw_value:
                return
            match = re.match('^"([^"]+)"', raw_value)
            if match:
                raw_value = match.group(1)
            else:
                raw_value = raw_value.split(',', 1)[0].strip().strip('"')
                if ' ' in raw_value and (not Path(raw_value).exists()):
                    exe_end = raw_value.lower().find('.exe')
                    if exe_end >= 0:
                        raw_value = raw_value[:exe_end + 4]
            path = Path(raw_value)
            if path.suffix.lower() in {'.exe', '.dll'}:
                path = path.parent
            searched_roots.append(path)
        if os.name == 'nt':
            try:
                import winreg
                registry_views = [0]
                for flag_name in ('KEY_WOW64_64KEY', 'KEY_WOW64_32KEY'):
                    flag = getattr(winreg, flag_name, 0)
                    if flag and flag not in registry_views:
                        registry_views.append(flag)
                hives = (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE)
                for hive in hives:
                    for view in registry_views:
                        access = winreg.KEY_READ | view
                        for key_name in ('Software\\Bytedance\\JianyingPro', 'Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\JianyingPro.exe'):
                            try:
                                with winreg.OpenKey(hive, key_name, 0, access) as key:
                                    for value_name in ('installDir', 'InstallLocation', 'DisplayIcon', 'Path', ''):
                                        try:
                                            add_registry_path(winreg.QueryValueEx(key, value_name)[0])
                                        except OSError:
                                            continue
                            except OSError:
                                continue
                        uninstall_key = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
                        try:
                            with winreg.OpenKey(hive, uninstall_key, 0, access) as parent:
                                for index in range(winreg.QueryInfoKey(parent)[0]):
                                    try:
                                        subkey_name = winreg.EnumKey(parent, index)
                                        with winreg.OpenKey(parent, subkey_name) as subkey:
                                            display_name = str(winreg.QueryValueEx(subkey, 'DisplayName')[0])
                                            normalized = display_name.casefold()
                                            if 'jianying' not in normalized and '剪映' not in normalized:
                                                continue
                                            for value_name in ('InstallLocation', 'DisplayIcon', 'UninstallString'):
                                                try:
                                                    add_registry_path(winreg.QueryValueEx(subkey, value_name)[0])
                                                except OSError:
                                                    continue
                                    except OSError:
                                        continue
                        except OSError:
                            continue
            except (ImportError, OSError):
                pass
        user_profile = Path(os.environ.get('USERPROFILE') or Path.home())
        local_app_data = Path(os.environ.get('LOCALAPPDATA') or user_profile / 'AppData' / 'Local')
        roaming_app_data = Path(os.environ.get('APPDATA') or user_profile / 'AppData' / 'Roaming')
        searched_roots.extend([user_profile / 'JianyingPro', local_app_data / 'JianyingPro', local_app_data / 'Programs' / 'JianyingPro', roaming_app_data / 'JianyingPro'])
        for drive in ('C:/', 'D:/'):
            for relative in ('JianyingPro', 'Program Files/JianyingPro', 'Program Files (x86)/JianyingPro', 'Program Files/ByteDance/JianyingPro', 'Program Files (x86)/ByteDance/JianyingPro'):
                searched_roots.append(Path(drive) / relative)
        for env_name in ('ProgramFiles', 'ProgramFiles(x86)'):
            base = os.environ.get(env_name)
            if base:
                searched_roots.extend([Path(base) / 'JianyingPro', Path(base) / 'ByteDance' / 'JianyingPro'])
        unique_roots = []
        seen_roots = set()
        for root in searched_roots:
            try:
                normalized = os.path.normcase(str(root.resolve()))
            except OSError:
                normalized = os.path.normcase(str(root.absolute()))
            if normalized not in seen_roots:
                seen_roots.add(normalized)
                unique_roots.append(root)
        for root in unique_roots:
            if not root.is_dir():
                continue
            stack = [(root, 0)]
            while stack:
                current, depth = stack.pop()
                direct = current / 'videoeditor.dll'
                if direct.is_file():
                    candidates.append(direct)
                if depth >= 3:
                    continue
                try:
                    stack.extend(((child, depth + 1) for child in current.iterdir() if child.is_dir() and (not child.is_symlink())))
                except OSError:
                    continue
        candidates = list({str(path.resolve()): path.resolve() for path in candidates if path.is_file()}.values())
        if not candidates:
            raise FileNotFoundError('未找到剪映 videoeditor.dll；已检查注册表、用户目录及 C/D 盘常见安装目录。也可设置环境变量 JIANYING_VIDEOEDITOR_DLL 指向该文件')

        def version_key(path):
            numbers = tuple((int(part) for part in re.findall('\\d+', path.parent.name)))
            try:
                modified = path.stat().st_mtime
            except OSError:
                modified = 0
            return (numbers, modified)
        return max(candidates, key=version_key)

    def _address(self, name):
        result = self._kernel32.GetProcAddress(self.library._handle, name)
        if not result:
            raise RuntimeError(f'当前剪映版本缺少草稿接口: {name!r}')
        return result

    @staticmethod
    def _attachment_path(draft_path):
        draft_path = Path(draft_path).resolve()
        parents = [draft_path.parent]
        parents.extend(list(draft_path.parents)[1:5])
        for parent in parents:
            candidate = parent / 'attachment_pc_common.json'
            if candidate.is_file():
                return candidate
        raise FileNotFoundError(f'找不到 attachment_pc_common.json: {draft_path}')

    def _entropy(self, draft_path):
        attachment = self._attachment_path(draft_path)
        source_text = attachment.read_text(encoding='utf-8-sig')
        source, backing = _msvc_input_string(source_text)
        result = (ctypes.c_ubyte * 64)()
        self._calc_entropy(ctypes.addressof(self.factory), ctypes.addressof(result), ctypes.addressof(source))
        entropy = bytes(result[32:64])
        if not any(entropy):
            raise RuntimeError(f'无法计算草稿密钥: {draft_path}')
        return entropy

    def _open(self, draft_path):
        draft_path = str(Path(draft_path).resolve())
        entropy = (ctypes.c_ubyte * 32).from_buffer_copy(self._entropy(draft_path))
        path_value, path_backing = _msvc_input_string(draft_path)
        shared_io = (ctypes.c_void_p * 2)()
        self._create_io(ctypes.addressof(self.factory), ctypes.addressof(shared_io), ctypes.addressof(entropy), ctypes.addressof(path_value))
        object_pointer = shared_io[0]
        if not object_pointer:
            raise RuntimeError(f'无法打开剪映草稿: {draft_path}')
        return object_pointer

    @staticmethod
    def _virtual(object_pointer, index, argtypes):
        vtable = ctypes.c_void_p.from_address(object_pointer).value
        address = ctypes.c_void_p.from_address(vtable + index * 8).value
        return ctypes.CFUNCTYPE(ctypes.c_void_p, *argtypes)(address)

    def read_json(self, draft_path):
        object_pointer = self._open(draft_path)
        result = (ctypes.c_ubyte * 88)()
        read = self._virtual(object_pointer, 3, (ctypes.c_void_p, ctypes.c_void_p))
        read(object_pointer, ctypes.addressof(result))
        result_code = ctypes.c_uint32.from_buffer(result, 72).value
        detail = _msvc_output_string(_MsvcString.from_buffer(result, 40)).decode('utf-8', errors='replace')
        raw = _msvc_output_string(_MsvcString.from_buffer(result, 8))
        if result_code:
            raise RuntimeError(f'剪映草稿解密失败({result_code}): {detail}')
        try:
            data = json.loads(raw.decode('utf-8-sig'))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f'剪映草稿解密后不是有效 JSON: {draft_path}') from exc
        if not isinstance(data, dict):
            raise RuntimeError(f'剪映草稿根节点不是对象: {draft_path}')
        return data

    def write_json(self, draft_path, data):
        raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        object_pointer = self._open(draft_path)
        value, backing = _msvc_input_string(raw)
        result = (ctypes.c_ubyte * 48)()
        write = self._virtual(object_pointer, 7, (ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p))
        write(object_pointer, ctypes.addressof(result), ctypes.addressof(value))
        result_code = ctypes.c_uint32.from_buffer(result, 32).value
        detail = _msvc_output_string(_MsvcString.from_buffer(result)).decode('utf-8', errors='replace')
        if result_code:
            raise RuntimeError(f'剪映草稿加密写入失败({result_code}): {detail}')

class _TkProxyWidget:
    """兼容原有代码中对 self.status / self.start_btn / self.guide_lbl 等控件的调用"""

    def __init__(self, app, role):
        self._app = app
        self._role = role
        self._value = ''

    def get(self):
        if self._role == 'draft_dir':
            return self._app.draft_dir_val
        if self._role == 'api_key':
            return self._app.api_key
        if self._role == 'api_model':
            return self._app.api_model
        if self._role == 'ren_mode':
            return self._app.ren_mode_val
        if self._role == 'rename_folder':
            return self._app.rename_folder_val
        if self._role == 'fmt':
            return self._app.fmt_val
        if self._role == 'ai_fmt':
            return self._app.ai_fmt_val
        return self._value

    def set(self, val):
        self._value = val

    def configure(self, **kwargs):
        if self._role == 'status' and 'text' in kwargs:
            self._app._js('setStatus', kwargs['text'])
        elif self._role == 'start_btn' and 'state' in kwargs:
            self._app._js('setExportBtnState', kwargs['state'] == 'normal')
        elif self._role == 'guide_lbl' and 'text' in kwargs:
            txt = kwargs['text']
            mode = 'ready' if any((marker in txt for marker in ('就绪', '已载入', '已保存', 'VERIFIED'))) else 'recording' if '/' in txt else ''
            self._app._js('updateGuideBadge', txt, mode)
        elif self._role == 'file_lbl' and 'text' in kwargs:
            self._app._js('setAiFileCount', kwargs['text'])
        elif self._role == 'ai_preview_btn':
            if 'state' in kwargs:
                self._app._js('setAiPreviewBusy', kwargs['state'] != 'normal')

class App:

    def __init__(self):
        global C_PRIMARY, C_SUCCESS, C_DANGER, C_WARN
        C_PRIMARY = '#9E1B16'
        C_SUCCESS = '#0B6E4F'
        C_DANGER = '#B91C1C'
        C_WARN = '#B45309'
        self.window = None
        self._ui_ready = False
        self._modal_cb = None
        self._resize_active = False
        self._resize_last_sync = 0.0
        self._operation_lock = threading.RLock()
        self._operation_generation = 0
        self._operation_context = threading.local()
        self.default_res = (2560, 1440)
        self.default_coords = {'export': [2420, 19], 'confirm': [1468, 1028], 'popup_close': [1548, 951], 'close_btn': None, 'draft_close': [2538, 18]}
        self.default_color = (99, 149, 200)
        self.sys_res = pyautogui.size()
        if self.sys_res == self.default_res:
            self.coords = self.default_coords.copy()
            self.close_color = self.default_color
        else:
            self.coords = {'export': None, 'confirm': None, 'popup_close': None, 'close_btn': None, 'draft_close': None}
            self.close_color = None
        self.stop_flag = False
        self.rec_state = None
        self._recording_lock = threading.RLock()
        self._recording_coords = None
        self._recording_color = None
        self._recording_template_name = None
        self._recording_template_path = None
        self.active_coord_template = None
        self.active_coord_template_path = COORD_TEMPLATE_FILE
        self.coord_template_resolution = None
        self.coord_template_resolution_mismatch = False
        self.coordinate_template_counter = 0
        self.export_mode = 'return_home'
        self.step_waits = DEFAULT_STEP_WAITS.copy()
        self._export_active = False
        self.api_key = DEFAULT_KEY
        self.api_model = 'gemini-3.5-flash'
        self.ai_provider = 'official'
        self.relay_url = ''
        self.relay_api_key = ''
        self.relay_model = 'gemini-2.5-flash'
        self.ui_theme = 'swiss'
        self.drafts = []
        self.sel_files = []
        self.rename_folder = ''
        self.rename_plan = []
        self.first_run = True
        self.first_sub = False
        self.draft_dir_val = 'D:\\JianyingPro Drafts'
        self.ren_mode_val = '正则匹配重命名'
        self.rename_folder_val = ''
        self.fmt_val = '短剧名称_第1集'
        self.ai_fmt_val = '短剧名称_第X集'
        self.status = _TkProxyWidget(self, 'status')
        self.start_btn = _TkProxyWidget(self, 'start_btn')
        self.guide_lbl = _TkProxyWidget(self, 'guide_lbl')
        self.file_lbl = _TkProxyWidget(self, 'file_lbl')
        self.ai_preview_btn = _TkProxyWidget(self, 'ai_preview_btn')
        self.draft_dir = _TkProxyWidget(self, 'draft_dir')
        self.key_entry = _TkProxyWidget(self, 'api_key')
        self.model_combo = _TkProxyWidget(self, 'api_model')
        self.ren_mode_seg = _TkProxyWidget(self, 'ren_mode')
        self.rename_folder_entry = _TkProxyWidget(self, 'rename_folder')
        self.fmt_entry = _TkProxyWidget(self, 'fmt')
        self.ai_fmt_entry = _TkProxyWidget(self, 'ai_fmt')
        self._load_cfg()
        available_templates = self._coordinate_template_records()
        self._sync_coordinate_template_counter(available_templates)
        selected_template = next((record for record in available_templates if self._same_path(record['path'], self.active_coord_template_path)), None)
        if selected_template is None and available_templates:
            selected_template = available_templates[0]
        if selected_template:
            self._load_coordinate_template(selected_template['path'])
            self._save_cfg()
        else:
            self.active_coord_template = None
            self.active_coord_template_path = ''
        self.kb = keyboard.Listener(on_release=self._on_key)
        self.kb.start()
        self.mouse_listener = mouse.Listener(on_click=self._on_mouse_click)
        self.mouse_listener.start()

    def _js(self, func_name, *args):
        if not self.window or not self._ui_ready:
            return
        try:
            args_json = ', '.join((json.dumps(a, ensure_ascii=False) for a in args))
            self.window.evaluate_js(f'window.{func_name} && window.{func_name}({args_json});')
        except Exception:
            pass

    def after(self, ms, func, *args):
        if ms <= 0:
            threading.Thread(target=func, args=args, daemon=True).start()
        else:
            t = threading.Timer(ms / 1000.0, func, args=args)
            t.daemon = True
            t.start()

    def _begin_operation(self, target, *args):
        with self._operation_lock:
            self._operation_generation += 1
            generation = self._operation_generation
            self.stop_flag = False

        def runner():
            self._operation_context.generation = generation
            try:
                target(*args)
            finally:
                self._operation_context.generation = None
        threading.Thread(target=runner, daemon=True).start()

    def _begin_interactive_operation(self):
        with self._operation_lock:
            self._operation_generation += 1
            self.stop_flag = False

    def _log(self, msg):
        _append_diagnostic_log(str(msg))
        print(msg)

    class _LogWriter:

        def __init__(self, app):
            self.app = app

        def write(self, s):
            if s:
                self.app._js('appendLog', s)

        def flush(self):
            pass

    def on_modal_result(self, confirmed):
        cb = self._modal_cb
        self._modal_cb = None
        if confirmed and cb:
            threading.Thread(target=cb, daemon=True).start()

    def start_wizard(self):
        self._start_wizard()

    def _mode_coords_ready(self, mode=None):
        mode = mode or self.export_mode
        required = ('export', 'confirm', 'popup_close') if mode == 'return_home' else ('export', 'confirm', 'close_btn', 'draft_close')
        return all((self.coords.get(key) for key in required))

    def _refresh_export_mode_badge(self):
        if self.rec_state:
            return
        if self._mode_coords_ready():
            label = f'● {self.active_coord_template} 已载入' if self.active_coord_template else '● 坐标已就绪'
            self._js('updateGuideBadge', label, 'ready')
        else:
            self._js('updateGuideBadge', '● 当前模式缺少坐标', '')

    def set_export_mode(self, mode):
        if mode not in ('return_home', 'wait_close') or self.rec_state or self._export_active:
            return False
        previous = self.export_mode
        self.export_mode = mode
        if not self._save_cfg():
            self.export_mode = previous
            self._show_toast('保存失败', '无法保存导出模式，请查看诊断日志', C_DANGER)
            return False
        self._refresh_export_mode_badge()
        self._log(f"导出模式：{('收起至首页' if mode == 'return_home' else '等待完成关闭')}")
        return True

    def save_step_waits(self, waits):
        if not isinstance(waits, dict) or set(waits) != set(DEFAULT_STEP_WAITS):
            return False
        try:
            values = {key: float(waits[key]) for key in DEFAULT_STEP_WAITS}
        except (TypeError, ValueError):
            return False
        if any((not math.isfinite(value) or not 0.1 <= value <= 600 for value in values.values())):
            return False
        previous = self.step_waits
        self.step_waits = {key: round(value, 1) for key, value in values.items()}
        if not self._save_cfg():
            self.step_waits = previous
            return False
        self._log('导出步骤等待时间已保存')
        self._show_toast('等待时间已保存', '下次导出将使用新的等待时间', C_SUCCESS)
        return True

    def select_coordinate_template(self, template_id):
        if self.rec_state:
            self._show_toast('正在录制', '请先完成或中断本次坐标录制', C_WARN, 5000)
            self._refresh_coordinate_template_ui()
            return False
        path = self._coordinate_template_path(template_id)
        if path is None or not self._is_valid_coordinate_template(path):
            self._show_toast('模板载入失败', '所选模板不存在或内容无效', C_DANGER, 6000)
            self._refresh_coordinate_template_ui()
            return False
        if not self._load_coordinate_template(path):
            self._show_toast('模板载入失败', '所选模板不是有效的坐标模板', C_DANGER, 6000)
            self._refresh_coordinate_template_ui()
            return False
        self._save_cfg()
        self._refresh_coordinate_template_ui()
        self._refresh_export_mode_badge()
        self._log(f'已切换坐标模板：{self.active_coord_template}')
        self._show_toast('模板已切换', f'当前使用：{self.active_coord_template}', C_SUCCESS, 4000)
        return True

    def rename_coordinate_template(self, template_id, new_name):
        if self.rec_state:
            self._show_toast('正在录制', '请先完成或中断本次坐标录制', C_WARN, 5000)
            self._refresh_coordinate_template_ui()
            return False
        path = self._coordinate_template_path(template_id)
        name = str(new_name or '').strip()
        if path is None or not self._is_valid_coordinate_template(path):
            self._show_toast('重命名失败', '模板不存在或内容无效', C_DANGER, 5000)
            self._refresh_coordinate_template_ui()
            return False
        if not name or len(name) > 40 or any((ch in name for ch in '\r\n\t')):
            self._show_toast('重命名失败', '名称需为 1 至 40 个可见字符', C_DANGER, 5000)
            self._refresh_coordinate_template_ui()
            return False
        records = self._coordinate_template_records()
        if any((record['id'] != path.name and record['name'].casefold() == name.casefold() for record in records)):
            self._show_toast('重命名失败', '已存在同名模板', C_DANGER, 5000)
            self._refresh_coordinate_template_ui()
            return False
        try:
            with open(path, 'r', encoding='utf-8-sig') as handle:
                payload = json.load(handle)
            old_name = str(payload.get('template_name') or path.stem)
            payload['template_name'] = name
            payload['renamed_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
            with _CONFIG_LOCK:
                _atomic_write_json(path, payload)
            if self._same_path(self.active_coord_template_path, path):
                self.active_coord_template = name
                self._save_cfg()
                self.guide_lbl.configure(text=f'● {name} 已载入')
            self._refresh_coordinate_template_ui()
            self._log(f'坐标模板已重命名：{old_name} → {name}')
            self._show_toast('重命名完成', f'{old_name} → {name}', C_SUCCESS, 4000)
            return True
        except Exception as exc:
            _append_diagnostic_log(f'重命名坐标模板失败 ({path}): {exc}')
            self._show_toast('重命名失败', '无法写入模板文件，请查看诊断日志', C_DANGER, 6000)
            self._refresh_coordinate_template_ui()
            return False

    def request_delete_coordinate_template(self, template_id):
        if self.rec_state:
            self._show_toast('正在录制', '请先完成或中断本次坐标录制', C_WARN, 5000)
            return False
        path = self._coordinate_template_path(template_id)
        record = next((item for item in self._coordinate_template_records() if item['id'] == template_id), None)
        if path is None or record is None:
            self._show_toast('删除失败', '模板不存在或内容无效', C_DANGER, 5000)
            self._refresh_coordinate_template_ui()
            return False
        self._ask_yes_no('删除坐标模板', f"确认删除【{record['name']}】？\n删除后会移入本地回收目录。", lambda: self._delete_coordinate_template(template_id))
        return True

    def scan_drafts(self):
        self._scan_thread()

    def request_start_export(self, idx):
        self._start_export(idx)

    def stop_export(self):
        self._stop()

    def browse_draft_dir(self):
        res = self.window.create_file_dialog(webview.FOLDER_DIALOG, directory=self.draft_dir_val if os.path.isdir(self.draft_dir_val) else '')
        if res and len(res) > 0:
            self.draft_dir_val = res[0]
            self._js('setDraftDirInput', self.draft_dir_val)

    def trigger_extract_subs(self):
        try:
            val = self.window.evaluate_js('window.getDraftDirValue()')
            if val:
                self.draft_dir_val = val
        except Exception:
            pass
        self._sub_thread()

    def trigger_fix_fonts(self):
        try:
            val = self.window.evaluate_js('window.getDraftDirValue()')
            if val:
                self.draft_dir_val = val
        except Exception:
            pass
        self._fix_font_thread()

    def trigger_unhide_tracks(self):
        try:
            val = self.window.evaluate_js('window.getDraftDirValue()')
            if val:
                self.draft_dir_val = val
        except Exception:
            pass
        self._unhide_tracks_thread()

    def on_rename_mode_change(self, mode):
        self.ren_mode_val = mode
        self.rename_plan = []
        self._js('renderRenamePlan', [])

    def browse_rename_folder(self):
        res = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if res and len(res) > 0:
            self.rename_folder_val = res[0]
            self._js('setRenameFolderInput', self.rename_folder_val)
            self.rename_plan = []
            self._js('renderRenamePlan', [])

    def select_ai_files(self):
        file_types = ('视频/字幕文件 (*.mp4;*.mov;*.avi;*.mkv;*.srt;*.ass;*.wav;*.mp3)', 'All files (*.*)')
        res = self.window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=file_types)
        if res:
            self.sel_files = list(res)
            self.file_lbl.configure(text=f'{len(self.sel_files)} 个文件')
            self.rename_plan = []
            self._js('renderRenamePlan', [])

    def load_folder_for_ai(self, folder=None):
        if not folder or not os.path.isdir(folder):
            res = self.window.create_file_dialog(webview.FOLDER_DIALOG)
            if res and len(res) > 0:
                folder = res[0]
        if folder and os.path.isdir(folder):
            self.rename_folder_val = folder
            self._js('setRenameFolderInput', folder)
            valid_exts = ('.mp4', '.mov', '.avi', '.mkv', '.srt', '.ass', '.wav', '.mp3')
            files = [os.path.join(folder, f) for f in sorted(os.listdir(folder)) if os.path.isfile(os.path.join(folder, f)) and f.lower().endswith(valid_exts)]
            if files:
                self.sel_files = files
                self.file_lbl.configure(text=f'{len(self.sel_files)} 个文件')
                self.rename_plan = []
                self._js('renderRenamePlan', [])
                self._log(f'已从文件夹载入 {len(files)} 个文件用于 AI 重命名')
            else:
                self._show_toast('未找到有效文件', '该文件夹下没有常见的视频或字幕文件', C_WARN)

    def regex_preview(self, folder, template):
        self.rename_folder_val = (folder or '').strip().strip('"')
        self.fmt_val = (template or '').strip()
        self._begin_operation(self._regex_preview_thread)

    def ai_preview(self, folder, fmt):
        if folder:
            self.rename_folder_val = folder.strip().strip('"')
        if fmt:
            self.ai_fmt_val = fmt.strip()
        self._ai_preview_thread()

    def trigger_exec_rename(self):
        if not self.rename_plan:
            return
        current_mode = self.ren_mode_val
        self._ask_yes_no(f'确认【{current_mode}】', f'将使用【{current_mode}】修改 {len(self.rename_plan)} 个文件，是否继续？', lambda: self._begin_operation(self._do_exec_rename))

    def open_api_url(self):
        import webbrowser
        webbrowser.open('https://aistudio.google.com/api-keys')

    def minimize_win(self):
        if self.window:
            self.window.minimize()

    def close_win(self):
        if self.window:
            self.window.destroy()
        os._exit(0)

    def _sync_responsive_ui(self):
        self._js('forceResponsiveSync')

    def save_settings(self, key, model, provider='official', relay_url='', relay_key='', relay_model=''):
        try:
            key = _normalize_api_key(key)
            relay_key = _normalize_api_key(relay_key)
            if provider not in ('official', 'relay'):
                raise ValueError('请选择有效的 AI 接口')
            relay_url = str(relay_url or '').strip()
            relay_model = _normalize_model_name(relay_model)
            if provider == 'relay':
                relay_url = _relay_chat_endpoint(relay_url)
                if not relay_key or not relay_model:
                    raise ValueError('请填写中转站 API Key 和模型名')
        except ValueError as exc:
            self._show_toast('AI 设置无效', str(exc), C_DANGER, 6000)
            return False
        previous = (self.api_key, self.api_model, self.ai_provider, self.relay_url, self.relay_api_key, self.relay_model)
        self.api_key = key
        self.api_model = model or 'gemini-3.5-flash'
        self.ai_provider = provider
        self.relay_url = relay_url
        self.relay_api_key = relay_key
        self.relay_model = relay_model or 'gemini-2.5-flash'
        if self._save_cfg():
            self._show_toast('AI 设置已保存', '所选接口及密钥已保存；扫描将使用该接口', C_SUCCESS)
            return True
        self.api_key, self.api_model, self.ai_provider, self.relay_url, self.relay_api_key, self.relay_model = previous
        self._show_toast('保存失败', '无法写入本地配置，请查看诊断日志', C_DANGER)
        return False

    def test_gemini_connection(self, key, model, provider='official', relay_url='', relay_key='', relay_model=''):
        try:
            if provider not in ('official', 'relay'):
                raise ValueError('请选择有效的 AI 接口')
            selected_key = _normalize_api_key(relay_key if provider == 'relay' else key)
            selected_model = _normalize_model_name(relay_model if provider == 'relay' else model)
            endpoint = _relay_chat_endpoint(relay_url) if provider == 'relay' else ''
            if not selected_key or not selected_model:
                raise ValueError('请先填写当前接口的 API Key 和模型名')
        except ValueError as exc:
            self._js('setGeminiTestState', False, str(exc), False)
            return False

        def worker():
            name = '中转站' if provider == 'relay' else '官方 Gemini'
            self._log(f'正在测试 {name}，模型：{selected_model}...')
            try:
                result = self._generate_ai_text('Reply with OK only. Confirm the image is visible.', image=_tiny_test_image(), temperature=0, max_output_tokens=16, provider=provider, key=selected_key, model=selected_model, url=endpoint)
                if not result.strip():
                    raise RuntimeError('接口返回了空响应')
                message = f'{name}连接成功，模型 {selected_model} 可识别图片；请保存设置后再扫描'
                self._js('setGeminiTestState', False, message, True)
                self._show_toast('AI 连接成功', message, C_SUCCESS)
                self._log(f'{name}连接测试成功，模型：{selected_model}')
            except Exception as exc:
                message = self._get_api_err_msg(exc)
                self._js('setGeminiTestState', False, message, False)
                self._show_toast('AI 连接失败', message, C_DANGER, 7000)
                self._log(f'{name}连接测试失败：{message}')
        threading.Thread(target=worker, daemon=True).start()
        return True

    def set_theme(self, theme_id):
        theme_id = str(theme_id or '').strip().lower()
        if theme_id not in UI_THEME_IDS:
            return False
        self.ui_theme = theme_id
        return self._save_cfg()

    def _show_toast(self, title, message, color=C_PRIMARY, duration=4000):
        self._js('showToast', title, message, color, duration)

    def _ask_yes_no(self, title, message, on_yes, show_cancel=True):
        self._modal_cb = on_yes
        self._js('showVoucherModal', title, message, show_cancel)

    def _client(self):
        key = _normalize_api_key(self.api_key)
        if not key:
            raise ValueError('请先在“API及外观设置”中填写并保存 Gemini API Key')
        return genai.Client(api_key=key)

    def _generate_ai_text(self, prompt, image=None, temperature=0.1, max_output_tokens=None, provider=None, key=None, model=None, url=None):
        provider = provider or self.ai_provider
        if provider == 'official':
            key = _normalize_api_key(self.api_key if key is None else key)
            if not key:
                raise ValueError('请先保存官方 Gemini API Key')
            model = model or self.api_model
            config = {'temperature': temperature}
            if max_output_tokens is not None:
                config['max_output_tokens'] = max_output_tokens
            response = genai.Client(api_key=key).models.generate_content(model=model, contents=[image, prompt] if image is not None else prompt, config=types.GenerateContentConfig(**config))
            if response is None or not response.text:
                raise ValueError('Gemini 返回了空响应')
            return response.text
        if provider != 'relay':
            raise ValueError('AI 接口配置无效')
        key = _normalize_api_key(self.relay_api_key if key is None else key)
        if not key:
            raise ValueError('请先保存中转站 API Key')
        model = _normalize_model_name(model or self.relay_model)
        endpoint = _relay_chat_endpoint(self.relay_url if url is None else url)
        content = [{'type': 'text', 'text': prompt}]
        if image is not None:
            bitmap = image.convert('RGB')
            bitmap.thumbnail((2560, 2560))
            buffer = BytesIO()
            bitmap.save(buffer, format='JPEG', quality=88)
            encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
            content.append({'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{encoded}'}})
        payload = {'model': model, 'messages': [{'role': 'user', 'content': content if image is not None else prompt}], 'temperature': temperature}
        if max_output_tokens is not None:
            payload['max_tokens'] = max_output_tokens
        response = requests.post(endpoint, headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}, json=payload, timeout=(10, 90))
        if not response.ok:
            raise RelayAPIError(response.status_code, _relay_error_detail(response, key))
        try:
            result = _relay_content_text(response.json())
        except (ValueError, requests.exceptions.JSONDecodeError) as exc:
            raise ValueError('中转站响应不是有效的聊天内容') from exc
        if not result.strip():
            raise ValueError('中转站返回了空内容，请确认模型支持文本与图片输入')
        return result

    def _normalize_coordinates(self, coordinates):
        if not isinstance(coordinates, dict):
            raise ValueError('坐标模板中的 coords 不是对象')
        normalized = {}
        for key in self.default_coords:
            point = coordinates.get(key)
            if point is None:
                normalized[key] = None
                continue
            if not isinstance(point, (list, tuple)) or len(point) != 2:
                raise ValueError(f'坐标 {key} 格式无效')
            try:
                normalized[key] = [int(point[0]), int(point[1])]
            except (TypeError, ValueError) as exc:
                raise ValueError(f'坐标 {key} 不是有效数字') from exc
        if not normalized.get('export') or not normalized.get('confirm'):
            raise ValueError('模板缺少导出或确认坐标')
        if not normalized.get('popup_close') and (not normalized.get('close_btn')):
            raise ValueError('模板缺少关闭或收起坐标')
        return normalized

    @staticmethod
    def _same_path(left, right):
        if not left or not right:
            return False
        try:
            return os.path.normcase(str(Path(left).resolve())) == os.path.normcase(str(Path(right).resolve()))
        except (OSError, ValueError):
            return False

    def _coordinate_template_path(self, template_id):
        template_id = str(template_id or '')
        if not template_id or Path(template_id).name != template_id or (not template_id.lower().endswith('.json')):
            return None
        try:
            path = (APP_DATA_DIR / template_id).resolve()
            if path.parent != APP_DATA_DIR.resolve():
                return None
            return path
        except (OSError, ValueError):
            return None

    def _read_coordinate_template_record(self, path):
        path = Path(path)
        if not path.is_file() or path.name.lower() == Path(CFG_FILE).name.lower():
            return None
        try:
            with open(path, 'r', encoding='utf-8-sig') as handle:
                template = json.load(handle)
            if 'template_version' not in template or 'template_name' not in template or 'coords' not in template:
                return None
            name = str(template.get('template_name') or '').strip()
            if not name:
                return None
            self._normalize_coordinates(template.get('coords'))
            resolution = template.get('screen_resolution')
            if not isinstance(resolution, (list, tuple)) or len(resolution) != 2:
                return None
            tuple((int(value) for value in resolution))
            color = template.get('color')
            if color is not None:
                if not isinstance(color, (list, tuple)) or len(color) != 3:
                    return None
                tuple((int(value) for value in color))
            return {'id': path.name, 'name': name, 'path': str(path.resolve())}
        except Exception:
            return None

    @staticmethod
    def _coordinate_template_sort_key(record):
        match = re.fullmatch('模板\\s*(\\d+)', record['name'])
        if not match:
            match = re.fullmatch('模板\\s*(\\d+)', Path(record['id']).stem)
        if match:
            return (0, int(match.group(1)), record['name'].casefold())
        return (1, record['name'].casefold(), record['id'].casefold())

    def _coordinate_template_records(self):
        try:
            APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
            records = []
            for path in APP_DATA_DIR.glob('*.json'):
                record = self._read_coordinate_template_record(path)
                if record:
                    records.append(record)
            records.sort(key=self._coordinate_template_sort_key)
            return records
        except Exception as exc:
            _append_diagnostic_log(f'扫描坐标模板失败: {exc}')
            return []

    def _coordinate_template_summaries(self):
        return [{'id': record['id'], 'name': record['name']} for record in self._coordinate_template_records()]

    def _active_coordinate_template_id(self):
        path = self._coordinate_template_path(Path(self.active_coord_template_path).name) if self.active_coord_template_path else None
        return path.name if path is not None and self._same_path(path, self.active_coord_template_path) else ''

    def _refresh_coordinate_template_ui(self):
        self._js('renderCoordinateTemplates', self._coordinate_template_summaries(), self._active_coordinate_template_id())

    def _is_valid_coordinate_template(self, path):
        return self._read_coordinate_template_record(path) is not None

    def _sync_coordinate_template_counter(self, records=None):
        highest = 0
        for record in records if records is not None else self._coordinate_template_records():
            for candidate in (record['name'], Path(record['id']).stem):
                match = re.fullmatch('模板\\s*(\\d+)', candidate)
                if match:
                    highest = max(highest, int(match.group(1)))
        self.coordinate_template_counter = highest
        return highest

    def _next_coordinate_template_identity(self):
        used_numbers = set()
        try:
            APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
            for path in APP_DATA_DIR.glob('模板*.json'):
                match = re.fullmatch('模板\\s*(\\d+)\\.json', path.name, re.IGNORECASE)
                if match:
                    used_numbers.add(int(match.group(1)))
        except Exception as exc:
            _append_diagnostic_log(f'检查坐标模板编号失败: {exc}')
        number = 1
        while number in used_numbers or (APP_DATA_DIR / f'模板{number}.json').exists():
            number += 1
        return (f'模板{number}', APP_DATA_DIR / f'模板{number}.json', number)

    def _reset_coordinates_without_template(self):
        if tuple(self.sys_res) == tuple(self.default_res):
            self.coords = {key: list(value) if value is not None else None for key, value in self.default_coords.items()}
            self.close_color = self.default_color
        else:
            self.coords = {key: None for key in self.default_coords}
            self.close_color = None
        self.active_coord_template = None
        self.active_coord_template_path = ''
        self.coord_template_resolution = None
        self.coord_template_resolution_mismatch = False

    def _delete_coordinate_template(self, template_id):
        path = self._coordinate_template_path(template_id)
        record = self._read_coordinate_template_record(path) if path is not None else None
        if path is None or record is None:
            self._show_toast('删除失败', '模板不存在或内容无效', C_DANGER, 5000)
            self._refresh_coordinate_template_ui()
            return False
        was_active = self._same_path(path, self.active_coord_template_path)
        try:
            DELETED_COORD_TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
            timestamp = time.strftime('%Y%m%d-%H%M%S')
            destination = DELETED_COORD_TEMPLATE_DIR / f'{path.stem}-{timestamp}{path.suffix}'
            suffix = 1
            while destination.exists():
                destination = DELETED_COORD_TEMPLATE_DIR / f'{path.stem}-{timestamp}-{suffix}{path.suffix}'
                suffix += 1
            shutil.move(str(path), str(destination))
            remaining = self._coordinate_template_records()
            if was_active:
                if remaining:
                    self._load_coordinate_template(remaining[0]['path'])
                else:
                    self._reset_coordinates_without_template()
            self._save_cfg()
            self._refresh_coordinate_template_ui()
            self._restore_coordinate_badge()
            self._log(f"坐标模板已删除：{record['name']}（已移入本地回收目录）")
            self._show_toast('模板已删除', f"已删除：{record['name']}", C_SUCCESS, 4000)
            return True
        except Exception as exc:
            _append_diagnostic_log(f'删除坐标模板失败 ({path}): {exc}')
            self._show_toast('删除失败', '无法移动模板文件，请查看诊断日志', C_DANGER, 6000)
            self._refresh_coordinate_template_ui()
            return False

    def _load_coordinate_template(self, template_path=None):
        path = Path(template_path or COORD_TEMPLATE_FILE)
        if not path.is_file():
            return False
        try:
            with open(path, 'r', encoding='utf-8-sig') as handle:
                template = json.load(handle)
            template_name = str(template.get('template_name') or path.stem).strip()
            if not template_name:
                raise ValueError('模板名称为空')
            coordinates = self._normalize_coordinates(template.get('coords'))
            color = template.get('color')
            if color is not None:
                if not isinstance(color, (list, tuple)) or len(color) != 3:
                    raise ValueError('模板颜色格式无效')
                color = tuple((int(value) for value in color))
            resolution = template.get('screen_resolution')
            if not isinstance(resolution, (list, tuple)) or len(resolution) != 2:
                raise ValueError('模板分辨率格式无效')
            resolution = tuple((int(value) for value in resolution))
            self.coords = coordinates
            self.close_color = color
            self.active_coord_template = template_name
            self.active_coord_template_path = str(path.resolve())
            self.coord_template_resolution = resolution
            self.coord_template_resolution_mismatch = resolution != tuple(self.sys_res)
            return True
        except Exception as exc:
            _append_diagnostic_log(f'读取坐标模板失败 ({path}): {exc}')
            return False

    def _save_coordinate_template(self, template_name=None, template_path=None):
        try:
            coordinates = self._normalize_coordinates(self.coords)
            assigned_number = None
            if not template_name or not template_path or Path(template_path).exists():
                template_name, template_path, assigned_number = self._next_coordinate_template_identity()
            template_path = Path(template_path)
            payload = {'template_version': 1, 'template_name': template_name, 'screen_resolution': [int(self.sys_res[0]), int(self.sys_res[1])], 'coords': coordinates, 'color': list(self.close_color) if self.close_color is not None else None, 'saved_at': time.strftime('%Y-%m-%d %H:%M:%S')}
            with _CONFIG_LOCK:
                _atomic_write_json(template_path, payload)
            self.coords = coordinates
            self.active_coord_template = template_name
            self.active_coord_template_path = str(template_path.resolve())
            self.coord_template_resolution = tuple(self.sys_res)
            self.coord_template_resolution_mismatch = False
            if assigned_number is None:
                match = re.fullmatch('模板\\s*(\\d+)', str(template_name))
                assigned_number = int(match.group(1)) if match else self.coordinate_template_counter
            self.coordinate_template_counter = max(self.coordinate_template_counter, assigned_number)
            if not self._save_cfg():
                _append_diagnostic_log('坐标模板已保存，但通用配置同步失败')
            self._refresh_coordinate_template_ui()
            return True
        except Exception as exc:
            _append_diagnostic_log(f'保存坐标模板失败 ({template_path}): {exc}')
            return False

    def _load_cfg(self):
        source = Path(CFG_FILE)
        if not source.is_file():
            source = next((Path(path) for path in LEGACY_CFG_FILES if Path(path).is_file()), None)
        if source is None:
            return
        migrate = str(source.resolve()) != str(Path(CFG_FILE).resolve())
        secret_load_failed = False
        try:
            with open(source, 'r', encoding='utf-8-sig') as handle:
                data = json.load(handle)
            loaded_coords = data.get('coords')
            if isinstance(loaded_coords, dict) and loaded_coords.get('export'):
                try:
                    self.coords = self._normalize_coordinates(loaded_coords)
                except ValueError as exc:
                    _append_diagnostic_log(f'旧坐标配置无效，已忽略: {exc}')
            loaded_color = data.get('color')
            if loaded_color:
                self.close_color = tuple(loaded_color)
            if 'api_key_protected' in data:
                try:
                    self.api_key = _unprotect_secret(data.get('api_key_protected', ''))
                except Exception as exc:
                    self.api_key = ''
                    secret_load_failed = True
                    _append_diagnostic_log(f'API Key 解密失败，已要求重新填写: {exc}')
            else:
                self.api_key = str(data.get('api_key', '') or '').strip()
                migrate = True
            loaded_key = self.api_key
            try:
                self.api_key = _normalize_api_key(loaded_key)
            except ValueError as exc:
                self.api_key = ''
                secret_load_failed = True
                _append_diagnostic_log(f'已保存的 API Key 无法使用: {exc}')
            else:
                if self.api_key != loaded_key:
                    migrate = True
            self.first_run = data.get('first_run', True)
            self.first_sub = False
            self.api_model = data.get('api_model', 'gemini-3.5-flash')
            self.ai_provider = data.get('ai_provider', 'official')
            if self.ai_provider not in ('official', 'relay'):
                self.ai_provider = 'official'
            self.relay_url = str(data.get('relay_url', '') or '')
            try:
                self.relay_model = _normalize_model_name(data.get('relay_model') or 'gemini-2.5-flash')
            except ValueError as exc:
                self.relay_model = 'gemini-2.5-flash'
                _append_diagnostic_log(f'已保存的中转站模型名无效，已恢复默认值: {exc}')
            try:
                self.relay_api_key = _normalize_api_key(_unprotect_secret(data.get('relay_key_protected', '')))
            except Exception as exc:
                self.relay_api_key = ''
                _append_diagnostic_log(f'中转站 API Key 解密失败，需重新填写: {exc}')
            mode = data.get('export_mode')
            if mode in ('return_home', 'wait_close'):
                self.export_mode = mode
            else:
                self.export_mode = 'return_home' if self.coords.get('popup_close') else 'wait_close'
            loaded_waits = data.get('step_waits')
            if isinstance(loaded_waits, dict):
                for key, default in DEFAULT_STEP_WAITS.items():
                    try:
                        value = float(loaded_waits.get(key, default))
                        if math.isfinite(value) and 0.1 <= value <= 600:
                            self.step_waits[key] = round(value, 1)
                    except (TypeError, ValueError):
                        pass
            saved_theme = str(data.get('ui_theme', 'swiss')).lower()
            self.ui_theme = saved_theme if saved_theme in UI_THEME_IDS else 'swiss'
            saved_template_path = data.get('active_coordinate_template_path')
            if saved_template_path:
                self.active_coord_template_path = str(saved_template_path)
            try:
                self.coordinate_template_counter = max(0, int(data.get('coordinate_template_counter', 0) or 0))
            except (TypeError, ValueError):
                self.coordinate_template_counter = 0
                migrate = True
        except Exception as exc:
            self.api_key = ''
            self.relay_api_key = ''
            _append_diagnostic_log(f'读取配置失败 ({source}): {exc}')
            return
        if migrate and (not secret_load_failed):
            self._save_cfg()

    def _save_cfg(self):
        try:
            payload = {'coords': self.coords, 'color': self.close_color, 'api_key_protected': _protect_secret((self.api_key or '').strip()), 'ai_provider': self.ai_provider, 'relay_url': self.relay_url, 'relay_key_protected': _protect_secret((self.relay_api_key or '').strip()), 'relay_model': self.relay_model, 'first_run': self.first_run, 'first_sub': False, 'api_model': getattr(self, 'api_model', 'gemini-3.5-flash'), 'ui_theme': getattr(self, 'ui_theme', 'swiss'), 'export_mode': self.export_mode, 'step_waits': self.step_waits, 'active_coordinate_template': self.active_coord_template, 'active_coordinate_template_path': self.active_coord_template_path, 'coordinate_template_counter': self.coordinate_template_counter}
            with _CONFIG_LOCK:
                _atomic_write_json(CFG_FILE, payload)
            return True
        except Exception as exc:
            _append_diagnostic_log(f'保存配置失败 ({CFG_FILE}): {exc}')
            return False

    def _start_wizard(self):
        self._begin_interactive_operation()
        template_name, template_path, _ = self._next_coordinate_template_identity()
        with self._recording_lock:
            self._recording_coords = {key: None for key in self.default_coords}
            self._recording_color = None
            self._recording_template_name = template_name
            self._recording_template_path = str(template_path)
            self.rec_state = 'export'
        first_step = '[1/4]' if self.export_mode == 'wait_close' else '[1/3]'
        self.guide_lbl.configure(text=f'{first_step} 鼠标放在【导出】上 → 按 F8')
        self._log(f'向导开始，完成后将保存为本地坐标模板【{template_name}】')

    def _capture_btn_template(self, x, y, name):
        """录制时截取按钮区域保存为模板图片"""
        try:
            w, h = (100, 44)
            rx, ry = (max(0, x - w // 2), max(0, y - h // 2))
            img = pyautogui.screenshot(region=(rx, ry, w, h))
            base = os.path.dirname(os.path.abspath(CFG_FILE)) or '.'
            path = os.path.join(base, f'tpl_{name}.png')
            img.save(path)
            self._log(f'  📸 已保存模板 → tpl_{name}.png')
        except Exception as e:
            self._log(f'  ⚠ 截图失败: {e}')

    def _restore_coordinate_badge(self):
        self._refresh_export_mode_badge()

    def _cancel_coordinate_recording(self):
        with self._recording_lock:
            if self.rec_state is None:
                return False
            self.rec_state = None
            self._recording_coords = None
            self._recording_color = None
            self._recording_template_name = None
            self._recording_template_path = None
            self._restore_coordinate_badge()
            return True

    def _on_key(self, key):
        if key == keyboard.Key.f10:
            self._stop('F10')
            return
        if self.rec_state:
            if key == keyboard.Key.f8:
                with self._recording_lock:
                    if not self.rec_state or self._recording_coords is None:
                        return
                    current_state = self.rec_state
                    x, y = pyautogui.position()
                    if current_state == 'popup_close' and self.export_mode == 'wait_close':
                        self._show_toast('请按 F9', '等待完成关闭模式需继续录制关闭按钮和关闭草稿坐标', C_WARN)
                        return
                    self._recording_coords[current_state] = [x, y]
                    if current_state == 'popup_close':
                        r, g, b = pyautogui.pixel(x, y)
                        self._recording_color = (r, g, b)
                        self._capture_btn_template(x, y, 'return_home')
                        self._log(f'  ✓ 收起至首页 ({x},{y}) RGB({r},{g},{b})，结束录制')
                        self._finish_coordinate_recording()
                    elif current_state == 'close_btn':
                        self._capture_btn_template(x, y, 'close_popup')
                        self._log(f'  ✓ 关闭弹窗 ({x},{y})')
                        self._next_rec()
                    else:
                        self._log(f'  ✓ {current_state} ({x},{y})')
                        self._next_rec()
            elif key == keyboard.Key.f9 and self.rec_state == 'popup_close' and (self.export_mode == 'wait_close'):
                with self._recording_lock:
                    if not self.rec_state or self._recording_coords is None:
                        return
                    current_state = self.rec_state
                    self._recording_coords[current_state] = None
                    self._log('  ↪ 已跳过收起至首页坐标，继续录制后续步骤')
                    self._next_rec()

    def _on_mouse_click(self, x, y, button, pressed):
        return

    def _next_rec(self):
        if self.export_mode == 'return_home':
            flow = {'export': ('confirm', '2/3 点导出呼出弹窗 → 鼠标在【确认导出】上 → F8'), 'confirm': ('popup_close', '3/3 鼠标放在【收起至首页】上 → F8 结束录制保存模板')}
        else:
            flow = {'export': ('confirm', '2/4 点导出呼出弹窗 → 鼠标在【确认导出】上 → F8'), 'confirm': ('popup_close', '等待完成关闭模式请按 F9，继续录制关闭按钮'), 'popup_close': ('close_btn', '3/4 鼠标在导出完成后的【关闭(X)】按钮上 → F8'), 'close_btn': ('draft_close', '4/4 鼠标放在【关闭草稿/返回首页】上 → 按 F8结束录制并保存模板'), 'draft_close': (None, '')}
        nxt, txt = flow[self.rec_state]
        self.rec_state = nxt
        if nxt is None:
            self._finish_coordinate_recording()
        else:
            self.guide_lbl.configure(text=txt)

    def _finish_coordinate_recording(self):
        if self._recording_coords is None:
            return False
        self.coords = self._recording_coords
        self.close_color = self._recording_color
        template_name = self._recording_template_name
        template_path = self._recording_template_path
        self.rec_state = None
        self._recording_coords = None
        self._recording_color = None
        self._recording_template_name = None
        self._recording_template_path = None
        if self._save_coordinate_template(template_name, template_path):
            saved_name = self.active_coord_template
            self._refresh_export_mode_badge()
            self._log(f'向导完成，【{saved_name}】已保存至 {self.active_coord_template_path}')
            self._show_toast('坐标模板已保存', f'{saved_name} 将在下次启动时自动载入', C_SUCCESS, 5000)
            return True
        self.guide_lbl.configure(text='● 模板保存失败')
        self._log(f"向导完成，但【{template_name or '新模板'}】保存失败，请查看诊断日志")
        self._show_toast('模板保存失败', '坐标未能写入本地，请查看诊断日志', C_DANGER, 6000)
        return False

    def _get_api_err_msg(self, e):
        if isinstance(e, RelayAPIError):
            status = e.status
            if status == 401:
                summary = '中转站拒绝了 API Key(401)'
            elif status == 403:
                summary = '中转站密钥无权使用该模型(403)'
            elif status == 404:
                summary = '中转站接口或模型不存在(404)'
            elif status == 429:
                summary = '中转站限流或额度不足(429)'
            elif status == 503:
                summary = '中转站或上游模型暂不可用(503)'
            else:
                summary = f'中转站请求失败({status})'
            return f'{summary}：{e.detail}' if e.detail else summary
        err = str(e).lower()
        if '401' in err:
            return 'API Key 无效或中转站不接受此密钥(401)'
        elif '403' in err:
            return '当前密钥无权使用所选模型或服务(403)'
        elif '404' in err:
            return '接口地址或模型不存在(404)，请核对中转站文档'
        elif '400' in err:
            return '请求参数或模型不被接口接受(400)'
        elif '429' in err or 'quota' in err or 'exhausted' in err:
            return 'API 额度已耗尽或请求过于频繁(429)'
        elif '503' in err or 'unavailable' in err:
            return 'Gemini 服务暂时不可用，请稍后重试(503)'
        elif '500' in err:
            return 'Gemini 服务器内部错误(500)'
        elif '10054' in err or 'connection reset' in err or 'closed' in err:
            return '连接被远程主机关闭，请检查代理是否稳定'
        elif 'proxy' in err:
            return '代理连接失败，请检查代理设置'
        elif 'timeout' in err:
            return '网络请求超时 (请检查代理是否可用)'
        return f'发生错误: {str(e)[:120]}'

    def _scan_thread(self):
        self._begin_operation(self._scan)

    def _scan(self):
        self._log('截屏并发送 AI 识别...')
        self._log(f"当前 AI 接口：{('中转站' if self.ai_provider == 'relay' else '官方 Gemini')}")
        self.status.configure(text='AI 扫描中...')
        try:
            self._chk()
            APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
            screenshot_path = APP_DATA_DIR / 'home_screen.png'
            pyautogui.screenshot(str(screenshot_path))
            self._chk()
            img = Image.open(screenshot_path)
            prompt = 'You are analyzing JianYing video editor home screen.\nFind EVERY video draft thumbnail visible.\nFor each, return its bounding box [ymin,xmin,ymax,xmax] normalized 0-1000 and its visible title text.\nReturn ONLY raw JSON array: [{"box":[y1,x1,y2,x2],"name":"title"},...]\nNo markdown.'
            t = self._generate_ai_text(prompt, image=img)
            self._chk()
            t = t.strip()
            for pfx in ['```json', '```']:
                if t.startswith(pfx):
                    t = t[len(pfx):]
            if t.endswith('```'):
                t = t[:-3]
            data = json.loads(t.strip())
            sw, sh = pyautogui.size()
            raw = []
            for it in data:
                self._chk()
                b = it.get('box', [])
                nm = it.get('name', '未知')
                if len(b) == 4:
                    y1, x1, y2, x2 = b
                    raw.append((int((x1 + x2) / 2 / 1000 * sw), int((y1 + y2) / 2 / 1000 * sh), nm))
            if not raw:
                self._log('⚠  未识别到草稿')
                self.status.configure(text='未识别')
                return
            raw.sort(key=lambda c: c[1])
            rows, cur = ([], [])
            for c in raw:
                if not cur:
                    cur.append(c)
                elif abs(c[1] - cur[0][1]) < 100:
                    cur.append(c)
                else:
                    cur.sort(key=lambda i: i[0])
                    rows.append(cur)
                    cur = [c]
            if cur:
                cur.sort(key=lambda i: i[0])
                rows.append(cur)
            self.drafts = []
            for row in rows:
                self.drafts.extend(row)
            self._fill_queue()
            preview = ', '.join((d[2] for d in self.drafts[:3]))
            if len(self.drafts) > 3:
                preview += '...'
            self._log(f'识别到 {len(self.drafts)} 个: {preview}')
            self.status.configure(text=f'{len(self.drafts)} 个草稿就绪')
        except Exception as e:
            if '用户中断' in str(e):
                self._log('AI 扫描已中断，返回结果已丢弃')
                self.status.configure(text='已中断')
                return
            msg = self._get_api_err_msg(e)
            self._log(f'✗ {msg}')
            self.status.configure(text='扫描失败')
            self._show_toast('AI 扫描失败', msg, C_DANGER, 6000)

    def _fill_queue(self):
        items = [{'name': nm, 'st': '待处理'} for _, _, nm in self.drafts]
        self._js('renderQueue', items)

    def _stop(self, source='中断按钮'):
        with self._operation_lock:
            self.stop_flag = True
            self._operation_generation += 1
        recording_cancelled = self._cancel_coordinate_recording()
        self._modal_cb = None
        self._js('cancelActiveOperationUi')
        self.start_btn.configure(state='normal')
        self.ai_preview_btn.configure(state='normal')
        self.status.configure(text='已中断')
        if recording_cancelled:
            self._log(f'{source}：坐标录制已立即取消，原模板未修改')
        else:
            self._log(f'{source}：当前操作已收到中断信号')

    @staticmethod
    def _foreground_process_name():
        if os.name != 'nt':
            return ''
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ''
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        process = kernel32.OpenProcess(4096, False, process_id.value)
        if not process:
            return ''
        try:
            size = wintypes.DWORD(32768)
            buffer = ctypes.create_unicode_buffer(size.value)
            if not kernel32.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
                return ''
            return Path(buffer.value).name.lower()
        finally:
            kernel32.CloseHandle(process)

    def _require_jianying_foreground(self):
        process_name = self._foreground_process_name()
        if process_name != 'jianyingpro.exe':
            shown_name = process_name or '未知程序'
            raise RuntimeError(f'为防止误点，自动化已停止：当前前台是 {shown_name}，不是 JianyingPro.exe')

    def _safe_click(self, *position):
        self._chk()
        self._require_jianying_foreground()
        pyautogui.click(*position)

    def _safe_press(self, key):
        self._chk()
        self._require_jianying_foreground()
        pyautogui.press(key)

    def _interruptible_wait(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self._chk()
            time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))

    def _wait_done(self, mode=None, timeout=EXPORT_TIMEOUT_SECONDS):
        """只检测当前导出模式需要的按钮。"""
        mode = mode or self.export_mode
        rh = self.coords.get('popup_close')
        cb = self.coords.get('close_btn')
        self._log('  · 等待导出弹窗 (0.5s)...')
        self._interruptible_wait(0.5)
        base = os.path.dirname(os.path.abspath(CFG_FILE)) or '.'
        meipass = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
        tpl_rh = os.path.join(base, 'tpl_return_home.png')
        tpl_rh_bundled = os.path.join(meipass, 'btn_bright.png')
        tpl_close = os.path.join(base, 'tpl_close_popup.png')
        self._log('  · 等待按钮就绪 (支持自动降级识别)...')
        deadline = time.monotonic() + timeout
        close_candidate_streak = 0
        while True:
            self._chk()
            if time.monotonic() >= deadline:
                raise TimeoutError(f'等待导出完成超时（{timeout // 60} 分钟）')
            if mode == 'return_home' and rh:
                x_rh, y_rh = rh
                for tpl_path in [tpl_rh, tpl_rh_bundled]:
                    if not os.path.exists(tpl_path):
                        continue
                    try:
                        rx = max(0, x_rh - 100)
                        ry = max(0, y_rh - 60)
                        loc = pyautogui.locateOnScreen(tpl_path, region=(rx, ry, 200, 120), confidence=0.82)
                        if loc is not None:
                            self._log('  ✓ 检测到【收起至首页】(局部模板匹配)')
                            return 'return_home'
                    except Exception:
                        pass
                    try:
                        loc = pyautogui.locateOnScreen(tpl_path, confidence=0.82)
                        if loc is not None:
                            self._log('  ✓ 检测到【收起至首页】(全屏模板匹配)')
                            return 'return_home'
                    except Exception:
                        pass
                for ox in [-25, -15, -5, 0, 5, 15, 25]:
                    for oy in [-10, -5, 0, 5, 10]:
                        try:
                            r, g, b = pyautogui.pixel(x_rh + ox, y_rh + oy)
                            if r < 80 and g > 130 and (b > 130):
                                self._log('  ✓ 检测到【收起至首页】(亮青色背景特征)')
                                return 'return_home'
                        except Exception:
                            pass
            if mode != 'wait_close':
                self._interruptible_wait(1)
                continue
            close_pos = cb
            close_template_exists = os.path.exists(tpl_close)
            if close_template_exists:
                try:
                    if close_pos:
                        rx = max(0, close_pos[0] - 100)
                        ry = max(0, close_pos[1] - 60)
                        loc = pyautogui.locateOnScreen(tpl_close, region=(rx, ry, 200, 120), confidence=0.82)
                        if loc is not None:
                            self._log('  ✓ 检测到【关闭】按钮 (局部模板匹配)')
                            return 'close'
                except Exception:
                    pass
            if close_pos:
                cx, cy = close_pos
                samples = []
                for ox in [-20, -10, 0, 10, 20]:
                    for oy in [-8, -4, 0, 4, 8]:
                        try:
                            samples.append(pyautogui.pixel(cx + ox, cy + oy))
                        except Exception:
                            pass
                if samples and (not any((r < 80 and g > 130 and (b > 130) for r, g, b in samples))):
                    brightness = [max(pixel) for pixel in samples]
                    if max(brightness) > 160 and max(brightness) - min(brightness) > 60:
                        close_candidate_streak += 1
                        if close_candidate_streak >= 2:
                            self._log('  ✓ 检测到【关闭】按钮 (连续两次结构对比度)')
                            return 'close'
                    else:
                        close_candidate_streak = 0
                else:
                    close_candidate_streak = 0
            self._interruptible_wait(1)

    def _start_export(self, idx=0):
        mode = self.export_mode
        if self._export_active:
            self._show_toast('正在导出', '请等待当前批次完成或点击中断', C_WARN)
            return
        if not self._mode_coords_ready(mode):
            required = '导出、确认导出、收起至首页' if mode == 'return_home' else '导出、确认导出、关闭弹窗、关闭草稿'
            self._show_toast('坐标未就绪', f'当前模式需要录制：{required}', C_WARN)
            return
        if not self.drafts:
            self._show_toast('未就绪', '请先 AI 扫描首页', C_WARN)
            return
        if idx is None or idx < 0 or idx >= len(self.drafts):
            idx = 0
        nm = self.drafts[idx][2]
        n = len(self.drafts) - idx
        mode_name = '收起至首页' if mode == 'return_home' else '等待完成关闭'
        self._ask_yes_no('确认开始', f'模式：【{mode_name}】\n将从【{nm}】(第{idx + 1}个) 开始\n共 {n} 个待导出，确认？', lambda: self._start_export_thread(idx, mode))

    def _start_export_thread(self, idx, mode=None):
        mode = mode or self.export_mode
        if not self._mode_coords_ready(mode) or self._export_active:
            return
        self._export_active = True
        self.start_btn.configure(state='disabled')
        self._begin_operation(self._export_loop, idx, mode)

    def _chk(self):
        generation = getattr(self._operation_context, 'generation', None)
        if self.stop_flag or (generation is not None and generation != self._operation_generation):
            raise Exception('用户中断')

    def _qst(self, i, st):
        self._js('updateQueueItemStatus', i, st)

    def _export_loop(self, start, mode=None):
        current_index = None
        try:
            mode = mode or self.export_mode
            waits = self.step_waits.copy()
            total = len(self.drafts)
            n = total - start
            mode_name = '收起至首页' if mode == 'return_home' else '等待完成关闭'
            self._log(f"\n{'─' * 32}\n开始导出【{mode_name}】：共 {n} 个")
            if self.window:
                self.window.minimize()
            self._interruptible_wait(0.8)
            for i in range(start, total):
                current_index = i
                self._chk()
                dx, dy, nm = self.drafts[i]
                self._qst(i, '▶ 处理中')
                self.status.configure(text=f'导出 {i - start + 1}/{n}')
                self._log(f'\n[{i + 1}/{total}] {nm}')
                self._safe_click(dx, dy)
                self._log(f"  · 加载草稿 ({waits['open_draft']:g}s)")
                self._interruptible_wait(waits['open_draft'])
                self._safe_click(*self.coords['export'])
                self._log('  · 点击导出')
                self._interruptible_wait(waits['export'])
                self._safe_click(*self.coords['confirm'])
                self._log('  · 确认导出')
                self._interruptible_wait(waits['confirm'])
                self._safe_press('enter')
                result = self._wait_done(mode)
                self._chk()
                if mode == 'return_home' and result == 'return_home':
                    self._safe_click(*self.coords['popup_close'])
                    self._log('  · 已收起至首页 (后台导出)')
                    self._interruptible_wait(waits['popup_close'])
                elif mode == 'wait_close' and result == 'close':
                    self._safe_click(*self.coords['close_btn'])
                    self._log('  · 点击关闭弹窗')
                    self._interruptible_wait(waits['close_btn'])
                    self._safe_click(*self.coords['draft_close'])
                    self._log('  · 关闭草稿 → 返回首页')
                    self._interruptible_wait(waits['draft_close'])
                else:
                    raise RuntimeError(f'未识别到有效的导出完成状态: {result!r}')
                self._qst(i, '完成')
                current_index = None
            self._log(f'\n全部完成！共导出 {n} 个')
            self.status.configure(text=f'完成 {n} 个')
        except Exception as e:
            err = str(e)
            if current_index is not None:
                self._qst(current_index, '失败')
            if '用户中断' not in err:
                self._show_toast('导出异常终止', f'发生错误: {err[:50]}', C_DANGER, 6000)
            self.status.configure(text='导出失败' if '用户中断' not in err else '已中断')
            self._log(f'\n导出已停止: {err}')
        finally:
            self._export_active = False
            self.start_btn.configure(state='normal')

    def _sub_thread(self):
        self._ask_yes_no('安全确认', '确定执行？此操作将提取 SRT 并隐藏字幕轨道', lambda: self._begin_operation(self._extract_subs))

    def _fix_font_thread(self):
        self._ask_yes_no('安全确认', '确定执行？此操作将统一字体并解除隐藏', lambda: self._begin_operation(self._fix_fonts))

    def _find_noto_sans_bold(self):
        dirs_to_check = [os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'Windows', 'Fonts'), os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts')]
        for d in dirs_to_check:
            if not os.path.exists(d):
                continue
            for fn in os.listdir(d):
                if not fn.lower().endswith(('.ttf', '.otf', '.ttc')):
                    continue
                clean_name = re.sub('[^a-z0-9]', '', fn.lower())
                if 'notosansbold' in clean_name:
                    return os.path.join(d, fn).replace('\\', '/')
        return None

    def _unhide_tracks_thread(self):
        self._ask_yes_no('安全确认', '确定执行？此操作将解除所有草稿的字幕隐藏', lambda: self._begin_operation(self._unhide_tracks))

    def _unhide_tracks(self):
        if self._jianying_is_running():
            self._log('✗ 请先完全退出剪映，再执行解除隐藏')
            self._show_toast('剪映仍在运行', '请完全退出剪映后重试', C_WARN, 6000)
            return
        base = self.draft_dir.get()
        if not os.path.exists(base):
            self._log('✗ 草稿根目录不存在')
            return
        items = []
        for fn in os.listdir(base):
            fp = os.path.join(base, fn)
            if os.path.isdir(fp):
                items.append((fn, fp))
        ok = 0
        for fn, draft_dir in items:
            try:
                self._chk()
                subtitle_jsons, _ = self._find_subtitle_jsons(draft_dir)
                if not subtitle_jsons:
                    continue
                track_copies = 0
                for _, data, _ in subtitle_jsons:
                    track_copies += self._set_subtitle_tracks_hidden(data, False)
                self._chk()
                backups = self._save_subtitle_jsons(subtitle_jsons)
                self._log(f'  ✓ {fn} 已解除隐藏 (同步 {len(subtitle_jsons)} 份，恢复 {track_copies} 条字幕轨道，备份 {len(backups)} 份)')
                ok += 1
            except Exception as e:
                if '用户中断' in str(e):
                    self._log('解除字幕隐藏已中断')
                    self.status.configure(text='已中断')
                    return
                self._log(f'  ✗ {fn} 失败: {e}')
        self._log(f'完成，共解除隐藏 {ok} 个草稿')
        self._show_toast('处理完成', f'成功解除 {ok} 个草稿的隐藏状态', C_SUCCESS, 6000)

    def _fix_fonts(self):
        font_path = self._find_noto_sans_bold()
        if not font_path:
            self._log('✗ 未在系统中找到 Noto Sans Bold 字体文件，请先安装该字体！')
            self._show_toast('缺少字体', '未检测到 Noto Sans Bold，无法统一字体', C_DANGER, 6000)
            return
        tpl_font = {'path': font_path, 'id': ''}
        self._log(f'将强制所有草稿使用系统匹配字体:\n  {font_path}')
        base = self.draft_dir.get()
        if not os.path.exists(base):
            self._log('✗ 草稿根目录不存在')
            return
        items = [(name, os.path.join(base, name)) for name in os.listdir(base) if os.path.isdir(os.path.join(base, name))]
        ok = 0
        for fn, draft_dir in items:
            try:
                self._chk()
                subtitle_jsons, _ = self._find_subtitle_jsons(draft_dir)
                if not subtitle_jsons:
                    continue
                changed_materials = 0
                restored_tracks = 0
                for _, data, _ in subtitle_jsons:
                    subtitle_materials = self._subtitle_materials(data)
                    for material in subtitle_materials.values():
                        content = material.get('content', {})
                        was_string = isinstance(content, str)
                        if was_string:
                            try:
                                content = json.loads(content)
                            except json.JSONDecodeError:
                                continue
                        if not isinstance(content, dict):
                            continue
                        styles = content.get('styles', [])
                        if not isinstance(styles, list) or not styles:
                            continue
                        for style in styles:
                            if isinstance(style, dict):
                                style['font'] = tpl_font
                        material['content'] = json.dumps(content, ensure_ascii=False, separators=(',', ':')) if was_string else content
                        changed_materials += 1
                    restored_tracks += self._set_subtitle_tracks_hidden(data, False)
                self._chk()
                backups = self._save_subtitle_jsons(subtitle_jsons)
                self._log(f'  ✓ {fn} 字体已统一并解除隐藏 (字幕 {changed_materials} 条，轨道 {restored_tracks} 条，备份 {len(backups)} 份)')
                ok += 1
            except Exception as e:
                if '用户中断' in str(e):
                    self._log('统一字体已中断')
                    self.status.configure(text='已中断')
                    return
                self._log(f'  ✗ {fn} 失败: {e}')
        self._log(f'完成，共处理 {ok} 个草稿')
        self._show_toast('处理完成', f'成功统一 {ok} 个草稿字体\n使用: {font_path}', C_SUCCESS, 6000)

    def _load_plain_draft_json(self, path):
        try:
            with open(path, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    @staticmethod
    def _jianying_is_running():
        try:
            result = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq JianyingPro.exe', '/NH'], capture_output=True, text=True, errors='ignore', creationflags=134217728, timeout=5)
            return 'JianyingPro.exe' in result.stdout
        except Exception:
            return False

    def _encrypted_draft_io(self):
        draft_io = getattr(self, '_jianying_draft_io', None)
        if draft_io is None:
            draft_io = JianyingDraftIO()
            self._jianying_draft_io = draft_io
            self._log(f'  · 已加载剪映草稿接口: {draft_io.dll_path}')
        return draft_io

    @staticmethod
    def _subtitle_materials(data):
        """返回有明确字幕证据的文字材料，排除标题、贴纸文字等普通文本。"""
        result = {}
        for material in data.get('materials', {}).get('texts', []):
            material_id = material.get('id')
            if not material_id:
                continue
            material_type = str(material.get('type', '')).strip().lower()
            recognized = material.get('recognize_text')
            has_recognized_text = isinstance(recognized, str) and bool(recognized.strip())
            if material_type == 'subtitle' or has_recognized_text:
                result[material_id] = material
        return result

    @classmethod
    def _subtitle_tracks(cls, data):
        subtitle_ids = set(cls._subtitle_materials(data))
        if not subtitle_ids:
            return []
        tracks = []
        for track in data.get('tracks', []):
            if track.get('type') != 'text':
                continue
            if any((segment.get('material_id') in subtitle_ids for segment in track.get('segments', []))):
                tracks.append(track)
        return tracks

    def _find_subtitle_jsons(self, draft_dir):
        candidates = [os.path.join(draft_dir, 'draft_content.json')]
        timelines_dir = os.path.join(draft_dir, 'Timelines')
        if os.path.isdir(timelines_dir):
            for timeline_id in sorted(os.listdir(timelines_dir)):
                timeline_dir = os.path.join(timelines_dir, timeline_id)
                if not os.path.isdir(timeline_dir):
                    continue
                candidates.append(os.path.join(timeline_dir, 'draft_content.json'))
        subtitle_jsons, encoded_drafts, load_errors, seen = ([], [], [], set())
        for path in candidates:
            norm = os.path.normcase(os.path.abspath(path))
            if norm in seen or not os.path.isfile(path):
                continue
            seen.add(norm)
            data = self._load_plain_draft_json(path)
            storage = 'plain'
            if data is None:
                try:
                    data = self._encrypted_draft_io().read_json(path)
                    storage = 'encrypted'
                    encoded_drafts.append(path)
                except Exception as exc:
                    load_errors.append(f'{path}: {exc}')
                    continue
            if self._subtitle_tracks(data):
                subtitle_jsons.append((path, data, storage))
        if not subtitle_jsons and load_errors:
            raise RuntimeError('；'.join(load_errors))
        return (subtitle_jsons, encoded_drafts)

    def _subtitle_lines(self, data):
        text_by_id = self._subtitle_materials(data)
        segments = []
        for track in self._subtitle_tracks(data):
            segments.extend(track.get('segments', []))
        segments.sort(key=lambda x: x.get('target_timerange', {}).get('start', 0))
        lines = []
        for segment in segments:
            material = text_by_id.get(segment.get('material_id'))
            if not material:
                continue
            content = material.get('content', {})
            if isinstance(content, str):
                try:
                    content = json.loads(content)
                except json.JSONDecodeError:
                    content = {'text': content}
            text = content.get('text', '') if isinstance(content, dict) else ''
            text = text or material.get('recognize_text', '') or material.get('base_content', '')
            if not isinstance(text, str) or not text.strip():
                continue
            timerange = segment.get('target_timerange', {})
            start = int(timerange.get('start', 0))
            duration = int(timerange.get('duration', 0))
            lines.extend([str(len(lines) // 4 + 1), f'{fmt_time(start)} --> {fmt_time(start + duration)}', text.strip(), ''])
        return lines

    def _set_subtitle_tracks_hidden(self, data, hidden=True):
        subtitle_tracks = self._subtitle_tracks(data)
        for track in subtitle_tracks:
            for segment in track.get('segments', []):
                segment['visible'] = not hidden
        return len(subtitle_tracks)

    def _save_subtitle_jsons(self, subtitle_jsons):
        stamp = time.strftime('%Y%m%d_%H%M%S') + f'_{int(time.time() * 1000) % 1000:03d}'
        backups = []
        try:
            for path, _, _ in subtitle_jsons:
                self._chk()
                backup = f'{path}.before_subtitle_{stamp}.bak'
                shutil.copy2(path, backup)
                backups.append((path, backup))
            for path, data, storage in subtitle_jsons:
                self._chk()
                if storage == 'encrypted':
                    self._encrypted_draft_io().write_json(path, data)
                    verified = self._encrypted_draft_io().read_json(path)
                else:
                    temp_path = f'{path}.subtitle.tmp'
                    try:
                        with open(temp_path, 'w', encoding='utf-8') as f:
                            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
                        os.replace(temp_path, path)
                    finally:
                        if os.path.exists(temp_path):
                            os.remove(temp_path)
                    verified = self._load_plain_draft_json(path)
                if verified != data:
                    raise RuntimeError(f'写入后校验不一致，已回滚: {path}')
        except Exception:
            for path, backup in backups:
                if os.path.exists(backup):
                    shutil.copy2(backup, path)
            raise
        return [backup for _, backup in backups]

    def _extract_subs(self):
        self._log('提取字幕...')
        if self._jianying_is_running():
            self._log('✗ 请先完全退出剪映，再提取并隐藏字幕')
            self._show_toast('剪映仍在运行', '请完全退出剪映后重试', C_WARN, 6000)
            return
        base = self.draft_dir.get()
        if not os.path.exists(base):
            self._log('✗ 目录不存在')
            return
        out = self.subtitle_output
        os.makedirs(out, exist_ok=True)
        items = []
        for name in os.listdir(base):
            draft_dir = os.path.join(base, name)
            if os.path.isdir(draft_dir) and name != 'srt':
                items.append((name, draft_dir))
        ok = 0
        failed = 0
        for name, draft_dir in items:
            try:
                self._chk()
                subtitle_jsons, encoded_drafts = self._find_subtitle_jsons(draft_dir)
                if not subtitle_jsons:
                    continue
                if encoded_drafts:
                    self._log(f'  · {name} 已通过剪映接口解密 {len(encoded_drafts)} 份 draft_content.json')
                lines = self._subtitle_lines(subtitle_jsons[0][1])
                if not lines:
                    raise ValueError('检测到文字轨道，但没有可提取的字幕文本')
                srt_path = os.path.join(out, f'{name}.srt')
                srt_temp = f'{srt_path}.tmp'
                with open(srt_temp, 'w', encoding='utf-8') as f:
                    f.write('\n'.join(lines))
                os.replace(srt_temp, srt_path)
                hidden_track_copies = 0
                for _, data, _ in subtitle_jsons:
                    hidden_track_copies += self._set_subtitle_tracks_hidden(data, True)
                self._chk()
                backups = self._save_subtitle_jsons(subtitle_jsons)
                self._log(f'  ✓ {name} → {os.path.basename(srt_path)} (同步 {len(subtitle_jsons)} 份，隐藏 {hidden_track_copies} 条字幕轨道副本，备份 {len(backups)} 份)')
                ok += 1
            except Exception as e:
                if '用户中断' in str(e):
                    self._log('字幕提取与隐藏已中断')
                    self.status.configure(text='已中断')
                    return
                self._log(f'  ✗ {name}: {e}')
                failed += 1
        self._log(f'完成，成功提取并隐藏 {ok} 个，失败 {failed} 个')
        if failed:
            self._show_toast('部分处理失败', f'成功 {ok} 个，失败 {failed} 个\n请查看日志，失败草稿已自动回滚', C_WARN, 8000)
        else:
            self._show_toast('提取完成', f'共处理 {ok} 个草稿\n字幕已保存至桌面/srt，原轨道已隐藏', C_SUCCESS, 6000)

    def _regex_preview_thread(self):
        self._chk()
        folder = self.rename_folder_entry.get().strip().strip('"')
        template = self.fmt_entry.get().strip()
        if not folder:
            self._show_toast('提示', '请先选择目标文件夹', C_WARN)
            return
        if not os.path.isdir(folder):
            self._show_toast('路径错误', '目标文件夹不存在', C_WARN)
            return
        parsed = _rename_parse_template(template)
        if not parsed:
            self._show_toast('模板错误', '模板必须包含一个数字，例如：短剧名称_第1集', C_WARN)
            return
        prefix, suffix = parsed
        self.rename_folder = folder
        plan, skipped_duplicates, skipped_without_number = _rename_plan(folder, prefix, suffix)
        self._chk()
        self.rename_plan = []
        for old_name, new_name in plan:
            source = os.path.join(folder, old_name)
            target = os.path.join(folder, new_name)
            self.rename_plan.append({'source': source, 'target': target, 'old_name': old_name, 'new_name': new_name, 'mode': '正则匹配'})
        self._js('renderRenamePlan', self.rename_plan)
        if skipped_duplicates:
            self._log('【正则匹配】检测到重复集数，以下文件跳过：')
            for old_name, target in skipped_duplicates:
                self._log(f'  {old_name} -> {target}')
        if skipped_without_number:
            self._log('【正则匹配】以下文件名没有识别到集数，已跳过：')
            for filename in skipped_without_number:
                self._log(f'  {filename}')
        if not self.rename_plan:
            self._show_toast('没有可改名文件', '【正则匹配】没有生成有效的重命名计划', C_WARN)
            return
        self._log(f'✓ 【正则匹配重命名】预览完成，共 {len(self.rename_plan)} 个文件')

    def _ai_preview_thread(self):
        if not getattr(self, 'sel_files', None):
            folder = self.rename_folder_entry.get().strip().strip('"')
            if folder and os.path.isdir(folder):
                self.load_folder_for_ai(folder)
            if not getattr(self, 'sel_files', None):
                self._show_toast('提示', '请先选择视频/字幕文件或载入文件夹', C_WARN)
                return
        self.ai_preview_btn.configure(state='disabled')
        self._begin_operation(self._ai_preview)

    def _ai_preview(self):
        self._log('【AI 智能重命名】开始分析...')
        fns = [os.path.basename(f) for f in self.sel_files]
        fmt = self.ai_fmt_entry.get().strip() or '短剧名称_第X集'
        prompt = f"Rename these files to: {fmt}\nFiles: {json.dumps(fns, ensure_ascii=False)}\nReturn ONLY raw JSON array with 'old' and 'new' keys."
        try:
            self._chk()
            t = self._generate_ai_text(prompt)
            self._chk()
            t = t.strip()
            for pfx in ['```json', '```']:
                if t.startswith(pfx):
                    t = t[len(pfx):]
            if t.endswith('```'):
                t = t[:-3]
            data = json.loads(t.strip())
            self._chk()
            self._fill_ai_ren(data)
        except Exception as e:
            if '用户中断' in str(e):
                self._log('AI 重命名已中断，返回结果已丢弃')
                self.ai_preview_btn.configure(state='normal')
                return
            msg = self._get_api_err_msg(e)
            self._log(f'✗ 【AI 重命名失败】{msg}')
            self._show_toast('AI 重命名失败', msg, C_DANGER, 6000)
            self.ai_preview_btn.configure(state='normal')

    def _fill_ai_ren(self, data):
        self.ai_preview_btn.configure(state='normal')
        dm = {os.path.basename(f): os.path.dirname(f) for f in self.sel_files}
        self.rename_plan = []
        for it in data:
            o, n = (it.get('old'), it.get('new'))
            if o and n and (o in dm):
                d = dm[o]
                source = os.path.join(d, o)
                target = os.path.join(d, n)
                self.rename_plan.append({'source': source, 'target': target, 'old_name': o, 'new_name': n, 'mode': 'AI重命名'})
        self._js('renderRenamePlan', self.rename_plan)
        if self.rename_plan:
            self._log(f'✓ 【AI 智能重命名】预览已生成，共 {len(self.rename_plan)} 个文件')
        else:
            self._show_toast('AI 未返回匹配文件', '未能成功生成匹配规则，请检查格式或文件列表', C_WARN)

    def _do_exec_rename(self):
        if not self.rename_plan:
            return
        ok = 0
        skipped = 0
        errors = 0
        total = len(self.rename_plan)
        current_mode = self.ren_mode_val
        for item in self.rename_plan:
            try:
                self._chk()
            except Exception as exc:
                if '用户中断' in str(exc):
                    self._log(f'【{current_mode}】已中断，已完成 {ok}/{total} 个')
                    self.status.configure(text='已中断')
                    return
                raise
            source = item['source']
            target = item['target']
            old_name = item['old_name']
            new_name = item['new_name']
            if source == target or old_name == new_name:
                continue
            if os.path.exists(target):
                skipped += 1
                self._log(f'  跳过，目标已存在：{new_name}')
                continue
            try:
                os.rename(source, target)
                ok += 1
            except OSError as exc:
                errors += 1
                self._log(f'  ✗ {old_name}: {exc}')
        self._show_toast(f'【{current_mode}】完成' if not errors else f'【{current_mode}】部分完成', f'成功 {ok}/{total} 个，已存在 {skipped} 个，失败 {errors} 个', C_SUCCESS if not errors else C_WARN)
        self.rename_plan = []
        self.sel_files = []
        self.file_lbl.configure(text='未选择')
        self._js('renderRenamePlan', [])
