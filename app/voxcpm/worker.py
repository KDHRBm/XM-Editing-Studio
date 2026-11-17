"""XM local VoxCPM adapter. No public listener; one owned process per operation."""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

PREFIX = '@XMVOX@'

def emit(stage, message, **values):
    print(PREFIX + json.dumps(dict(stage=stage, message=message, **values), ensure_ascii=False), flush=True)

def save_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, path)

def under(root, relative):
    path = (Path(root) / relative).resolve()
    if not path.is_relative_to(Path(root).resolve()):
        raise ValueError('文件路径超出语音数据目录')
    return path

def configure(root):
    root.mkdir(parents=True, exist_ok=True)
    for key, sub in {'HF_HOME':'cache/huggingface', 'MODELSCOPE_CACHE':'cache/modelscope',
                     'TORCH_HOME':'cache/torch', 'XDG_CACHE_HOME':'cache', 'TEMP':'temp', 'TMP':'temp',
                     'NUMBA_CACHE_DIR':'cache/numba', 'MPLCONFIGDIR':'cache/matplotlib',
                     'GRADIO_TEMP_DIR':'temp/gradio'}.items():
        folder = root / sub
        folder.mkdir(parents=True, exist_ok=True)
        os.environ[key] = str(folder)
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['DO_NOT_TRACK'] = '1'

def digest(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

def download_file(url, target, size, sha, offset=0, total=0):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size == size and digest(target) == sha:
        emit('download', '已校验 ' + target.name, completed=offset+size, total=total)
        return
    partial = target.with_suffix(target.suffix + '.part')
    start_time = time.monotonic()
    initial = partial.stat().st_size if partial.exists() else 0
    for attempt in range(3):
        start = partial.stat().st_size if partial.exists() else 0
        if start >= size:
            if start == size and digest(partial) == sha:
                os.replace(partial, target)
                return
            partial.unlink(); start = 0
        request = urllib.request.Request(url, headers={'User-Agent':'XM-Editing-Studio/1.6.3', **({'Range':f'bytes={start}-'} if start else {})})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                if start and response.status != 206:
                    start = 0; initial = 0
                elif start and not response.headers.get('Content-Range', '').startswith(f'bytes {start}-'):
                    raise ValueError('下载续传位置不一致')
                received, last = start, 0.0
                with partial.open('ab' if start else 'wb') as dest:
                    while chunk := response.read(1024*1024):
                        dest.write(chunk); received += len(chunk)
                        if received > size:
                            raise ValueError('下载文件大小异常')
                        now = time.monotonic()
                        if now-last > .6:
                            rate = max(0, received-initial)/max(.01, now-start_time)
                            emit('download', '正在下载 '+target.name, completed=offset+received, total=total,
                                 speed=rate, remaining=(size-received)/rate if rate else None)
                            last = now
            if partial.stat().st_size != size:
                raise ValueError('下载尚未完整，请重试以继续下载')
            emit('verify', '正在校验 '+target.name, completed=offset+size, total=total)
            if digest(partial) != sha:
                partial.unlink()
                raise ValueError('模型校验失败，重新下载')
            os.replace(partial, target)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1+attempt)

def install_model(root):
    catalog = json.loads(Path(__file__).with_name('model-files.json').read_text(encoding='utf-8-sig'))
    total = sum(f['Size'] for f in catalog)
    offset = 0
    for f in catalog:
        path = under(root / 'models' / 'VoxCPM2', f['Path'])
        url = 'https://modelscope.cn/models/OpenBMB/VoxCPM2/resolve/master/' + urllib.parse.quote(f['Path'])
        download_file(url, path, f['Size'], f['Sha256'], offset, total)
        offset += f['Size']
    save_json(root / 'model-ready.json', {'model':'OpenBMB/VoxCPM2', 'files':catalog, 'bytes':total})
    emit('complete', 'VoxCPM2 模型已下载并校验完成', completed=total, total=total)

def validate_request(value):
    mode = value.get('mode', 'design')
    if mode not in ('design','clone','ultimate'):
        raise ValueError('请选择有效的语音模式')
    text = str(value.get('text','')).strip()
    if not text or len(text) > 1500:
        raise ValueError('请输入 1–1500 字的配音文本，长文请分段生成')
    control = str(value.get('control','')).strip()
    if len(control) > 500:
        raise ValueError('声音描述不能超过 500 字')
    ref = str(value.get('reference','')).strip()
    prompt = str(value.get('prompt','')).strip()
    if mode != 'design' and not ref:
        raise ValueError('请先选择参考音频')
    if mode == 'ultimate' and (not prompt or len(prompt) > 1500):
        raise ValueError('极致克隆需要填写参考音频的准确文字（最多 1500 字）')
    device = value.get('device','auto')
    if device not in ('auto','cuda','cpu'):
        raise ValueError('无效的推理设备')
    steps = int(value.get('steps',10)); cfg = float(value.get('cfg',2)); seed=int(value.get('seed',-1))
    if not 1 <= steps <= 50 or not 1 <= cfg <= 3 or not -1 <= seed <= 2147483647:
        raise ValueError('生成参数超出范围')
    return dict(mode=mode, text=text, control=control, reference=ref, prompt=prompt,
                device=device, steps=steps, cfg=cfg, seed=seed,
                normalize=bool(value.get('normalize')), denoise=bool(value.get('denoise')))

