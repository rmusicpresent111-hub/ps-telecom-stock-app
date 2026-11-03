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
// the site password gate (Next 16 proxy / legacy middleware) can't ship in
// a static export either — move whichever exists aside during the build
const MW_PAIRS = [
  ['src/proxy.ts', '.proxy-apk-temp'],
  ['src/middleware.ts', '.middleware-apk-temp'],
].map(([f, t]) => [path.join(ROOT, f), path.join(ROOT, t)]);
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

// Step 0: Sync preflight — v2.28.0 carries ZERO cloud credentials in the
// app. All D1 traffic is relayed by the deployed server's /api/cloud/d1
// proxy (the CLOUDFLARE_* env vars live ONLY on Vercel). The APK needs just
// the sync account (ID + PIN) and the deployment URL to reach the proxy.
const ENV_FILE = path.join(ROOT, '.env');
if (!exists(ENV_FILE)) {
  console.error('\n❌ Missing .env (sync account + deployment URL).');
  console.error('   Fix: copy the template and paste your real values:\n');
  console.error('     cp .env.example .env');
  console.error('     # then open .env and fill NEXT_PUBLIC_SYNC_ID / NEXT_PUBLIC_SYNC_PIN / NEXT_PUBLIC_SYNC_API_URL\n');
  console.error('   (This file is git-ignored.)');
  process.exit(1);
}
const envProbe = fs.readFileSync(ENV_FILE, 'utf8');
const readEnvVar = (name) => {
  const m = envProbe.match(new RegExp(`^\\s*${name}\\s*=\\s*\\S.*$`, 'm'));
  if (!m) return '';
  return m[0].split('=').slice(1).join('=').trim();
};
const isPlaceholderVal = (v) => !v || /PASTE[._-]?YOUR|CHANGE[._-]?ME/i.test(v);
// FORBIDDEN: any NEXT_PUBLIC_CF_* value would bake the cloud keys into the
// APK bundle — the exact thing v2.28.0 removes. Hard-fail so a stale .env
// can never leak credentials into a shipped binary again.
const forbidden = ['NEXT_PUBLIC_CF_ACCOUNT_ID', 'NEXT_PUBLIC_CF_DATABASE_ID', 'NEXT_PUBLIC_CF_API_TOKEN']
  .filter((n) => !isPlaceholderVal(readEnvVar(n)));
if (forbidden.length > 0) {
  console.error(`\n❌ .env still carries client-side cloud keys: ${forbidden.join(', ')}`);
  console.error('   v2.28.0 keeps credentials on the server (Vercel env vars).');
  console.error('   Delete those lines from .env — the APK talks to the deployed');
  console.error('   /api/cloud/d1 proxy instead, so no token is needed in the app.');
  process.exit(1);
}
const requiredClientVars = ['NEXT_PUBLIC_SYNC_ID', 'NEXT_PUBLIC_SYNC_PIN', 'NEXT_PUBLIC_SYNC_API_URL'];
const missing = requiredClientVars.filter((n) => isPlaceholderVal(readEnvVar(n)));
if (missing.length > 0) {
  console.error(`\n❌ .env is missing real values for: ${missing.join(', ')}`);
  console.error('   NEXT_PUBLIC_SYNC_ID        your sync account (e.g. PS-MUAG-JEEB)');
  console.error('   NEXT_PUBLIC_SYNC_PIN       the sync/admin PIN');
  console.error('   NEXT_PUBLIC_SYNC_API_URL   the deployment origin, e.g. https://artechnologyapp.com');
  process.exit(1);
}
const syncApiUrl = readEnvVar('NEXT_PUBLIC_SYNC_API_URL');
if (!/^https:\/\/\S+$/i.test(syncApiUrl)) {
  console.error('\n❌ NEXT_PUBLIC_SYNC_API_URL must be the deployment origin, e.g. https://artechnologyapp.com');
  process.exit(1);
}
console.log(`✓ Server-managed sync configured (proxy: ${syncApiUrl.replace(/\/+$/, '')}/api/cloud/d1)`);
console.log('✓ No cloud credentials will be baked into the APK');

