# ตรวจ syntax ของไฟล์ PowerShell ทั้งหมดในโปรเจกต์ (ใช้ตอนพัฒนา)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$files = Get-ChildItem -Path $root -Filter *.ps1 -Recurse |
  Where-Object { $_.FullName -notlike '*\.tmp\*' -and $_.FullName -notlike '*\node_modules\*' -and $_.FullName -notlike '*\dist\*' }
$bad = 0
foreach ($f in $files) {
  $errors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errors)
  if ($errors -and $errors.Count -gt 0) {
    $bad++
    Write-Host "FAIL $($f.Name)" -ForegroundColor Red
    $errors | Select-Object -First 6 | ForEach-Object { Write-Host "   line $($_.Extent.StartLineNumber): $($_.Message)" }
  } else {
    Write-Host "OK   $($f.Name)" -ForegroundColor Green
  }
}
if ($bad -gt 0) { exit 1 } else { Write-Host 'PS1 SYNTAX OK' -ForegroundColor Green }
