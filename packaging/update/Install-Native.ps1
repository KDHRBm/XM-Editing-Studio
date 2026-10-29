param(
  [Parameter(Mandatory=$true)][string]$TargetDirectory,
  [string]$LegacyProfile = '',
  [switch]$TestMode,
  [int]$FailAfter = 0
)
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($TargetDirectory).TrimEnd('\')
$bundle = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$payload = Join-Path $bundle 'payload'
$markerValue = 'xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885'
function Normal-Path([string]$path) {
  $at=[IO.Path]::GetFullPath($path)
  while($at) {
    if((Test-Path -LiteralPath $at) -and ((Get-Item -LiteralPath $at -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '更新目录不能包含链接。' }
    $at=[IO.Path]::GetDirectoryName($at)
  }
}
function Copy-Profile([string]$from,[string]$to) {
  New-Item -ItemType Directory -Path $to -Force | Out-Null
  if(Test-Path -LiteralPath $from) {
    & robocopy $from $to /E /XJ /R:0 /W:0 /NFL /NDL /NJH /NJS /NP /XD Cache 'Code Cache' GPUCache DawnCache Crashpad cache updates companion-updates /XF 'Singleton*' | Out-Null
    if($LASTEXITCODE -ge 8){throw '数据备份失败，程序文件尚未修改。'}
  }
}
function Move-Entry([string]$from,[string]$to) {
  # Same-volume renames are atomic. Move-Item can partially move a directory
  # before reporting a locked file, making a reliable rollback impossible.
  if([IO.Directory]::Exists($from)){[IO.Directory]::Move($from,$to)}
  else{[IO.File]::Move($from,$to)}
}
function File-Hash([string]$file) {
  $stream=[IO.File]::OpenRead($file)
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $hasher.Dispose(); $stream.Dispose() }
}
function Verify-Payload([string]$directory) {
  foreach($item in $manifest.files.PSObject.Properties) {
    $file=[IO.Path]::GetFullPath((Join-Path $directory $item.Name))
    if(-not $file.StartsWith($directory+'\',[StringComparison]::OrdinalIgnoreCase)){throw '清单路径无效。'}
    if(-not[IO.File]::Exists($file) -or (File-Hash $file) -ne $item.Value){throw ('更新文件校验失败：'+$item.Name)}
  }
}
function Run-Checked([string]$exe,[string]$arguments,[string]$label,[string]$working) {
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$exe; $info.Arguments=$arguments; $info.WorkingDirectory=$working
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  $process=New-Object Diagnostics.Process; $process.StartInfo=$info
  [void]$process.Start()
  $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit(180000)){ $process.Kill(); throw ($label+' 超时，原数据未删除。') }
  [IO.File]::WriteAllText((Join-Path $backup ($label+'.log')),$stdout.Result)
  [IO.File]::WriteAllText((Join-Path $backup ($label+'-errors.log')),$stderr.Result)
  $exitCode=$process.ExitCode; $process.Dispose()
  if($exitCode -ne 0){throw ($label+' 失败（退出码 '+$exitCode+'），请查看备份目录日志。')}
}
function Assert-Closed {
  $processes=@(Get-CimInstance Win32_Process)
  $installerAncestors=New-Object 'System.Collections.Generic.HashSet[uint32]'
  $visited=New-Object 'System.Collections.Generic.HashSet[uint32]'
  $ancestorId=[uint32]$PID
  while($ancestorId -and $visited.Add($ancestorId)) {
    $ancestor=$processes | Where-Object ProcessId -EQ $ancestorId | Select-Object -First 1
    if(-not $ancestor){break}
    if($ancestor.Name -eq 'XM-Editing-Studio-1.4.2-Windows-x64-Setup.exe'){
      if($ancestor.ExecutablePath -and $ancestor.ExecutablePath.StartsWith($target+'\data\',[StringComparison]::OrdinalIgnoreCase)){throw '请先将更新包移到安装目录的 data 文件夹之外，再运行更新。软件内更新会自动准备独立启动副本。'}
      [void]$installerAncestors.Add($ancestorId)
    }
    $ancestorId=[uint32]$ancestor.ParentProcessId
  }
  # The verified installer launch copy may run from this installation folder.
  # Only its ancestor process is exempt; the application and pet must still exit.
  $running=@($processes | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase) -and -not $installerAncestors.Contains([uint32]$_.ProcessId) })
  if($running.Count){throw '请保存任务，并从托盘彻底退出 XM剪辑台和桌宠后重试。'}
}
$backup=''
try {
  Normal-Path $target; Normal-Path $bundle
  if($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\') -or $target -eq $bundle){throw '请选择独立的 XM剪辑台安装文件夹。'}
  if($target -match '(?i)fork|kirota' -or (Test-Path -LiteralPath (Join-Path $target 'xm-fork-install.id'))){throw '请选择原版目录，fork 版本保持独立。'}
  $existing=Test-Path -LiteralPath (Join-Path $target '小马剪辑台.exe')
  if($existing) {
    $marker=Join-Path $target 'xiaoma-install.id'
    if(-not(Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker).Trim() -ne $markerValue){throw '未识别到原版安装标记，请选择已安装的原版 XM剪辑台目录。'}
    $version=[Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $target '小马剪辑台.exe')).ProductVersion
    if([version]($version -replace '[^\d.].*$','') -lt [version]'1.3.1'){throw '此包支持 1.3.1 及以上原版。'}
  } elseif((Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force | Where-Object Name -NotLike '.xm-install-*').Count){throw '全新安装请选择空文件夹，避免覆盖其他文件。'}
  Assert-Closed
  $manifest=Get-Content -LiteralPath (Join-Path $payload 'native-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if($manifest.version -ne '1.4.2' -or $manifest.architecture -ne 'csharp-webview2'){throw '更新包版本不正确。'}
  Verify-Payload $payload
  $backup=Join-Path $target ('.xiaoma-update-backups\1.4.2-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  $data=Join-Path $target 'data'
  $oldProfile=$data
  if(-not(Test-Path -LiteralPath $oldProfile)) {
    if($LegacyProfile){ if(-not $TestMode){throw '测试目录参数只用于隔离验证。'}; $oldProfile=[IO.Path]::GetFullPath($LegacyProfile) }
    elseif($existing) {
      $oldProfile=Join-Path $env:APPDATA 'xiaoma-editing-studio'
      if(-not(Test-Path -LiteralPath $oldProfile)){$oldProfile=Join-Path $env:APPDATA '黑曜信号台'}
    }
  }
  $nextData=Join-Path $backup 'next-data'
  Copy-Profile $oldProfile $nextData
  $petPointer=Join-Path $oldProfile 'companion-updates\active.json'
  if(Test-Path -LiteralPath $petPointer) {
    $active=Get-Content -LiteralPath $petPointer -Raw -Encoding UTF8 | ConvertFrom-Json
    $activePath=[IO.Path]::GetFullPath($active.directory).TrimEnd('\')
    $activeRoot=[IO.Path]::GetFullPath((Join-Path $oldProfile 'companion-updates')).TrimEnd('\')
    if([IO.Path]::GetDirectoryName($activePath) -eq $activeRoot -and [IO.Path]::GetFileName($activePath) -match '^runtime-[\w.-]+$') {
      Normal-Path $activePath
      $relative='companion-updates\'+[IO.Path]::GetFileName($activePath)
      $nextPet=Join-Path $nextData $relative
      Copy-Profile $activePath $nextPet
      foreach($name in @('xm_companion_bridge.py','xm_companion_prepare.py')){Copy-Item -LiteralPath (Join-Path $payload ('resources\companion\_internal\'+$name)) -Destination (Join-Path $nextPet ('_internal\'+$name)) -Force}
      $petManifest=Join-Path $nextPet 'xm-manifest.json'
      $petInfo=Get-Content -LiteralPath $petManifest -Raw -Encoding UTF8 | ConvertFrom-Json
      $petInfo.bridgeSha256=File-Hash (Join-Path $nextPet '_internal\xm_companion_bridge.py')
      $petInfo.prepareSha256=File-Hash (Join-Path $nextPet '_internal\xm_companion_prepare.py')
      [IO.File]::WriteAllText($petManifest, ($petInfo | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false)))
      [IO.File]::WriteAllText((Join-Path $nextData 'companion-updates\active.json'), (@{directory=(Join-Path $data $relative)} | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    }
  }
  $compat=Join-Path $env:LOCALAPPDATA 'XM-Editing-Studio\draft-compat'
  if(-not $TestMode -and (Test-Path -LiteralPath $compat) -and -not(Test-Path -LiteralPath (Join-Path $nextData 'draft-compat'))){Copy-Profile $compat (Join-Path $nextData 'draft-compat')}
  $legacyStorage=Test-Path -LiteralPath (Join-Path $nextData 'Local Storage')
  if($legacyStorage -and -not(Test-Path -LiteralPath (Join-Path $nextData 'native-webview'))) {
    $exportRuntime=Join-Path $backup 'migration-runtime'; New-Item -ItemType Directory -Path $exportRuntime | Out-Null
    foreach($item in Get-ChildItem -LiteralPath $target -File){ if($item.Extension -in '.exe','.dll','.pak','.bin','.dat','.json' -and $item.Name -ne 'Uninstall.exe'){Copy-Item -LiteralPath $item.FullName -Destination $exportRuntime} }
    if(Test-Path -LiteralPath (Join-Path $target 'locales')){Copy-Item -LiteralPath (Join-Path $target 'locales') -Destination $exportRuntime -Recurse}
    New-Item -ItemType Directory -Path (Join-Path $exportRuntime 'resources') | Out-Null
    Copy-Item -LiteralPath (Join-Path $bundle 'migration\app.asar') -Destination (Join-Path $exportRuntime 'resources\app.asar')
    $exportExe=Join-Path $exportRuntime '小马剪辑台.exe'
    & (Join-Path $bundle 'MigrationHelper.exe') $exportExe ([IO.File]::ReadAllText((Join-Path $bundle 'migration\header.sha256')).Trim())
    if($LASTEXITCODE -ne 0){throw '旧版隔离导出准备失败。'}
    $env:XM_MIGRATION_PROFILE=$nextData; $env:XM_MIGRATION_OUTPUT=Join-Path $nextData 'native-migration.json'
    Run-Checked $exportExe '--no-first-run' 'export' $exportRuntime
    if(-not(Test-Path -LiteralPath $env:XM_MIGRATION_OUTPUT)){throw '旧数据导出不完整。'}
  }
  $needsImport=(Test-Path -LiteralPath (Join-Path $nextData 'native-migration.json')) -and -not(Test-Path -LiteralPath (Join-Path $nextData 'native-migrated.flag'))
  $env:XM_NATIVE_USER_DATA_DIR=$nextData
  Run-Checked (Join-Path $payload '小马剪辑台.exe') '--verify-migration' 'verify-storage' $payload
  if($needsImport -and -not(Test-Path -LiteralPath (Join-Path $nextData 'native-migrated.flag'))){throw '新版数据导入校验未通过。'}
  $engineConfig=Join-Path $nextData 'jianying-ai\settings\settings.json'
  if(Test-Path -LiteralPath $engineConfig) {
    $settings=Get-Content -LiteralPath $engineConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    $oldDefault=Join-Path $oldProfile 'jianying-ai\settings\字幕导出'
    if($settings.subtitle_output -eq $oldDefault){$settings.subtitle_output=Join-Path $target 'data\jianying-ai\settings\字幕导出';$settings | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $engineConfig -Encoding UTF8}
  }
  Assert-Closed
  $saved=Join-Path $backup 'application'; New-Item -ItemType Directory -Path $saved | Out-Null
  $legacy=@('小马剪辑台.exe','resources','locales','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','LICENSE','LICENSE.electron.txt','LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','version','vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll')
  $names=@($legacy+@(Get-ChildItem -LiteralPath $payload -Force | Select-Object -ExpandProperty Name) | Sort-Object -Unique)
  $moved=@(); $installed=@(); $dataMoved=$false; $dataInstalled=$false
  try {
    foreach($name in $names) {
      if($name -eq 'data' -or $name.StartsWith('.')){throw '程序清单包含数据目录。'}
      $current=Join-Path $target $name
      if(Test-Path -LiteralPath $current){ Move-Entry $current (Join-Path $saved $name); $moved+=$name }
    }
    foreach($entry in Get-ChildItem -LiteralPath $payload -Force) {
      $installed+=$entry.Name; Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $target $entry.Name) -Recurse
      if($TestMode -and $FailAfter -gt 0 -and $installed.Count -ge $FailAfter){throw 'Injected update failure'}
    }
    Verify-Payload $target
    if(Test-Path -LiteralPath $data){Move-Entry $data (Join-Path $backup 'data-before'); $dataMoved=$true}
    if($TestMode -and $FailAfter -eq -1){throw 'Injected failure after data rename'}
    Move-Entry $nextData $data; $dataInstalled=$true
    [IO.File]::WriteAllText((Join-Path $target 'xiaoma-install.id'),$markerValue)
    @{version='1.4.2';target=$target;architecture='csharp-webview2';state='complete';data=$data} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'result.json') -Encoding UTF8
  } catch {
    $problem=$_; $failed=Join-Path $backup 'failed-application'; New-Item -ItemType Directory -Path $failed -Force | Out-Null
    foreach($name in $installed){$current=Join-Path $target $name;if(Test-Path -LiteralPath $current){Move-Entry $current (Join-Path $failed $name)}}
    foreach($name in $moved){Move-Entry (Join-Path $saved $name) (Join-Path $target $name)}
    if($dataInstalled){Move-Entry $data $nextData}
    if($dataMoved){Move-Entry (Join-Path $backup 'data-before') $data}
    @{version='1.4.2';target=$target;state='rolled-back'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'result.json') -Encoding UTF8
    throw $problem
  }
  if(-not $TestMode) {
    $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\XiaomaEditingStudio'
    if(Test-Path $key){$registered=(Get-ItemProperty $key).InstallLocation;if($registered -and [IO.Path]::GetFullPath($registered).TrimEnd('\') -eq $target){Set-ItemProperty $key DisplayVersion '1.4.2'}}
  }
  [IO.File]::WriteAllText((Join-Path $bundle 'last-result.txt'),"已更新到 1.4.2。数据保存在：$data`r`n备份：$backup")
  exit 0
} catch {
  [IO.File]::WriteAllText((Join-Path $bundle 'last-result.txt'),("更新未完成："+$_.Exception.Message+"`r`n备份："+$backup))
  exit 1
}
