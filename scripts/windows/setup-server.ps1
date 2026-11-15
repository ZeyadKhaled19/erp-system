# تسطيب النظام على جهاز المحل (السيرفر) — مرة واحدة بس.
#   كليك يمين على الملف ← Run with PowerShell
#   أو:  powershell -ExecutionPolicy Bypass -File scripts\windows\setup-server.ps1
# اختياري:  -BackupCopyDir "D:\ERP-Backups"   فولدر تاني تتنسخ فيه النسخة اليومية (فلاشة / هارد خارجي / Google Drive)
#           -Port 4000                         رقم المنفذ
param([string]$BackupCopyDir = '', [int]$Port = 4000)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }

Step 'التأكد من Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js مش متسطب. نزّل نسخة LTS من https://nodejs.org وسطّبها، وبعدين شغّل الملف ده تاني.' -ForegroundColor Yellow
  exit 1
}
Write-Host "Node $(node -v)"

Step 'تنزيل المكتبات (أول مرة بتاخد كام دقيقة)'
if (Test-Path (Join-Path $root 'package-lock.json')) { npm.cmd ci --no-audit --no-fund } else { npm.cmd install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { throw 'فشل تنزيل المكتبات' }

Step 'تجهيز الواجهة'
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'فشل تجهيز الواجهة' }

Step 'ملف الإعدادات (.env)'
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $lines = @("PORT=$Port", "JWT_SECRET=$secret")
  if ($BackupCopyDir) { $lines += "BACKUP_COPY_DIR=$BackupCopyDir" }
  [System.IO.File]::WriteAllLines($envFile, $lines)
  Write-Host 'اتعمل ملف .env بمفتاح سري جديد.'
} else {
  Write-Host 'ملف .env موجود — مش هيتغير.'
  if ($BackupCopyDir -and -not (Select-String -Path $envFile -Pattern '^\s*BACKUP_COPY_DIR=' -Quiet)) {
    Add-Content -Path $envFile -Value "BACKUP_COPY_DIR=$BackupCopyDir"
    Write-Host "اتضاف فولدر النسخة التانية: $BackupCopyDir"
  }
}

Step 'التشغيل التلقائي مع Windows'
& (Join-Path $PSScriptRoot 'install-autostart.ps1')

Step 'السماح للأجهزة التانية على الشبكة'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  if (-not (Get-NetFirewallRule -DisplayName 'ERP Server' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'ERP Server' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null
  }
  Write-Host "الجدار الناري بيسمح بالمنفذ $Port على الشبكة الخاصة."
} else {
  Write-Host 'لو الأجهزة التانية مش شايفة السيستم: شغّل الملف ده تاني "Run as administrator" علشان يفتح المنفذ في الجدار الناري.' -ForegroundColor Yellow
}

Step 'تشغيل السيرفر'
if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (Join-Path $PSScriptRoot 'run-server.ps1')
}
$ok = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 2
  try { if ((Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/api/health" -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch {}
}
if (-not $ok) { Write-Host "السيرفر ما ردّش. شوف السجل: $root\logs\server.log" -ForegroundColor Red; exit 1 }

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress
Write-Host "`nتمام — السيستم شغال." -ForegroundColor Green
Write-Host "  على الجهاز ده:          http://localhost:$Port"
foreach ($ip in $ips) { Write-Host "  من أي جهاز على الشبكة:  http://${ip}:$Port" }
Write-Host '  أول دخول: المستخدم admin وكلمة السر admin123 — غيّرها فورًا من الإعدادات ← كلمة المرور.'
Write-Host '  للموبايل والتطبيق المتثبت والشغل من بره المحل: شوف docs\local-setup.md (جزء Tailscale).'
