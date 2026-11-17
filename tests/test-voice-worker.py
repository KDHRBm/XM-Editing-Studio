import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('voice_worker',Path(__file__).resolve().parents[1]/'app/voxcpm/worker.py')
worker=importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)

class Response(io.BytesIO):
    def __init__(self,data,status=200,headers=None): super().__init__(data); self.status=status; self.headers=headers or {}

class VoiceWorkerTests(unittest.TestCase):
    def test_three_modes_and_limits(self):
        self.assertEqual(worker.validate_request({'text':'你好'})['mode'],'design')
        self.assertEqual(worker.validate_request({'mode':'clone','text':'Hello','reference':'a.wav'})['reference'],'a.wav')
        self.assertEqual(worker.validate_request({'mode':'ultimate','text':'Hola','reference':'a.wav','prompt':'原文'})['prompt'],'原文')
        for bad in ({'text':''},{'text':'a'*1501},{'text':'a','mode':'bad'},{'text':'a','mode':'clone'},
                    {'text':'a','mode':'ultimate','reference':'a.wav'},{'text':'a','steps':51},
                    {'text':'a','cfg':float('nan')},{'text':'a','device':'remote'}):
            with self.assertRaises(ValueError): worker.validate_request(bad)

    def test_paths_reject_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):worker.under(tmp,'../outside.wav')
            self.assertEqual(worker.under(tmp,'a.wav').parent,Path(tmp).resolve())

    def test_atomic_download_resume_and_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'weights.bin'; payload=b'abcdefgh'; sha=worker.hashlib.sha256(payload).hexdigest()
            partial=target.with_suffix('.bin.part'); partial.write_bytes(payload[:3])
            def request(req,timeout):
                self.assertEqual(req.headers['Range'],'bytes=3-')
                return Response(payload[3:],206,{'Content-Range':'bytes 3-7/8'})
            with patch.object(worker.urllib.request,'urlopen',request):worker.download_file('https://example.test/model',target,len(payload),sha)
            self.assertEqual(target.read_bytes(),payload); self.assertFalse(partial.exists())
            with patch.object(worker.urllib.request,'urlopen',side_effect=AssertionError('Already downloaded')):
                worker.download_file('https://example.test/model',target,len(payload),sha)

    def test_server_ignores_range_restarts_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'weights.bin'; target.with_suffix('.bin.part').write_bytes(b'old')
            payload=b'new file'
            with patch.object(worker.urllib.request,'urlopen',return_value=Response(payload)):
                worker.download_file('https://example.test/model',target,len(payload),worker.hashlib.sha256(payload).hexdigest())
            self.assertEqual(target.read_bytes(),payload)

    def test_wrong_hash_never_becomes_installed_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'weights.bin'
            with patch.object(worker.urllib.request,'urlopen',side_effect=lambda *a,**k:Response(b'bad')),patch.object(worker.time,'sleep'):
                with self.assertRaises(ValueError):worker.download_file('https://example.test/model',target,3,'0'*64)
            self.assertFalse(target.exists())

    def test_catalog_contains_only_pinned_official_files(self):
        catalog=json.loads(Path(worker.__file__).with_name('model-files.json').read_text())
        self.assertIn('model.safetensors',[item['Path'] for item in catalog])
        for item in catalog:
            self.assertNotIn('..',item['Path']); self.assertRegex(item['Sha256'],r'^[a-f0-9]{64}$')
            self.assertGreater(item['Size'],0)

    def test_generation_maps_modes_and_saves_only_complete_result(self):
        calls=[]
        class Model:
            tts_model=SimpleNamespace(sample_rate=48000)
            def generate_streaming(self,**params):calls.append(params);yield [0.1]*32
        fake_torch=SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:True,mem_get_info=lambda:(8*1024**3,8*1024**3)))
        modules={'torch':fake_torch,'numpy':SimpleNamespace(concatenate=lambda x:sum(x,[]),isfinite=lambda x:SimpleNamespace(all=lambda:True)),
                 'soundfile':SimpleNamespace(write=lambda path,*a,**k:Path(path).write_bytes(b'RIFF-fixture')),
                 'voxcpm':SimpleNamespace(VoxCPM=SimpleNamespace(from_pretrained=lambda *a,**k:Model()))}
        with tempfile.TemporaryDirectory() as tmp,patch.dict(worker.sys.modules,modules),patch.object(worker,'reference_audio',return_value='normalized.wav'):
            root=Path(tmp);worker.configure(root);(root/'model-ready.json').write_text('{}')
            worker.generate(root,{'mode':'design','text':'你好','control':'(温柔)女声'})
            self.assertEqual(calls[-1]['text'],'(温柔女声)你好')
            worker.generate(root,{'mode':'ultimate','text':'Hola','reference':'ref.wav','prompt':'原文','control':'ignored'})
            self.assertEqual(calls[-1]['text'],'Hola');self.assertEqual(calls[-1]['prompt_text'],'原文')
            self.assertEqual(calls[-1]['prompt_wav_path'],calls[-1]['reference_wav_path'])
            self.assertEqual(len(list((root/'outputs').glob('*.wav'))),2)
            self.assertEqual(len(list((root/'outputs').glob('*.json'))),2)

    def test_gpu_memory_error_is_actionable(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(worker.sys.modules,{'torch':SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:True,mem_get_info=lambda:(100,100))), 'soundfile':SimpleNamespace(),'numpy':SimpleNamespace(),'voxcpm':SimpleNamespace(VoxCPM=object)}):
            root=Path(tmp);(root/'model-ready.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'显存不足'):worker.generate(root,{'text':'测试'})

if __name__=='__main__':unittest.main()
