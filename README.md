# work.studio AI - VS Code Extension

[![CI](https://github.com/spacevox-ai/vscode-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/spacevox-ai/vscode-extension/actions/workflows/ci.yml)
[![Release](https://github.com/spacevox-ai/vscode-extension/actions/workflows/release.yml/badge.svg)](https://github.com/spacevox-ai/vscode-extension/releases)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/workstudio.work-studio-ai)](https://marketplace.visualstudio.com/items?itemName=workstudio.work-studio-ai)

AI-powered code completion, chat, and governance for Visual Studio Code, powered by [work.studio](https://work.studio).

## ✨ Features

- **🤖 AI Chat Participant** - Use `@workstudio` in VS Code Chat for intelligent coding assistance
- **⚡ Slash Commands** - `/explain`, `/fix`, `/test`, `/docs`, `/refactor`
- **💡 Inline Completions** - AI-powered code suggestions as you type
- **🌐 Multi-Language** - TypeScript, JavaScript, Python, Java, Go, C#, and more
- **🔒 Enterprise Governance** - OAuth2 authentication, usage tracking, team oversight
- **📡 MCP Protocol** - Uses standardized Model Context Protocol for AI integration

---

## 📥 Installation

Choose the method that works best for you:

### Option 1: One-Click Installer (Recommended)

Download and run the installer for your platform:

#### Windows
```powershell
# Download and run (double-click the .exe or run in PowerShell)
Invoke-WebRequest -Uri "https://github.com/spacevox-ai/vscode-extension/releases/latest/download/install-workstudio-win.exe" -OutFile install-workstudio.exe
.\install-workstudio.exe

# Silent install with specific environment
.\install-workstudio.exe --env production --silent
```

#### macOS
```bash
# Intel Mac
curl -L -o install-workstudio https://github.com/spacevox-ai/vscode-extension/releases/latest/download/install-workstudio-macos-x64
chmod +x install-workstudio
./install-workstudio

# Apple Silicon (M1/M2/M3)
curl -L -o install-workstudio https://github.com/spacevox-ai/vscode-extension/releases/latest/download/install-workstudio-macos-arm64
chmod +x install-workstudio
./install-workstudio
```

#### Linux
```bash
curl -L -o install-workstudio https://github.com/spacevox-ai/vscode-extension/releases/latest/download/install-workstudio-linux
chmod +x install-workstudio
./install-workstudio
```

### Option 2: VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"work.studio AI"**
4. Click **Install**

Or via CLI:
```bash
code --install-extension workstudio.work-studio-ai
```

### Option 3: Download VSIX

1. Download `work-studio-ai-x.x.x.vsix` from [Releases](https://github.com/spacevox-ai/vscode-extension/releases)
2. In VS Code: Extensions → `...` → **Install from VSIX...**
3. Select the downloaded file

Or via CLI:
```bash
code --install-extension work-studio-ai-0.1.0.vsix
```

### Option 4: Scripts (for automation/IT deployment)

**Windows (PowerShell):**
```powershell
.\scripts\install-extension.ps1 -Environment production
```

**Mac/Linux (Bash):**
```bash
./scripts/install-extension.sh --env production
```

---

## 🚀 Getting Started

1. **Sign In** - Click "work.studio: Sign In" in the status bar
2. **Authenticate** - Complete OAuth in your browser
3. **Start Coding** - AI completions appear automatically!

### Quick Tips

| Feature | How to Use |
|---------|------------|
| **Chat** | `Ctrl+Alt+W` or `@workstudio` in VS Code Chat |
| **Explain code** | Select code → `/explain` |
| **Fix bugs** | Select code → `/fix` |
| **Generate tests** | Select code → `/test` |
| **Write docs** | Select code → `/docs` |
| **Refactor** | Select code → `/refactor` |
| **Completions** | Just start typing! |

---

## ⚙️ Configuration

Open Settings (`Ctrl+,`) and search for "work.studio":

### Environment Presets

| Setting | Default | Description |
|---------|---------|-------------|
| `workstudio.environment` | `production` | Environment: `local`, `staging`, `production` |

Environments auto-configure URLs:

| Environment | Server | Auth |
|-------------|--------|------|
| `production` | `wss://api.work.studio/ws/mcp` | `https://auth.work.studio` |
| `staging` | `wss://api.stage.work.studio/ws/mcp` | `https://auth.stage.work.studio` |
| `local` | `ws://localhost:8102/ws/mcp` | `https://auth.spacevox.local` |

### Manual Overrides (Optional)

| Setting | Description |
|---------|-------------|
| `workstudio.serverUrl` | Override MCP WebSocket URL |
| `workstudio.authUrl` | Override authentication URL |
| `workstudio.agentId` | Override AI agent ID |

### Completion Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `workstudio.completion.enabled` | `true` | Enable/disable completions |
| `workstudio.completion.debounceMs` | `300` | Delay before requesting |
| `workstudio.completion.maxTokens` | `256` | Max tokens per suggestion |

---

## 🔧 Development

### Prerequisites

- Node.js 18+
- npm 9+
- VS Code 1.90+

### Build from Source

```bash
# Clone repository
git clone https://github.com/spacevox-ai/vscode-extension.git
cd vscode-extension

# Install dependencies
npm install

# Compile
npm run compile

# Watch mode (auto-rebuild)
npm run watch

# Package as VSIX
npm run package

# Install locally
npm run install-local
```

### Build Native Installers

```bash
cd installer
npm install

# Build all platforms
npm run build

# Or build specific platform
npm run build:win     # Windows EXE
npm run build:mac     # macOS (Intel)
npm run build:mac-arm # macOS (Apple Silicon)
npm run build:linux   # Linux
```

### Project Structure

```
vscode-extension/
├── .github/workflows/
│   ├── ci.yml              # CI pipeline
│   └── release.yml         # Release automation
├── installer/
│   ├── install.js          # Node.js installer (compiles to EXE)
│   └── package.json        # Installer dependencies
├── scripts/
│   ├── install-extension.ps1   # Windows PowerShell script
│   └── install-extension.sh    # Mac/Linux bash script
├── src/
│   ├── extension.ts        # Entry point
│   ├── mcp/                # MCP WebSocket client
│   ├── auth/               # OAuth2 authentication
│   ├── completion/         # Inline completions
│   ├── config/             # Environment config
│   └── ui/                 # Status bar, etc.
├── package.json            # Extension manifest
└── tsconfig.json           # TypeScript config
```

---

## 📦 Publishing

### To VS Code Marketplace

#### Step 1: Create Publisher Account

1. Go to [Azure DevOps](https://dev.azure.com)
2. Create an organization (or use existing)
3. Generate a Personal Access Token (PAT):
   - User Settings → Personal Access Tokens → **New Token**
   - Name: `vsce`
   - Scopes: **Marketplace (Manage)**
   - Copy the token!

#### Step 2: Create/Login Publisher

```bash
# Login with your PAT
npx vsce login workstudio

# Or create new publisher (first time)
npx vsce create-publisher workstudio
```

#### Step 3: Publish

```bash
# Publish current version
npm run publish

# Or with version bump
npx vsce publish minor  # 0.1.0 → 0.2.0
npx vsce publish patch  # 0.1.0 → 0.1.1
npx vsce publish major  # 0.1.0 → 1.0.0
```

#### Step 4: Automated Publishing (CI/CD)

Add your PAT as a GitHub Secret:
1. Repository → Settings → Secrets → Actions
2. Add **`VSCE_PAT`** with your token value

Now releases tagged `vX.X.X` will auto-publish to Marketplace!

### To Private Registry (Enterprise)

```bash
# Package VSIX
npm run package

# Upload to S3/CDN
aws s3 cp work-studio-ai-*.vsix s3://your-cdn/vscode-extensions/

# Or Azure Blob Storage
az storage blob upload --file work-studio-ai-*.vsix --container extensions --account-name youraccount
```

---

## 🏷️ Creating Releases

### Manual Release

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit: `git commit -am "Release v0.2.0"`
4. Tag: `git tag v0.2.0`
5. Push: `git push && git push --tags`

### Automated Release (GitHub Actions)

When you push a tag like `v0.2.0`, GitHub Actions will:

1. ✅ Build VSIX package
2. ✅ Build native installers (Windows EXE, macOS, Linux)
3. ✅ Create GitHub Release with all artifacts
4. ✅ Publish to VS Code Marketplace (if `VSCE_PAT` is configured)

### Version Conventions

| Tag Format | Type | Marketplace |
|------------|------|-------------|
| `v1.0.0` | Stable | ✅ Published |
| `v1.0.0-beta.1` | Beta | ❌ Pre-release only |
| `v1.0.0-alpha.1` | Alpha | ❌ Pre-release only |
| `v1.0.0-rc.1` | Release Candidate | ❌ Pre-release only |

---

## 🔐 Security

- OAuth2 PKCE authentication (no secrets stored locally)
- Credentials stored in system keychain via `keytar`
- All communication over TLS (except local dev)
- No code stored on servers beyond request duration

---

## 🐛 Troubleshooting

### "Not connected" error
1. Check internet connection
2. Run `work.studio: Sign In` to re-authenticate
3. Check Output panel: View → Output → work.studio AI

### Completions not appearing
1. Verify `workstudio.completion.enabled` is `true`
2. Check you're authenticated
3. Ensure language is supported

### Authentication fails
1. Verify `workstudio.authUrl` is correct
2. Allow popup/redirect in browser
3. Try signing out and back in

### "Agent not found" error
1. Ensure backend service is running
2. Verify agent ID is valid

---

## 📝 License

MIT License - see [LICENSE](LICENSE)

---

## 🙋 Support

- 📧 Email: support@work.studio
- 🐛 Issues: [GitHub Issues](https://github.com/spacevox-ai/vscode-extension/issues)
- 📚 Docs: [work.studio Documentation](https://docs.work.studio)
