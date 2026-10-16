@echo off
setlocal EnableExtensions
set "NODE_OPTIONS="
cd /d "%~dp0..\.."
if errorlevel 1 goto fail_folder

where node >nul 2>&1
if errorlevel 1 goto fail_node
if not exist "node_modules\tsx\package.json" goto fail_tsx

set "NODE_MAJOR="
for /f "delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto fail_node
if %NODE_MAJOR% LSS 22 goto fail_node

set "TARGET=%~1"
if /I "%TARGET%"=="preview" goto launch
if /I "%TARGET%"=="production" goto launch
if not "%~1"=="" goto fail_choice

echo Dealer website stock worker
echo.
echo   1  Preview    https://itrader.dev
echo   2  Production https://itrader.im
echo.
choice /c 12 /n /m "Choose 1 or 2: "
if errorlevel 3 goto fail_choice
if errorlevel 2 (
  set "TARGET=production"
  goto launch
)
if errorlevel 1 (
  set "TARGET=preview"
  goto launch
)
goto fail_choice

:launch
if /I "%TARGET%"=="preview" set "TARGET=preview"
if /I "%TARGET%"=="production" set "TARGET=production"
set "CHECK="
if "%~2"=="--check" set "CHECK=--check"
if not "%~2"=="" if not "%~2"=="--check" goto fail_choice
echo.
echo Selected %TARGET%. Leave this window open and keep the PC awake.
node --import tsx "scripts/dealer-stock-sync/pc-launcher.ts" --target %TARGET% %CHECK%
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Worker finished with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%

:fail_folder
echo Could not open the repository folder.
goto finish_fail

:fail_node
echo Node.js 22 or newer was not found on PATH. Install it, then open this launcher again.
echo This launcher does not install Node.js.
goto finish_fail

:fail_tsx
echo tsx is not installed. In this repository folder run: npm ci
echo This launcher does not install packages.
goto finish_fail

:fail_choice
echo Choose preview or production. Example: start-worker.cmd preview
goto finish_fail

:finish_fail
echo.
pause
exit /b 1
