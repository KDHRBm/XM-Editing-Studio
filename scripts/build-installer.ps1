param(
  [string]$Version = '',
  [string]$PackagedDir = '',
  [string]$OutputDir = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$product = [regex]::Unescape('XM\u526A\u8F91\u53F0')
$guide = [regex]::Unescape('\u4F7F\u7528\u8BF4\u660E.txt')
if (-not $Version) { $Version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version }
if (-not $PackagedDir) { $PackagedDir = Join-Path $root ('artifacts\' + $product + '-win32-x64') }
if (-not $OutputDir) { $OutputDir = Join-Path $root 'artifacts\release-1.4.0' }
$packaged = (Resolve-Path -LiteralPath $PackagedDir).Path.TrimEnd('\')
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$output = Join-Path $OutputDir "XM-Editing-Studio-$Version-Windows-x64-Setup.exe"
$installer = Join-Path $root 'packaging\installer'
$generated = @('generated-config.nsh','generated-install.nsh','generated-uninstall.nsh','generated-uninstall-dirs.nsh')
$encoding = New-Object System.Text.UTF8Encoding($true)
$files = Get-ChildItem -LiteralPath $packaged -Recurse -File | Sort-Object FullName
$dirs = Get-ChildItem -LiteralPath $packaged -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending
$size = [int][math]::Ceiling((($files | Measure-Object Length -Sum).Sum + (Get-Item (Join-Path $installer $guide)).Length) / 1024.0)
$versionParts = @($Version.Split('.'))
while ($versionParts.Count -lt 4) { $versionParts += '0' }
$config = @(
  "!define APP_VERSION `"$Version`"",
  "!define APP_FILE_VERSION `"$($versionParts[0..3] -join '.')`"",
  "!define OUTPUT_FILE `"$output`"",
  "!define APP_ICON `"$(Join-Path $root 'app\assets\app-icon.ico')`"",
  "!define INSTALLED_SIZE_KB $size"
)
$install = New-Object 'System.Collections.Generic.List[string]'
$uninstall = New-Object 'System.Collections.Generic.List[string]'
$uninstallDirs = New-Object 'System.Collections.Generic.List[string]'
$lastDir = ''
foreach ($file in $files) {
  $relative = $file.FullName.Substring($packaged.Length + 1)
  $relativeDir = Split-Path -Parent $relative
  $target = if ($relativeDir) { "`$INSTDIR\$relativeDir" } else { '$INSTDIR' }
  if ($target -ne $lastDir) { $install.Add("SetOutPath `"$target`""); $lastDir = $target }
  $install.Add("File `"$($file.FullName)`"")
  $uninstall.Add("Delete `"`$INSTDIR\$relative`"")
}
$install.Add('SetOutPath "$INSTDIR"')
$install.Add("File `"$(Join-Path $installer $guide)`"")
$uninstall.Add("Delete `"`$INSTDIR\$guide`"")
foreach ($dir in $dirs) { $uninstallDirs.Add("RMDir `"`$INSTDIR\$($dir.FullName.Substring($packaged.Length + 1))`"") }
$makensis = Join-Path $root '..\installer-tools\nsis\makensis.exe'
if (-not (Test-Path -LiteralPath $makensis)) { throw "NSIS not found: $makensis" }
try {
  [IO.File]::WriteAllLines((Join-Path $installer $generated[0]), $config, $encoding)
  [IO.File]::WriteAllLines((Join-Path $installer $generated[1]), $install, $encoding)
  [IO.File]::WriteAllLines((Join-Path $installer $generated[2]), $uninstall, $encoding)
  [IO.File]::WriteAllLines((Join-Path $installer $generated[3]), $uninstallDirs, $encoding)
  & $makensis /V2 /INPUTCHARSET UTF8 (Join-Path $installer 'setup.nsi')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) { throw 'Installer build failed.' }
} finally {
  foreach ($name in $generated) { Remove-Item -LiteralPath (Join-Path $installer $name) -Force -ErrorAction SilentlyContinue }
}
$digest = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $OutputDir 'SHA256SUMS.txt'), "$digest  $(Split-Path $output -Leaf)`n", (New-Object System.Text.UTF8Encoding($false)))
Get-Item -LiteralPath $output | Select-Object FullName,Length
