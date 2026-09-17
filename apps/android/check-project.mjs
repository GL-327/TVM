#!/usr/bin/env node
/*
 * Windows-side validation for apps/android.
 *
 * This is a PACKAGING check, not an Android build. It cannot compile Kotlin,
 * download the Android SDK, or produce an APK. It catches the mistakes that
 * make Gradle refuse the project or that break the Core LAN contract the
 * iOS client already implements.
 *
 * Run: node apps/android/check-project.mjs
 * Exit code 0 = every check passed. 1 = at least one failure.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');
const SRC = join(ROOT, 'app', 'src', 'main', 'java', 'com', 'tvm', 'privateclient');

const failures = [];
const warnings = [];
const passes = [];

function fail(message) { failures.push(message); }
function warn(message) { warnings.push(message); }
function pass(message) { passes.push(message); }

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(detail === undefined ? label : `${label} — ${detail}`);
}

function read(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

const required = [
  'README.md',
  'settings.gradle.kts',
  'build.gradle.kts',
  'gradle.properties',
  'gradlew',
  'gradlew.bat',
  'gradle/wrapper/gradle-wrapper.properties',
  'gradle/wrapper/gradle-wrapper.jar',
  'app/build.gradle.kts',
  'app/proguard-rules.pro',
  'app/src/main/AndroidManifest.xml',
  'app/src/main/java/com/tvm/privateclient/Connection.kt',
  'app/src/main/java/com/tvm/privateclient/SessionClient.kt',
  'app/src/main/java/com/tvm/privateclient/CredentialStore.kt',
  'app/src/main/java/com/tvm/privateclient/MainActivity.kt',
  'app/src/main/java/com/tvm/privateclient/TVMWebViewClient.kt',
  'app/src/main/res/layout/activity_main.xml',
  'app/src/main/res/values/strings.xml',
  'app/src/main/res/values/themes.xml',
  'app/src/main/res/xml/network_security_config.xml',
  'app/src/main/res/xml/data_extraction_rules.xml',
  'app/src/test/java/com/tvm/privateclient/ConnectionTest.kt',
  'app/src/test/java/com/tvm/privateclient/SessionClientTest.kt',
];

for (const file of required) {
  check(`${file} exists`, existsSync(join(ROOT, file)), `missing ${file}`);
}

const wrapper = read(join(ROOT, 'gradle', 'wrapper', 'gradle-wrapper.properties')) ?? '';
check('Gradle wrapper pins a 8.x distribution',
  /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-8\./.test(wrapper));

const appGradle = read(join(ROOT, 'app', 'build.gradle.kts')) ?? '';
check('applicationId is com.tvm.privateclient', appGradle.includes('applicationId = "com.tvm.privateclient"'));
check('minSdk is 26 or newer', /minSdk\s*=\s*(26|2[7-9]|[3-9]\d)/.test(appGradle));
check('compileSdk is 35 or newer', /compileSdk\s*=\s*(35|3[6-9]|[4-9]\d)/.test(appGradle));
check('EncryptedSharedPreferences dependency is present',
  appGradle.includes('androidx.security:security-crypto'));

const manifest = read(join(ROOT, 'app', 'src', 'main', 'AndroidManifest.xml')) ?? '';
check('manifest requests INTERNET', manifest.includes('android.permission.INTERNET'));
check('manifest wires networkSecurityConfig',
  manifest.includes('android:networkSecurityConfig="@xml/network_security_config"'));
check('manifest disables backup of credentials',
  manifest.includes('android:allowBackup="false"'));
check('manifest does not declare a debug WebView bridge',
  !manifest.includes('android:debuggable="true"'));
check('manifest uses adjustResize so the IME does not cover inputs',
  manifest.includes('android:windowSoftInputMode="adjustResize"'));

const connection = read(join(SRC, 'Connection.kt')) ?? '';
const session = read(join(SRC, 'SessionClient.kt')) ?? '';
const store = read(join(SRC, 'CredentialStore.kt')) ?? '';
const web = read(join(SRC, 'TVMWebViewClient.kt')) ?? '';
const main = read(join(SRC, 'MainActivity.kt')) ?? '';

check('Connection.sessionUrl is api/lan/session',
  connection.includes('api/lan/session'));
check('private IPv4 matches iOS (10/8, 172.16/12, 192.168/16)',
  connection.includes('octets[0] == 10') &&
  connection.includes('octets[0] == 172') &&
  connection.includes('octets[1] in 16..31') &&
  connection.includes('octets[0] == 192') &&
  connection.includes('octets[1] == 168'));
check('loopback and public HTTP are not treated as private LAN',
  !connection.includes('127.0.0.1') && !connection.includes('localhost'));
check('token must be 32–4096 printable characters',
  connection.includes('32..4096') && connection.includes('it.code < 33'));

check('SessionClient cookie name is tvm_lan_session',
  session.includes('COOKIE_NAME = "tvm_lan_session"'));
check('SessionClient sends Bearer from the supplied token',
  session.includes('Bearer ${' + 'connection.token}'));
check('SessionClient POSTs empty JSON and never follows redirects',
  session.includes('"{}".toByteArray') && session.includes('instanceFollowRedirects = false'));
check('SessionClient requires HttpOnly and Path=/ ',
  session.includes('httpOnly') && session.includes('attrs["path"] != "/"'));
check('SessionClient requires Secure when the origin is HTTPS',
  session.includes('https && !secure'));
check('SessionClient DELETE sends the session cookie, not the bearer',
  session.includes('requestMethod') && session.includes('Cookie') &&
  !/DELETE[\s\S]{0,400}Authorization/.test(session));

check('credentials use EncryptedSharedPreferences',
  store.includes('EncryptedSharedPreferences') && store.includes('AES256_GCM'));
check('WebView refuses cross-origin main-frame loads',
  web.includes('isSameOrigin') || web.includes('sameOrigin'));
check('WebView does not ignore TLS errors',
  web.includes('handler.cancel()') && !web.includes('handler.proceed()'));
check('WebView requests viewport-fit=cover',
  web.includes('viewport-fit=cover'));
check('WebView uses visualViewport so the IME does not hide inputs',
  web.includes('visualViewport') && web.includes('scrollIntoView'));
/*
 * The standalone app needs a native player bridge — a WebView's <video> cannot
 * open Matroska, WebM or MPEG-TS, which is most of what a debrid link or IPTV
 * channel is. That bridge is only safe because the page it talks to is served
 * by this app's own loopback server. Attaching it while a remote origin is
 * loaded would hand that origin a native surface, so the invariant is no longer
 * "no bridge" but "bridge only in standalone mode".
 */
