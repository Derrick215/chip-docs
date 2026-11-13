@echo off
chcp 65001 >nul
cd /d "%~dp0"
python tools\build_catalog.py
if errorlevel 1 goto failed
python tools\preview.py
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo 启动失败，请确认已安装 Python 3，或检查上方错误提示。
pause
