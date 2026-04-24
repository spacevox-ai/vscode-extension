#!/usr/bin/env node
/**
 * work.studio AI VS Code Extension Installer
 * 
 * Standalone installer that can be compiled to EXE using pkg.
 * Downloads and installs the extension with proper configuration.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

// Configuration
const CONFIG = {
    extensionId: 'workstudio.work-studio-ai',
    repoOwner: 'spacevox-ai',
    repoName: 'vscode-extension',
    vsixName: 'work-studio-ai',
    defaultEnvironment: 'production',
};

// Colors for terminal output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
    console.log(`${colors.cyan}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
    console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
    console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function logWarning(message) {
    console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

// Print banner
function printBanner() {
    console.log('');
    log('╔══════════════════════════════════════════════════════╗', 'cyan');
    log('║                                                      ║', 'cyan');
    log('║        work.studio AI - VS Code Extension            ║', 'cyan');
    log('║                    Installer                         ║', 'cyan');
    log('║                                                      ║', 'cyan');
    log('╚══════════════════════════════════════════════════════╝', 'cyan');
    console.log('');
}

// Check if VS Code is installed
function checkVSCode() {
    logStep('1/5', 'Checking VS Code installation...');
    
    try {
        const result = execSync('code --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const version = result.split('\n')[0];
        logSuccess(`VS Code found: v${version}`);
        return true;
    } catch (error) {
        logError('VS Code not found!');
        console.log('');
        log('Please install VS Code first:', 'yellow');
        log('  https://code.visualstudio.com/download', 'cyan');
        console.log('');
        return false;
    }
}

// Get latest release info from GitHub
async function getLatestRelease() {
    logStep('2/5', 'Fetching latest version...');
    
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${CONFIG.repoOwner}/${CONFIG.repoName}/releases/latest`,
            headers: {
                'User-Agent': 'work-studio-installer',
                'Accept': 'application/vnd.github.v3+json',
            },
        };
        
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const release = JSON.parse(data);
                        logSuccess(`Latest version: ${release.tag_name}`);
                        resolve(release);
                    } catch (e) {
                        reject(new Error('Failed to parse release info'));
                    }
                } else if (res.statusCode === 404) {
                    // No releases yet, use local or bundled
                    logWarning('No releases found, will use bundled version');
                    resolve(null);
                } else {
                    reject(new Error(`GitHub API returned ${res.statusCode}`));
                }
            });
        }).on('error', reject);
    });
}

// Download file
async function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const protocol = url.startsWith('https') ? https : http;
        
        const request = protocol.get(url, { 
            headers: { 'User-Agent': 'work-studio-installer' }
        }, (response) => {
            // Handle redirects
            if (response.statusCode === 302 || response.statusCode === 301) {
                file.close();
                fs.unlinkSync(destPath);
                return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`Download failed with status ${response.statusCode}`));
                return;
            }
            
            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize) {
                    const percent = Math.round((downloadedSize / totalSize) * 100);
                    process.stdout.write(`\r   Downloading: ${percent}%`);
                }
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                console.log(''); // New line after progress
                resolve(destPath);
            });
        });
        
        request.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

// Download VSIX from release
async function downloadVSIX(release) {
    logStep('3/5', 'Downloading extension...');
    
    const tempDir = process.env.TEMP || process.env.TMP || '/tmp';
    const vsixPath = path.join(tempDir, 'work-studio-ai.vsix');
    
    // Find VSIX asset in release
    if (release && release.assets) {
        const vsixAsset = release.assets.find(a => a.name.endsWith('.vsix'));
        if (vsixAsset) {
            await downloadFile(vsixAsset.browser_download_url, vsixPath);
            logSuccess(`Downloaded: ${vsixAsset.name}`);
            return vsixPath;
        }
    }
    
    // Check for bundled VSIX (when compiled with pkg)
    const bundledPath = path.join(__dirname, 'work-studio-ai.vsix');
    if (fs.existsSync(bundledPath)) {
        fs.copyFileSync(bundledPath, vsixPath);
        logSuccess('Using bundled extension');
        return vsixPath;
    }
    
    throw new Error('No VSIX found. Please download manually from GitHub releases.');
}

// Install extension
function installExtension(vsixPath) {
    logStep('4/5', 'Installing extension...');
    
    try {
        execSync(`code --install-extension "${vsixPath}" --force`, { 
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        logSuccess('Extension installed successfully!');
        return true;
    } catch (error) {
        logError(`Installation failed: ${error.message}`);
        return false;
    }
}

// Configure extension settings
function configureSettings(environment) {
    logStep('5/5', `Configuring environment: ${environment}...`);
    
    // Determine settings path based on OS
    let settingsPath;
    if (process.platform === 'win32') {
        settingsPath = path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
    } else if (process.platform === 'darwin') {
        settingsPath = path.join(process.env.HOME, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    } else {
        settingsPath = path.join(process.env.HOME, '.config', 'Code', 'User', 'settings.json');
    }
    
    // Ensure directory exists
    const settingsDir = path.dirname(settingsPath);
    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
    }
    
    // Read existing settings or create empty
    let settings = {};
    if (fs.existsSync(settingsPath)) {
        try {
            const content = fs.readFileSync(settingsPath, 'utf8');
            // Remove comments (simple approach)
            const cleanContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            settings = JSON.parse(cleanContent);
        } catch (e) {
            logWarning('Could not parse existing settings, creating new');
        }
    }
    
    // Set environment
    settings['workstudio.environment'] = environment;
    
    // Write settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    logSuccess(`Environment set to: ${environment}`);
}

// Print success message
function printSuccess() {
    console.log('');
    log('═══════════════════════════════════════════════════════', 'green');
    log('  ✅ Installation Complete!', 'green');
    log('═══════════════════════════════════════════════════════', 'green');
    console.log('');
    log('Next Steps:', 'cyan');
    console.log('  1. Restart VS Code (or reload window: Ctrl+Shift+P → "Reload Window")');
    console.log('  2. Click "work.studio: Sign In" in the status bar');
    console.log('  3. Complete authentication in your browser');
    console.log('  4. Start coding with AI assistance!');
    console.log('');
    log('Quick Tips:', 'cyan');
    console.log('  • Chat: Press Ctrl+Alt+W or type @workstudio in VS Code Chat');
    console.log('  • Commands: /explain, /fix, /test, /docs, /refactor');
    console.log('  • Completions: Just start typing - suggestions appear automatically');
    console.log('');
}

// Interactive prompt for environment
async function promptEnvironment() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        console.log('');
        log('Select environment:', 'cyan');
        console.log('  [1] Production (default) - api.work.studio');
        console.log('  [2] Staging             - api.stage.work.studio');
        console.log('  [3] Local Development   - localhost:8102');
        console.log('');
        
        rl.question('Enter choice [1-3] or press Enter for default: ', (answer) => {
            rl.close();
            const choice = answer.trim() || '1';
            switch (choice) {
                case '2': resolve('staging'); break;
                case '3': resolve('local'); break;
                default: resolve('production'); break;
            }
        });
    });
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        environment: null,
        silent: false,
        help: false,
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--env':
            case '-e':
                options.environment = args[++i];
                break;
            case '--silent':
            case '-s':
                options.silent = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
        }
    }
    
    return options;
}

// Print help
function printHelp() {
    console.log('');
    console.log('work.studio AI VS Code Extension Installer');
    console.log('');
    console.log('Usage: install-workstudio [options]');
    console.log('');
    console.log('Options:');
    console.log('  -e, --env <env>    Environment: production, staging, local (default: production)');
    console.log('  -s, --silent       Non-interactive mode, use defaults');
    console.log('  -h, --help         Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  install-workstudio                  # Interactive installation');
    console.log('  install-workstudio -e production    # Install with production settings');
    console.log('  install-workstudio -e local -s      # Silent install for local dev');
    console.log('');
}

// Main installation flow
async function main() {
    const options = parseArgs();
    
    if (options.help) {
        printHelp();
        process.exit(0);
    }
    
    printBanner();
    
    // Step 1: Check VS Code
    if (!checkVSCode()) {
        process.exit(1);
    }
    
    // Determine environment
    let environment = options.environment;
    if (!environment && !options.silent) {
        environment = await promptEnvironment();
    }
    environment = environment || CONFIG.defaultEnvironment;
    
    try {
        // Step 2: Get latest release
        const release = await getLatestRelease();
        
        // Step 3: Download VSIX
        const vsixPath = await downloadVSIX(release);
        
        // Step 4: Install extension
        if (!installExtension(vsixPath)) {
            process.exit(1);
        }
        
        // Step 5: Configure settings
        configureSettings(environment);
        
        // Cleanup
        try {
            fs.unlinkSync(vsixPath);
        } catch (e) {
            // Ignore cleanup errors
        }
        
        // Success!
        printSuccess();
        
    } catch (error) {
        console.log('');
        logError(`Installation failed: ${error.message}`);
        console.log('');
        log('Troubleshooting:', 'yellow');
        console.log('  1. Check your internet connection');
        console.log('  2. Try downloading manually from:');
        console.log(`     https://github.com/${CONFIG.repoOwner}/${CONFIG.repoName}/releases`);
        console.log('  3. Install via VS Code: Extensions → Install from VSIX');
        console.log('');
        process.exit(1);
    }
}

// Run
main().catch(error => {
    logError(`Unexpected error: ${error.message}`);
    process.exit(1);
});
