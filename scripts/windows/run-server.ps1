# تشغيل خادم النظام في الخلفية مع إعادة التشغيل التلقائي إذا توقف لأي سبب.
# يستدعيه «مُجدول المهام» في Windows عند تسجيل الدخول (انظر install-autostart.ps1).
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'server.log'
$port = 4000
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}

function Write-Log($msg) { Add-Content -Path $log -Value ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg) -Encoding utf8 }

# لا نشغّل نسخة ثانية إذا كان الخادم يعمل بالفعل
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Write-Log "الخادم يعمل بالفعل على المنفذ $port — لا حاجة لتشغيل نسخة أخرى."
  exit 0
}

Set-Location $root
while ($true) {
  # تدوير السجل حتى لا يكبر بلا حد (5 ميجا)
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item -Force $log "$log.old" }
  Write-Log 'بدء تشغيل الخادم...'
  # التحويل عبر cmd يحفظ مخرجات الخادم كما هي (UTF-8) بدل UTF-16 في PowerShell 5.1
  cmd.exe /d /c "npm.cmd run start >> `"$log`" 2>&1"
  Write-Log "توقف الخادم (رمز الخروج $LASTEXITCODE). إعادة التشغيل بعد 10 ثوانٍ."
  Start-Sleep -Seconds 10
  # إذا شغّله أحد يدويًا في هذه الأثناء لا نكرر
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { Write-Log 'الخادم يعمل من مكان آخر — إنهاء.'; exit 0 }
}
