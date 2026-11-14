package com.tvm.privateclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class TvmImagesTest {
    private val jpeg = byteArrayOf(1, 2, 3)

    @Test
    fun aRefusedRequestIsTriedAgain() {
        val asked = mutableListOf<String>()
        var calls = 0
        val images = TvmImages(null, fetch = { url ->
            asked += url
            calls++
            if (calls < 3) TvmImages.Fetched(429, null, null) else TvmImages.Fetched(200, "image/jpeg", jpeg)
        }, sleep = {})
        val picture = images.load("https://images.metahub.space/poster/large/tt0121955/img")
        assertEquals(200, picture.status)
        assertEquals(3, asked.size)
    }

    @Test
    fun aMissingLargePosterFallsBackToSmallerSizes() {
        val asked = mutableListOf<String>()
        val images = TvmImages(null, fetch = { url ->
            asked += url
            if (url.contains("/small/")) TvmImages.Fetched(200, "image/jpeg", jpeg) else TvmImages.Fetched(404, null, null)
        }, sleep = {})
        val picture = images.load("https://images.metahub.space/poster/large/tt0121955/img")
        assertEquals(200, picture.status)
        assertEquals(
            listOf(
                "https://images.metahub.space/poster/large/tt0121955/img",
                "https://images.metahub.space/poster/medium/tt0121955/img",
                "https://images.metahub.space/poster/small/tt0121955/img",
            ),
            asked,
        )
    }

    @Test
    fun aPictureThatDoesNotExistIsReportedMissingWithoutRetries() {
        var calls = 0
        val images = TvmImages(null, fetch = { calls++; TvmImages.Fetched(404, null, null) }, sleep = {})
        val picture = images.load("https://image.tmdb.org/t/p/w342/none.jpg")
        assertEquals(404, picture.status)
        assertEquals(1, calls)
    }

    @Test
    fun aKeptPictureIsServedFromThePhone() {
        val dir = Files.createTempDirectory("art").toFile()
        val cache = TvmArtCache(dir)
        var calls = 0
        val images = TvmImages(cache, fetch = { calls++; TvmImages.Fetched(200, "image/jpeg", jpeg) }, sleep = {})
        images.load("https://image.tmdb.org/t/p/w342/a.jpg")
        val again = images.load("https://image.tmdb.org/t/p/w342/a.jpg")
        assertEquals(200, again.status)
        assertEquals(1, calls)
        dir.deleteRecursively()
    }

    @Test
    fun onlyPicturesAreTakenOver() {
        assertTrue(TvmImages.handles("GET", "https://images.metahub.space/poster/large/tt1/img", null))
        assertTrue(TvmImages.handles("GET", "https://example.org/a.png", "image/avif,image/webp,*/*"))
        assertFalse(TvmImages.handles("GET", "http://127.0.0.1:7345/api/home", "image/png"))
        assertFalse(TvmImages.handles("POST", "https://image.tmdb.org/t/p/w342/a.jpg", null))
        assertFalse(TvmImages.handles("GET", "https://example.org/data.json", "application/json"))
    }
}
