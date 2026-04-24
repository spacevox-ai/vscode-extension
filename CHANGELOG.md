# Changelog

All notable changes to the work.studio AI VS Code Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-23

### Added
- 🤖 AI Chat Participant (`@workstudio`) with slash commands
- ⚡ Slash commands: `/explain`, `/fix`, `/test`, `/docs`, `/refactor`
- 💡 Inline code completion with AI suggestions
- 🔒 OAuth2 PKCE authentication via Keycloak
- 📡 MCP (Model Context Protocol) WebSocket integration
- 🌐 Environment presets (local, staging, production)
- 📦 Native installers for Windows, macOS, and Linux
- 🔧 Configurable settings for server URL, auth URL, and agent ID

### Security
- Credentials stored in system keychain
- TLS encryption for all API communication
- No code stored on servers beyond request duration
