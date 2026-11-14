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

/*
 * The ⋮ menu's actions (reload, app update, home Core) are rows in Settings.
 * They reach the shell as tvm-app:// links, which both WebView clients handle
 * only from a tap, so no JavaScript bridge is needed for them.
 */
const standaloneClient = read(join(SRC, 'StandaloneWebViewClient.kt')) ?? '';
check('Settings app actions are handled by both WebView clients, only from a tap',
  [standaloneClient, web].every((src) => src.includes('APP_ACTION_SCHEME') && src.includes('request.hasGesture()')),
  'tvm-app:// links must be handled (gesture-only) in StandaloneWebViewClient and TVMWebViewClient');
check('the floating ⋮ menu is not shown over the working interface',
  /private fun clearError\(\) \{[^}]*chrome\.visibility = View\.GONE/.test(main),
  'clearError() should keep the ⋮ menu hidden; its actions are in Settings');
check('WebView does not install a touch listener that can swallow DOM clicks',
  !main.includes('setOnTouchListener') && !web.includes('setOnTouchListener'));
check('WebView disables pinch zoom',
  main.includes('setSupportZoom(false)') && main.includes('builtInZoomControls = false'));
check('TvmLiveReflector.kt exists', existsSync(join(SRC, 'TvmLiveReflector.kt')));
check('TvmDevUnlock.kt exists', existsSync(join(SRC, 'TvmDevUnlock.kt')));
check('launcher foreground is the orbital PNG',
  existsSync(join(ROOT, 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_foreground.png')));
{
  // The launcher icon is an adaptive icon whose logo layer is transparent, so
  // launcher masks (One UI, circle, squircle) never crop the artwork.
  const res = join(ROOT, 'app', 'src', 'main', 'res');
  const manifest = read(join(ROOT, 'app', 'src', 'main', 'AndroidManifest.xml')) ?? '';
  const adaptive = read(join(res, 'mipmap-anydpi-v26', 'ic_tvm_launcher.xml')) ?? '';
  const pngType = (file) => { try { return readFileSync(file)[25]; } catch { return -1; } };
  check('the manifest uses the adaptive TVM launcher icon',
    manifest.includes('android:icon="@mipmap/ic_tvm_launcher"') && manifest.includes('android:roundIcon="@mipmap/ic_tvm_launcher_round"') &&
    adaptive.includes('@drawable/ic_launcher_background') && adaptive.includes('@drawable/ic_launcher_foreground'));
  check('the launcher logo layer is transparent (RGBA)', pngType(join(res, 'drawable', 'ic_launcher_foreground.png')) === 6);
  check('the Good Lock icons are transparent PNGs at 512 and 1024',
    ['TVM_Glass_512.png', 'TVM_Glass_1024.png'].every((f) => pngType(join(ROOT, 'branding', f)) === 6));
  check('CI builds get a rising versionCode', /versionCode = 4 \+ \(System\.getenv\("GITHUB_RUN_NUMBER"\)/.test(read(join(ROOT, 'app', 'build.gradle.kts')) ?? ''));
}
check('live playback is a local proxy',
  (read(join(SRC, 'TvmLocalCore.kt')) ?? '').includes('/api/live/proxy/'));
check('the Android app applies a GitHub UI bundle on open unless auto-update is off',
  /applyIfNeeded[\s\S]{0,800}showStandalone/.test(main) &&
  main.indexOf('applyIfNeeded') < main.indexOf('showStandalone()') &&
  main.includes('apply.join(20_000)') &&
  main.includes('webView.reload()') &&
  /fun applyIfNeeded[\s\S]{0,800}promoteLocked/.test(read(join(SRC, 'TvmUpdater.kt')) ?? '') &&
  (read(join(SRC, 'TvmUpdater.kt')) ?? '').includes('tvm-android-ui.tar.gz') &&
  (read(join(SRC, 'TvmLocalCore.kt')) ?? '').includes('/api/update/apply'));
{
  const core = read(join(SRC, 'TvmLocalCore.kt')) ?? '';
  const accounts = read(join(SRC, 'TvmAccounts.kt')) ?? '';
  const desktopLive = read(join(REPO, 'apps', 'core', 'src', 'providers', 'live.ts')) ?? '';
  const testUrl = /TEST_CHANNEL_URL = '([^']+)'/.exec(desktopLive)?.[1] ?? '';
  check('Android answers the dev account the same way the desktop does',
    core.includes('"/api/account/dev"') && core.includes('TvmDevUnlock.verify(code)') &&
    core.includes('plans.setDeveloper(true)') && core.includes('!accounts.devSignedIn()') &&
    accounts.includes('fun signInDev(') && accounts.includes('const val DEV_ACCOUNT_ID = "acc_dev"'));
  check('the dev can set Live TV, a Real-Debrid key and a verified address per account on Android',
    ['/api/admin/accounts/live-tv', '/api/admin/accounts/rd', '/api/admin/accounts/verify', '/api/admin/mail']
      .every((route) => core.includes(`"${route}"`)) &&
    core.includes('rd.useAccountToken(accounts.rdTokenFor('));
  check('Android plays the same DW News test channel as the desktop, through its proxy',
    testUrl !== '' && core.includes(`"${testUrl}"`) && core.includes('testChannels().firstOrNull'),
    'apps/core/src/providers/live.ts TEST_CHANNEL_URL and TvmLocalCore.TEST_CHANNEL_URL must match');
}
{
  const workflow = read(join(REPO, '.github', 'workflows', 'mobile.yml')) ?? '';
  const smokeAt = workflow.indexOf('node scripts/android-smoke.mjs');
  check('the APK is installed and opened on an emulator before it is released',
    existsSync(join(REPO, 'scripts', 'android-smoke.mjs')) &&
    smokeAt !== -1 && smokeAt < workflow.indexOf('name: Publish the Android release'));
  check("CI signs the APK with TVM's key when the secret is set",
    workflow.includes('secrets.TVM_ANDROID_SIGNING') &&
    appGradle.includes('System.getenv("TVM_ANDROID_KEYSTORE")') &&
    appGradle.includes('signingConfig = signingConfigs.getByName("tvm")'),
    'without a stable key a new APK will not install over the previous one');
}
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

// ---- Android look: overlay, full-screen playback, startup reveal -------------
const shellDir = join(ROOT, 'app', 'src', 'main', 'assets', 'android-shell');
const shellCss = read(join(shellDir, 'tvm-android.css')) ?? '';
const shellJs = read(join(shellDir, 'tvm-android.js')) ?? '';
const chrome = read(join(SRC, 'TvmDeviceChrome.kt')) ?? '';
check('the Android overlay stylesheet and script exist', shellCss.length > 0 && shellJs.length > 0);
{
  // Every rule must be scoped to html.tvm-android so it cannot reach iOS, the
  // website or Android TV. Comments and @-rule lines are skipped.
  const css = shellCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const unscoped = [];
  for (const block of css.split('}')) {
    const head = block.split('{').slice(-2, -1)[0];
    if (head === undefined) continue;
    const selector = head.split('{').pop().trim();
    if (selector === '' || selector.startsWith('@') || /^(from|to|\d+%)$/.test(selector)) continue;
    for (const part of selector.split(/,(?![^(]*\))/)) {
      const one = part.trim().replace(/^@media[^{]*/, '').trim();
      if (one !== '' && !one.startsWith('html.tvm-android')) unscoped.push(one);
    }
  }
  check('every overlay rule is scoped to html.tvm-android', unscoped.length === 0, unscoped.slice(0, 3).join(' | '));
}
check('the overlay is injected on phones only, never on a television',
  chrome.includes('fun androidOverlay(') && chrome.includes('if (phone && overlay.isNotEmpty())') &&
  main.includes('if (!television)') && main.includes('android-shell/tvm-android.css'));
// Vertical page pans go to the browser (native scrolling); the overlay must
// never cancel a touch, or nothing would scroll at all.
check('the overlay never cancels a touch or pointer gesture',
  !/(touchstart|touchmove|touchend|pointerdown|pointermove|pointerup)'[^;]*?preventDefault/s.test(shellJs.replace(/\n/g, ' ').replace(/click'[\s\S]*?\}\)\(id\)\);/, '')) &&
  shellJs.includes("event.stopImmediatePropagation();") && shellJs.includes('passive: true'));
