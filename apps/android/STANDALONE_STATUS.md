# Android standalone port — status

The Android client now works the way the iOS one does: the interface and a core
are bundled into the app, decode is native, and no PC is required. It was a thin
LAN WebView client that needed Core running on a computer.

The iOS original is `apps/ios/TVM/*.swift`. Every Kotlin file below is a port of
the Swift file beside it and must stay behaviour-identical: both clients serve
the same `apps/ui` interface and must answer its API the same way. Change one,
change the other.

## Ported

| Kotlin | From | Notes |
| --- | --- | --- |
| `TvmModels.kt` | `TVMModels.swift` | Shared vocabulary; written first as the contract the rest compiles against. |
| `TvmTitle.kt` | `TVMTitle.swift` | |
| `TvmStore.kt` | `TVMStore.swift` | File-based, same JSON shapes and filenames as iOS. |
| `TvmCatalog.kt` | `TVMCatalog.swift` | Bundled fallback catalogue. |
| `TvmRealDebrid.kt` | `TVMRealDebrid.swift` | `HttpURLConnection`; no third-party HTTP client. |
| `TvmPlans.kt` | `TVMPlans.swift` | Plans, entitlements, billing, dev unlock. |
| `TvmMedia.kt` | `TVMMedia.swift` | Home, rails, library, search, playback, progress. |
| `TvmLocalCore.kt` | `TVMLocalCore.swift` | The route table — roughly forty `/api/*` routes. |
| `TvmLocalServer.kt` | `TVMLocalServer.swift` | Loopback HTTP server. |
| `TvmNativePlayer.kt` | `TVMPlayerController.swift` | Media3/ExoPlayer, speaking the same bridge protocol as iOS. |
| `StandaloneWebViewClient.kt` | (new) | Confines the bridge-carrying WebView to loopback. |

Supporting pieces: `bundle-ui.mjs` copies the built `apps/ui` into
`app/src/main/assets/ui`; `export-fallback-catalog.mjs` writes
`assets/FallbackCatalog.json`; both mirror their `apps/ios` equivalents.

On the shared-interface side, `apps/ui/src/player/iosEngine.ts` gained
`androidPlaybackBridge()` and `nativePlaybackBridge()`, and `engine.ts` routes
through the latter — one code path now covers both phones.

## Two things worth knowing before changing this

**The server is bound to 127.0.0.1 deliberately.** It needs no token precisely
because nothing on the Wi-Fi network can reach it. Binding it anywhere else
turns an unauthenticated API into a network service.

**The native player bridge is attached in exactly one place** —
`MainActivity.attachStandalone`, immediately before loading the loopback origin.
Attaching it on the LAN path would hand a remote core a native surface on the
phone. `check-project.mjs` fails the build if `addJavascriptInterface` appears
without a standalone/loopback guard beside it.

## Verified on this machine

```
set JAVA_HOME=C:\Program Files\Java\jdk-21.0.11
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
cd apps\android && gradlew.bat assembleDebug testDebugUnitTest
```

`BUILD SUCCESSFUL`. The debug APK is 12.1 MB and contains the bundled interface
(173 asset files), the fallback catalogue and the Media3 decoders.
`node apps/android/check-project.mjs` passes 112 checks.

## Not done, and not claimed

**No physical Android device has run any of this.** A successful build and
passing unit tests prove it compiles and its logic holds — nothing about
playback on a real handset, codec support on a given chipset, or the on-device
core actually serving the interface end to end. That needs the APK installed.

Five of the six module audits were cut short by a usage limit, so the ports were
verified by the Kotlin compiler and by review rather than by a second reading of
each file against its Swift original. The compiler is the stronger check for
structure; it says nothing about behavioural drift. `TvmMedia.kt` is the largest
port and the least independently reviewed.

There are no unit tests yet for the ported modules. `apps/ios/TVMTests` is the
model to follow, and the logic is deliberately free of Android APIs so it can be
tested on the JVM.
