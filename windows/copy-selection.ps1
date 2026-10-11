#requires -Version 5.1
<#
  ส่ง Ctrl+C ไปที่โปรแกรมที่กำลังโฟกัสอยู่ เพื่อคัดลอกข้อความที่เลือกไว้ (เรียกจาก main.js)
  รอให้ผู้ใช้ปล่อย Ctrl/Alt/Shift จากคีย์ลัดก่อน ไม่งั้นโปรแกรมปลายทางจะได้ Ctrl+Alt+C แทน Ctrl+C
#>
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class KeyState {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
'@

$modifiers = 0x11, 0x12, 0x10, 0x5B, 0x5C  # Ctrl, Alt, Shift, Win
$deadline = (Get-Date).AddMilliseconds(1500)
while ((Get-Date) -lt $deadline) {
  $held = $false
  foreach ($vk in $modifiers) {
    if (([KeyState]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { $held = $true; break }
  }
  if (-not $held) { break }
  Start-Sleep -Milliseconds 25
}
[System.Windows.Forms.SendKeys]::SendWait('^c')
