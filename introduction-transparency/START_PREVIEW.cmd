@echo off
setlocal
cd /d "%~dp0"
echo Matheca introduction preview
echo Open http://127.0.0.1:5181/ in your browser.
echo Close this window to stop the preview.
node serve.mjs dist
if errorlevel 1 pause
