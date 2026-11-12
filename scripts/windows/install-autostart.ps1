# تثبيت التشغيل التلقائي لخادم النظام مع Windows (مهمة في «مُجدول المهام»).
#   التثبيت:   powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
#   الإزالة:   powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1 -Remove
#   تشغيل الآن: Start-ScheduledTask -TaskName "ERP Server"
param([switch]$Remove)
$name = 'ERP Server'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "أُزيلت مهمة التشغيل التلقائي «$name». الخادم الحالي (إن كان يعمل) لم يُوقف."
  exit 0
}

$runner = Join-Path $PSScriptRoot 'run-server.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'تشغيل خادم نظام الحسابات والمخازن تلقائيًا عند تسجيل الدخول، مع إعادة تشغيله إذا توقف.' -Force | Out-Null
Write-Output "تم تثبيت «$name»: سيعمل الخادم تلقائيًا كل مرة تسجّل فيها الدخول إلى Windows."
