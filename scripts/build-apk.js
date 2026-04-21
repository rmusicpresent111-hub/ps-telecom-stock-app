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
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const TEMP_DIR = path.join(ROOT, '.api-routes-temp');
const OUT_DIR = path.join(ROOT, 'out');

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
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
console.log('\nStep 4: Syncing with Capacitor Android...');
try {
  run('npx cap sync android');
} catch (err) {
  console.log('\n⚠️  Capacitor sync failed. Try running manually:');
  console.log('    npx cap sync android');
  console.log('    or: bunx @capacitor/cli sync android');
}

// Step 6: Open Android Studio
console.log('\nStep 5: Opening Android Studio...');
try {
  run('npx cap open android');
} catch (err) {
  console.log('\n⚠️  Could not auto-open Android Studio.');
  console.log('    Open it manually and import: ' + path.join(ROOT, 'android'));
}

console.log('\n🎉 Done! Build your APK in Android Studio:');
console.log('   Build → Build Bundle(s) / APK(s) → Build APK(s)');
