@echo off
cd /d "%~dp0"
start "" http://localhost:8080
echo Phone Assist demo: http://localhost:8080  (close this window to stop)
python -m http.server 8080
