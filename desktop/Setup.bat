@echo off
chcp 65001 >nul
rem สร้างไฟล์ตั้งค่าเริ่มต้นใน %APPDATA%\AtThaiReader
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0TranslatePopup.ps1" -Setup
pause
