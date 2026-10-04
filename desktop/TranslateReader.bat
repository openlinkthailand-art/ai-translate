@echo off
chcp 65001 >nul
rem เปิดตัวช่วยแปลสำหรับโปรแกรมอ่าน PDF (ทำงานเบื้องหลัง รอรับคีย์ลัด)
start "" powershell -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0TranslatePopup.ps1"
exit /b
