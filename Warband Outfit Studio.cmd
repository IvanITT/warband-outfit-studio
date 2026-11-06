@echo off
setlocal
cd /d "%~dp0"
title WARBand Outfit Studio

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js 22 or newer is required.
  echo   Download it from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting WARBand Outfit Studio...
echo.
node backend\server\index.js --open

if errorlevel 1 (
  echo.
  echo   The server stopped with an error. Check the messages above.
  pause
)
