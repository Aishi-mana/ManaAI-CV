@echo off
setlocal
title Build Mana
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust was not found. Install it from https://rustup.rs
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing packages. This can take a minute...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Building the standalone Mana app. This takes several minutes the first time...
echo.
call npm run tauri build -- --no-bundle
if errorlevel 1 (
  echo.
  echo The build failed. Scroll up to read the error.
  pause
  exit /b 1
)

echo.
echo Done. Your app is: src-tauri\target\release\mana.exe
echo Right-click it and choose Send to, then Desktop, to make a shortcut.
start "" explorer "%~dp0src-tauri\target\release"
pause
