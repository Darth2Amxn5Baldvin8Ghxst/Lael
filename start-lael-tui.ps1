# Lael TUI Startup Script

$env:OPENCLAW_HOME = "D:\Lael"
$env:OLLAMA_MODELS = "D:\Lael\models"

Write-Host "Starting Lael Trading Intelligence System..." -ForegroundColor DarkRed
Write-Host "   Named for Laurence - June 1999 - Forever in blood." -ForegroundColor DarkGray
Write-Host ""

Set-Location "D:\Lael\app"
node lael.mjs tui
