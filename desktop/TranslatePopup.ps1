<#
=====================================================================
 อ่านไทย Translate Reader — ตัวช่วยบน Windows (สำหรับโปรแกรมอ่าน PDF)
=====================================================================
 ใช้เมื่อคุณอ่าน PDF ในโปรแกรมที่ไม่ใช่เบราว์เซอร์ (Adobe Acrobat Reader,
 Foxit, SumatraPDF, Word ฯลฯ) แล้วอยากแปลแบบกดคีย์ลัดเดียว

 วิธีใช้
   1) ดับเบิลคลิก TranslateReader.bat  (หรือรันคำสั่ง:
      powershell -ExecutionPolicy Bypass -File TranslatePopup.ps1 )
   2) คลุมข้อความในโปรแกรมอ่าน PDF แล้วกด  Ctrl + Alt + T
      → โปรแกรมจะคัดลอกข้อความนั้น แปล และโชว์ป๊อปอัปข้างเมาส์
   3) กด  Ctrl + Alt + Y  เพื่อแปลข้อความที่อยู่ในคลิปบอร์ดอยู่แล้ว
      (ไม่ต้องส่ง Ctrl+C จึงไม่ไปรบกวนโปรแกรมอื่น)

 ตั้งค่า AI (ไม่บังคับ): แก้ไฟล์ %APPDATA%\AtThaiReader\config.json
   { "ai": { "enabled": true, "provider": "openai",
             "baseUrl": "https://api.openai.com/v1",
             "apiKey": "sk-...", "model": "gpt-4o-mini" } }
   ใช้ Ollama ในเครื่องก็ได้: "baseUrl": "http://localhost:11434/v1", "apiKey": ""

 คำศัพท์ที่กด "บันทึก" จะถูกเก็บที่
   %APPDATA%\AtThaiReader\vocabulary.json  (นำเข้าในส่วนขยาย Chrome ได้)
=====================================================================
#>

[CmdletBinding()]
param(
  [switch]$Setup,
  [switch]$NoRestoreClipboard
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ------------------------------------------------------------------ #
# ไฟล์ตั้งค่าและคลังคำศัพท์
# ------------------------------------------------------------------ #
$DataDir = Join-Path $env:APPDATA 'AtThaiReader'
$ConfigPath = Join-Path $DataDir 'config.json'
$VocabPath = Join-Path $DataDir 'vocabulary.json'

$DefaultConfig = @{
  targetLang   = 'th'
  sourceLang   = 'auto'
  restoreClipboard = $true
  showExamples = $true
  showSynonyms = $true
  hotkeyTranslate = 'Ctrl+Alt+T'
  hotkeyClipboard = 'Ctrl+Alt+Y'
  ai = @{
    enabled  = $false
    provider = 'openai'
    baseUrl  = 'https://api.openai.com/v1'
    apiKey   = ''
    model    = 'gpt-4o-mini'
  }
}

function Ensure-DataFiles {
  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
  if (-not (Test-Path $ConfigPath)) {
    $DefaultConfig | ConvertTo-Json -Depth 6 | Set-Content -Path $ConfigPath -Encoding UTF8
  }
  if (-not (Test-Path $VocabPath)) {
    @{ app = 'atthai-translate-reader'; version = 1; words = @() } | ConvertTo-Json -Depth 6 |
      Set-Content -Path $VocabPath -Encoding UTF8
  }
}

function Get-Config {
  try {
    $raw = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $DefaultConfig
  }
  $cfg = @{}
  foreach ($k in $DefaultConfig.Keys) {
    if ($null -ne $raw.$k) { $cfg[$k] = $raw.$k } else { $cfg[$k] = $DefaultConfig[$k] }
  }
  $ai = @{}
  foreach ($k in $DefaultConfig.ai.Keys) {
    if ($null -ne $raw.ai.$k) { $ai[$k] = $raw.ai.$k } else { $ai[$k] = $DefaultConfig.ai[$k] }
  }
  $cfg['ai'] = $ai
  return $cfg
}

# ------------------------------------------------------------------ #
# ตัวเชื่อมกับ Windows API (คีย์ลัดระดับระบบ)
# ------------------------------------------------------------------ #
if (-not ('HotkeyForm' -as [type])) {
  Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class HotkeyForm : Form {
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    public event Action<int> HotkeyPressed;
    public HotkeyForm() {
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Location = new System.Drawing.Point(-4000, -4000);
        Size = new System.Drawing.Size(1, 1);
        ShowIcon = false;
    }
    public bool Register(int id, int mods, int vk) { return RegisterHotKey(Handle, id, mods, vk); }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x0312 && HotkeyPressed != null) { HotkeyPressed(m.WParam.ToInt32()); }
        base.WndProc(ref m);
    }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
}
'@
}

