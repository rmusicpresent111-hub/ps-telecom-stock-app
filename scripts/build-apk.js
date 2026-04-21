/**
 * Cross-platform APK Build Script
 * Works on Windows PowerShell, Linux, and macOS
 * 
 * Usage: node scripts/build-apk.js
 * 
 * This script:
 * 1. Temporarily moves the API folder (static export doesn't need server routes)
 * 2. Builds the Next.js static export to ./out
 * 3. Restores the API folder
 * 4. Syncs with Capacitor Android
 * 5. Opens Android Studio
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const TEMP_DIR = path.join(ROOT, '.api-routes-temp');
const OUT_DIR = path.join(ROOT, 'out');

// Detect package manager
function detectRunner() {
  // Try bunx first (user has bun installed), then npx
  try { execSync('bun --version', { stdio: 'pipe' }); return 'bunx'; } catch {}
  try { execSync('npx --version', { stdio: 'pipe' }); return 'npx'; } catch {}
  return null;
}

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, shell: true });
}

function tryRun(cmd) {
  try {
    run(cmd);
    return true;
  } catch {
    return false;
  }
}

function exists(p) {
  return fs.existsSync(p);
}

function moveDir(src, dest) {
  if (exists(src)) {
    fs.renameSync(src, dest);
    console.log(`✓ Moved ${path.basename(src)} → ${path.basename(dest)}`);
  }
}

// Step 1: Move API folder out of the way
console.log('\n📦 PS TELECOM - APK Build Script');
console.log('================================\n');

if (exists(API_DIR)) {
  console.log('Step 1: Moving API routes temporarily...');
  moveDir(API_DIR, TEMP_DIR);
} else {
  console.log('Step 1: API folder already moved, skipping...');
}

// Step 2: Build static export
try {
  console.log('\nStep 2: Building Next.js static export...');
  run('npx next build');
} catch (err) {
  console.error('\n❌ Build failed! Restoring API folder...');
  if (exists(TEMP_DIR)) {
    moveDir(TEMP_DIR, API_DIR);
  }
  process.exit(1);
}

// Step 3: Restore API folder
console.log('\nStep 3: Restoring API folder...');
if (exists(TEMP_DIR)) {
  moveDir(TEMP_DIR, API_DIR);
} else {
  console.log('  No temp folder to restore.');
}

// Step 4: Verify output
if (!exists(OUT_DIR)) {
  console.error('\n❌ Build output ./out not found! Something went wrong.');
  process.exit(1);
}

const indexHtml = path.join(OUT_DIR, 'index.html');
if (!exists(indexHtml)) {
  console.error('\n❌ index.html not found in ./out! Build may have failed.');
  process.exit(1);
}

console.log('\n✅ Static build successful! ./out directory is ready.');

// Step 5: Capacitor sync
const runner = detectRunner();
console.log(`\nStep 4: Syncing with Capacitor Android (using ${runner || 'manual'})...`);

let syncSuccess = false;

if (runner === 'bunx') {
  syncSuccess = tryRun('bunx @capacitor/cli sync android');
  if (!syncSuccess) {
    console.log('\n  bunx failed, trying with local capacitor...');
    syncSuccess = tryRun('node ./node_modules/@capacitor/cli/bin/capacitor sync android');
  }
} else if (runner === 'npx') {
  syncSuccess = tryRun('npx @capacitor/cli sync android');
  if (!syncSuccess) {
    console.log('\n  npx failed, trying with local capacitor...');
    syncSuccess = tryRun('node ./node_modules/@capacitor/cli/bin/capacitor sync android');
  }
}

// Last resort: try direct node execution
if (!syncSuccess) {
  const localCap = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
  if (exists(localCap)) {
    console.log('\n  Trying direct node execution...');
    syncSuccess = tryRun(`node "${localCap}" sync android`);
  }
}

if (!syncSuccess) {
  console.log('\n⚠️  Capacitor sync failed. Try running manually:');
  console.log('    bunx @capacitor/cli sync android');
  console.log('    OR: npx @capacitor/cli sync android');
}

// Step 6: Open Android Studio
console.log('\nStep 5: Opening Android Studio...');
let opened = false;

if (runner === 'bunx') {
  opened = tryRun('bunx @capacitor/cli open android');
} else if (runner === 'npx') {
  opened = tryRun('npx @capacitor/cli open android');
}

if (!opened) {
  const localCap = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
  if (exists(localCap)) {
    opened = tryRun(`node "${localCap}" open android`);
  }
}

if (!opened) {
  console.log('\n⚠️  Could not auto-open Android Studio.');
  console.log('    Open Android Studio manually → File → Open → select the "android" folder');
}

console.log('\n🎉 Done! Build your APK in Android Studio:');
console.log('   Build → Build Bundle(s) / APK(s) → Build APK(s)');
