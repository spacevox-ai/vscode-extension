#!/bin/bash
#
# Installs work.studio AI VS Code Extension
#
# Usage:
#   ./install-extension.sh                                    # Install from CDN (production)
#   ./install-extension.sh --local ./work-studio-ai-0.1.0.vsix  # Install local file
#   ./install-extension.sh --env local                        # Set to local dev mode
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Defaults
VERSION="latest"
LOCAL_PATH=""
ENVIRONMENT="production"
CDN_BASE_URL="https://cdn.work.studio/vscode-extension"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version|-v)
            VERSION="$2"
            shift 2
            ;;
        --local|-l)
            LOCAL_PATH="$2"
            shift 2
            ;;
        --env|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --version, -v   Version to install (default: latest)"
            echo "  --local, -l     Path to local .vsix file"
            echo "  --env, -e       Environment: local, staging, production (default: production)"
            echo "  --help, -h      Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   work.studio AI - VS Code Extension     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# Check VS Code is installed
if ! command -v code &> /dev/null; then
    echo -e "${RED}❌ VS Code not found. Please install VS Code first.${NC}"
    echo -e "${YELLOW}   Download: https://code.visualstudio.com/download${NC}"
    exit 1
fi

echo -e "${GREEN}✓ VS Code found: $(which code)${NC}"

# Determine VSIX path
VSIX_PATH="$LOCAL_PATH"

if [ -z "$VSIX_PATH" ]; then
    # Download from CDN
    if [ "$VERSION" = "latest" ]; then
        DOWNLOAD_URL="${CDN_BASE_URL}/work-studio-ai-latest.vsix"
    else
        DOWNLOAD_URL="${CDN_BASE_URL}/work-studio-ai-${VERSION}.vsix"
    fi
    
    VSIX_PATH="/tmp/work-studio-ai.vsix"
    
    echo -e "${YELLOW}📥 Downloading extension...${NC}"
    echo "   URL: $DOWNLOAD_URL"
    
    if curl -fSL "$DOWNLOAD_URL" -o "$VSIX_PATH"; then
        echo -e "${GREEN}✓ Downloaded to: $VSIX_PATH${NC}"
    else
        echo -e "${RED}❌ Download failed${NC}"
        echo ""
        echo -e "${YELLOW}💡 Tip: For local development, use:${NC}"
        echo -e "${CYAN}   ./install-extension.sh --local ./work-studio-ai-0.1.0.vsix${NC}"
        exit 1
    fi
fi

# Verify VSIX exists
if [ ! -f "$VSIX_PATH" ]; then
    echo -e "${RED}❌ VSIX file not found: $VSIX_PATH${NC}"
    exit 1
fi

# Install extension
echo ""
echo -e "${YELLOW}📦 Installing extension...${NC}"

if code --install-extension "$VSIX_PATH" --force; then
    echo -e "${GREEN}✓ Extension installed successfully!${NC}"
else
    echo -e "${RED}❌ Installation failed${NC}"
    exit 1
fi

# Configure environment
echo ""
echo -e "${YELLOW}⚙️  Configuring environment: $ENVIRONMENT${NC}"

# Determine settings path
if [[ "$OSTYPE" == "darwin"* ]]; then
    SETTINGS_PATH="$HOME/Library/Application Support/Code/User/settings.json"
else
    SETTINGS_PATH="$HOME/.config/Code/User/settings.json"
fi

# Create settings directory if needed
mkdir -p "$(dirname "$SETTINGS_PATH")"

# Read or create settings
if [ -f "$SETTINGS_PATH" ]; then
    # Use jq if available, otherwise simple sed
    if command -v jq &> /dev/null; then
        jq --arg env "$ENVIRONMENT" '.["workstudio.environment"] = $env' "$SETTINGS_PATH" > "${SETTINGS_PATH}.tmp"
        mv "${SETTINGS_PATH}.tmp" "$SETTINGS_PATH"
    else
        echo -e "${YELLOW}⚠️  jq not found. Please set workstudio.environment manually in VS Code settings.${NC}"
    fi
else
    echo "{\"workstudio.environment\": \"$ENVIRONMENT\"}" > "$SETTINGS_PATH"
fi

echo -e "${GREEN}✓ Environment set to: $ENVIRONMENT${NC}"

# Done!
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Installation complete!${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Reload VS Code (Cmd+Shift+P → 'Reload Window')"
echo "  2. Click 'work.studio: Sign In' in the status bar"
echo "  3. Start coding with AI assistance!"
echo ""
echo "💬 Chat: Press Ctrl+Alt+W (Cmd+Alt+W on Mac) or use @workstudio"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
