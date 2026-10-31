/**
 * Continuation of scripts/build-apk.js — steps 5 (sync) → 6 (gradle).
 * Steps 1-4.5 (static export, cap add android, icon branding) already done.
 * Function bodies copied verbatim from build-apk.js so behaviour is identical.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = '/home/z/my-project';
const ANDROID_DIR = path.join(ROOT, 'android');

function exists(p) { return fs.existsSync(p); }
function capCmd(args) {
  let success = false;
  try { execSync(`bunx @capacitor/cli ${args}`, { stdio: 'pipe', cwd: ROOT, shell: true }); success = true; } catch {}
  if (!success) {
    const localCap = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
    if (exists(localCap)) success = (() => { try { execSync(`node "${localCap}" ${args}`, { stdio: 'inherit', cwd: ROOT, shell: true }); return true; } catch { return false; } })();
  }
  return success;
}

// ---- STEP 5: cap sync ----
console.log('\nStep 5: Syncing with Capacitor Android...');
const syncSuccess = capCmd('sync android');
if (!syncSuccess) { console.error('❌ cap sync failed'); process.exit(1); }
console.log('✅ cap sync done');

// ---- STEP 5.7 / 5.7c plugin installer (shared by WhatsappSender + AppLock) ----
function installPlugin(srcFile, label) {
  const src = path.join(ROOT, 'native', 'android', srcFile);
  const cfgPath = path.join(ROOT, 'capacitor.config.json');
  if (!exists(src) || !exists(cfgPath) || !exists(ANDROID_DIR)) { console.log(`  ⚠️ Skipping ${label}`); return; }
  const appId = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).appId;
  const javaDir = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java', ...appId.split('.'));
  const mainActivity = path.join(javaDir, 'MainActivity.java');
  if (!exists(mainActivity)) { console.log(`  ⚠️ MainActivity missing for ${label}`); return; }
  fs.mkdirSync(javaDir, { recursive: true });
  const java = fs.readFileSync(src, 'utf8').replace(/__PACKAGE_NAME__/g, appId);
  fs.writeFileSync(path.join(javaDir, srcFile), java);
  let ma = fs.readFileSync(mainActivity, 'utf8');
  const cls = srcFile.replace('.java', '');
  if (ma.includes(cls)) { console.log(`  ✓ ${cls} already registered`); return; }
  if (ma.includes('super.onCreate(')) {
    ma = ma.replace(/(super\.onCreate\([^)]*\);)/, `$1\n        registerPlugin(${cls}.class);`);
    fs.writeFileSync(mainActivity, ma);
  } else if (!ma.includes('onCreate(')) {
    const onCreateMethod = [
      '', '    @Override',
      '    protected void onCreate(android.os.Bundle savedInstanceState) {',
      '        super.onCreate(savedInstanceState);',
      `        registerPlugin(${cls}.class);`, '    }', ''
    ].join('\n');
    const lastBrace = ma.lastIndexOf('}');
    ma = ma.slice(0, lastBrace) + onCreateMethod + ma.slice(lastBrace);
    fs.writeFileSync(mainActivity, ma);
  }
  console.log(`  ✅ ${cls} installed for ${appId}`);
}

// ---- STEP 5.7b: WhatsApp queries ----
function ensureWhatsappQueries() {
  const manifestPath = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!exists(manifestPath)) return;
  let mf = fs.readFileSync(manifestPath, 'utf8');
  if (mf.includes('com.whatsapp"')) { console.log('  ✓ <queries> already present'); return; }
  const packages = '<package android:name="com.whatsapp" />\n        <package android:name="com.whatsapp.w4b" />';
  const firstQueries = mf.indexOf('<queries');
  if (firstQueries !== -1) {
    const openEnd = mf.indexOf('>', firstQueries) + 1;
    mf = mf.slice(0, openEnd) + '\n        ' + packages + mf.slice(openEnd);
  } else {
    const appIdx = mf.indexOf('<application');
    mf = mf.slice(0, appIdx) + '<queries>\n        ' + packages + '\n    </queries>\n    ' + mf.slice(appIdx);
  }
  fs.writeFileSync(manifestPath, mf);
  console.log('  ✅ <queries> injected');
}

// ---- STEP 5.7d: biometric dependency ----
function ensureBiometricDependency() {
  const gradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  if (gradle.includes('androidx.biometric')) { console.log('  ✓ androidx.biometric already present'); return; }
  const m = gradle.match(/dependencies\s*\{/);
  const insertAt = m.index + m[0].length;
  const dep = "    implementation 'androidx.biometric:biometric:1.1.0'";
  gradle = gradle.slice(0, insertAt) + '\n' + dep + gradle.slice(insertAt);
  fs.writeFileSync(gradlePath, gradle);
  console.log('  ✅ androidx.biometric added');
}

// ---- STEP 5.8: version stamp ----
function setAndroidVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = String(pkg.version || '1.0.0');
  const parts = version.split('.').map((n) => parseInt(n, 10) || 0);
  const code = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  const gradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  const before = gradle;
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
  gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  if (gradle !== before) fs.writeFileSync(gradlePath, gradle);
  console.log(`  ✅ version ${version} (versionCode ${code})`);
}

installPlugin('WhatsappSender.java', 'WhatsappSender');
ensureWhatsappQueries();
installPlugin('AppLockPlugin.java', 'AppLock');
ensureBiometricDependency();
setAndroidVersion();

// local.properties for the sandbox SDK
const lp = path.join(ANDROID_DIR, 'local.properties');
if (!exists(lp)) { fs.writeFileSync(lp, 'sdk.dir=/home/z/android-sdk\n'); console.log('  ✅ local.properties written'); }

// ---- STEP 6: gradle assembleDebug ----
console.log('\nStep 6: Gradle assembleDebug...');
const gradleEnv = { ...process.env, JAVA_HOME: process.env.JAVA_HOME || '' };
gradleEnv.ANDROID_HOME = '/home/z/android-sdk';
try {
  execSync('./gradlew assembleDebug --console=plain --no-daemon', {
    stdio: 'inherit', cwd: ANDROID_DIR, env: gradleEnv, shell: true,
  });
} catch (err) {
  console.error('\n❌ Gradle build failed');
  process.exit(1);
}

const built = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (exists(built)) {
  const dest = path.join(ROOT, 'PS-TELECOM-debug.apk');
  fs.copyFileSync(built, dest);
  console.log('\n🎉 APK READY → ' + dest);
} else {
  console.error('\n❌ APK output not found');
  process.exit(1);
}
