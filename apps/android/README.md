# TVM for Android

Native Kotlin / WebView client for TVM Core. Same LAN contract as the iOS app: `POST /api/lan/session` with `Authorization: Bearer <TVM_LAN_TOKEN>` mints the HttpOnly `tvm_lan_session` cookie; `DELETE` revokes it. The bearer is never written into the WebView. Credentials are stored in EncryptedSharedPreferences.

The app does not contain Core. It loads the shared `apps/ui` interface from your TVM computer on a trusted network. Phone layout comes from `apps/ui/src/theme/mobile.css`. The WebView injects `viewport-fit=cover` and a `visualViewport` keyboard helper so form fields stay above the IME; pinch zoom is off; DOM clicks and overlay taps are not intercepted. There is no JavascriptInterface.

This is not a Play Store app. Core must be started with `TVM_CORE_BIND=0.0.0.0` and a unique `TVM_LAN_TOKEN` of at least 32 characters.

## Source tree

```
apps/android/
  README.md
  check-project.mjs
  .gitignore
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  gradlew
  gradlew.bat
  gradle/wrapper/gradle-wrapper.properties
  gradle/wrapper/gradle-wrapper.jar
  app/build.gradle.kts
  app/proguard-rules.pro
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/tvm/privateclient/Connection.kt
  app/src/main/java/com/tvm/privateclient/SessionClient.kt
  app/src/main/java/com/tvm/privateclient/CredentialStore.kt
  app/src/main/java/com/tvm/privateclient/MainActivity.kt
  app/src/main/java/com/tvm/privateclient/TVMWebViewClient.kt
  app/src/main/res/layout/activity_main.xml
  app/src/main/res/values/strings.xml
  app/src/main/res/values/themes.xml
  app/src/main/res/values/colors.xml
  app/src/main/res/xml/network_security_config.xml
  app/src/main/res/xml/backup_rules.xml
  app/src/main/res/xml/data_extraction_rules.xml
  app/src/main/res/drawable/ic_launcher.xml
  app/src/main/res/drawable/ic_launcher_foreground.xml
  app/src/main/res/drawable/field.xml
  app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
  app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml
  app/src/test/java/com/tvm/privateclient/ConnectionTest.kt
  app/src/test/java/com/tvm/privateclient/SessionClientTest.kt
```

`local.properties`, `.gradle/` and `app/build/` are local. `*.apk` is gitignored.

## What works on this Windows workspace

| Step | Status here |
| --- | --- |
| Source tree (Gradle, Kotlin, manifest, tests) | Present |
| `node apps/android/check-project.mjs` | Packaging + Core-contract check |
| Java | Use JDK 17 or 21. This PC has `C:\Program Files\Java\jdk-21.0.11`. The default `java` on PATH may be newer (Java 25); AGP 8.7 will refuse that. |
| `ANDROID_HOME` / Android SDK | **Not in the repository.** Command-line tools can be installed to `%LOCALAPPDATA%\Android\Sdk`. |
| Debug APK in git | **Not committed.** `app/build/` and `*.apk` are ignored. After the SDK is present, `gradlew.bat assembleDebug` writes a debug-signed APK under `app/build/outputs/apk/debug/` for private testing only. If that file exists on disk from a previous build, it is still not a repository artifact. |
| Play Store / signed release AAB | Not in this tree |

GitHub Actions `mobile.yml` runs the same `assembleDebug` on a runner that has the SDK. It is not a Play release, but it is signed with TVM's own key, so each release installs over the last and keeps the phone's sign-ins. The key comes from the `TVM_ANDROID_SIGNING` secret: the keystore password on the first line, then the PKCS12 keystore (alias `tvm`) in base64. The key itself is kept outside the repository. A local build without it gets Gradle's usual debug key.

Before anything is released, `scripts/android-smoke.mjs` installs the APK on an Android 14 emulator, opens it, and checks that the phone's own core answers, the sign-in screen appears and an account can be created. The screenshot and logcat are kept as the `tvm-android-smoke` artifact.

## What you need to produce an APK

1. Android Studio or [command-line tools](https://developer.android.com/studio#command-tools) with:
   - Android SDK Platform 35
   - Build-Tools 35.0.0
   - Platform-Tools
2. JDK 17 or 21 (`JAVA_HOME` must not be Java 25; AGP 8.7 will refuse it).
3. From `apps/android`:

```bat
set JAVA_HOME=C:\Program Files\Java\jdk-21.0.11
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%
gradlew.bat assembleDebug
```

After a successful assemble, the debug APK is at `app/build/outputs/apk/debug/app-debug.apk` on that machine. That path is gitignored and is not a committed artifact.

```bat
gradlew.bat testDebugUnitTest
```

`local.properties` with `sdk.dir=` is created by Android Studio and must not be committed.

## Host connection

Run Core with `TVM_CORE_BIND=0.0.0.0` and a unique `TVM_LAN_TOKEN` of at least 32 characters. On the phone enter the PC's private IPv4 address, for example `http://192.168.1.20:7345`, and enable “Allow private LAN HTTP” for that trusted Wi-Fi path. HTTPS with a normally trusted certificate is preferred. Public HTTP, loopback, credentials-in-URL and redirects while holding the bearer are rejected.

`node apps/android/check-project.mjs` validates the tree and the Core contract from Windows. It cannot compile Kotlin or prove playback on a device.