const movedMw = [];
function moveMwAside() {
  for (const [src, tmp] of MW_PAIRS) {
    if (exists(src)) {
      moveDir(src, tmp);
      movedMw.push([tmp, src]);
    }
  }
}
function restoreMw() {
  for (const [tmp, src] of movedMw) {
    if (exists(tmp)) moveDir(tmp, src);
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
console.log('Step 1b: Moving site-gate proxy/middleware temporarily...');
moveMwAside();

// Step 2: Build static export
try {
  console.log('\nStep 2: Building Next.js static export...');
  run('npx next build');
} catch (err) {
  console.error('\n❌ Build failed! Restoring API folder...');
  if (exists(TEMP_DIR)) {
    moveDir(TEMP_DIR, API_DIR);
  }
  restoreMw();
  process.exit(1);
}

// Step 3: Restore API folder
console.log('\nStep 3: Restoring API folder...');
if (exists(TEMP_DIR)) {
  moveDir(TEMP_DIR, API_DIR);
} else {
  console.log('  No temp folder to restore.');
}
restoreMw();

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
    //    Capacitor 8's fresh template MainActivity is the ONE-LINE
    //    "public class MainActivity extends BridgeActivity {}" — no onCreate
    //    at all — so the old super.onCreate-marker patch silently failed and
    //    the plugin was NEVER registered (the "WhatsApp direct send broken in
    //    the built APK" bug). Handle every template shape:
    //      a) already patched        → skip (idempotent)
    //      b) has super.onCreate(...) → inject registerPlugin right after it
    //      c) minimal class, no onCreate → add a complete onCreate with the
    //         registration (fully-qualified android.os.Bundle → no imports)
    let ma = fs.readFileSync(mainActivity, 'utf8');
    if (ma.includes('WhatsappSender')) {
      console.log('  ✓ WhatsappSender already registered in MainActivity.');
    } else if (ma.includes('super.onCreate(')) {
      ma = ma.replace(
        /(super\.onCreate\([^)]*\);)/,
        '$1\n        // Local plugin: bill PDF → customer\'s WhatsApp chat directly\n        registerPlugin(WhatsappSender.class);'
      );
      fs.writeFileSync(mainActivity, ma);
    } else if (!ma.includes('onCreate(')) {
      const onCreateMethod = [
        '',
        '    @Override',
        '    protected void onCreate(android.os.Bundle savedInstanceState) {',
        '        super.onCreate(savedInstanceState);',
        "        // Local plugin: bill PDF → customer's WhatsApp chat directly",
        '        registerPlugin(WhatsappSender.class);',
        '    }',
        ''
      ].join('\n');
      const lastBrace = ma.lastIndexOf('}');
      if (lastBrace === -1) {
        console.log('  ⚠️  MainActivity.java has no closing brace — plugin NOT registered.');
        return;
      }
      ma = ma.slice(0, lastBrace) + onCreateMethod + ma.slice(lastBrace);
      fs.writeFileSync(mainActivity, ma);
    } else {
      console.log('  ⚠️  MainActivity has onCreate but no super.onCreate call — plugin NOT registered.');
      return;
    }
    console.log(`  ✅ WhatsappSender installed for ${appId} (direct PDF → customer chat)`);
  } catch (err) {
    console.log(`  ⚠️  Plugin install failed (${(err && err.message) || err}) — continuing; share-sheet flow stays active.`);
  }
}
installWhatsappPlugin();

