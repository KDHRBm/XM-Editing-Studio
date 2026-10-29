param([switch]$SkipRenderer, [string]$OutputDirectory = '')

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

Set-Location -LiteralPath $projectRoot

if (-not $SkipRenderer) { & node scripts/build.mjs; if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed' } }

& (Join-Path $PSScriptRoot 'build-native.ps1')

& node --input-type=module -e "import {build} from 'esbuild';await build({entryPoints:['app/native-host/native-bridge.mjs'],outfile:'app/dist/client/assets/native-bridge.js',bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true});"

if ($LASTEXITCODE -ne 0) { throw 'Native bridge build failed' }

Copy-Item -LiteralPath 'app/native-host/storage-migration.js' -Destination 'app/dist/client/assets/storage-migration.js' -Force

$nativeStage = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot 'artifacts/XM剪辑台-csharp-win32-x64' }

$webviewRoot = Join-Path $projectRoot '.generated/webview2-sdk'

$sdkArchive = Join-Path $webviewRoot 'sdk.zip'

$sdkHash = 'EF128016DD1E51C59178C827ED5B8AA3322C57AFA8675D930F8109505542AD74'

New-Item -ItemType Directory -Path $webviewRoot -Force | Out-Null

if (-not (Test-Path -LiteralPath $sdkArchive)) {

  Invoke-WebRequest -Uri 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.2903.40/microsoft.web.webview2.1.0.2903.40.nupkg' -OutFile $sdkArchive

}

if ((Get-FileHash -LiteralPath $sdkArchive -Algorithm SHA256).Hash -ne $sdkHash) { throw 'WebView2 SDK checksum mismatch' }

Expand-Archive -LiteralPath $sdkArchive -DestinationPath $webviewRoot -Force

New-Item -ItemType Directory -Path $nativeStage -Force | Out-Null

foreach ($name in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) { Copy-Item -LiteralPath (Join-Path $webviewRoot ('lib/net462/' + $name)) -Destination $nativeStage -Force }

Copy-Item -LiteralPath (Join-Path $webviewRoot 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $nativeStage -Force

foreach ($name in @('LICENSE.txt','NOTICE.txt')) { Copy-Item -LiteralPath (Join-Path $webviewRoot $name) -Destination (Join-Path $nativeStage ('WebView2-' + $name)) -Force }

$references = @('System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.Net.Http.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll',(Join-Path $nativeStage 'Microsoft.Web.WebView2.Core.dll'),(Join-Path $nativeStage 'Microsoft.Web.WebView2.WinForms.dll'))

$compilerArgs = @('/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output','/codepage:65001',('/out:' + (Join-Path $nativeStage '小马剪辑台.exe')),('/win32icon:' + (Join-Path $projectRoot 'app/assets/app-icon.ico')))

$compilerArgs += $references | ForEach-Object { '/reference:' + $_ }

$compilerArgs += Get-ChildItem -LiteralPath (Join-Path $projectRoot 'app/native-host') -Filter '*.cs' | ForEach-Object { $_.FullName }

& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' @compilerArgs

if ($LASTEXITCODE -ne 0) { throw 'C# host build failed' }

$nativeResources = Join-Path $nativeStage 'resources'

New-Item -ItemType Directory -Path $nativeResources -Force | Out-Null

$clientTarget = Join-Path $nativeResources 'client'

New-Item -ItemType Directory -Path $clientTarget -Force | Out-Null

Copy-Item -Path (Join-Path $projectRoot 'app/dist/client/*') -Destination $clientTarget -Recurse -Force

foreach ($file in @('jianying/JianYingEngine.exe','jianying/engine.json','watermark/WatermarkEngine.exe','watermark/engine.json','watermark/watermark.png')) {

  $target = Join-Path $nativeResources $file

  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null

  Copy-Item -LiteralPath (Join-Path $projectRoot ('app/build/' + $file)) -Destination $target -Force

}

New-Item -ItemType Directory -Path (Join-Path $nativeResources 'helpers') -Force | Out-Null

$periodOutput = Join-Path $nativeResources 'helpers/PeriodKeeper.exe'

& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll "/out:$periodOutput" (Join-Path $projectRoot 'app/native/PeriodKeeper.cs')

if ($LASTEXITCODE -ne 0) { throw 'Punctuation helper build failed' }

Copy-Item -LiteralPath (Join-Path $projectRoot 'app/assets/app-icon.ico') -Destination $nativeStage -Force

Copy-Item -LiteralPath (Join-Path $projectRoot 'app/THIRD_PARTY_NOTICES.txt') -Destination $nativeStage -Force

$periodHash = (Get-FileHash -LiteralPath (Join-Path $nativeResources 'helpers/PeriodKeeper.exe') -Algorithm SHA256).Hash.ToLowerInvariant()

@{version='1.4.2';architecture='C# + WebView2';periodSha256=$periodHash} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $nativeResources 'native-manifest.json') -Encoding utf8

if (-not (Test-Path -LiteralPath 'app/build/companion/xm-manifest.json')) { throw 'Build the complete companion first; see docs/COMPANION-INTEGRATION.md' }

& robocopy (Join-Path $projectRoot 'app/build/companion') (Join-Path $nativeResources 'companion') /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Companion copy failed' }

& node scripts/hash-native-stage.mjs $nativeStage

if ($LASTEXITCODE -ne 0) { throw 'Native package checksum generation failed' }

Write-Output "Native stage: $nativeStage"
