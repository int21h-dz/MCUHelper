@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem Release MAJOR (MINOR is auto-incremented from release/ folder)
set "RELEASE_MAJOR=0"
set "NO_BUMP="

rem CLI override (для автоматизации без меню)
if /i "%~1"=="nobump" set "NO_BUMP=1"
if /i "%~1"=="--no-bump" set "NO_BUMP=1"
if /i "%~1"=="-n" set "NO_BUMP=1"
if /i "%~1"=="bump" set "NO_BUMP=0"
if /i "%~1"=="--bump" set "NO_BUMP=0"
if /i "%~1"=="-b" set "NO_BUMP=0"

echo ========================================
echo  MCU-NR Helper - VSIX build
echo ========================================
echo   MAJOR=%RELEASE_MAJOR%
echo.

if not defined NO_BUMP call :choose_mode
if not defined NO_BUMP goto :fail

if "!NO_BUMP!"=="1" (
  echo   Mode: no version bump
) else (
  echo   Mode: auto bump version
)
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
if not exist "extension\vendor\mcu-language" mkdir "extension\vendor\mcu-language"
copy /Y "packages\mcu-language\dist\defaultPhy.js" "extension\vendor\mcu-language\defaultPhy.js" >nul
copy /Y "packages\mcu-language\dist\encodingDetect.js" "extension\vendor\mcu-language\encodingDetect.js" >nul
copy /Y "packages\mcu-language\dist\detect.js" "extension\vendor\mcu-language\detect.js" >nul
copy /Y "packages\mcu-language\dist\includeResolve.js" "extension\vendor\mcu-language\includeResolve.js" >nul
copy /Y "packages\mcu-language\dist\registrationBuilder.js" "extension\vendor\mcu-language\registrationBuilder.js" >nul
copy /Y "packages\mcu-language\dist\resultSummary.js" "extension\vendor\mcu-language\resultSummary.js" >nul
if errorlevel 1 goto :fail
if not exist "extension\vendor\mcu-geometry" mkdir "extension\vendor\mcu-geometry"
copy /Y "packages\mcu-geometry\dist\meshPreview.js" "extension\vendor\mcu-geometry\meshPreview.js" >nul
if errorlevel 1 goto :fail
rem README + images for VS Code Details (vsce looks next to package.json)
copy /Y "README.md" "extension\README.md" >nul
if errorlevel 1 goto :fail
if not exist "extension\media" mkdir "extension\media"
copy /Y "media\Promo.gif" "extension\media\Promo.gif" >nul
if errorlevel 1 goto :fail
copy /Y "media\Thenx.png" "extension\media\Thenx.png" >nul
if errorlevel 1 goto :fail

echo.
if "!NO_BUMP!"=="1" (
  echo [5/7] Version ^(no bump^)...
  set "BUMP_ARGS=%RELEASE_MAJOR% --no-bump"
) else (
  echo [5/7] Bump version ^(release + package.json^)...
  set "BUMP_ARGS=%RELEASE_MAJOR%"
)
set "RELEASE_VERSION="
for /f "usebackq delims=" %%V in (`node "%~dp0scripts\bump-vsix-version.js" !BUMP_ARGS!`) do set "RELEASE_VERSION=%%V"
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

:choose_mode
set "CURRENT_VERSION="
for /f "usebackq delims=" %%V in (`node -p "require('./extension/package.json').version"`) do set "CURRENT_VERSION=%%V"
echo Текущая версия: !CURRENT_VERSION!
echo.
echo Выберите режим сборки:
echo   1 - Увеличить версию ^(новый релиз^)
echo   2 - Без изменения версии ^(пересборка^)
echo.
set "MODE_CHOICE="
set /p "MODE_CHOICE=Ваш выбор [1]: "
if "!MODE_CHOICE!"=="" set "MODE_CHOICE=1"
if "!MODE_CHOICE!"=="1" (
  set "NO_BUMP=0"
  exit /b 0
)
if "!MODE_CHOICE!"=="2" (
  set "NO_BUMP=1"
  exit /b 0
)
echo.
echo Неверный выбор: "!MODE_CHOICE!". Введите 1 или 2.
echo.
goto :choose_mode

:fail
echo.
echo ERROR: build failed (exit code %errorlevel%).
exit /b 1
