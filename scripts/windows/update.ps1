# تحديث النظام على جهاز المحل لآخر نسخة، من غير ما البيانات تتلمس.
#   كليك يمين على الملف ← Run with PowerShell
#   أو:  powershell -ExecutionPolicy Bypass -File scripts\windows\update.ps1
# الترتيب: يقفل السيرفر ← ياخد نسخة احتياطية ← ينزّل التحديث ← يشغّل السيرفر تاني.
# (السيرفر لازم يكون مقفول وقت النسخة: قاعدة البيانات المحلية ما ينفعش برنامجين يفتحوها في نفس الوقت)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
$port = 4000
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Start-Server {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (Join-Path $PSScriptRoot 'run-server.ps1')
}

Step 'قفل السيرفر'
# الأول المشغّل اللي بيعيد تشغيله (run-server.ps1) علشان ما يرجعش يقوم في النص، وبعدين السيرفر نفسه
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*run-server.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
foreach ($i in 1..15) { if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Seconds 1 }
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { Write-Host 'السيرفر مش راضي يقفل — التحديث اتلغى.' -ForegroundColor Red; exit 1 }
Write-Host 'السيرفر اتقفل.'

try {
  Step 'نسخة احتياطية قبل التحديث'
  npm.cmd run backup
  if ($LASTEXITCODE -ne 0) { throw 'ما قدرتش آخد نسخة — التحديث اتلغى علشان البيانات تفضل في أمان.' }

  Step 'تنزيل آخر نسخة من الكود'
  if (Test-Path (Join-Path $root '.git')) {
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'ما قدرتش أنزّل التحديث (git pull)' }
  } else {
    Write-Host 'الفولدر ده مش متوصل بـ Git — انسخ ملفات النسخة الجديدة فوقه (من غير data و backups و .env) وبعدين شغّل الملف ده تاني.' -ForegroundColor Yellow
  }

  Step 'تنزيل المكتبات وتجهيز الواجهة'
  npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'فشل تنزيل المكتبات' }
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'فشل تجهيز الواجهة' }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'هرجّع السيرفر يشتغل بالنسخة اللي كانت شغالة.' -ForegroundColor Yellow
} finally {
  Step 'تشغيل السيرفر'
  Start-Server
}

$ok = $false
foreach ($i in 1..45) {
  Start-Sleep -Seconds 2
  try { if ((Invoke-WebRequest -UseBasicParsing "http://localhost:$port/api/health" -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch {}
}
if ($ok) { Write-Host "`nتمام — السيستم شغال. افتحه على الأجهزة ودوس «تحديث» لو ظهرت الرسالة." -ForegroundColor Green }
else { Write-Host "السيرفر ما رجعش. شوف السجل: $root\logs\server.log" -ForegroundColor Red; exit 1 }
