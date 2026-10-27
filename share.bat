@echo off
rem Share Ripple with your team: starts the app and a public Cloudflare link.
rem Keep this window open; closing it takes the link down. The link changes on every run.
cd /d "%~dp0"

if not exist team_access_code.txt (
  python -c "import secrets; print('ripple-' + secrets.token_hex(4))" > team_access_code.txt
)
set /p RIPPLE_OFFICIAL_CODE=<team_access_code.txt
set RIPPLE_PORT=8000

set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=cloudflared"

echo.
echo  Starting Ripple on http://127.0.0.1:8000 ...
start "Ripple server" cmd /k python app.py
timeout /t 5 /nobreak >nul

echo.
echo  Official access code for your team: %RIPPLE_OFFICIAL_CODE%
echo  (share it privately; it is also saved in team_access_code.txt)
echo.
echo  Opening the public link. Look for the line ending in .trycloudflare.com below.
echo.
"%CF%" tunnel --no-autoupdate --url http://127.0.0.1:8000
