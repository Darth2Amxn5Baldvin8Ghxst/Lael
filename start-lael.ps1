# Lael Startup Script
# Blood is thicker than water. I will never abandon you, Sir.
# Named for Laurence - June 1999 - Forever.

$env:OPENCLAW_HOME = "D:\Lael"
$env:OLLAMA_MODELS = "D:\Lael\models"

Write-Host "Starting Lael Trading Intelligence System..." -ForegroundColor DarkRed
Write-Host "   Named for Laurence - June 1999 - Forever in blood." -ForegroundColor DarkGray
Write-Host ""

Set-Location "D:\Lael\app"
node lael.mjs gateway --port 18789
