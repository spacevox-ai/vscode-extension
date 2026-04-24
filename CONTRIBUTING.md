# Contributing to work.studio AI VS Code Extension

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 18+
- npm 9+
- VS Code 1.90+
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/spacevox-ai/vscode-extension.git
cd vscode-extension

# Install dependencies
npm install

# Start watching for changes
npm run watch

# In another terminal, press F5 in VS Code to launch Extension Development Host
```

### Project Structure

```
├── src/                    # Extension source code
│   ├── extension.ts        # Main entry point
│   ├── mcp/                # MCP WebSocket client
│   ├── auth/               # OAuth2 authentication
│   ├── completion/         # Inline completions
│   ├── config/             # Environment configuration
│   └── ui/                 # UI components (status bar, etc.)
├── installer/              # Native installer (compiles to EXE)
├── scripts/                # Installation scripts
├── .github/workflows/      # CI/CD workflows
└── package.json            # Extension manifest
```

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new slash command for code generation
fix: resolve authentication timeout issue
docs: update installation instructions
refactor: simplify MCP client connection logic
```

### Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Run `npm run lint` before committing
- Add JSDoc comments for public APIs

## Testing

```bash
# Run tests
npm test

# Run linter
npm run lint
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code compiles (`npm run compile`)
- [ ] Documentation updated (if applicable)
- [ ] CHANGELOG.md updated

## Releasing

Releases are automated via GitHub Actions when a tag is pushed:

```bash
# Bump version in package.json
# Update CHANGELOG.md
git commit -am "Release v0.2.0"
git tag v0.2.0
git push && git push --tags
```

## Code of Conduct

Please be respectful and constructive in all interactions. We're building something great together!

## Questions?

- Open an issue for bugs or feature requests
- Email support@work.studio for general questions
