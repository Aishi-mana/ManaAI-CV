@echo off
setlocal
title Mana
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
  echo First run: installing packages. This can take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo Starting Mana...
echo The first start compiles the Rust side and can take several minutes.
echo Close the Mana window to quit. Keep this window open while she runs.
echo.
call npm run tauri dev

echo.
echo Mana has stopped. If something went wrong, scroll up to read the message.
pause
