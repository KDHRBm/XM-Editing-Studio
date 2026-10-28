param()
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
    $jianyingDir = Join-Path $repoRoot 'app/build/jianying'
    New-Item -ItemType Directory -Path $jianyingDir -Force | Out-Null
    $jianyingExe = Join-Path $jianyingDir 'JianYingEngine.exe'
    & $compiler /nologo /utf8output /codepage:65001 /target:exe /platform:x64 /optimize+ `
        /r:System.Web.Extensions.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
        ('/out:' + $jianyingExe) (Join-Path $repoRoot 'app/native/JianYingEngine.cs') (Join-Path $repoRoot 'app/native/JianYingScan.cs') (Join-Path $repoRoot 'app/native/JianYingProgress.cs') (Join-Path $repoRoot 'app/native/JianYingDraftIO.cs')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $jianyingExe)) { throw 'Native JianYing engine compilation failed.' }
    $jianyingHash = (Get-FileHash -LiteralPath $jianyingExe -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $jianyingDir 'engine.json'), "{`"sha256`":`"$jianyingHash`"}", (New-Object Text.UTF8Encoding $false))
    $watermarkDir = Join-Path $repoRoot 'app/build/watermark'
    New-Item -ItemType Directory -Path $watermarkDir -Force | Out-Null
    $watermarkExe = Join-Path $watermarkDir 'WatermarkEngine.exe'
    & $compiler /nologo /utf8output /codepage:65001 /target:exe /platform:x64 /optimize+ `
        /r:System.Web.Extensions.dll /r:System.Drawing.dll `
        ('/out:' + $watermarkExe) (Join-Path $repoRoot 'app/native/WatermarkEngine.cs')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $watermarkExe)) { throw 'Watermark engine compilation failed.' }
    $watermarkHash = (Get-FileHash -LiteralPath $watermarkExe -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $watermarkDir 'engine.json'), "{`"sha256`":`"$watermarkHash`"}", (New-Object Text.UTF8Encoding $false))
    Copy-Item -LiteralPath (Join-Path $repoRoot 'watermarker/public/watermark.png') -Destination (Join-Path $watermarkDir 'watermark.png') -Force
} finally { Pop-Location }
