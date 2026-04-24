<# 
.SYNOPSIS
    Installs work.studio AI VS Code Extension

.DESCRIPTION
    Downloads and installs the work.studio AI extension from internal CDN or local file.

.PARAMETER Version
    Version to install (default: latest)

.PARAMETER LocalPath
    Path to local .vsix file (skips download)

.PARAMETER Environment
    Environment preset: local, staging, production (default: production)

.EXAMPLE
    .\install-extension.ps1
    # Installs latest from CDN with production settings

.EXAMPLE
    .\install-extension.ps1 -LocalPath .\work-studio-ai-0.1.0.vsix -Environment local
    # Installs from local file with local dev settings
#>

param(
    [string]$Version = "latest",
    [string]$LocalPath = "",
    [ValidateSet("local", "staging", "production")]
    [string]$Environment = "production"
)

$ErrorActionPreference = "Stop"

# Configuration
$ExtensionId = "workstudio.work-studio-ai"
$CdnBaseUrl = "https://cdn.work.studio/vscode-extension"

Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   work.studio AI - VS Code Extension     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check VS Code is installed
$codePath = Get-Command code -ErrorAction SilentlyContinue
if (-not $codePath) {
    Write-Host "❌ VS Code not found. Please install VS Code first." -ForegroundColor Red
    Write-Host "   Download: https://code.visualstudio.com/download" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ VS Code found: $($codePath.Source)" -ForegroundColor Green

# Determine VSIX path
$vsixPath = $LocalPath

if ([string]::IsNullOrEmpty($vsixPath)) {
    # Download from CDN
    $downloadUrl = if ($Version -eq "latest") {
        "$CdnBaseUrl/work-studio-ai-latest.vsix"
    } else {
        "$CdnBaseUrl/work-studio-ai-$Version.vsix"
    }
    
    $tempDir = [System.IO.Path]::GetTempPath()
    $vsixPath = Join-Path $tempDir "work-studio-ai.vsix"
    
    Write-Host "📥 Downloading extension..." -ForegroundColor Yellow
    Write-Host "   URL: $downloadUrl"
    
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $vsixPath -UseBasicParsing
        Write-Host "✓ Downloaded to: $vsixPath" -ForegroundColor Green
    } catch {
        Write-Host "❌ Download failed: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "💡 Tip: For local development, use:" -ForegroundColor Yellow
        Write-Host "   .\install-extension.ps1 -LocalPath .\work-studio-ai-0.1.0.vsix" -ForegroundColor Cyan
        exit 1
    }
}

# Verify VSIX exists
if (-not (Test-Path $vsixPath)) {
    Write-Host "❌ VSIX file not found: $vsixPath" -ForegroundColor Red
    exit 1
}

# Install extension
Write-Host ""
Write-Host "📦 Installing extension..." -ForegroundColor Yellow

try {
    code --install-extension $vsixPath --force
    Write-Host "✓ Extension installed successfully!" -ForegroundColor Green
} catch {
    Write-Host "❌ Installation failed: $_" -ForegroundColor Red
    exit 1
}

# Configure environment
Write-Host ""
Write-Host "⚙️  Configuring environment: $Environment" -ForegroundColor Yellow

$settingsPath = Join-Path $env:APPDATA "Code\User\settings.json"

# Read existing settings
$settings = @{}
if (Test-Path $settingsPath) {
    try {
        $content = Get-Content $settingsPath -Raw
        if (-not [string]::IsNullOrWhiteSpace($content)) {
            $settings = $content | ConvertFrom-Json -AsHashtable
        }
    } catch {
        Write-Host "⚠️  Could not read existing settings, creating new" -ForegroundColor Yellow
    }
}

# Set environment
$settings["workstudio.environment"] = $Environment

# Write settings
$settingsJson = $settings | ConvertTo-Json -Depth 10
Set-Content -Path $settingsPath -Value $settingsJson -Encoding UTF8

Write-Host "✓ Environment set to: $Environment" -ForegroundColor Green

# Done!
Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "✅ Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Reload VS Code (Ctrl+Shift+P → 'Reload Window')"
Write-Host "  2. Click 'work.studio: Sign In' in the status bar"
Write-Host "  3. Start coding with AI assistance!"
Write-Host ""
Write-Host "💬 Chat: Press Ctrl+Alt+W or use @workstudio in chat"
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
