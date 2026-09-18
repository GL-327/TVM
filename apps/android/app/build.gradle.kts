plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI signs with TVM's own key (the TVM_ANDROID_SIGNING secret, unpacked by
// mobile.yml) so each APK installs over the last. A local build without it
// gets Gradle's usual debug key.
val tvmKeystore: String? = System.getenv("TVM_ANDROID_KEYSTORE")?.takeIf { it.isNotBlank() }

android {
    namespace = "com.tvm.privateclient"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tvm.privateclient"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        val keystore = tvmKeystore
        if (keystore != null) {
            create("tvm") {
                storeFile = file(keystore)
                storeType = "pkcs12"
                storePassword = System.getenv("TVM_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = "tvm"
                keyPassword = System.getenv("TVM_ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            if (tvmKeystore != null) signingConfig = signingConfigs.getByName("tvm")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.security:security-crypto:1.0.0")

    // The ported core is written in suspending functions, mirroring the Swift's
    // async/await. The loopback server calls into it from a worker thread.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    /*
     * Native decode, the Android counterpart of MobileVLCKit on iOS. Media3
     * handles Matroska, WebM and MPEG-TS in software where the device has no
     * hardware decoder, which is exactly the gap that made the WebView's
     * <video> element useless for these sources. The HLS module is separate.
     */
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
