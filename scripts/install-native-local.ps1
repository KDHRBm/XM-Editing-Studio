param(
  [Parameter(Mandatory=$true)][string]$TargetDirectory,
  [string]$ProfileDirectory = '',
  [string]$StageDirectory = '',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $StageDirectory) { $StageDirectory = Join-Path $repoRoot 'artifacts/XM剪辑台-csharp-win32-x64' }
if (-not $ProfileDirectory) {
  $ProfileDirectory = Join-Path $env:APPDATA 'xiaoma-editing-studio'
  $legacyProfile = Join-Path $env:APPDATA '黑曜信号台'
  if (-not (Test-Path -LiteralPath $ProfileDirectory) -and (Test-Path -LiteralPath $legacyProfile)) { $ProfileDirectory = $legacyProfile }
}
$target = [IO.Path]::GetFullPath($TargetDirectory).TrimEnd('\')
$stage = (Resolve-Path -LiteralPath $StageDirectory).Path.TrimEnd('\')
$profile = [IO.Path]::GetFullPath($ProfileDirectory).TrimEnd('\')
if ($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\') -or $target -eq $stage -or $stage.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation target' }
if ($target -match '(?i)fork|kirota' -or $profile -match '(?i)fork|kirota' -or (Test-Path -LiteralPath (Join-Path $target 'xm-fork-install.id'))) { throw 'Fork installation/profile must remain independent' }
$marker = Join-Path $target 'xiaoma-install.id'
if (-not (Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker).Trim() -ne 'xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885') { throw 'Unrecognized XM installation' }
$manifest = Get-Content -LiteralPath (Join-Path $stage 'native-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.architecture -ne 'csharp-webview2') { throw 'Not a native WebView2 build' }
& node (Join-Path $PSScriptRoot 'verify-native-stage.mjs') $stage
if ($LASTEXITCODE -ne 0) { throw 'Native package verification failed' }
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase) })
if (-not $Apply) { [pscustomobject]@{target=$target;architecture=$manifest.architecture;files=@($manifest.files.PSObject.Properties).Count;running=$running.Count;ready=($running.Count -eq 0)}; return }
if ($running.Count) { throw 'XM is running. Save work and completely exit from its tray before applying.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $target ('.xiaoma-native-backups\'+$stamp)
New-Item -ItemType Directory -Path $backup | Out-Null
function Copy-Profile($from, $to) {
  New-Item -ItemType Directory -Path $to -Force | Out-Null
  if (Test-Path -LiteralPath $from) {
    & robocopy $from $to /E /XJ /R:0 /W:0 /NFL /NDL /NJH /NJS /NP /XD Cache 'Code Cache' GPUCache DawnCache Crashpad 'companion-updates' | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Profile backup failed; no application files were changed' }
  }
}
Copy-Profile $profile (Join-Path $backup 'profile')
$verifiedProfile = Join-Path $backup 'verified-profile'
$migrationNeeded = -not (Test-Path -LiteralPath (Join-Path $profile 'native-migrated.flag'))
if ($migrationNeeded) {
  $exportProfile = Join-Path $backup 'export-profile'
  Copy-Profile (Join-Path $backup 'profile') $exportProfile
  New-Item -ItemType Directory -Path $verifiedProfile | Out-Null
  $snapshot = Join-Path $verifiedProfile 'native-migration.json'
  $oldMigrationProfile=$env:XM_MIGRATION_PROFILE; $oldMigrationOutput=$env:XM_MIGRATION_OUTPUT; $oldNativeProfile=$env:XM_NATIVE_USER_DATA_DIR
  try {
    $env:XM_MIGRATION_PROFILE=$exportProfile; $env:XM_MIGRATION_OUTPUT=$snapshot
    $exporter = Join-Path $PSScriptRoot 'export-legacy-state.cjs'
    $electron = Join-Path $repoRoot 'node_modules/electron/dist/electron.exe'
    $export = Start-Process -FilePath $electron -ArgumentList ('"'+$exporter+'"') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $backup 'export.log') -RedirectStandardError (Join-Path $backup 'export-errors.log')
    if (-not $export.WaitForExit(120000)) { $export.Kill(); throw 'Isolated legacy export timed out' }
    if ($export.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $snapshot)) { throw 'Legacy export failed; original files are unchanged' }
    $env:XM_NATIVE_USER_DATA_DIR=$verifiedProfile
    $verify = Start-Process -FilePath (Join-Path $stage '小马剪辑台.exe') -ArgumentList '--verify-migration' -WorkingDirectory $stage -WindowStyle Hidden -PassThru
    if (-not $verify.WaitForExit(150000)) { $verify.Kill(); throw 'Isolated native import timed out' }
    if ($verify.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $verifiedProfile 'native-migrated.flag'))) { throw 'Native import verification failed; original files are unchanged' }
  } finally { $env:XM_MIGRATION_PROFILE=$oldMigrationProfile; $env:XM_MIGRATION_OUTPUT=$oldMigrationOutput; $env:XM_NATIVE_USER_DATA_DIR=$oldNativeProfile }
}
# Move only known application components and the exact staged replacements.
# User media, previous backups, shortcuts, installer registration and fork stay put.
$legacy = @('小马剪辑台.exe','resources','locales','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','LICENSE','LICENSE.electron.txt','LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','version','vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll')
$entries = @($legacy + @(Get-ChildItem -LiteralPath $stage -Force | Select-Object -ExpandProperty Name) | Sort-Object -Unique)
$saved = Join-Path $backup 'application'
New-Item -ItemType Directory -Path $saved | Out-Null
$moved = @(); $installed = @(); $profileInstalled = @(); $profileSaved = Join-Path $backup 'native-profile-before'
New-Item -ItemType Directory -Path $profileSaved | Out-Null
try {
  foreach ($name in $entries) {
    $source = [IO.Path]::GetFullPath((Join-Path $target $name))
    if (-not $source.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Parent $source) -ne $target) { throw 'Refusing path outside installation' }
    if (Test-Path -LiteralPath $source) { Move-Item -LiteralPath $source -Destination (Join-Path $saved $name); $moved += $name }
  }
  foreach ($entry in Get-ChildItem -LiteralPath $stage -Force) {
    $installed += $entry.Name
    Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $target $entry.Name) -Recurse
  }
  & node (Join-Path $PSScriptRoot 'verify-native-stage.mjs') $target (Join-Path $stage 'native-files.json')
  if ($LASTEXITCODE -ne 0) { throw 'Installed package verification failed' }
  if ($migrationNeeded) {
    New-Item -ItemType Directory -Path $profile -Force | Out-Null
    foreach ($name in @('native-webview','native-migration.json','native-migration-report.json','native-migrated.flag')) {
      $destination = Join-Path $profile $name
      if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination (Join-Path $profileSaved $name) }
      $profileInstalled += $name
      Move-Item -LiteralPath (Join-Path $verifiedProfile $name) -Destination $destination
    }
  }
  @{version=$manifest.version;architecture=$manifest.architecture;backup=$backup;completed=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'completed.json') -Encoding UTF8
} catch {
  $failure = $_
  $failed = Join-Path $backup 'failed-application'; New-Item -ItemType Directory -Path $failed | Out-Null
  foreach ($name in $installed) { $path=Join-Path $target $name; if(Test-Path -LiteralPath $path){Move-Item -LiteralPath $path -Destination (Join-Path $failed $name)} }
  foreach ($name in $moved) { Move-Item -LiteralPath (Join-Path $saved $name) -Destination (Join-Path $target $name) }
  foreach ($name in $profileInstalled) { $path=Join-Path $profile $name; if(Test-Path -LiteralPath $path){Move-Item -LiteralPath $path -Destination (Join-Path $verifiedProfile $name)}; if(Test-Path -LiteralPath (Join-Path $profileSaved $name)){Move-Item -LiteralPath (Join-Path $profileSaved $name) -Destination $path} }
  throw $failure
}
[pscustomobject]@{installed=$target;backup=$backup;version=$manifest.version;architecture=$manifest.architecture;migration=$migrationNeeded}
