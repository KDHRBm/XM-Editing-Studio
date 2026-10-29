Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "native-config.nsh"
Name "XM剪辑台 1.4.2"
OutFile "${OUTPUT_FILE}"
InstallDir "D:\小马剪辑台"
InstallDirRegKey HKCU "Software\Xiaoma\EditingStudio" "InstallLocation"
RequestExecutionLevel user
ManifestDPIAware true
ManifestSupportedOS all
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "XM剪辑台 · 作者：小马"
ShowInstDetails show
AllowSkipFiles off
VIProductVersion "1.4.2.0"
VIAddVersionKey /LANG=2052 "ProductName" "XM剪辑台"
VIAddVersionKey /LANG=2052 "FileDescription" "XM剪辑台 1.4.2 安装与更新"
VIAddVersionKey /LANG=2052 "FileVersion" "1.4.2.0"
VIAddVersionKey /LANG=2052 "ProductVersion" "1.4.2"
VIAddVersionKey /LANG=2052 "LegalCopyright" "小马"
!define MUI_ICON "${APP_ICON}"
!define MUI_WELCOMEPAGE_TITLE "XM剪辑台 1.4.2"
!define MUI_WELCOMEPAGE_TEXT "支持从原版 1.3.1 及以上版本直接升级，也可全新安装。$\r$\n$\r$\n请先保存任务并从托盘彻底退出原版剪辑台。选择原安装目录即可，其他独立安装的版本不受影响。$\r$\n$\r$\n更新会先备份并校验配置、任务和历史记录。软件数据与缓存保存到安装目录下的 data。首次迁移到 WebView2 后，国内 AI 官方网页需要重新登录。"
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "已安装 XM剪辑台 1.4.2。$\r$\n$\r$\n使用原快捷方式或桌面 XM剪辑台打开。备份位于安装目录的 .xiaoma-update-backups；个人数据位于 data。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
Var Stage
Var Result
Var TestMode
Var TestArgs
Function .onInit
  StrCpy $TestMode 0
  StrCpy $TestArgs ""
  ClearErrors
  ${GetOptions} "$CMDLINE" "/TEST" $0
  ${IfNot} ${Errors}
    StrCpy $TestMode 1
    StrCpy $TestArgs " -TestMode"
  ${EndIf}
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "需要 64 位 Windows 10 / 11。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd
Function ValidateDirectory
  IfFileExists "$INSTDIR\xm-fork-install.id" invalid 0
  IfFileExists "$INSTDIR\XM剪辑台-Fork.exe" invalid 0
  ${GetRoot} "$INSTDIR" $0
  StrCmp $INSTDIR $0 invalid
  StrCmp $INSTDIR "" invalid
  IfFileExists "$INSTDIR\小马剪辑台.exe" checkMarker done
  checkMarker:
    ClearErrors
    FileOpen $0 "$INSTDIR\xiaoma-install.id" r
    IfErrors invalid
    FileRead $0 $1
    FileClose $0
    StrCmp $1 "xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885" done
    StrCmp $1 "xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885$\r$\n" done invalid
  invalid:
    MessageBox MB_OK|MB_ICONSTOP "请选择原版 XM剪辑台安装目录，不能选择磁盘根目录或另一版本目录。" /SD IDOK
    SetErrorLevel 2
    Abort
  done:
FunctionEnd
Section "安装与更新"
  Call ValidateDirectory
  System::Call 'kernel32::GetTickCount() i.r0'
  StrCpy $Stage "$INSTDIR\.xm-install-142-$0"
  SetOutPath "$Stage"
  File "${BUNDLE_DIR}\Install-Native.ps1"
  File "${BUNDLE_DIR}\MigrationHelper.exe"
  SetOutPath "$Stage\migration"
  File "${BUNDLE_DIR}\migration\app.asar"
  File "${BUNDLE_DIR}\migration\header.sha256"
  SetOutPath "$Stage\payload"
  File /r "${BUNDLE_DIR}\payload\*"
  SetOutPath "$Stage"
  DetailPrint "正在校验更新文件、备份和迁移个人数据，请稍候…"
  nsExec::ExecToLog '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$Stage\Install-Native.ps1" -TargetDirectory "$INSTDIR"$TestArgs'
  Pop $Result
  ${If} $Result != 0
    IfSilent +2 0
    ExecShell "open" "$Stage\last-result.txt"
    DetailPrint "安装未完成。原程序及数据保留，请查看 $Stage\last-result.txt。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  CopyFiles /SILENT "$Stage\last-result.txt" "$INSTDIR\更新结果-1.4.2.txt"
  ${If} $TestMode == 0
  WriteRegStr HKCU "Software\Xiaoma\EditingStudio" "InstallLocation" "$INSTDIR"
  CreateShortcut "$DESKTOP\XM剪辑台.lnk" "$INSTDIR\小马剪辑台.exe" "" "$INSTDIR\app-icon.ico"
  ${EndIf}
  SetOutPath "$INSTDIR"
  RMDir /r "$Stage"
SectionEnd
