
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Name "Matheca"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Matheca"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_ICON "..\..\assets\icon.ico"
!define MUI_UNICON "..\..\assets\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Matheca.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Var Key
Var AppKey
Var LinkName
Var Args
Var Validate
Function SetKeys
  StrCpy $Key "Software\Microsoft\Windows\CurrentVersion\Uninstall\MathecaTauri"
  StrCpy $AppKey "Software\MathecaTauri\Installer"
  StrCpy $LinkName "Matheca"
  ${If} $Validate == "yes"
    StrCpy $Key "Software\Microsoft\Windows\CurrentVersion\Uninstall\MathecaTauriPackagingValidation"
    StrCpy $AppKey "Software\MathecaTauri\InstallerValidation"
    StrCpy $LinkName "Matheca Packaging Validation"
  ${EndIf}
FunctionEnd
Function .onInit
  SetShellVarContext current
  ${GetParameters} $Args
  ClearErrors
  ${GetOptions} $Args "/VALIDATE" $0
  ${IfNot} ${Errors}
    StrCpy $Validate "yes"
  ${EndIf}
  Call SetKeys
  ${If} $Validate != "yes"
    ReadRegStr $0 HKCU "$AppKey" "InstallDir"
    ${If} $0 != ""
      StrCpy $INSTDIR $0
    ${EndIf}
  ${EndIf}
  SetRegView 32
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  SetRegView 64
  ${If} $0 == ""
    MessageBox MB_OK|MB_ICONSTOP "请先安装 Microsoft Edge WebView2 Runtime，再运行此安装包。下载地址：https://developer.microsoft.com/microsoft-edge/webview2/"
    Abort
  ${EndIf}
FunctionEnd
Section "Matheca" SEC_MAIN
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${PAYLOAD}\*.*"
  ${If} $Validate == "yes"
    FileOpen $0 "$INSTDIR\.installer-validation" w
    FileWrite $0 "MathecaInstallerValidation-v1"
    FileClose $0
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "$AppKey" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "$Key" "DisplayName" "$LinkName"
  WriteRegStr HKCU "$Key" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "$Key" "Publisher" "SACO1F"
  WriteRegStr HKCU "$Key" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "$Key" "DisplayIcon" "$INSTDIR\Matheca.exe"
  WriteRegStr HKCU "$Key" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "$Key" "NoModify" 1
  WriteRegDWORD HKCU "$Key" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\$LinkName"
  CreateShortcut "$SMPROGRAMS\$LinkName\Matheca.lnk" "$INSTDIR\Matheca.exe"
  CreateShortcut "$SMPROGRAMS\$LinkName\卸载.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\$LinkName.lnk" "$INSTDIR\Matheca.exe"
SectionEnd
Function un.onInit
  SetShellVarContext current
  SetRegView 64
  StrCpy $Key "Software\Microsoft\Windows\CurrentVersion\Uninstall\MathecaTauri"
  StrCpy $AppKey "Software\MathecaTauri\Installer"
  StrCpy $LinkName "Matheca"
  IfFileExists "$INSTDIR\.installer-validation" 0 normal
    StrCpy $Key "Software\Microsoft\Windows\CurrentVersion\Uninstall\MathecaTauriPackagingValidation"
    StrCpy $AppKey "Software\MathecaTauri\InstallerValidation"
    StrCpy $LinkName "Matheca Packaging Validation"
  normal:
FunctionEnd
Section "Uninstall"
  !include "uninstall-files.nsh"
  Delete "$INSTDIR\.installer-validation"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\$LinkName\Matheca.lnk"
  Delete "$SMPROGRAMS\$LinkName\卸载.lnk"
  RMDir "$SMPROGRAMS\$LinkName"
  Delete "$DESKTOP\$LinkName.lnk"
  DeleteRegKey HKCU "$Key"
  DeleteRegKey HKCU "$AppKey"
SectionEnd
