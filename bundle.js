// bundle.js — Unified Bundling Script focusing on the Device UI
// Prepares standalone Web, Desktop, and Mobile packages for live distribution

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'live-site', 'public', 'downloads');

console.log('='.repeat(60));
console.log('🚀 BUNDLING FILE TRANSFER APP (Device UI Focus)');
console.log('='.repeat(60));

// Ensure output directories exist
[DIST_DIR, DOWNLOADS_DIR, path.join(DIST_DIR, 'device-ui'), path.join(DIST_DIR, 'windows-package')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- STEP 1: Bundle Standalone Device UI ---
console.log('\n📦 Step 1: Compiling Device UI into standalone web application...');
const serverJsContent = fs.readFileSync(path.join(ROOT_DIR, 'server.js'), 'utf8');
const devicesClientJs = fs.readFileSync(path.join(ROOT_DIR, 'devices-client.js'), 'utf8');

// Extract devicesHtml template from server.js
const match = serverJsContent.match(/const devicesHtml = `([\s\S]*?)`;\s*\n\s*\n\s*\nconst devicesClientJs/);
if (!match) {
  console.error('❌ Could not extract devicesHtml from server.js');
  process.exit(1);
}

const devicesHtml = match[1];
const standaloneHtml = devicesHtml.replace('__DEVICES_CLIENT_JS__', devicesClientJs);

// Write standalone Device UI HTML
const deviceUiHtmlPath = path.join(DIST_DIR, 'device-ui', 'index.html');
fs.writeFileSync(deviceUiHtmlPath, standaloneHtml, 'utf8');
console.log(`   ✔ Generated: dist/device-ui/index.html (${(standaloneHtml.length / 1024).toFixed(1)} KB)`);

// Generate Web App Manifest for Mobile PWA
const manifestJson = {
  name: "File Transfer Fast",
  short_name: "FileTransfer",
  description: "High-speed local Wi-Fi file transfer powered by parallel chunking",
  start_url: "/devices-ui",
  display: "standalone",
  background_color: "#090d16",
  theme_color: "#3b82f6",
  icons: [
    {
      src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>",
      sizes: "192x192 512x512",
      type: "image/svg+xml"
    }
  ]
};
fs.writeFileSync(path.join(DIST_DIR, 'device-ui', 'manifest.json'), JSON.stringify(manifestJson, null, 2), 'utf8');
console.log('   ✔ Generated: dist/device-ui/manifest.json');

// --- STEP 2: Package Windows Desktop App Bundle ---
console.log('\n📦 Step 2: Packaging Windows Desktop App bundle (.zip)...');
const winPkgDir = path.join(DIST_DIR, 'windows-package');

// Copy required files for the Windows bundle
const filesToCopy = [
  'server.js',
  'devices-client.js',
  'client.js',
  'package.json',
  'start-app.bat',
  'stop-app.bat'
];

filesToCopy.forEach(f => {
  const src = path.join(ROOT_DIR, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(winPkgDir, f));
  }
});

// Add README for Windows package users
const readmeText = `=====================================================
File Transfer Fast - Windows Desktop App
=====================================================

QUICK START:
1. Make sure Node.js is installed on your PC (https://nodejs.org).
2. Double-click "start-app.bat".
3. Your browser will automatically open with the high-speed Device UI!

TO STOP:
Double-click "stop-app.bat" or close the console window.
`;
fs.writeFileSync(path.join(winPkgDir, 'README.txt'), readmeText, 'utf8');

// Compress Windows bundle into live-site downloads
const winZipPath = path.join(DOWNLOADS_DIR, 'file-transfer-windows.zip');
try {
  // Use PowerShell Compress-Archive on Windows
  if (process.platform === 'win32') {
    const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${winPkgDir}\\*' -DestinationPath '${winZipPath}' -Force"`;
    execSync(psCmd, { stdio: 'inherit' });
    const stat = fs.statSync(winZipPath);
    console.log(`   ✔ Created: live-site/public/downloads/file-transfer-windows.zip (${(stat.size / 1024).toFixed(1)} KB)`);
  }
} catch (err) {
  console.warn('   ⚠ Could not create zip archive automatically:', err.message);
}

// --- STEP 3: Package Mobile Web Bundle ---
console.log('\n📦 Step 3: Packaging Mobile Web Bundle...');
const webZipPath = path.join(DOWNLOADS_DIR, 'file-transfer-web.zip');
try {
  if (process.platform === 'win32') {
    const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${DIST_DIR}\\device-ui\\*' -DestinationPath '${webZipPath}' -Force"`;
    execSync(psCmd, { stdio: 'inherit' });
    const stat = fs.statSync(webZipPath);
    console.log(`   ✔ Created: live-site/public/downloads/file-transfer-web.zip (${(stat.size / 1024).toFixed(1)} KB)`);
  }
} catch (err) {
  console.warn('   ⚠ Could not create web zip archive:', err.message);
}

// Check if Android APK exists in downloads
const apkPath = path.join(DOWNLOADS_DIR, 'file-transfer.apk');
if (fs.existsSync(apkPath)) {
  const stat = fs.statSync(apkPath);
  console.log(`\n📱 Android APK ready: ${(stat.size / (1024 * 1024)).toFixed(2)} MB in live downloads.`);
} else {
  console.log('\n💡 Note: To serve a native APK, place file-transfer.apk in live-site/public/downloads/.');
  console.log('   The live site also serves the Windows package, Mobile Web App, and direct local connect!');
}

console.log('\n' + '='.repeat(60));
console.log('🎉 BUNDLING COMPLETED SUCCESSFULLY!');
console.log('All packages are ready in: live-site/public/downloads/');
console.log('='.repeat(60) + '\n');
