/**
 * Cross-platform APK Build Script
 * Works on Windows PowerShell, Linux, and macOS
 * 
 * Usage: node scripts/build-apk.js
 * 
 * This script:
 * 0. VERCEL DEPLOY GUARD — when VERCEL=1 (Vercel runs `npm run build` on every
 *    deploy), a plain `next build` is executed and the script exits. Server
 *    hosting needs the normal .next output with API routes intact, NOT the
 *    APK's static ./out export. next.config.ts already switches `output` to
 *    server mode whenever VERCEL is set.
 * 1. Temporarily moves the API folder (static export doesn't need server routes)
 * 2. Builds the Next.js static export to ./out
 * 3. Restores the API folder
 * 4. Adds Android platform if missing
 * 5. Syncs with Capacitor Android
 * 6. COMPILES THE APK ITSELF via Gradle (auto-detects Java) and copies it to
 *    the project root as PS-TELECOM-debug.apk — no Android Studio steps needed
 * 7. Only if Gradle fails: opens Android Studio with manual instructions
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

// ---------------------------------------------------------------------------
// STEP 0 — Vercel deploy guard (must run before ANY APK/static-export logic).
// Without this, a Vercel deployment fails with "Build output ./out not found"
// because server mode produces .next, never ./out.
// ---------------------------------------------------------------------------
if (process.env.VERCEL) {
  console.log('\n🌐 Vercel detected → running standard Next.js server build (APK steps skipped)...');
  const localNext = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  let vercelBuildOk;
  if (exists(localNext)) {
    // Most reliable: run the locally installed Next.js binary with node directly.
    vercelBuildOk = tryRun(`node "${localNext}" build`);
  } else {
    const vercelRunner = detectRunner() || 'npx';
    vercelBuildOk = tryRun(`${vercelRunner} next build`);
  }
  if (!vercelBuildOk) {
    console.error('\n❌ Vercel build failed.');
    process.exit(1);
  }
  console.log('\n✅ Vercel server build complete (.next output, API routes included).');
  process.exit(0);
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

// Step 0: Cloud sync secrets preflight (git-ignored file must exist)
const SECRETS_FILE = path.join(ROOT, 'src', 'lib', 'd1-secrets.ts');
if (!exists(SECRETS_FILE)) {
  console.error('\n❌ Missing src/lib/d1-secrets.ts (cloud sync credentials).');
  console.error('   Fix: copy the template and paste your real values:\n');
  console.error('     cp src/lib/d1-secrets.example.ts src/lib/d1-secrets.ts');
  console.error('     # then open src/lib/d1-secrets.ts and paste Account ID / Database ID / API Token\n');
  console.error('   (This file is git-ignored — the token never enters git.)');
  process.exit(1);
}
const secretsProbe = fs.readFileSync(SECRETS_FILE, 'utf8');
if (secretsProbe.includes('PASTE_YOUR_')) {
  console.error('\n❌ src/lib/d1-secrets.ts still contains placeholders (PASTE_YOUR_...).');
  console.error('   Open it and paste your real Cloudflare Account ID / Database ID / API Token.');
  process.exit(1);
}
console.log('✓ Cloud sync secrets found (src/lib/d1-secrets.ts)');

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

// ---------------------------------------------------------------------------
// STEP 5.7 — Native "WhatsappSender" plugin install (bill PDF → the bill's
// customer WhatsApp chat directly, no contact picking).
// Copies native/android/WhatsappSender.java into the android project under
// the app's package and registers it in MainActivity. Idempotent + fail-soft:
// any problem only means the app keeps using the share-sheet flow.
// ---------------------------------------------------------------------------
function installWhatsappPlugin() {
  console.log('\nStep 5.7: Installing native WhatsappSender plugin...');
  try {
    const src = path.join(ROOT, 'native', 'android', 'WhatsappSender.java');
    const cfgPath = path.join(ROOT, 'capacitor.config.json');
    if (!exists(src) || !exists(cfgPath) || !exists(ANDROID_DIR)) {
      console.log('  ⚠️  Skipping (native/android/WhatsappSender.java or android/ missing).');
      return;
    }
    const appId = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).appId;
    const javaDir = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java', ...appId.split('.'));
    const mainActivity = path.join(javaDir, 'MainActivity.java');
    if (!exists(mainActivity)) {
      console.log('  ⚠️  MainActivity.java not found — skipping plugin install.');
      return;
    }

    // 1) copy the plugin class with the real package name
    fs.mkdirSync(javaDir, { recursive: true });
    const java = fs.readFileSync(src, 'utf8').replace(/__PACKAGE_NAME__/g, appId);
    fs.writeFileSync(path.join(javaDir, 'WhatsappSender.java'), java);

    // 2) register it in MainActivity (same package → no import needed)
    let ma = fs.readFileSync(mainActivity, 'utf8');
    if (!ma.includes('WhatsappSender')) {
      const marker = 'super.onCreate(savedInstanceState);';
      if (!ma.includes(marker)) {
        console.log('  ⚠️  Could not patch MainActivity (unexpected content) — plugin NOT registered.');
        return;
      }
      ma = ma.replace(
        marker,
        `${marker}\n        // Local plugin: bill PDF → customer's WhatsApp chat directly\n        registerPlugin(WhatsappSender.class);`
      );
      fs.writeFileSync(mainActivity, ma);
    }
    console.log(`  ✅ WhatsappSender installed for ${appId} (direct PDF → customer chat)`);
  } catch (err) {
    console.log(`  ⚠️  Plugin install failed (${(err && err.message) || err}) — continuing; share-sheet flow stays active.`);
  }
}
installWhatsappPlugin();


// ---------------------------------------------------------------------------
// STEP 7 — Compile the APK with Gradle directly (no Android Studio needed).
// Finds a JDK (JAVA_HOME → Android Studio's embedded JBR → java on PATH),
// runs `gradlew assembleDebug`, then copies the APK to the project root.
// ---------------------------------------------------------------------------
function findJavaHome() {
  const candidates = [];

  if (process.env.JAVA_HOME && exists(process.env.JAVA_HOME)) {
    candidates.push(process.env.JAVA_HOME);
  }

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Android\\Android Studio Preview\\jbr'
    );
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Android Studio', 'jbr'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      '/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home'
    );
  } else {
    candidates.push('/opt/android-studio/jbr', '/usr/local/android-studio/jbr');
  }

  for (const c of candidates) {
    if (c && exists(c)) return c;
  }

  // Last resort: java already on PATH?
  try {
    execSync('java -version', { stdio: 'pipe', shell: true });
    return ''; // gradlew will resolve java from PATH when JAVA_HOME is unset
  } catch {}

  return null;
}

function buildApkWithGradle() {
  const gradlew = process.platform === 'win32'
    ? path.join(ANDROID_DIR, 'gradlew.bat')
    : path.join(ANDROID_DIR, 'gradlew');

  if (!exists(gradlew)) {
    console.log('  gradle wrapper not found — skipping automatic APK build.');
    return false;
  }

  const javaHome = findJavaHome();
  if (javaHome === null) {
    console.log('  No JDK found (JAVA_HOME / Android Studio / PATH) — skipping automatic APK build.');
    return false;
  }

  const gradleEnv = { ...process.env };
  if (javaHome) gradleEnv.JAVA_HOME = javaHome;

  console.log(`\nStep 6: Compiling APK with Gradle (this can take 5–15 min on the FIRST run —`);
  console.log('        it downloads Gradle + dependencies once, do not close this window)...');

  try {
    execSync(
      process.platform === 'win32' ? 'gradlew.bat assembleDebug --console=plain' : './gradlew assembleDebug --console=plain',
      { stdio: 'inherit', cwd: ANDROID_DIR, env: gradleEnv, shell: true }
    );
    return true;
  } catch (err) {
    console.error('\n❌ Gradle build failed (see the error output above).');
    return false;
  }
}

function copyApkToRoot() {
  const built = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!exists(built)) return null;

  const dest = path.join(ROOT, 'PS-TELECOM-debug.apk');
  try {
    fs.copyFileSync(built, dest);
    return dest;
  } catch {
    return built; // fall back to reporting the original path
  }
}

const gradleOk = buildApkWithGradle();

if (gradleOk) {
  const apkPath = copyApkToRoot();
  console.log('\n🎉 APK READY! 🎉');
  if (apkPath) {
    console.log('   📱 ' + apkPath);
    if (apkPath.endsWith('PS-TELECOM-debug.apk')) {
      console.log('   (also kept at android/app/build/outputs/apk/debug/app-debug.apk)');
    }
  } else {
    console.log('   📱 ' + path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'));
  }
  console.log('\n   Install: copy PS-TELECOM-debug.apk to your phone → tap it → allow "Install unknown apps".');
  process.exit(0);
}

// Fallback — Gradle unavailable: hand over to Android Studio.
console.log('\nStep 7: Falling back to Android Studio...');
const opened = capCmd('open android');

if (!opened) {
  console.log('\n⚠️  Could not auto-open Android Studio.');
  console.log('    Open Android Studio manually → File → Open → select the "android" folder:');
  console.log('    ' + ANDROID_DIR);
}

console.log('\n📱 Build the APK in Android Studio:');
console.log('   1. Wait for the bottom progress bar / "Gradle sync finished" to stop');
console.log('   2. Menu: Build → Build Bundle(s) / APK(s) → Build APK(s)');
console.log('   3. Wait for "BUILD SUCCESSFUL" → click "locate" in the popup');
console.log('   APK file: android/app/build/outputs/apk/debug/app-debug.apk');
console.log('\n   If Gradle sync shows errors: File → Sync Project with Gradle Files, and');
console.log('   set Gradle JDK = Embedded JDK (Settings → Build Tools → Gradle).')
