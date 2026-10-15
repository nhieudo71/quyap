@echo off
setlocal
cd /d "%~dp0"

set "PORT=5899"
set "URL=http://localhost:%PORT%/index.html"

echo ==================================================
echo   Quan Ly Tai Chinh Ap - Local Server
echo   %URL%
echo   (Dong cua so nay de TAT server)
echo ==================================================
echo.

rem Mo trinh duyet sau 2 giay (de server kip khoi dong)
start "" /b cmd /c timeout /t 2 ^>nul ^& start "" "%URL%"

rem 1) Python 3
where python >nul 2>nul
if %errorlevel%==0 (
  echo [Python] Dang chay localhost tai cong %PORT% ...
  python -m http.server %PORT%
  goto :end
)

rem 2) Python qua launcher "py"
where py >nul 2>nul
if %errorlevel%==0 (
  echo [py] Dang chay localhost tai cong %PORT% ...
  py -3 -m http.server %PORT%
  goto :end
)

rem 3) Node.js qua npx http-server
where npx >nul 2>nul
if %errorlevel%==0 (
  echo [Node] Dang chay localhost tai cong %PORT% ...
  npx --yes http-server -p %PORT% -c-1
  goto :end
)

echo.
echo  KHONG tim thay Python hoac Node.js tren may.
echo  Hay cai mot trong hai:
echo    - Python: https://www.python.org/downloads/
echo    - Node.js: https://nodejs.org/
echo  Roi chay lai run.bat
echo.
pause

:end
endlocal
