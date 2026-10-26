param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required on Windows x64.' }
    $helperDirectory = Join-Path $repoRoot '.generated/native/helpers'
    New-Item -ItemType Directory -Path $helperDirectory -Force | Out-Null
    $helper = Join-Path $helperDirectory 'PeriodKeeper.exe'
    $source = Join-Path $repoRoot 'app/native/PeriodKeeper.cs'
    & $compiler /nologo /target:exe /platform:x64 /optimize+ /r:System.Web.Extensions.dll ('/out:' + $helper) $source
    if ($LASTEXITCODE -ne 0) { throw 'Punctuation helper compilation failed.' }
    $hash = (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $repoRoot 'app/electron/period-helper-integrity.mjs'), "export const HELPER_SHA256 = '$hash';`n", (New-Object Text.UTF8Encoding $false))
    & $Python -m PyInstaller --noconfirm --clean --onefile --console --name JianYingEngine --paths app/native/jianying --collect-all cv2 --collect-all pynput --distpath .generated/native-engine --workpath .generated/pyinstaller --specpath .generated app/native/jianying/engine.py
    if ($LASTEXITCODE -ne 0) { throw 'Python engine compilation failed. Install scripts/requirements-native.txt first.' }
    & $Python scripts/stage-native.py
    if ($LASTEXITCODE -ne 0) { throw 'Native engine staging failed.' }
} finally { Pop-Location }