$MOD_ALT = 1; $MOD_CONTROL = 2; $MOD_SHIFT = 4; $MOD_NOREPEAT = 0x4000

function Parse-Hotkey([string]$text) {
  $mods = 0; $key = 0
  foreach ($part in ($text -split '\+')) {
    switch ($part.Trim().ToUpper()) {
      'CTRL'   { $mods = $mods -bor $MOD_CONTROL }
      'ALT'    { $mods = $mods -bor $MOD_ALT }
      'SHIFT'  { $mods = $mods -bor $MOD_SHIFT }
      'WIN'    { $mods = $mods -bor 8 }
      default  { if ($part.Length -eq 1) { $key = [int][char]$part.ToUpper() } }
    }
  }
  return @{ mods = ($mods -bor $MOD_NOREPEAT); key = $key }
}

# ------------------------------------------------------------------ #
# แหล่งแปล
# ------------------------------------------------------------------ #
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function Invoke-Json([string]$url, [string]$method = 'GET', $body = $null, $headers = $null) {
  $params = @{
    Uri             = $url
    Method          = $method
    UseBasicParsing = $true
    TimeoutSec      = 20
    Headers         = @{ 'User-Agent' = $UA }
  }
  if ($headers) { foreach ($k in $headers.Keys) { $params.Headers[$k] = $headers[$k] } }
  if ($body) {
    $params.Body = $body
    $params.ContentType = 'application/json'
  }
  $res = Invoke-WebRequest @params
  return ($res.Content | ConvertFrom-Json)
}

function Get-Translation([string]$text, $cfg) {
  $to = $cfg.targetLang
  # 1) Google Translate (gtx)
  try {
    $q = [uri]::EscapeDataString($text)
    $url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=$to&dt=t&dt=bd&q=$q"
    $data = Invoke-Json $url
    $parts = @()
    foreach ($seg in $data[0]) { if ($seg[0]) { $parts += [string]$seg[0] } }
    $translation = ($parts -join '').Trim()
    if ($translation) {
      $alts = @()
      if ($data[1]) { foreach ($entry in $data[1]) { if ($entry[1]) { foreach ($t in $entry[1]) { $alts += [string]$t } } } }
      return @{ translation = $translation; alternatives = $alts; provider = 'Google' }
    }
  } catch { }
  # 2) Google Dictionary (clients5)
  try {
    $q = [uri]::EscapeDataString($text)
    $url = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=$to&q=$q"
    $data = Invoke-Json $url
    $parts = @()
    foreach ($item in $data) {
      if ($item -is [string]) { $parts += $item }
      elseif ($item -is [array] -and $item[0] -is [string]) { $parts += $item[0] }
    }
    $translation = ($parts -join '').Trim()
    if ($translation) { return @{ translation = $translation; alternatives = @(); provider = 'Google Dictionary' } }
  } catch { }
  # 3) MyMemory
  try {
    $q = [uri]::EscapeDataString($text)
    $url = "https://api.mymemory.translated.net/get?q=$q&langpair=en|$to"
    $data = Invoke-Json $url
    $translation = [string]$data.responseData.translatedText
    if ($translation) { return @{ translation = $translation; alternatives = @(); provider = 'MyMemory' } }
  } catch { }
  return @{ translation = ''; alternatives = @(); provider = ''; error = 'เชื่อมต่อผู้ให้บริการแปลไม่ได้' }
}

function Get-Synonyms([string]$word) {
  try {
    if ($word -notmatch '^[A-Za-z][A-Za-z''-]*$') { return @() }
    $url = "https://api.datamuse.com/words?rel_syn=$([uri]::EscapeDataString($word))&md=f&max=30"
    $data = Invoke-Json $url
    $scored = @()
    foreach ($item in $data) {
      $freq = 0
      foreach ($tag in $item.tags) { if ($tag -like 'f:*') { $freq = [double]$tag.Substring(2) } }
      $scored += [pscustomobject]@{ word = $item.word; freq = $freq }
    }
    $picked = $scored | Where-Object { $_.freq -ge 0.5 } | Sort-Object freq -Descending | Select-Object -First 8
    if (-not $picked) { $picked = $scored | Sort-Object freq -Descending | Select-Object -First 6 }
    return @($picked | ForEach-Object { $_.word })
  } catch { return @() }
}

