Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "generated-config.nsh"

Name "XM剪辑台"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\XM剪辑台"
InstallDirRegKey HKCU "Software\Xiaoma\EditingStudio" "InstallLocation"
RequestExecutionLevel user
ManifestSupportedOS all
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "XM剪辑台 · AI 创作工作空间"
ShowInstDetails show
ShowUninstDetails show
AllowSkipFiles off
VIProductVersion "${APP_FILE_VERSION}"
VIAddVersionKey /LANG=2052 "ProductName" "XM剪辑台"
VIAddVersionKey /LANG=2052 "FileDescription" "XM剪辑台安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName" "小马"
VIAddVersionKey /LANG=2052 "LegalCopyright" "XM剪辑台"

!define PRODUCT_KEY "Software\Xiaoma\EditingStudio"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\XiaomaEditingStudio"
!define INSTALL_ID "xiaoma-editing-studio-482e9a36-9698-45e1-b24e-d2e8d9042885"
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "欢迎安装XM剪辑台"
!define MUI_WELCOMEPAGE_TEXT "中文、英文、西语台词整理，Gemini / DeepSeek / 豆包剧本分析与分段配乐、Suno 音乐生成、样片水印与 JianYing-Ai-Pro。$\r$\n$\r$\n版本 ${APP_VERSION}，适用于 Windows 10 / 11 64 位系统。内置运行组件，安装到当前用户，无需管理员权限。$\r$\n$\r$\n安装前请先退出正在运行的 XM剪辑台或小马剪辑台。"
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\小马剪辑台.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动XM剪辑台"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\使用说明.txt"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT "查看使用说明"
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "卸载程序只移除软件文件。模型连接、剧本历史、本地音乐和导出素材将保留。请先退出XM剪辑台。"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Var PreviousDirectory

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "此安装包需要 64 位 Windows 10 或 Windows 11。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "此安装包需要 Windows 10 或 Windows 11。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadRegStr $PreviousDirectory HKCU "${PRODUCT_KEY}" "InstallLocation"
FunctionEnd

Function ValidateDirectory
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == $0
  ${OrIf} $INSTDIR == ""
    Goto invalidDirectory
  ${EndIf}
  ${If} $PreviousDirectory != ""
  ${AndIf} $PreviousDirectory != $INSTDIR
    MessageBox MB_OK|MB_ICONEXCLAMATION "已安装的XM剪辑台（或旧名小马剪辑台）位于：$PreviousDirectory。请在原目录升级，或先卸载旧安装后再更换目录。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  IfFileExists "$INSTDIR\xiaoma-install.id" checkMarker 0
  FindFirst $0 $1 "$INSTDIR\*"
  directoryLoop:
    StrCmp $1 "" directoryEmpty
    StrCmp $1 "." nextEntry
    StrCmp $1 ".." nextEntry
    FindClose $0
    Goto invalidDirectory
  nextEntry:
    FindNext $0 $1
    Goto directoryLoop
  directoryEmpty:
    FindClose $0
    Return
  checkMarker:
    ClearErrors
    FileOpen $0 "$INSTDIR\xiaoma-install.id" r
    IfErrors invalidDirectory
    FileRead $0 $1
    FileClose $0
    StrCmp $1 "${INSTALL_ID}" directoryValid invalidDirectory
  invalidDirectory:
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择专用的空文件夹，或由此安装程序创建的XM剪辑台 / 小马剪辑台目录。不会覆盖其他文件夹中的文件。" /SD IDOK
    SetErrorLevel 2
    Abort
  directoryValid:
FunctionEnd

!macro CHECK_APP_CLOSED PREFIX
Function ${PREFIX}CheckAppClosed
  IfFileExists "$INSTDIR\小马剪辑台.exe" 0 appClosed
  retryClose:
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\小马剪辑台.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r0'
    IntCmp $0 -1 appInUse
    System::Call 'kernel32::CloseHandle(p r0)'
    Goto appClosed
  appInUse:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "程序正在运行或文件不可写。请退出XM剪辑台后点击重试。" /SD IDCANCEL IDRETRY retryClose
    SetErrorLevel 2
    Abort
  appClosed:
FunctionEnd
!macroend
!insertmacro CHECK_APP_CLOSED ""
!insertmacro CHECK_APP_CLOSED "un."

Section "XM剪辑台（必选）" MainSection
  SectionIn RO
  Call ValidateDirectory
  Call CheckAppClosed
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\xiaoma-install.id" w
  FileWrite $0 "${INSTALL_ID}"
  FileClose $0
  SetOverwrite on
  !include "generated-install.nsh"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\卸载XM剪辑台.exe"
  WriteRegStr HKCU "${PRODUCT_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "XM剪辑台"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "小马"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\小马剪辑台.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\卸载XM剪辑台.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\卸载XM剪辑台.exe$\" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${INSTALLED_SIZE_KB}
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ; Remove only the legacy uninstaller in this registered installation.
  ; Legacy shortcuts may belong to a separate portable copy and are preserved.
  ${If} $PreviousDirectory == $INSTDIR
    Delete "$INSTDIR\卸载小马剪辑台.exe"
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\XM剪辑台"
  CreateShortcut "$SMPROGRAMS\XM剪辑台\XM剪辑台.lnk" "$INSTDIR\小马剪辑台.exe"
  CreateShortcut "$SMPROGRAMS\XM剪辑台\使用说明.lnk" "$INSTDIR\使用说明.txt"
  CreateShortcut "$SMPROGRAMS\XM剪辑台\卸载.lnk" "$INSTDIR\卸载XM剪辑台.exe"
SectionEnd

Section "创建桌面快捷方式" DesktopSection
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\XM剪辑台.lnk" "$INSTDIR\小马剪辑台.exe"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${MainSection} "安装软件、内置运行环境、本地水印引擎和开始菜单入口。"
  !insertmacro MUI_DESCRIPTION_TEXT ${DesktopSection} "在当前用户桌面创建XM剪辑台快捷方式。"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ClearErrors
  FileOpen $0 "$INSTDIR\xiaoma-install.id" r
  IfErrors invalidUninstall
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "${INSTALL_ID}" validUninstall
  invalidUninstall:
    MessageBox MB_OK|MB_ICONSTOP "无法确认安装目录，已停止卸载以保护文件。" /SD IDOK
    SetErrorLevel 2
    Abort
  validUninstall:
  Call un.CheckAppClosed
FunctionEnd

Section "Uninstall"
  SetOutPath "$TEMP"
  ClearErrors
  !include "generated-uninstall.nsh"
  IfErrors uninstallFailed
  !include "generated-uninstall-dirs.nsh"
  ReadRegStr $0 HKCU "${PRODUCT_KEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    Delete "$DESKTOP\XM剪辑台.lnk"
    Delete "$SMPROGRAMS\XM剪辑台\XM剪辑台.lnk"
    Delete "$SMPROGRAMS\XM剪辑台\使用说明.lnk"
    Delete "$SMPROGRAMS\XM剪辑台\卸载.lnk"
    RMDir "$SMPROGRAMS\XM剪辑台"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    DeleteRegKey HKCU "${PRODUCT_KEY}"
    DeleteRegKey /ifempty HKCU "Software\Xiaoma"
  ${EndIf}
  Delete "$INSTDIR\xiaoma-install.id"
  Delete "$INSTDIR\卸载XM剪辑台.exe"
  RMDir "$INSTDIR"
  Goto uninstallDone
  uninstallFailed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "部分程序文件正在使用，请退出程序后重新卸载。个人配置与素材均已保留。" /SD IDOK
    SetErrorLevel 2
    Abort
  uninstallDone:
SectionEnd