// ---------------------------------------------------------------------------
// STEP 5.7b — Android 11+ PACKAGE VISIBILITY (the "chat list e khujte hochhe"
// bug). On Android 11+ an app cannot even SEE com.whatsapp unless its manifest
// declares <queries> for it. Without this, WhatsappSender.java reports
// "no-whatsapp" on every modern phone and the bill falls back to the generic
// share sheet → WhatsApp's contact picker → the user has to SEARCH for the
// customer. Injecting the queries fixes the direct-send path.
// Idempotent + fail-soft.
// ---------------------------------------------------------------------------
function ensureWhatsappQueries() {
  console.log('\nStep 5.7b: Ensuring Android <queries> for WhatsApp package visibility...');
  try {
    const manifestPath = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
    if (!exists(manifestPath)) {
      console.log('  ⚠️  AndroidManifest.xml not found — skipping (direct-send may show the picker).');
      return;
    }
    let mf = fs.readFileSync(manifestPath, 'utf8');
    if (mf.includes('com.whatsapp"')) {
      console.log('  ✓ <queries> already present.');
      return;
    }
    const packages =
      '<package android:name="com.whatsapp" />\n' +
      '        <package android:name="com.whatsapp.w4b" />';
    const firstQueries = mf.indexOf('<queries');
    if (firstQueries !== -1) {
      // a <queries> block already exists → inject our packages inside it
      const openEnd = mf.indexOf('>', firstQueries) + 1;
      mf = mf.slice(0, openEnd) + '\n        ' + packages + mf.slice(openEnd);
    } else {
      // no <queries> block → add one as a sibling right before <application
      const appIdx = mf.indexOf('<application');
      if (appIdx === -1) {
        console.log('  ⚠️  Could not find <application> in the manifest — skipping.');
        return;
      }
      mf = mf.slice(0, appIdx) + '<queries>\n        ' + packages + '\n    </queries>\n    ' + mf.slice(appIdx);
    }
    fs.writeFileSync(manifestPath, mf);
    console.log('  ✅ <queries> injected — the app can now target WhatsApp directly (Android 11+).');
  } catch (err) {
    console.log(`  ⚠️  Manifest patch failed (${(err && err.message) || err}) — continuing; share-sheet flow stays active.`);
  }
}
ensureWhatsappQueries();

// ---------------------------------------------------------------------------
// STEP 5.7c — Native "AppLock" plugin install (device screen-lock gate on app
// open — fingerprint / face / PIN, the phone's own lock credentials, v2.18.0).
// Copies native/android/AppLockPlugin.java into the android project, registers
// it in MainActivity, and (Step 5.7d) injects the androidx.biometric gradle
// dependency. Idempotent + fail-soft: any problem only means the app opens
// without the lock gate — exactly the behaviour of builds before v2.18.0.
// ---------------------------------------------------------------------------
function installAppLockPlugin() {
  console.log('\nStep 5.7c: Installing native AppLock plugin (screen-lock gate)...');
  try {
    const src = path.join(ROOT, 'native', 'android', 'AppLockPlugin.java');
    const cfgPath = path.join(ROOT, 'capacitor.config.json');
    if (!exists(src) || !exists(cfgPath) || !exists(ANDROID_DIR)) {
      console.log('  ⚠️  Skipping (native/android/AppLockPlugin.java or android/ missing).');
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
    fs.writeFileSync(path.join(javaDir, 'AppLockPlugin.java'), java);

    // 2) register it in MainActivity (same package → no import needed).
    //    Handles every MainActivity template shape (same strategy as the
    //    WhatsappSender installer above):
    //      a) already patched        → skip (idempotent)
    //      b) has super.onCreate(...) → inject registerPlugin right after it
    //      c) minimal class, no onCreate → add a complete onCreate with the
    //         registration (fully-qualified android.os.Bundle → no imports)
    let ma = fs.readFileSync(mainActivity, 'utf8');
    if (ma.includes('AppLockPlugin')) {
      console.log('  ✓ AppLockPlugin already registered in MainActivity.');
    } else if (ma.includes('super.onCreate(')) {
      ma = ma.replace(
        /(super\.onCreate\([^)]*\);)/,
        '$1\n        // Local plugin: device screen-lock (fingerprint/PIN) gate on app open\n        registerPlugin(AppLockPlugin.class);'
      );
      fs.writeFileSync(mainActivity, ma);
    } else if (!ma.includes('onCreate(')) {
      const onCreateMethod = [
        '',
        '    @Override',
        '    protected void onCreate(android.os.Bundle savedInstanceState) {',
        '        super.onCreate(savedInstanceState);',
        '        // Local plugin: device screen-lock (fingerprint/PIN) gate on app open',
        '        registerPlugin(AppLockPlugin.class);',
        '    }',
        ''
      ].join('\n');
      const lastBrace = ma.lastIndexOf('}');
      if (lastBrace === -1) {
        console.log('  ⚠️  MainActivity.java has no closing brace — plugin NOT registered.');
        return;
      }
      ma = ma.slice(0, lastBrace) + onCreateMethod + ma.slice(lastBrace);
      fs.writeFileSync(mainActivity, ma);
    } else {
      console.log('  ⚠️  MainActivity has onCreate but no super.onCreate call — plugin NOT registered.');
      return;
    }
    console.log(`  ✅ AppLockPlugin installed for ${appId} (screen-lock gate on app open)`);
  } catch (err) {
    console.log(`  ⚠️  AppLock plugin install failed (${(err && err.message) || err}) — continuing; the app opens without the lock gate.`);
  }
}