function Get-Examples([string]$text, $cfg) {
  try {
    $q = [uri]::EscapeDataString($text)
    $url = "https://tatoeba.org/en/api_v0/search?from=eng&to=tha&query=$q&sort=relevance"
    $data = Invoke-Json $url
    $out = @()
    foreach ($r in $data.results) {
      $en = [string]$r.text
      if (-not $en -or $en.Length -gt 160) { continue }
      $th = ''
      foreach ($group in $r.translations) { foreach ($t in $group) { if ($t.lang -eq 'tha') { $th = [string]$t.text; break } } ; if ($th) { break } }
      if (-not $th) { continue }
      $out += [pscustomobject]@{ en = $en; th = $th }
      if ($out.Count -ge 3) { break }
    }
    return $out
  } catch { return @() }
}

function Get-AiExplanation([string]$text, $cfg) {
  if (-not $cfg.ai.enabled -or -not $cfg.ai.baseUrl) { return $null }
  if ($cfg.ai.provider -ne 'ollama' -and -not $cfg.ai.apiKey) { return $null }
  $system = @'
You are an expert English-Thai lexicographer for a Thai learner.
Reply with ONE valid JSON object only (no markdown):
{"translation":"คำแปลไทย","partOfSpeech":"...","contextMeaning":"อธิบายไทย 1-2 ประโยค","synonyms":[{"word":"english","th":"ไทย"}],"examples":[{"en":"...","th":"..."}],"memoryHook":"ตัวช่วยจำภาษาไทย"}
Use everyday Thai. Synonyms must be common easy English words. Examples must be short real-life situations.
'@
  $body = @{
    model = $cfg.ai.model
    temperature = 0.2
    messages = @(
      @{ role = 'system'; content = $system },
      @{ role = 'user'; content = "คำที่ต้องการ: `"$text`"" }
    )
  } | ConvertTo-Json -Depth 8
  try {
    $headers = @{}
    if ($cfg.ai.apiKey) { $headers['Authorization'] = "Bearer $($cfg.ai.apiKey)" }
    $base = $cfg.ai.baseUrl.TrimEnd('/')
    $res = Invoke-Json "$base/chat/completions" 'POST' $body $headers
    $content = [string]$res.choices[0].message.content
    $content = $content -replace '(?s)^.*?```(?:json)?', '' -replace '(?s)```.*$', ''
    $start = $content.IndexOf('{'); $end = $content.LastIndexOf('}')
    if ($start -ge 0 -and $end -gt $start) { $content = $content.Substring($start, $end - $start + 1) }
    return ($content | ConvertFrom-Json)
  } catch { return $null }
}

# ------------------------------------------------------------------ #
# บันทึกคำศัพท์ (ไฟล์เดียวกับที่ส่วนขยายนำเข้าได้)
# ------------------------------------------------------------------ #
function Save-Word($entry) {
  try {
    $data = Get-Content -Path $VocabPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $words = @()
    if ($data.words) { $words = @($data.words) }
    $exists = $false
    foreach ($w in $words) { if ($w.word -eq $entry.word) { $exists = $true } }
    if (-not $exists) {
      $words += $entry
      @{
        app        = 'atthai-translate-reader'
        version    = 1
        exportedAt = (Get-Date).ToString('o')
        count      = $words.Count
        words      = $words
      } | ConvertTo-Json -Depth 8 | Set-Content -Path $VocabPath -Encoding UTF8
      return $true
    }
    return $false
  } catch { return $false }
}

function New-WordEntry($result, $text, $context) {
  $syn = @()
  if ($result.synonyms) { foreach ($s in $result.synonyms) { $syn += @{ word = [string]$s.word; th = [string]$s.th; level = 'normal'; note = '' } } }
  $ex = @()
  if ($result.examples) { foreach ($e in $result.examples) { $ex += @{ en = [string]$e.en; th = [string]$e.th; source = 'Tatoeba' } } }
  return @{
    id            = [guid]::NewGuid().ToString()
    word          = $text
    translation   = $result.translation
    reading       = [string]$result.reading
    partOfSpeech  = [string]$result.partOfSpeech
    register      = ''
    contextMeaning = [string]$result.contextMeaning
    context       = $context
    literal       = ''
    memoryHook    = [string]$result.memoryHook
    notes         = ''
    alternatives  = @()
    definitions   = @()
    synonyms      = $syn
    examples      = $ex
    collocations  = @()
    sourceLang    = 'en'
    targetLang    = $script:Config.targetLang
    provider      = $result.provider
    aiUsed        = [bool]$result.aiUsed
    sourceTitle   = ''
    sourceUrl     = ''
    sourceType    = 'desktop'
    tags          = @('desktop')
    starred       = $false
    createdAt     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    updatedAt     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    reviewCount   = 0
    lastReviewedAt = 0
    srs           = @{ ease = 2.5; interval = 0; reps = 0; lapses = 0; due = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); lastGrade = $null }
  }
}

# ------------------------------------------------------------------ #
# ป๊อปอัป
# ------------------------------------------------------------------ #
$script:Popup = $null

function Close-Popup {
  if ($script:Popup) {
    try { $script:Popup.Close(); $script:Popup.Dispose() } catch { }
    $script:Popup = $null
  }
}

function Show-Popup([string]$text) {
  Close-Popup
  $cfg = $script:Config
  $font = New-Object System.Drawing.Font('Segoe UI', 10)

  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'Manual'
  $form.TopMost = $true
  $form.ShowInTaskbar = $false
  $form.BackColor = [System.Drawing.Color]::FromArgb(24, 27, 33)
  $form.ForeColor = [System.Drawing.Color]::FromArgb(232, 236, 243)
  $form.Padding = New-Object System.Windows.Forms.Padding(14, 12, 14, 10)
  $form.Width = 460
  $form.AutoSize = $true
  $form.AutoSizeMode = 'GrowAndShrink'

  $panel = New-Object System.Windows.Forms.FlowLayoutPanel
  $panel.FlowDirection = 'TopDown'
  $panel.WrapContents = $false
  $panel.AutoSize = $true
  $panel.AutoSizeMode = 'GrowAndShrink'
  $panel.Width = 430
  $panel.Dock = 'Fill'
  $form.Controls.Add($panel)

  function New-Label($text, $size, $color, $bold = $false, $width = 430) {
    $lbl = New-Object System.Windows.Forms.Label
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $lbl.Font = New-Object System.Drawing.Font('Segoe UI', $size, $style)
    $lbl.ForeColor = $color
    $lbl.Text = $text
    $lbl.MaximumSize = New-Object System.Drawing.Size($width, 0)
    $lbl.AutoSize = $true
    $lbl.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 5)
    return $lbl
  }

  $lblWord = New-Label $text 13 ([System.Drawing.Color]::FromArgb(153, 163, 179)) $false
  $lblTrans = New-Label 'กำลังแปล…' 17 ([System.Drawing.Color]::FromArgb(45, 212, 191)) $true
  $panel.Controls.Add($lblWord) | Out-Null
  $panel.Controls.Add($lblTrans) | Out-Null

  $lblBody = New-Label '' 10 ([System.Drawing.Color]::FromArgb(210, 216, 226)) $false
  $panel.Controls.Add($lblBody) | Out-Null

  $buttons = New-Object System.Windows.Forms.FlowLayoutPanel
  $buttons.FlowDirection = 'LeftToRight'
  $buttons.AutoSize = $true
  $buttons.WrapContents = $false
  $buttons.Margin = New-Object System.Windows.Forms.Padding(0, 6, 0, 0)

  function New-Btn($label, $action) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $label
    $b.FlatStyle = 'Flat'
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 68, 82)
    $b.BackColor = [System.Drawing.Color]::FromArgb(34, 38, 47)
    $b.ForeColor = [System.Drawing.Color]::FromArgb(232, 236, 243)
    $b.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    $b.AutoSize = $true
    $b.Padding = New-Object System.Windows.Forms.Padding(8, 4, 8, 4)
    $b.Margin = New-Object System.Windows.Forms.Padding(0, 0, 6, 0)
    $b.Add_Click($action)
    return $b
  }

  $state = @{ result = $null; text = $text; context = ''; saved = $false }

  $btnSpeak = New-Btn '🔊 ออกเสียง' {
    try {
      $voice = New-Object -ComObject SAPI.SpVoice
      [void]$voice.Speak($state.text)
    } catch { }
  }
  $btnSave = New-Btn '💾 บันทึก' {
    if (-not $state.result) { return }
    $entry = New-WordEntry $state.result $state.text $state.context
    $created = Save-Word $entry
    if ($created) { $btnSave.Text = 'บันทึกแล้ว ✓' } else { $btnSave.Text = 'มีอยู่แล้ว' }
    $btnSave.Enabled = $false
  }
  $btnCopy = New-Btn '📋 คัดลอก' {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine($state.text)
    if ($state.result) {
      [void]$sb.AppendLine("= " + $state.result.translation)
      if ($state.result.contextMeaning) { [void]$sb.AppendLine([string]$state.result.contextMeaning) }
      if ($state.result.examples) { foreach ($e in $state.result.examples) { [void]$sb.AppendLine("• " + $e.en + " → " + $e.th) } }
    }
    Set-Clipboard -Value $sb.ToString()
    $btnCopy.Text = 'คัดลอกแล้ว ✓'
  }
  $btnClose = New-Btn '✕ ปิด' { Close-Popup }
  $btnAi = New-Btn '🤖 AI อธิบาย' {
    $btnAi.Enabled = $false
    $btnAi.Text = 'กำลังถาม AI…'
    $form.Refresh()
    $ai = Get-AiExplanation $state.text $script:Config
    if ($ai) {
      if ($ai.translation) { $lblTrans.Text = [string]$ai.translation; $state.result.translation = [string]$ai.translation }
      $lines = @()
      if ($ai.contextMeaning) { $lines += [string]$ai.contextMeaning }
      if ($ai.synonyms) { $lines += 'คำพ้อง: ' + (($ai.synonyms | ForEach-Object { $_.word }) -join ', ') }
      if ($ai.examples) { foreach ($e in $ai.examples) { $lines += ('• ' + $e.en + ' → ' + $e.th) } }
      if ($ai.memoryHook) { $lines += '🧠 ' + [string]$ai.memoryHook }
      $lblBody.Text = ($lines -join "`r`n")
      $state.result.contextMeaning = [string]$ai.contextMeaning
      $state.result.memoryHook = [string]$ai.memoryHook
      $state.result.synonyms = $ai.synonyms
      $state.result.examples = $ai.examples
      $state.result.aiUsed = $true
    } else {
      $btnAi.Text = 'AI ใช้ไม่ได้ (ตรวจ config.json)'
    }
    $form.Refresh()
  }

  $buttons.Controls.Add($btnSpeak) | Out-Null
  $buttons.Controls.Add($btnSave) | Out-Null
  $buttons.Controls.Add($btnCopy) | Out-Null
  if ($script:Config.ai.enabled) { $buttons.Controls.Add($btnAi) | Out-Null }
  $buttons.Controls.Add($btnClose) | Out-Null
  $panel.Controls.Add($buttons) | Out-Null

  # วางป๊อปอัปใกล้เมาส์ แต่ไม่ให้หลุดจอ
  $cursor = [System.Windows.Forms.Cursor]::Position
  $screen = [System.Windows.Forms.Screen]::FromPoint($cursor).WorkingArea
  $form.PerformLayout()
  $form.Left = [Math]::Min([Math]::Max($screen.Left + 8, $cursor.X - 40), $screen.Right - $form.Width - 8)
  $form.Top = [Math]::Min([Math]::Max($screen.Top + 8, $cursor.Y + 18), $screen.Bottom - $form.Height - 8)

  # ปิดเมื่อคลิกที่อื่น / กด Esc
  $form.Add_Deactivate({ Close-Popup })
  $form.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { Close-Popup } })
  $form.Add_Shown({ $form.Activate() })

  $script:Popup = $form
  $form.Show()
  $form.Refresh()

  # แปลในรอบถัดไปของ UI เพื่อให้ป๊อปอัปขึ้นก่อน
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 60
  $timer.Add_Tick({
    $timer.Stop()
    try {
      $result = Get-Translation $state.text $script:Config
      if (-not $result.translation) {
        $lblTrans.Text = '⚠️ ' + $(if ($result.error) { $result.error } else { 'แปลไม่สำเร็จ' })
        $lblTrans.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        return
      }
      $lblTrans.Text = $result.translation
      $lines = @()
      if ($result.alternatives -and $result.alternatives.Count -gt 0) {
        $lines += 'อื่น ๆ: ' + (($result.alternatives | Select-Object -First 5) -join ', ')
      }
      $synonyms = @()
      if ($script:Config.showSynonyms) { $synonyms = Get-Synonyms $state.text }
      if ($synonyms.Count -gt 0) { $lines += 'คำพ้องที่ใช้ง่าย: ' + ($synonyms -join ', ') }
      $examples = @()
      if ($script:Config.showExamples) { $examples = Get-Examples $state.text $script:Config }
      foreach ($e in $examples) { $lines += ('• ' + $e.en + "`r`n   " + $e.th) }
      $lines += ('— ' + $result.provider)
      $lblBody.Text = ($lines -join "`r`n")

      $state.result = @{
        translation    = $result.translation
        provider       = $result.provider
        reading        = ''
        partOfSpeech   = ''
        contextMeaning = ''
        memoryHook     = ''
        synonyms       = @($synonyms | ForEach-Object { @{ word = $_; th = ''; level = 'normal'; note = '' } })
        examples       = @($examples | ForEach-Object { @{ en = $_.en; th = $_.th; source = 'Tatoeba' } })
        aiUsed         = $false
      }
      $state.context = ''
      $btnSpeak.Enabled = $true
    } catch {
      $lblTrans.Text = '⚠️ ' + $_.Exception.Message
    } finally {
      $form.PerformLayout()
      $form.Refresh()
    }
  })
  $timer.Start()
}

# ------------------------------------------------------------------ #
# ทำงานหลัก
# ------------------------------------------------------------------ #
function Get-SelectedText {
  $before = ''
  try { $before = Get-Clipboard -Raw } catch { }
  [System.Windows.Forms.SendKeys]::SendWait('^c')
  Start-Sleep -Milliseconds 260
  $text = ''
  for ($i = 0; $i -lt 10; $i++) {
    try { $text = Get-Clipboard -Raw } catch { $text = '' }
    if ($text -and $text -ne $before) { break }
    Start-Sleep -Milliseconds 90
  }
  if ($script:Config.restoreClipboard -and -not $NoRestoreClipboard) {
    Start-Sleep -Milliseconds 120
    try { Set-Clipboard -Value $before } catch { }
  }
  return $text
}

function Invoke-Translate([string]$rawText, [switch]$FromClipboard) {
  if (-not $rawText) { return }
  $text = $rawText.Trim()
  if ($text.Length -gt 600) { $text = $text.Substring(0, 600) }
  if (-not $text) { return }
  Show-Popup $text
}

function Start-Reader {
  Ensure-DataFiles
  $script:Config = Get-Config

  $form = New-Object HotkeyForm
  $hk1 = Parse-Hotkey $script:Config.hotkeyTranslate
  $hk2 = Parse-Hotkey $script:Config.hotkeyClipboard
  $ok1 = $form.Register(1, $hk1.mods, $hk1.key)
  $ok2 = $form.Register(2, $hk2.mods, $hk2.key)

  if (-not $ok1) {
    [System.Windows.Forms.MessageBox]::Show(
      "ลงทะเบียนคีย์ลัด $($script:Config.hotkeyTranslate) ไม่สำเร็จ — อาจมีโปรแกรมอื่นใช้อยู่ แก้ได้ที่ `n$ConfigPath",
      'อ่านไทย Translate Reader') | Out-Null
  }

  $form.Add_HotkeyPressed({
    param($id)
    if ($id -eq 1) {
      $text = Get-SelectedText
      Invoke-Translate $text
    } elseif ($id -eq 2) {
      $text = ''
      try { $text = Get-Clipboard -Raw } catch { }
      Invoke-Translate $text -FromClipboard
    }
  })

  $form.Add_Shown({
    $balloon = New-Object System.Windows.Forms.NotifyIcon
    $balloon.Icon = [System.Drawing.SystemIcons]::Application
    $balloon.Visible = $true
    $balloon.Text = 'อ่านไทย Translate Reader กำลังทำงาน'
    $balloon.BalloonTipTitle = 'อ่านไทย Translate Reader'
    $balloon.BalloonTipText = "พร้อมใช้งาน · $($script:Config.hotkeyTranslate) = แปลข้อความที่เลือก`n$($script:Config.hotkeyClipboard) = แปลจากคลิปบอร์ด"
    $balloon.ShowBalloonTip(4000)
    $script:Balloon = $balloon
  })

  [System.Windows.Forms.Application]::Run($form)
}

# ------------------------------------------------------------------ #
if ($Setup) {
  Ensure-DataFiles
  Write-Host "สร้างไฟล์ตั้งค่าแล้ว:" -ForegroundColor Green
  Write-Host "  $ConfigPath"
  Write-Host "  $VocabPath"
  Write-Host ''
  Write-Host 'เปิดโปรแกรมด้วยคำสั่ง:'
  Write-Host '  powershell -ExecutionPolicy Bypass -File TranslatePopup.ps1'
  exit 0
}

Start-Reader
