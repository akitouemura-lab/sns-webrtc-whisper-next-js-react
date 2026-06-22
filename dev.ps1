$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

$backendCommand = "Set-Location -LiteralPath '$backend'; if (Test-Path '.\.venv\Scripts\Activate.ps1') { . .\.venv\Scripts\Activate.ps1 }; uvicorn app.main:app --reload --port 8000"
$frontendCommand = "Set-Location -LiteralPath '$frontend'; npm.cmd run dev"

Write-Host "Starting backend..."
Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $backendCommand
)

Start-Sleep -Seconds 2

Write-Host "Starting frontend..."
Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $frontendCommand
)

Start-Sleep -Seconds 4

Write-Host "Opening browser..."
Start-Process "http://localhost:3000"