// androidx.biometric gives the AppLock plugin BiometricManager/BiometricPrompt
// (fingerprint + device-credential fallback) on every Android version the app
// supports. Injected into the app-level gradle file (Groovy OR Kotlin DSL).
function ensureBiometricDependency() {
  console.log('\nStep 5.7d: Ensuring androidx.biometric dependency for AppLock...');
  try {
    const gradleFiles = ['app/build.gradle', 'app/build.gradle.kts'];
    for (const rel of gradleFiles) {
      const gradlePath = path.join(ANDROID_DIR, rel);
      if (!exists(gradlePath)) continue;
      let gradle = fs.readFileSync(gradlePath, 'utf8');
      if (gradle.includes('androidx.biometric')) {
        console.log('  ✓ androidx.biometric already present.');
        return;
      }
      const m = gradle.match(/dependencies\s*\{/);
      if (!m) {
        console.log('  ⚠️  dependencies block not found in ' + rel + ' — skipping.');
        return;
      }
      const insertAt = m.index + m[0].length;
      const nl = gradle.includes('\r\n') ? '\r\n' : '\n';
      // Kotlin DSL needs parentheses + double quotes; Groovy uses space + single quotes
      const dep = rel.endsWith('.kts')
        ? '    implementation("androidx.biometric:biometric:1.1.0")'
        : "    implementation 'androidx.biometric:biometric:1.1.0'";
      gradle = gradle.slice(0, insertAt) + nl + dep + gradle.slice(insertAt);
      fs.writeFileSync(gradlePath, gradle);
      console.log('  ✅ androidx.biometric:biometric:1.1.0 added to ' + rel);
      return;
    }
    console.log('  ⚠️  app/build.gradle(.kts) not found — skipping biometric dependency.');
  } catch (err) {
    console.log(`  ⚠️  Biometric dependency injection failed (${(err && err.message) || err}) — the APK still builds; AppLock will just report unavailable.`);
  }
}

installAppLockPlugin();
ensureBiometricDependency();

// ---------------------------------------------------------------------------
// STEP 5.7e — Native "BluetoothPrinter" plugin install (v2.31.0 — thermal
// receipt printing). Copies native/android/BluetoothPrinter.java into the
// android project and registers it in MainActivity. Same idempotent +
// fail-soft strategy as the other local plugins: any problem only means the
// Bluetooth Print button reports "unavailable" — everything else keeps
// working, and NOTHING about sync/storage is touched.
// ---------------------------------------------------------------------------
function installBluetoothPrinterPlugin() {
  console.log('\nStep 5.7e: Installing native BluetoothPrinter plugin (thermal receipts)...');
  try {
    const src = path.join(ROOT, 'native', 'android', 'BluetoothPrinter.java');
    const cfgPath = path.join(ROOT, 'capacitor.config.json');
    if (!exists(src) || !exists(cfgPath) || !exists(ANDROID_DIR)) {
      console.log('  ⚠️  Skipping (native/android/BluetoothPrinter.java or android/ missing).');
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
    fs.writeFileSync(path.join(javaDir, 'BluetoothPrinter.java'), java);

    // 2) register it in MainActivity (handles every template shape — same
    //    strategy as the other plugin installers above).
    let ma = fs.readFileSync(mainActivity, 'utf8');
    if (ma.includes('BluetoothPrinter')) {
      console.log('  ✓ BluetoothPrinter already registered in MainActivity.');
    } else if (ma.includes('super.onCreate(')) {
      ma = ma.replace(
        /(super\.onCreate\([^)]*\);)/,
        '$1\n        // Local plugin: Bluetooth thermal receipt printing (ESC/POS)\n        registerPlugin(BluetoothPrinter.class);'
      );
      fs.writeFileSync(mainActivity, ma);
    } else if (!ma.includes('onCreate(')) {
      const onCreateMethod = [
        '',
        '    @Override',
        '    protected void onCreate(android.os.Bundle savedInstanceState) {',
        '        super.onCreate(savedInstanceState);',
        '        // Local plugin: Bluetooth thermal receipt printing (ESC/POS)',
        '        registerPlugin(BluetoothPrinter.class);',
        '    }',
        ''
      ].join('\n');
      const lastBrace = ma.lastIndexOf('}');
      if (lastBrace === -1) {
        console.log('  ⚠️  MainActivity.java has no closing brace — plugin NOT registered.');
        return;
      }
      ma = ma.slice(0, lastBrace) + onCreateMethod + ma.slice(lastBrace);
      fs.writeFileSync(mainActivity, ma);
    } else {
      console.log('  ⚠️  MainActivity has onCreate but no super.onCreate call — plugin NOT registered.');
      return;
    }
    console.log(`  ✅ BluetoothPrinter installed for ${appId} (thermal receipt printing)`);
  } catch (err) {
    console.log(`  ⚠️  BluetoothPrinter install failed (${(err && err.message) || err}) — continuing; the print button just reports unavailable.`);
  }
}

// ---------------------------------------------------------------------------
// STEP 5.7f — BLUETOOTH permissions for the thermal printer plugin.
// Android ≤ 11: BLUETOOTH/BLUETOOTH_ADMIN are normal install-time permissions
// (needed to talk to an already-paired printer). Android 12+: BLUETOOTH_CONNECT
// is a runtime permission the plugin asks for on first print. Idempotent.
// ---------------------------------------------------------------------------
function ensureBluetoothPermissions() {
  console.log('\nStep 5.7f: Ensuring BLUETOOTH permissions in AndroidManifest...');
  try {
    const manifestPath = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
    if (!exists(manifestPath)) {
      console.log('  ⚠️  AndroidManifest.xml not found — skipping.');
      return;
    }
    let mf = fs.readFileSync(manifestPath, 'utf8');
    if (mf.includes('android.permission.BLUETOOTH_CONNECT')) {
      console.log('  ✓ BLUETOOTH permissions already present.');
      return;
    }
    const perms =
      '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />\n' +
      '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />\n' +
      '    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />';
    const appIdx = mf.indexOf('<application');
    if (appIdx === -1) {
      console.log('  ⚠️  Could not find <application> in the manifest — skipping.');
      return;
    }
    mf = mf.slice(0, appIdx) + perms + '\n    ' + mf.slice(appIdx);
    fs.writeFileSync(manifestPath, mf);
    console.log('  ✅ BLUETOOTH permissions injected — thermal printing can pair + print.');
  } catch (err) {
    console.log(`  ⚠️  Manifest patch failed (${(err && err.message) || err}) — continuing.`);
  }
}

installBluetoothPrinterPlugin();
ensureBluetoothPermissions();

// ---------------------------------------------------------------------------
// STEP 5.8 — App version stamp. Writes the version from package.json into
// android/app/build.gradle (versionName "2.8.0" style) and derives a
// monotonically increasing versionCode (major*10000 + minor*100 + patch →
// 2.8.0 = 20800), so every release installs cleanly over the previous one.
// Idempotent + fail-soft.
// ---------------------------------------------------------------------------
function setAndroidVersion() {
  console.log('\nStep 5.8: Stamping app version into android/app/build.gradle...');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const version = String(pkg.version || '1.0.0');
    const parts = version.split('.').map((n) => parseInt(n, 10) || 0);
    const code = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
    const gradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
    if (!exists(gradlePath)) {
      console.log('  ⚠️  android/app/build.gradle not found — skipping version stamp.');
      return;
    }
    let gradle = fs.readFileSync(gradlePath, 'utf8');
    const before = gradle;
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
    if (gradle !== before) {
      fs.writeFileSync(gradlePath, gradle);
      console.log(`  ✅ App version set → ${version} (versionCode ${code}).`);
    } else if (gradle.includes(`versionCode ${code}`)) {
      console.log(`  ✓ Already at ${version} (versionCode ${code}).`);
    } else {
      console.log('  ⚠️  versionCode/versionName not found in build.gradle — no changes made.');
    }
  } catch (err) {
    console.log(`  ⚠️  Version stamp failed (${(err && err.message) || err}) — continuing.`);
  }
}
setAndroidVersion();

