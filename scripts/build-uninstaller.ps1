param([string]$Output = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Output) { $Output = Join-Path $root 'artifacts\XM-Editing-Studio-Uninstaller.exe' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler not found.' }
New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
& $compiler /nologo /utf8output /codepage:65001 /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$Output" (Join-Path $root 'packaging\uninstaller\XmUninstaller.cs')
if ($LASTEXITCODE -ne 0) { throw 'Uninstaller build failed.' }
Get-Item -LiteralPath $Output | Select-Object FullName, Length
