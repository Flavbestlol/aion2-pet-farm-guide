; AION 2 Pet Farm Guide: the Windows installer.
;
; Built by tools/make_release.py:
;   makensis -DVERSION=<plugin version> -DOVERLAY_VERSION=<overlay version> -DPAYLOAD=<folder> -DOUTFILE=<exe> setup.nsi
; PAYLOAD holds "Farm Guide Overlay.exe" and farm-guide\ (the plugin). The overlay writes addon.json and
; emblem.png beside itself (for Flav-Toolkit's hub) when it runs, and --setup-link does it here.
;
; For you only (no administrator rights): it installs to %LOCALAPPDATA%\Programs, where the overlay
; can also update itself. The guide reads the game from Flav-Toolkit (the hub finds it through a link,
; --setup-link) or from A2 Tools (the overlay adds the plugin to it: --setup-register, see
; overlay/src-tauri/src/a2/setup.rs). Nothing starts with Windows unless you tick the box.

Target amd64-unicode   ; 64-bit, like the overlay and the game
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

!define NAME "AION 2 Pet Farm Guide"
!define EXE "Farm Guide Overlay.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AION2PetFarmGuide"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define REPO "https://github.com/Flavbestlol/aion2-pet-farm-guide"
!ifndef ART
  !define ART "${__FILEDIR__}\art"
!endif

Name "${NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${NAME}"
InstallDirRegKey HKCU "${UNKEY}" "InstallLocation"
BrandingText "${NAME} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${NAME}"
VIAddVersionKey "FileDescription" "${NAME} setup"
VIAddVersionKey "CompanyName" "Flavbest"
VIAddVersionKey "LegalCopyright" "GPL-3.0, by Flavbest"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

; ── look ──
!define MUI_ICON "${ART}\setup.ico"
!define MUI_UNICON "${ART}\setup.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ART}\side.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ART}\side.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${ART}\head.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${ART}\head.bmp"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC

Var Meter       ; what the plugin step said: 0 done, 1 failed, 2 A2 Tools was open, 3 A2 Tools not installed
Var Core        ; 1: Flav-Toolkit is on this PC
Var FinishText

; ── pages ──
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${NAME}"
!define MUI_WELCOMEPAGE_TEXT "This sets up the guide on your PC:$\r$\n$\r$\n•  the overlay, which shows the guide over AION 2$\r$\n•  its link to Flav-Toolkit, which reads the game for it$\r$\n•  or the plugin, added to the A2 Tools DPS Meter for you, if you use that$\r$\n$\r$\nNo administrator rights needed. Nothing starts with Windows unless you choose it.$\r$\n$\r$\nVersion ${VERSION}. Click Next to continue."
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "The guide installs here, for your Windows account only. The default is fine for almost everyone."
!insertmacro MUI_PAGE_DIRECTORY

!define MUI_PAGE_HEADER_TEXT "Options"
!define MUI_PAGE_HEADER_SUBTEXT "Shortcuts, and whether the overlay starts with Windows."
!define MUI_COMPONENTSPAGE_TEXT_TOP "Start with Windows: the overlay waits hidden until you play AION 2. You can change it later in the guide's Settings › Overlay."
!define MUI_COMPONENTSPAGE_TEXT_COMPLIST "Options:"
!insertmacro MUI_PAGE_COMPONENTS

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "The guide is installed"
!define MUI_FINISHPAGE_TEXT "$FinishText"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start the guide now"
!define MUI_FINISHPAGE_LINK "Get Flav-Toolkit (it reads the game for the guide)"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/Flavbestlol/flav-toolkit/releases/latest"
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── install ──
Function CloseOverlay
  ; the overlay, including an older copy you started from elsewhere
  nsExec::Exec 'taskkill /IM "${EXE}"'
  Sleep 800
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 300
FunctionEnd

Section "-Farm Guide" SecMain
  Call CloseOverlay
  SetOutPath "$INSTDIR"
  File "${PAYLOAD}\${EXE}"
  Delete "$INSTDIR\Farm Guide Overlay.new.exe"
  Delete "$INSTDIR\WebView2Loader.dll" ; 1.16.1 and older needed it; the overlay now carries it inside
  SetOutPath "$INSTDIR\farm-guide"
  File /r "${PAYLOAD}\farm-guide\*.*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Settings › Apps
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Flavbest"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${UNKEY}" "URLInfoAbout" "${REPO}"
  WriteRegStr HKCU "${UNKEY}" "HelpLink" "${REPO}/issues"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" "$0"

  CreateShortcut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "Shows the pet farming guide over AION 2"
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "Shows the pet farming guide over AION 2"
SectionEnd

Section /o "Start with Windows" SecAuto
SectionEnd

Section "-Finish setting up" SecSetup
  ${IfNot} ${SectionIsSelected} ${SecDesktop}
    Delete "$DESKTOP\${NAME}.lnk"
  ${EndIf}
  ${If} ${SectionIsSelected} ${SecAuto}
    ExecWait '"$INSTDIR\${EXE}" --setup-autostart on'
  ${Else}
    ExecWait '"$INSTDIR\${EXE}" --setup-autostart off'
  ${EndIf}

  ; Flav-Toolkit has run on this PC (it keeps its log in its data folder)
  StrCpy $Core 0
  ${If} ${FileExists} "$APPDATA\com.flavbest.flav-toolkit\flav-toolkit.log"
    StrCpy $Core 1
  ${EndIf}
  ; Flav-Toolkit's hub: addon.json and emblem.png here, and a link to this folder in its own
  ; (written even before Flav-Toolkit is installed, so its hub finds the guide from its first start)
  ExecWait '"$INSTDIR\${EXE}" --setup-link "$INSTDIR"'

  ; ── A2 Tools only (goes with overlay/src-tauri/src/a2 when A2 Tools support is dropped) ──
  ; the plugin, into A2 Tools (it can't be changed while A2 Tools is open)
  retry:
  ExecWait '"$INSTDIR\${EXE}" --setup-register "$INSTDIR\farm-guide"' $Meter
  ${If} $Meter == 2
    MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "The A2 Tools DPS Meter is open.$\r$\n$\r$\nClose it, then click Retry, so the guide can add itself to it.$\r$\n$\r$\nOr click Cancel: the guide does it by itself the next time the meter is closed, while the guide is running." /SD IDCANCEL IDRETRY retry
  ${EndIf}

  ${If} $Meter == 0
    StrCpy $FinishText "The guide is installed and added to the A2 Tools DPS Meter.$\r$\n$\r$\nStart the meter (as administrator) and log in to your character: the game sends your pet levels at login."
  ${ElseIf} $Meter == 2
    StrCpy $FinishText "The guide is installed.$\r$\n$\r$\nOne step left: close the A2 Tools DPS Meter for a moment while the guide runs. It adds itself to the meter, then start the meter again."
  ${ElseIf} $Meter == 3
  ${AndIf} $Core == 1
    StrCpy $FinishText "The guide is installed.$\r$\n$\r$\nIt reads the game from Flav-Toolkit: start Flav-Toolkit, then AION 2, and log in to your character (the game sends your pet levels at login). Flav-Toolkit's hub lists the guide."
  ${ElseIf} $Meter == 3
    StrCpy $FinishText "The guide is installed.$\r$\n$\r$\nIt reads the game from Flav-Toolkit, which isn't on this PC yet: get it with the link below and start it. (The free A2 Tools DPS Meter works too: the guide adds itself to it once it's installed.)"
  ${Else}
    StrCpy $FinishText "The guide is installed, but it couldn't add itself to the A2 Tools DPS Meter.$\r$\n$\r$\nAdd it by hand: in the meter, Settings › Plugins, turn on Plugin developer mode, click Load plugin folder… and pick:$\r$\n$INSTDIR\farm-guide"
  ${EndIf}
SectionEnd

Function FinishShow
  ; Flav-Toolkit's link, only when neither it nor A2 Tools is here
  ${If} $Meter != 3
  ${OrIf} $Core == 1
    ShowWindow $mui.FinishPage.Link ${SW_HIDE}
  ${EndIf}
FunctionEnd

Function .onInit
  ; one installer at a time
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "AION2PetFarmGuideSetup") p .r0 ?e'
  Pop $1
  ${If} $1 == 183
    MessageBox MB_ICONINFORMATION "The setup is already running." /SD IDOK
    Abort
  ${EndIf}
  ; installing again: keep what you chose last time
  ReadRegStr $0 HKCU "${UNKEY}" "InstallLocation"
  ${If} $0 != ""
    ${IfNot} ${FileExists} "$DESKTOP\${NAME}.lnk"
      !insertmacro UnselectSection ${SecDesktop}
    ${EndIf}
  ${EndIf}
  ReadRegStr $0 HKCU "${RUNKEY}" "FarmGuideOverlay"
  ${If} $0 != ""
    !insertmacro SelectSection ${SecAuto}
  ${EndIf}
  ; the overlay draws with Microsoft Edge WebView2 (part of Windows 11, and of Windows 10 with Edge)
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $1 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ${If} $1 == ""
    ${OrIf} $1 == "0.0.0.0"
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "The overlay needs Microsoft Edge WebView2, which wasn't found on this PC.$\r$\n$\r$\nOpen Microsoft's WebView2 page to get it? (The setup carries on either way.)" /SD IDNO IDNO +2
      ExecShell "open" "https://developer.microsoft.com/microsoft-edge/webview2/"
    ${EndIf}
  ${EndIf}
FunctionEnd

; ── uninstall ──
Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}"'
  Sleep 800
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 300
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    retry:
    ; A2 Tools only: take the plugin folder out of A2 Tools' list
    ExecWait '"$INSTDIR\${EXE}" --setup-unregister "$INSTDIR\farm-guide"' $0
    ${If} $0 == 2
      MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "The A2 Tools DPS Meter is open.$\r$\n$\r$\nClose it, then click Retry, so the guide can take itself out of it.$\r$\n$\r$\nOr click Cancel and remove it later in the meter: Settings › Plugins." /SD IDCANCEL IDRETRY retry
    ${EndIf}
  ${EndIf}
  DeleteRegValue HKCU "${RUNKEY}" "FarmGuideOverlay"
  ; Flav-Toolkit's link to this folder (a link to another copy stays)
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    ExecWait '"$INSTDIR\${EXE}" --setup-unlink "$INSTDIR"'
  ${EndIf}

  ; only what the setup put there, in case the folder was one of yours
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\Farm Guide Overlay.new.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  RMDir /r "$INSTDIR\farm-guide"
  Delete "$INSTDIR\addon.json"
  Delete "$INSTDIR\emblem.png"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  DeleteRegKey HKCU "${UNKEY}"

  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete the guide's own folder: where you placed it, your choices, and its copy of your soul history?$\r$\n$\r$\nYour pet levels come back from the game at your next login either way. If you use the A2 Tools DPS Meter, it keeps its own copy of the history." /SD IDNO IDNO keep
    RMDir /r "$APPDATA\app.farmguide.overlay"
    RMDir /r "$LOCALAPPDATA\app.farmguide.overlay"
  keep:
SectionEnd
