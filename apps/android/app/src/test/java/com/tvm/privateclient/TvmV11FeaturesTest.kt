package com.tvm.privateclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** TVM 1.1 on the phone's own Core: PINs, age limits and release events match the Node Core. */
class TvmV11FeaturesTest {
    @Test
    fun pinHashMatchesEveryOtherApp() {
        // The vector in packages/content/parental.json, also checked by Core and Windows.
        assertEquals(
            "1eeaf002a05b931ed2f5dd9fd99fc48b215f8e2dc3f300d356eb83bfe6a4adb4",
            TvmPins.hashPin("1234", "00112233445566778899aabbccddeeff", 20_000),
        )
    }

    @Test
    fun underSevensSeeAnimationAndFamilyOnly() {
        val cartoon = MediaItem(id = "tt1", title = "Cartoon", genres = listOf("Animation", "Comedy"))
        val horror = MediaItem(id = "tt2", title = "Scary", genres = listOf("Family", "Horror"))
        val action = MediaItem(id = "tt3", title = "Action", genres = listOf("Action"))
        assertTrue(TvmParental.allowedForLevel(cartoon, 7))
        assertFalse(TvmParental.allowedForLevel(horror, 7))
        assertFalse(TvmParental.allowedForLevel(action, 7))
        assertTrue(TvmParental.allowedForLevel(action, 18))
    }

    @Test
    fun eventsSayWhenTheyOpen() {
        assertEquals("In cinemas 16 December", TvmMedia.eventKicker("2026-12-16", "2026-12-10"))
        assertEquals("In cinemas now", TvmMedia.eventKicker("2026-12-16", "2026-12-16"))
    }
}
