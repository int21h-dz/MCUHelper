@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem Release MAJOR (MINOR is auto-incremented from release/ folder)
set "RELEASE_MAJOR=0"

echo ========================================
echo  MCU-NR Helper - VSIX build
echo ========================================
echo   MAJOR=%RELEASE_MAJOR%
echo.

echo [1/7] npm install (root)...
call npm install --no-fund --no-audit
if errorlevel 1 goto :fail

echo.
echo [2/7] npm install (mcu-lsp, extension)...
call npm install --no-fund --no-audit --prefix packages\mcu-lsp
if errorlevel 1 goto :fail
call npm install --no-fund --no-audit --prefix extension
if errorlevel 1 goto :fail

echo.
echo [3/7] Build packages...
call npm run build
if errorlevel 1 goto :fail

echo.
echo [4/7] Copy assets for packaging...
if not exist "extension\server" mkdir "extension\server"
copy /Y "packages\mcu-lsp\dist\server.js" "extension\server\server.js" >nul
if errorlevel 1 goto :fail
if not exist "extension\vendor\mcu-schema" mkdir "extension\vendor\mcu-schema"
xcopy /E /I /Y "packages\mcu-schema\dist\*" "extension\vendor\mcu-schema\" >nul
if errorlevel 1 goto :fail

echo.
echo [5/7] Bump version (release + package.json)...
set "RELEASE_VERSION="
for /f "usebackq delims=" %%V in (`node "%~dp0scripts\bump-vsix-version.js" %RELEASE_MAJOR%`) do set "RELEASE_VERSION=%%V"
if not defined RELEASE_VERSION goto :fail
echo   mcuhelper-vscode-!RELEASE_VERSION!.vsix

echo.
echo [6/7] Package VSIX...
if not exist "release" mkdir "release"
call npm run package --prefix extension -- --out "..\release"
if errorlevel 1 goto :fail

echo.
echo [7/7] Done.
echo.
echo Install from:
echo   %~dp0release\mcuhelper-vscode-!RELEASE_VERSION!.vsix
echo.
echo On another machine:
echo   code --install-extension "%~dp0release\mcuhelper-vscode-!RELEASE_VERSION!.vsix"
echo   (or: Extensions -^> ... -^> Install from VSIX)
echo.
goto :eof

:fail
echo.
echo ERROR: build failed (exit code %errorlevel%).
exit /b 1