check('native playback is never painted over by the overlay',
  shellCss.includes("html.tvm-android.tvm-native-playback .player.player--native") &&
  !/html\.tvm-android \.player \{[^}]*background:\s*#000/.test(shellCss));
check('TVM runs as one activity (reopening it returns to the film, not a second copy with a second core)',
  manifest.includes('android:launchMode="singleTask"'));
check('the playback smoke test runs on the emulator',
  existsSync(join(ROOT, 'smoke', 'playback.mjs')) &&
  (read(join(REPO, 'scripts', 'android-smoke.mjs')) ?? '').includes('playbackSmoke'));
const cinema = read(join(SRC, 'TvmCinemaMode.kt')) ?? '';
check('playback goes full screen in landscape and restores afterwards',
  cinema.includes('SCREEN_ORIENTATION_SENSOR_LANDSCAPE') && cinema.includes('hide(WindowInsetsCompat.Type.systemBars())') &&
  cinema.includes('show(WindowInsetsCompat.Type.systemBars())') && cinema.includes('savedOrientation') &&
  main.includes('cinema.enter()') && main.includes('cinema.exit()'));
const player = read(join(SRC, 'TvmNativePlayer.kt')) ?? '';
check('the native picture sits under the WebView and keeps its shape',
  player.includes('root.addView(\n            frame,\n            0,') && player.includes('RESIZE_MODE_FIT') && !player.includes('webView.z ='));
const layout = read(join(ROOT, 'app', 'src', 'main', 'res', 'layout', 'activity_main.xml')) ?? '';
check('the startup reveal builds the logo from vectors',
  layout.includes('com.tvm.privateclient.TvmIntroView') && existsSync(join(SRC, 'TvmLogoGeometry.kt')) &&
  (read(join(SRC, 'TvmIntroView.kt')) ?? '').includes('PathMeasure'));
check('the native reveal replaces the web intro on Android', chrome.includes("sessionStorage.setItem('tvm.intro.session', '1')"));

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
