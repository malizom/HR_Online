@echo off
rem Double-click to start the People Portal demo on Windows. Needs Docker Desktop (free for small businesses).
cd /d "%~dp0"
docker info >nul 2>&1 || (echo Docker Desktop is not running. Start it, then run this again. & pause & exit /b 1)
if not exist .env (
  powershell -NoProfile -Command "$r=[Security.Cryptography.RandomNumberGenerator]::Create(); function k{$b=New-Object byte[] 32;$r.GetBytes($b);[Convert]::ToBase64String($b)}; $c=-join((48..57)+(65..90)|Get-Random -Count 6|%%{[char]$_}); \"AUTH_SECRET=$(k)`nDATA_ENCRYPTION_KEY=$(k)`nDEMO_ACCESS_CODE=MVR-$c\" | Set-Content -Encoding ascii .env"
)
if "%1"=="--fresh" docker compose down -v
echo Starting the demo (the first time takes a few minutes to build)...
docker compose up -d --build || (pause & exit /b 1)
:wait
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/ready).StatusCode}catch{exit 1}" >nul 2>&1 || (timeout /t 2 >nul & goto wait)
for /f "tokens=2 delims==" %%a in ('findstr DEMO_ACCESS_CODE .env') do set CODE=%%a
echo Ready:  http://localhost:3000    Access code: %CODE%
start "" http://localhost:3000/signin
echo Leave this window open during the demo.
pause
docker compose stop
