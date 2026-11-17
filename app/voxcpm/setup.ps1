param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
$OutputEncoding=[Console]::OutputEncoding
$Root=[IO.Path]::GetFullPath($Root)
New-Item -ItemType Directory -Path $Root -Force | Out-Null
foreach($name in @('cache','temp','python','models','outputs','jobs')){New-Item -ItemType Directory -Path (Join-Path $Root $name) -Force | Out-Null}
$env:UV_CACHE_DIR=Join-Path $Root 'cache\uv'
$env:UV_PYTHON_INSTALL_DIR=Join-Path $Root 'python'
$env:UV_PYTHON_BIN_DIR=Join-Path $Root 'bin'
$env:TEMP=Join-Path $Root 'temp'; $env:TMP=$env:TEMP
$env:PYTHONUTF8='1'; $env:PYTHONNOUSERSITE='1'; $env:UV_PYTHON_PREFERENCE='only-managed'
function Progress($message){Write-Output ('@XMVOX@'+(@{stage='runtime';message=$message}|ConvertTo-Json -Compress))}
$uv=Join-Path $Root 'uv.exe'
if(-not (Test-Path -LiteralPath $uv)){
  Progress '正在下载 Python 部署工具…'
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $zip=Join-Path $Root 'uv.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/astral-sh/uv/releases/download/0.13.8/uv-x86_64-pc-windows-msvc.zip' -OutFile $zip
  if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '529e78a9cec6cd7e3e014f7ecd8bda0c113969d4ed0f2efeedb85c30943325b8'){throw '部署工具校验失败，请重试。'}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($zip)
  try{$entry=$archive.Entries|Where-Object {$_.FullName -eq 'uv.exe'}; if(-not $entry){throw '部署工具不完整'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$uv)}finally{$archive.Dispose()}
}
Progress '正在安装独立 Python 3.11（保存在安装目录）…'
& $uv python install 3.11 --no-progress
if($LASTEXITCODE -ne 0){throw 'Python 下载失败，请检查网络后重试。'}
$venv=Join-Path $Root 'runtime'
if(-not(Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))){& $uv venv --python 3.11 $venv; if($LASTEXITCODE -ne 0){throw '无法创建独立运行环境'}}
$python=Join-Path $venv 'Scripts\python.exe'
Progress '正在安装 PyTorch GPU 推理组件，首次下载需要一些时间…'
& $uv pip install --python $python 'torch==2.8.0' 'torchaudio==2.8.0' --index-url 'https://download.pytorch.org/whl/cu128' --no-progress
if($LASTEXITCODE -ne 0){throw 'PyTorch 下载失败，请稍后重试。'}
Progress '正在安装 VoxCPM2 语音组件…'
& $uv pip install --python $python 'voxcpm==2.0.3' 'transformers==4.57.1' 'torchcodec==0.7.0' 'torch==2.8.0' 'torchaudio==2.8.0' --index-url 'https://pypi.org/simple' --no-progress
if($LASTEXITCODE -ne 0){throw 'VoxCPM 安装失败，请检查部署日志。'}
& $python -c 'from voxcpm import VoxCPM; import soundfile; import torch; print(torch.__version__)'
if($LASTEXITCODE -ne 0){throw '语音环境验证失败，请检查部署日志。'}
[IO.File]::WriteAllText((Join-Path $Root 'runtime-ready.json'),'{"version":"2.0.3","torch":"2.8.0"}',(New-Object Text.UTF8Encoding $false))
Progress '语音运行环境已就绪'
