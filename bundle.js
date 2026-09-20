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
console.log('\n📦 Step 2: Packaging Windows Desktop App bundle (.exe & .zip)...');
const winPkgDir = path.join(DIST_DIR, 'windows-package');
try { fs.rmSync(winPkgDir, { recursive: true, force: true }); } catch(e) {}
fs.mkdirSync(winPkgDir, { recursive: true });

// Compile FileTransferFast.exe if csc is available
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const exeDestInDownloads = path.join(DOWNLOADS_DIR, 'FileTransferFast.exe');
const exeDestInPkg = path.join(winPkgDir, 'FileTransferFast.exe');
const rootExe = path.join(ROOT_DIR, 'FileTransferFast.exe');

if (fs.existsSync(cscPath) && fs.existsSync(path.join(ROOT_DIR, 'Launcher.cs'))) {
  try {
    console.log('   🔨 Compiling FileTransferFast.exe with native app icon...');
    const compileCmd = `"${cscPath}" /target:winexe /win32icon:app.ico /r:System.Windows.Forms.dll,System.Drawing.dll /resource:server.js,FileTransferFast.server.js /resource:devices-client.js,FileTransferFast.devices-client.js /resource:client.js,FileTransferFast.client.js /resource:package.json,FileTransferFast.package.json /out:FileTransferFast.exe Launcher.cs`;
    execSync(compileCmd, { cwd: ROOT_DIR, stdio: 'ignore' });
    console.log('   ✔ Successfully compiled FileTransferFast.exe');
  } catch (err) {
    console.warn('   ⚠ C# compilation note:', err.message);
  }
}

if (fs.existsSync(rootExe)) {
  fs.copyFileSync(rootExe, exeDestInDownloads);
  fs.copyFileSync(rootExe, exeDestInPkg);
  const exeStat = fs.statSync(exeDestInDownloads);
  console.log(`   ✔ Generated direct download: live-site/public/downloads/FileTransferFast.exe (${(exeStat.size / 1024).toFixed(1)} KB)`);
}

// Copy required files for the Windows bundle
const filesToCopy = [
  'server.js',
  'devices-client.js',
  'client.js',
  'package.json',
  'start-app.bat',
  'stop-app.bat',
  'app.ico'
];

filesToCopy.forEach(f => {
  const src = path.join(ROOT_DIR, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(winPkgDir, f));
  }
});

// Add clear, user-friendly HOW-TO-RUN instructions for Windows package users
const howToRunText = `=====================================================
⚡ FILE TRANSFER FAST — WINDOWS HOST APP
=====================================================

HOW TO RUN:
1. Double-click "FileTransferFast.exe" (the blue lightning icon).
2. The transfer engine starts and opens your browser automatically!
3. Other devices on your Wi-Fi can now connect via PIN or QR code.

HOW TO STOP:
- Click the "Stop & Exit" button on the File Transfer Fast window.

NOTE:
- Node.js (https://nodejs.org) powers the high-speed transfer engine.
  If not already installed, FileTransferFast.exe will provide a 1-click link.
- Alternatively, you can also run "start-app.bat" anytime.
`;
fs.writeFileSync(path.join(winPkgDir, 'HOW-TO-RUN.txt'), howToRunText, 'utf8');
fs.writeFileSync(path.join(winPkgDir, 'README.txt'), howToRunText, 'utf8');

function createZip(sourceDir, targetZip) {
  if (fs.existsSync(targetZip)) {
    try { fs.unlinkSync(targetZip); } catch (e) {}
  }
  const s = sourceDir.replace(/\\/g, '\\\\');
  const d = targetZip.replace(/\\/g, '\\\\');
  const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${s}', '${d}')"`;
  execSync(psCmd, { stdio: 'pipe' });
  return fs.statSync(targetZip).size;
}

// Compress Windows bundle into live-site downloads
const winZipPath = path.join(DOWNLOADS_DIR, 'file-transfer-windows.zip');
try {
  const size = createZip(winPkgDir, winZipPath);
  console.log(`   ✔ Created: live-site/public/downloads/file-transfer-windows.zip (${(size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.warn('   ⚠ Could not create Windows zip archive:', err.message);
}

// Package Mac & Linux bundle
const macPkgDir = path.join(DIST_DIR, 'mac-linux-package');
if (!fs.existsSync(macPkgDir)) fs.mkdirSync(macPkgDir, { recursive: true });
['server.js', 'devices-client.js', 'client.js', 'package.json', 'start-app.sh', 'stop-app.sh'].forEach(f => {
  const src = path.join(ROOT_DIR, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(macPkgDir, f));
});
const macZipPath = path.join(DOWNLOADS_DIR, 'file-transfer-mac-linux.zip');
try {
  const size = createZip(macPkgDir, macZipPath);
  console.log(`   ✔ Created: live-site/public/downloads/file-transfer-mac-linux.zip (${(size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.warn('   ⚠ Could not create Mac/Linux zip archive:', err.message);
}

// --- STEP 3: Package Mobile Web Bundle ---
console.log('\n📦 Step 3: Packaging Mobile Web Bundle...');
const webZipPath = path.join(DOWNLOADS_DIR, 'file-transfer-web.zip');
try {
  const size = createZip(path.join(DIST_DIR, 'device-ui'), webZipPath);
  console.log(`   ✔ Created: live-site/public/downloads/file-transfer-web.zip (${(size / 1024).toFixed(1)} KB)`);
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