// ---------------------------------------------------------------------------
// STEP 5.8a — Maven mirror guard. Shared CI IPs (and some regions) get
// HTTP 429 "Too Many Requests" from repo.maven.apache.org, which fails the
// gradle classpath resolution mid-build. Putting a reliable Maven Central
// mirror FIRST (Aliyun public — mirrors central 1:1) keeps resolution fast
// and rate-limit-proof; google() + mavenCentral stay as fallbacks. Idempotent.
// ---------------------------------------------------------------------------
function ensureMavenMirror() {
  console.log('\nStep 5.8a: Ensuring Maven Central mirror (429 guard)...');
  try {
    // The :capacitor-android library project (node_modules) declares its OWN
    // buildscript repositories — the root patch alone does NOT cover it, and
    // its AGP classpath is exactly where the 429s hit. Patch every gradle file
    // that owns a repositories block.
    const candidates = [
      path.join(ANDROID_DIR, 'build.gradle'),
      path.join(ANDROID_DIR, 'app', 'build.gradle'),
      path.join(ROOT, 'node_modules', '@capacitor', 'android', 'capacitor', 'build.gradle'),
    ];
    let patched = 0;
    for (const gradlePath of candidates) {
      if (!exists(gradlePath)) continue;
      let gradle = fs.readFileSync(gradlePath, 'utf8');
      if (gradle.includes('maven.aliyun.com')) { patched++; continue; }
      if (!/repositories\s*\{/.test(gradle)) continue;
      const mirror = "maven { url 'https://maven.aliyun.com/repository/public' }";
      gradle = gradle.replace(/repositories\s*\{\n(\s*)/g, (m0, ind) => `${m0}${ind}${mirror}\n${ind}`);
      if (gradle.includes('maven.aliyun.com')) {
        fs.writeFileSync(gradlePath, gradle);
        patched++;
        console.log('  ✅ mirror → ' + path.relative(ROOT, gradlePath));
      }
    }
    if (patched) {
      console.log(`  ✅ Aliyun public mirror active in ${patched} gradle file(s) — ahead of google()/mavenCentral().`);
    } else {
      console.log('  ⚠️  No repositories block found — mirror not added.');
    }
  } catch (err) {
    console.log(`  ⚠️  Mirror setup failed (${(err && err.message) || err}) — continuing.`);
  }
}
ensureMavenMirror();

// ---------------------------------------------------------------------------
// STEP 5.8b — PERSISTENT SIGNING. Uses the repo-tracked keystore
// android-signing/ps-telecom.keystore (password inside android-signing/README)
// for BOTH debug and release builds, so every APK built from this repo — on
// any machine — installs cleanly over the previous one (same signature).
// Without this, each machine's random debug key would force an uninstall
// (data loss) on every new build. Idempotent + fail-soft: if the keystore is
// missing the build falls back to Gradle's default per-machine debug key.
// ---------------------------------------------------------------------------
function ensurePersistentSigning() {
  console.log('\nStep 5.8b: Ensuring persistent signing config (android-signing keystore)...');
  try {
    const keystoreRel = 'android-signing/ps-telecom.keystore';
    const keystorePath = path.join(ROOT, keystoreRel);
    if (!exists(keystorePath)) {
      console.log(`  ⚠️  ${keystoreRel} not found — using default debug signing (upgrades from other machines will need an uninstall).`);
      return;
    }
    const gradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
    if (!exists(gradlePath)) {
      console.log('  ⚠️  app/build.gradle not found — skipping signing config.');
      return;
    }
    let gradle = fs.readFileSync(gradlePath, 'utf8');
    if (gradle.includes('ps-telecom.keystore')) {
      console.log('  ✓ Persistent signing config already present.');
      return;
    }
    const STORE_PASS = 'PSTelecom22000';
    const configBlock = [
      '    signingConfigs {',
      '        psTelecom {',
      "            storeFile file('../../" + keystoreRel + "')",
      `            storePassword '${STORE_PASS}'`,
      "            keyAlias 'ps-telecom'",
      `            keyPassword '${STORE_PASS}'`,
      '        }',
      '    }',
      '    buildTypes {',
      '        debug {',
      '            signingConfig signingConfigs.psTelecom',
      '        }',
      '        release {',
      '            signingConfig signingConfigs.psTelecom',
      '        }',
      '    }',
    ].join('\n');
    const bt = gradle.match(/(    )buildTypes \{/);
    if (!bt) {
      console.log('  ⚠️  buildTypes block not found — skipping signing config.');
      return;
    }
    // Replace the whole (template) buildTypes block with signingConfigs + ours
    const btStart = gradle.indexOf(bt[0]);
    // Brace-count aware end-of-block search (the naive "first } after
    // proguardFiles" approach breaks on Capacitor 8 templates where the
    // release block closes before buildTypes does, leaving a stray brace).
    let depth = 0, btEnd = -1;
    for (let i = btStart; i < gradle.length; i++) {
      const ch = gradle[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { btEnd = i; break; } }
    }
    if (btEnd === -1) {
      console.log('  ⚠️  Could not find end of buildTypes block — skipping signing config.');
      return;
    }
    gradle = gradle.slice(0, btStart) + configBlock + gradle.slice(btEnd + 1);
    fs.writeFileSync(gradlePath, gradle);
    console.log('  ✅ ps-telecom signing applied to debug + release builds.');
  } catch (err) {
    console.log(`  ⚠️  Signing config injection failed (${(err && err.message) || err}) — continuing with default signing.`);
  }
}
ensurePersistentSigning();


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
      process.platform === 'win32' ? 'gradlew.bat assembleDebug assembleRelease --console=plain' : './gradlew assembleDebug assembleRelease --console=plain',
      { stdio: 'inherit', cwd: ANDROID_DIR, env: gradleEnv, shell: true }
    );
    return true;
  } catch (err) {
    console.error('\n❌ Gradle build failed (see the error output above).');
    return false;
  }
}

function copyApkToRoot() {
  const outDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk');
  const copied = [];
  try {
    const debugBuilt = path.join(outDir, 'debug', 'app-debug.apk');
    if (exists(debugBuilt)) {
      const dest = path.join(ROOT, 'PS-TELECOM.apk');
      fs.copyFileSync(debugBuilt, dest);
      copied.push(dest);
    }
    const releaseBuilt = path.join(outDir, 'release', 'app-release.apk');
    if (exists(releaseBuilt)) {
      const dest = path.join(ROOT, 'PS-TELECOM-release.apk');
      fs.copyFileSync(releaseBuilt, dest);
      copied.push(dest);
    }
  } catch {}
  return copied.length > 0 ? copied : null;
}

const gradleOk = buildApkWithGradle();

if (gradleOk) {
  const apkPaths = copyApkToRoot();
  console.log('\n🎉 APK READY! 🎉');
  if (apkPaths) {
    for (const p of apkPaths) console.log('   📱 ' + p);
  } else {
    console.log('   📱 ' + path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'));
  }
  console.log('\n   Install: copy PS-TELECOM.apk (or PS-TELECOM-release.apk) to your phone → tap it → allow "Install unknown apps".');
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
