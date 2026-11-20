param(
    [ValidateSet("Show", "Install", "Remove")]
    [string]$Action = "Show",
    [switch]$ApproveProductionSchedule
)

$taskName = "ZoicasOsinski-DailyMySqlBackup"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "run-daily-backup.ps1"

if ($Action -eq "Show") {
    Write-Output "Prepared task name: $taskName"
    Write-Output "Schedule: daily at 02:30 local time"
    Write-Output "No task has been installed by this command. Use -Action Install -ApproveProductionSchedule only after written approval."
    exit 0
}

if (-not $ApproveProductionSchedule) { throw "Installation or removal requires explicit -ApproveProductionSchedule." }
if ($Action -eq "Remove") { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop; exit 0 }

$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30AM
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -Description "Private Zoicas & Osinski MySQL backup. Requires .env.backup and explicit production approval." -Force