check('a JavascriptInterface is only attached in standalone (loopback) mode',
  !main.includes('addJavascriptInterface') ||
  /standalone|127\.0\.0\.1|loopback/i.test(
    main.slice(Math.max(0, main.indexOf('addJavascriptInterface') - 600), main.indexOf('addJavascriptInterface') + 200),
  ),
  'addJavascriptInterface is called without a standalone/loopback guard nearby');
check('the LAN WebView client installs no bridge of its own',
  !web.includes('addJavascriptInterface'));
check('WebView does not install a touch listener that can swallow DOM clicks',
  !main.includes('setOnTouchListener') && !web.includes('setOnTouchListener'));
check('WebView disables pinch zoom',
  main.includes('setSupportZoom(false)') && main.includes('builtInZoomControls = false'));
check('TvmLiveReflector.kt exists', existsSync(join(SRC, 'TvmLiveReflector.kt')));
check('TvmDevUnlock.kt exists', existsSync(join(SRC, 'TvmDevUnlock.kt')));
check('launcher foreground is the orbital PNG',
  existsSync(join(ROOT, 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_foreground.png')));
check('live playback is a local proxy',
  (read(join(SRC, 'TvmLocalCore.kt')) ?? '').includes('/api/live/proxy/'));
check('the Android app applies a GitHub UI bundle on open unless auto-update is off',
  main.includes('applyIfNeeded') &&
  main.includes('webView.reload()') &&
  /fun applyIfNeeded[\s\S]{0,800}promoteLocked/.test(read(join(SRC, 'TvmUpdater.kt')) ?? '') &&
  (read(join(SRC, 'TvmUpdater.kt')) ?? '').includes('tvm-android-ui.tar.gz') &&
  (read(join(SRC, 'TvmLocalCore.kt')) ?? '').includes('/api/update/apply'));
check('an applied GitHub update shows a changelog on the next open',
  (read(join(SRC, 'TvmUpdater.kt')) ?? '').includes('writePending') &&
  (read(join(SRC, 'TvmLocalCore.kt')) ?? '').includes('/api/update/changelog'));
check('Android publishes device chrome like iOS',
  existsSync(join(SRC, 'TvmDeviceChrome.kt')) &&
  main.includes('TvmDeviceChrome.publish') &&
  (read(join(SRC, 'TvmDeviceChrome.kt')) ?? '').includes('playbackHeight') &&
  (read(join(SRC, 'TvmDeviceChrome.kt')) ?? '').includes('--tvm-inset-top'));
check('activity applies IME/system-bar insets',
  main.includes('WindowInsetsCompat.Type.ime()') && main.includes('displayCutout'));
check('cookies are not flushed to disk on purpose',
  !main.includes('CookieManager.getInstance().flush') && !main.includes('cookieManager.flush'));

const server = read(join(REPO, 'apps', 'core', 'src', 'server.ts')) ?? '';
const lanSessions = read(join(REPO, 'apps', 'core', 'src', 'lanSessions.ts')) ?? '';
check("Core serves '/api/lan/session'", server.includes("'/api/lan/session'"));
check('Core accepts POST and DELETE on the session route',
  server.includes("path === '/api/lan/session' && request.method === 'POST'") &&
  server.includes("path === '/api/lan/session' && request.method === 'DELETE'"));
check('Core cookie name matches the client',
  lanSessions.includes("'tvm_lan_session'") || lanSessions.includes('"tvm_lan_session"'));
check('Core marks the session cookie HttpOnly', lanSessions.includes('HttpOnly'));

const iosSession = read(join(REPO, 'apps', 'ios', 'TVM', 'SessionClient.swift')) ?? '';
const iosCookie = /cookieName\s*=\s*"([^"]+)"/.exec(iosSession);
check('Android cookie name matches iOS',
  iosCookie !== null && session.includes(`"${iosCookie[1]}"`));

const applyTheme = read(join(REPO, 'apps', 'ui', 'src', 'theme', 'apply.ts')) ?? '';
const motionAt = applyTheme.lastIndexOf("import './motion.css'");
const mobileAt = applyTheme.lastIndexOf("import './mobile.css'");
check('the shared UI imports mobile.css after motion.css',
  motionAt >= 0 && mobileAt > motionAt,
  'phone WebView would keep the 10-foot layout');

const iosTests = read(join(REPO, 'apps', 'ios', 'TVMTests', 'ConnectionTests.swift')) ?? '';
const androidTests = read(join(ROOT, 'app', 'src', 'test', 'java', 'com', 'tvm', 'privateclient', 'ConnectionTest.kt')) ?? '';
for (const address of [
  'http://10.0.0.1:7345',
  'http://8.8.8.8',
  'http://127.0.0.1',
  'http://192.168.01.1',
  'https://user:pass@tvm.example',
  'http://192.168.1.2/?token=secret',
]) {
  check(`Android tests include iOS fixture ${address}`,
    androidTests.includes(address),
    'keep ConnectionTest.kt aligned with ConnectionTests.swift');
  check(`iOS tests still include ${address}`, iosTests.includes(address));
}

const readme = read(join(ROOT, 'README.md')) ?? '';
check('README states that no APK was produced without the SDK',
  /ANDROID_HOME|not installed|No APK/i.test(readme));
check('README documents assembleDebug', readme.includes('assembleDebug'));

for (const file of walk(join(ROOT, 'app', 'src'))) {
  const text = read(file) ?? '';
  const name = relative(ROOT, file).replace(/\\/g, '/');
  if (file.endsWith('.kt')) {
    check(`${name} contains no hardcoded bearer token`,
      !/Bearer\s+[A-Za-z0-9_\-]{16,}/.test(text));
    check(`${name} does not disable TLS validation`,
      !text.includes('TrustAll') && !text.includes('ALLOW_ALL_HOSTNAME'));
  }
}

const gradlew = read(join(ROOT, 'gradlew')) ?? '';
check('gradlew JVM options are unquoted tokens',
  /^DEFAULT_JVM_OPTS='-Xmx\d+m -Xms\d+m'$/m.test(gradlew),
  'quoted -Xmx64m is parsed as a Java class name on Linux CI');

const jar = join(ROOT, 'gradle', 'wrapper', 'gradle-wrapper.jar');
if (existsSync(jar)) {
  const size = statSync(jar).size;
  check('gradle-wrapper.jar is a real archive', size > 20_000, `size ${size}`);
}

for (const message of passes) console.log(`  ok    ${message}`);
for (const message of warnings) console.log(`  warn  ${message}`);
for (const message of failures) console.error(`  FAIL  ${message}`);

console.log('');
console.log(`${passes.length} passed, ${warnings.length} warnings, ${failures.length} failed`);

if (failures.length > 0) {
  console.error('');
  console.error('Android project validation FAILED.');
  process.exit(1);
}

console.log('');
console.log('Android project structure and Core contract look consistent.');
console.log('');
console.log('This is NOT an APK. Still required on a machine with the Android SDK:');
console.log('  cd apps/android');
console.log('  set JAVA_HOME to JDK 17 or 21');
console.log('  set ANDROID_HOME to the SDK');
console.log('  gradlew.bat assembleDebug');
