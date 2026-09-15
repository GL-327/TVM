plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tvm.privateclient"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tvm.privateclient"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
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
