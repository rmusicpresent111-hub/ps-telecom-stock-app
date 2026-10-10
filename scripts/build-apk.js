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
 * 4. Adds Android platform if missing
 * 5. Syncs with Capacitor Android
 * 6. Opens Android Studio
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const TEMP_DIR = path.join(ROOT, '.api-routes-temp');
const OUT_DIR = path.join(ROOT, 'out');
const ANDROID_DIR = path.join(ROOT, 'android');

// Detect package manager
function detectRunner() {
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

// Run capacitor command with fallbacks
function capCmd(args) {
  const runner = detectRunner();
  let success = false;

  // Method 1: Use detected runner (bunx or npx)
  if (runner === 'bunx') {
    success = tryRun(`bunx @capacitor/cli ${args}`);
  } else if (runner === 'npx') {
    success = tryRun(`npx @capacitor/cli ${args}`);
  }

  // Method 2: Use local capacitor binary
  if (!success) {
    const localCap = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
    if (exists(localCap)) {
      console.log('\n  Trying local capacitor...');
      success = tryRun(`node "${localCap}" ${args}`);
    }
  }

  return success;
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

// Step 5: Add Android platform if missing
if (!exists(ANDROID_DIR)) {
  console.log('\nStep 4: Android platform not found. Adding it...');
  
  // Make sure @capacitor/android is installed
  if (!exists(path.join(ROOT, 'node_modules', '@capacitor', 'android'))) {
    console.log('  Installing @capacitor/android...');
    try {
      run('bun add @capacitor/android');
    } catch {
      try { run('npm install @capacitor/android'); } catch {}
    }
  }

  const added = capCmd('add android');
  if (!added) {
    console.error('\n❌ Failed to add Android platform. Try manually:');
    console.error('    bunx @capacitor/cli add android');
    process.exit(1);
  }
  console.log('✅ Android platform added!');
} else {
  console.log('\nStep 4: Android platform already exists, skipping add.');
}

// Step 5.5: Brand assets — regenerate the PS TELECOM launcher icons and
// native splash from ./assets (icon-only / icon-foreground /
// icon-background / splash / splash-dark) into android/app/src/main/res.
// Idempotent and cheap; run whenever assets/ exists so icon updates land on
// every build, not only on a fresh `cap add`.
if (exists(path.join(ROOT, 'assets', 'icon-only.png'))) {
  console.log('\nStep 4.5: Generating PS TELECOM launcher icons & splash...');
  let branded = false;
  const brandRunner = detectRunner();
  if (brandRunner === 'bunx') {
    branded = tryRun('bunx @capacitor/assets generate --android --assetPath assets');
  } else if (brandRunner === 'npx') {
    branded = tryRun('npx @capacitor/assets generate --android --assetPath assets');
  }
  if (!branded) {
    const localAssets = path.join(ROOT, 'node_modules', '@capacitor', 'assets', 'bin', 'capacitor-assets');
    if (exists(localAssets)) {
      branded = tryRun(`node "${localAssets}" generate --android --assetPath assets`);
    }
  }
  if (branded) {
    console.log('✅ Icons & splash branded!');
  } else {
    console.log('\n⚠️  Could not generate brand assets (icons stay default).');
    console.log('    Try manually: npx @capacitor/assets generate --assetPath assets');
  }
} else {
  console.log('\nStep 4.5: No assets/ folder found, skipping icon branding.');
}

// Step 6: Capacitor sync
console.log('\nStep 5: Syncing with Capacitor Android...');
const syncSuccess = capCmd('sync android');

if (!syncSuccess) {
  console.log('\n⚠️  Capacitor sync failed. Try running manually:');
  console.log('    bunx @capacitor/cli sync android');
}

// Step 7: Open Android Studio
console.log('\nStep 6: Opening Android Studio...');
const opened = capCmd('open android');

if (!opened) {
  console.log('\n⚠️  Could not auto-open Android Studio.');
  console.log('    Open Android Studio manually → File → Open → select the "android" folder:');
  console.log('    ' + ANDROID_DIR);
}

console.log('\n🎉 Done! Build your APK in Android Studio:');
console.log('   Build → Build Bundle(s) / APK(s) → Build APK(s)');
