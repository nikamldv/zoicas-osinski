$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$env:ENV_FILE = ".env.backup"
& node "$PSScriptRoot\mysql-backup.js" --config=.env.backup --allow-production
exit $LASTEXITCODE
