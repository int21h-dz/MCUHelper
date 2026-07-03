@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo  MCU-NR Helper - сборка VSIX
echo ========================================
echo.

echo [1/6] Установка зависимостей (корень)...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/6] Установка зависимостей (mcu-lsp, extension)...
call npm install --prefix packages\mcu-lsp
if errorlevel 1 goto :fail
call npm install --prefix extension
if errorlevel 1 goto :fail

echo.
echo [3/6] Сборка пакетов...
call npm run build
if errorlevel 1 goto :fail

echo.
echo [4/6] Подготовка ресурсов для упаковки...
if not exist "extension\server" mkdir "extension\server"
copy /Y "packages\mcu-lsp\dist\server.js" "extension\server\server.js" >nul
if errorlevel 1 goto :fail
if not exist "extension\vendor\mcu-schema" mkdir "extension\vendor\mcu-schema"
xcopy /E /I /Y "packages\mcu-schema\dist\*" "extension\vendor\mcu-schema\" >nul
if errorlevel 1 goto :fail

echo.
echo [5/6] Упаковка VSIX...
if not exist "release" mkdir "release"
call npm run package --prefix extension -- --out "..\release"
if errorlevel 1 goto :fail

echo.
echo [6/6] Готово.
echo.
echo Файл для установки:
for %%F in ("release\*.vsix") do echo   %%~fF
echo.
echo Установка на другой машине:
echo   code --install-extension "release\mcuhelper-vscode-0.2.0.vsix"
echo   (или: Расширения -^> ... -^> Install from VSIX)
echo.
goto :eof

:fail
echo.
echo ОШИБКА: сборка прервана (код %errorlevel%).
exit /b 1
