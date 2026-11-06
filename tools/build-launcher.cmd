@echo off
setlocal
cd /d "%~dp0.."
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo .NET Framework 4 csc.exe not found; cannot rebuild the launcher.
  exit /b 1
)
"%CSC%" /nologo /target:exe /platform:anycpu /codepage:65001 /out:"WARBand Outfit Studio.exe" "tools\launcher\Launcher.cs"
if errorlevel 1 exit /b 1
echo Launcher rebuilt: WARBand Outfit Studio.exe
