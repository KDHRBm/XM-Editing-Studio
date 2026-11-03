$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required on Windows x64.' }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    function Get-Sha256Hex([string]$filePath) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
    }

    # 1. Compile PeriodKeeper.exe (C# native clipboard helper)
    $helperDirectory = Join-Path $repoRoot '.generated/native/helpers'
    New-Item -ItemType Directory -Path $helperDirectory -Force | Out-Null
    $helper = Join-Path $helperDirectory 'PeriodKeeper.exe'
    $source = Join-Path $repoRoot 'app/native/PeriodKeeper.cs'
    & $compiler /nologo /utf8output /codepage:65001 /target:exe /platform:x64 /optimize+ /r:System.Web.Extensions.dll ('/out:' + $helper) $source
    if ($LASTEXITCODE -ne 0) { throw 'Punctuation helper compilation failed.' }

    # 2. Compile JianYingEngine.exe (Native C# automation & draft engine)
    $engineOutDir = Join-Path $repoRoot 'app/build/jianying'
    if (Test-Path -LiteralPath $engineOutDir) {
        Remove-Item -LiteralPath $engineOutDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $engineOutDir -Force | Out-Null
    $engineExe = Join-Path $engineOutDir 'JianYingEngine.exe'
    $engineSource = Join-Path $repoRoot 'app/native/JianYingEngine.cs'
    $engineScan = Join-Path $repoRoot 'app/native/JianYingScan.cs'
    $engineProgress = Join-Path $repoRoot 'app/native/JianYingProgress.cs'
    $engineAutomation = Join-Path $repoRoot 'app/native/JianYingAutomation.cs'
    $engineDraftIo = Join-Path $repoRoot 'app/native/JianYingDraftIO.cs'
    $enginePunctuation = Join-Path $repoRoot 'app/native/JianYingPunctuation.cs'
    & $compiler /nologo /utf8output /codepage:65001 /target:exe /platform:x64 /optimize+ `
        /r:System.Web.Extensions.dll `
        /r:System.Drawing.dll `
        /r:System.Windows.Forms.dll `
        ('/out:' + $engineExe) $engineSource $engineScan $engineProgress $engineAutomation $engineDraftIo $enginePunctuation
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $engineExe)) {
        throw 'JianYingEngine C# compilation failed.'
    }
    $engineHash = Get-Sha256Hex $engineExe
    $engineManifest = "{`n  `"sha256`": `"$engineHash`"`n}`n"
    [IO.File]::WriteAllText((Join-Path $engineOutDir 'engine.json'), $engineManifest, $utf8NoBom)

    # 3. Compile WatermarkEngine.exe (Native Windows Media Foundation hardware-accelerated watermarker)
    $wmOutDir = Join-Path $repoRoot 'app/build/watermark'
    if (Test-Path -LiteralPath $wmOutDir) {
        Remove-Item -LiteralPath $wmOutDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $wmOutDir -Force | Out-Null
    $wmExe = Join-Path $wmOutDir 'WatermarkEngine.exe'
    $wmSource = Join-Path $repoRoot 'app/native/WatermarkEngine.cs'
    & $compiler /nologo /utf8output /codepage:65001 /target:exe /platform:x64 /optimize+ `
        /r:System.Web.Extensions.dll `
        /r:System.Drawing.dll `
        ('/out:' + $wmExe) $wmSource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $wmExe)) {
        throw 'WatermarkEngine C# compilation failed.'
    }
    $wmHash = Get-Sha256Hex $wmExe
    $wmManifest = "{`n  `"sha256`": `"$wmHash`"`n}`n"
    [IO.File]::WriteAllText((Join-Path $wmOutDir 'engine.json'), $wmManifest, $utf8NoBom)
    if (Test-Path -LiteralPath (Join-Path $repoRoot 'app/public/watermark.png')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot 'app/public/watermark.png') -Destination (Join-Path $wmOutDir 'watermark.png') -Force
    }

    # 4. Compile XMStudioHost.exe (Native C# + Windows WebView2 Desktop Host)
    $hostOutDir = Join-Path $repoRoot 'app/build/host'
    New-Item -ItemType Directory -Path $hostOutDir -Force | Out-Null
    $hostExeName = [regex]::Unescape("\u5c0f\u9a6c\u526a\u8f91\u53f0.exe")
    $hostExe = Join-Path $hostOutDir $hostExeName
    $hostSource = Join-Path $repoRoot 'app/native/XMStudioHost.cs'
    $wvCore = Join-Path $repoRoot 'app/lib/webview2/Microsoft.Web.WebView2.Core.dll'
    $wvWinForms = Join-Path $repoRoot 'app/lib/webview2/Microsoft.Web.WebView2.WinForms.dll'
    $appIcon = Join-Path $repoRoot 'app/assets/app-icon.ico'
    & $compiler /nologo /utf8output /codepage:65001 /target:winexe /platform:x64 /optimize+ `
        /r:System.Web.Extensions.dll `
        /r:System.Drawing.dll `
        /r:System.Windows.Forms.dll `
        ('/r:' + $wvCore) `
        ('/r:' + $wvWinForms) `
        ('/win32icon:' + $appIcon) `
        ('/out:' + $hostExe) $hostSource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExe)) {
        throw 'XMStudioHost C# compilation failed.'
    }

    Write-Host "Native helpers built: PeriodKeeper.exe, JianYingEngine.exe ($((Get-Item $engineExe).Length) bytes), WatermarkEngine.exe ($((Get-Item $wmExe).Length) bytes), XMStudioHost ($((Get-Item $hostExe).Length) bytes)"
} finally { Pop-Location }