def reference_audio(root, filename):
    import soundfile as sf
    import librosa
    import numpy as np
    path = Path(filename)
    if not path.is_file() or path.stat().st_size > 100*1024*1024:
        raise ValueError('参考音频不存在或超过 100MB')
    # libsndfile reads WAV/FLAC/MP3 without spawning another process.
    data, rate = sf.read(str(path), dtype='float32', always_2d=True)
    seconds = len(data)/rate
    if not .5 <= seconds <= 30:
        raise ValueError('参考音频需在 0.5–30 秒之间，建议使用 3–15 秒清晰人声')
    audio = np.mean(data, axis=1)
    if rate != 16000:
        audio = librosa.resample(audio, orig_sr=rate, target_sr=16000)
    target = root / 'temp' / 'reference.wav'
    sf.write(str(target), audio, 16000)
    return str(target)

def optional_model(root, model_id, folder):
    from modelscope import snapshot_download
    emit('download-extra', '正在准备'+folder+'模型，首次使用需要下载…')
    target = root / 'models' / folder
    snapshot_download(model_id, local_dir=str(target))
    return str(target)

def transcribe(root, value):
    reference = reference_audio(root, value.get('reference',''))
    path = optional_model(root, 'iic/SenseVoiceSmall', 'SenseVoiceSmall')
    from funasr import AutoModel
    emit('transcribe', '正在识别参考音频文字…')
    model = AutoModel(model=path, device='cpu', disable_update=True, trust_remote_code=False)
    result = model.generate(input=reference, cache={}, language='auto', use_itn=True)
    text = re.sub(r'<\|.*?\|>', '', result[0]['text']).strip()
    emit('complete', '参考音频识别完成', transcript=text)

def generate(root, value):
    request = validate_request(value)
    import torch
    import soundfile as sf
    import numpy as np
    from voxcpm import VoxCPM
    model_path = root / 'models' / 'VoxCPM2'
    if not (root / 'model-ready.json').exists():
        raise ValueError('请先完成 VoxCPM2 本地部署')
    device = request['device']
    if device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    if device == 'cuda':
        if not torch.cuda.is_available():
            raise ValueError('CUDA 不可用，请更新显卡驱动或选择 CPU')
        free,_ = torch.cuda.mem_get_info()
        if free < 5700*1024*1024:
            raise ValueError('空闲显存不足 5.7GB。请先在本地部署中释放其他模型显存，或选择 CPU。')
    reference = reference_audio(root, request['reference']) if request['mode'] != 'design' else None
    denoiser = optional_model(root, 'iic/speech_zipenhancer_ans_multiloss_16k_base','ZipEnhancer') if reference and request['denoise'] else None
    emit('loading', '正在加载 VoxCPM2 · '+('显卡推理' if device=='cuda' else 'CPU 推理（耗时较长）'))
    model = VoxCPM.from_pretrained(str(model_path), load_denoiser=bool(denoiser), zipenhancer_model_id=denoiser,
                                  optimize=False, device=device, local_files_only=True)
    text = request['text']
    if request['mode'] != 'ultimate' and request['control']:
        control = re.sub(r'[()（）]', '', request['control'])
        text = '('+control+')'+text
    params = dict(text=text, cfg_value=request['cfg'], inference_timesteps=request['steps'],
                  normalize=request['normalize'], denoise=bool(denoiser), max_len=1800,
                  seed=request['seed'] if request['seed'] >= 0 else None)
    if reference:
        params['reference_wav_path'] = reference
    if request['mode'] == 'ultimate':
        params.update(prompt_wav_path=reference, prompt_text=request['prompt'])
    emit('generating', '正在合成语音…', audioSeconds=0)
    chunks=[]; samples=0; sample_rate=model.tts_model.sample_rate; start=time.monotonic(); last=0
    for chunk in model.generate_streaming(**params):
        chunks.append(chunk); samples += len(chunk)
        if time.monotonic()-last >= .5:
            emit('generating', '正在合成语音…', audioSeconds=round(samples/sample_rate,1), elapsed=round(time.monotonic()-start,1))
            last=time.monotonic()
    if not samples:
        raise ValueError('模型未生成音频，请缩短文本后重试')
    wav = np.concatenate(chunks)
    if not np.isfinite(wav).all():
        raise ValueError('生成音频无效，请重试')
    import uuid
    output_id = time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]
    (root / 'outputs').mkdir(exist_ok=True)
    target = root / 'outputs' / (output_id+'.wav')
    sf.write(str(target.with_suffix('.tmp')), wav, sample_rate, format='WAV', subtype='PCM_16')
    os.replace(target.with_suffix('.tmp'), target)
    metadata=dict(id=output_id, title=request['text'][:60], mode=request['mode'], duration=samples/sample_rate,
                  sampleRate=sample_rate, createdAt=time.strftime('%Y-%m-%d %H:%M:%S'), device=device)
    save_json(target.with_suffix('.json'), metadata)
    emit('complete', '语音已生成并保存', result=metadata)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--root',required=True)
    parser.add_argument('--action',choices=['install-model','generate','transcribe'],required=True)
    parser.add_argument('--request')
    args=parser.parse_args(); root=Path(args.root).resolve(); configure(root)
    value=json.loads(Path(args.request).read_text(encoding='utf-8-sig')) if args.request else {}
    if args.action=='install-model': install_model(root)
    elif args.action=='transcribe': transcribe(root,value)
    else: generate(root,value)

if __name__=='__main__':
    try: main()
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit('error',str(error))
        sys.exit(1)
