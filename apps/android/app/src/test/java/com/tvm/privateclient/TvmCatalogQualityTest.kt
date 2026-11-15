package com.tvm.privateclient

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvmCatalogQualityTest {
    @After fun reset() = TvmArtTrust.clear()

    private fun item(id: String, title: String, kind: String) = MediaItem(
        id = id, title = title, year = null, kind = kind, synopsis = "", poster = "", backdrop = "",
        genres = emptyList(), rating = "", runtime = null, playable = true, progress = null, filename = null,
        hue = 0, mimeType = null, season = null, episode = null, episodeName = null, showTitle = title,
        aired = null, added = null,
    )

    private fun hits(kind: String, vararg titles: String) =
        titles.mapIndexed { i, t -> TvmSearchRank.Hit(item("tt$kind$i", t, kind), 0.0, i) }

    @Test
    fun exactSeriesWithSpinOffsLeadsOverSameNamedFilm() {
        // Cinemeta's own answers for "dexter", in its order.
        val movies = hits("movie", "Dexter", "Als je begrijpt wat ik bedoel", "Dexter Prep", "Dexter Dickie")
        val series = hits("series", "Dexter: Resurrection", "Dexter", "Dexter: New Blood", "Dexter: Original Sin", "Dexter's Laboratory")
        val ranked = TvmSearchRank.rank("Dexter", movies, series).map { it.title to it.kind }
        assertEquals("Dexter" to "series", ranked[0])
        assertEquals("Dexter" to "movie", ranked[1])
        assertEquals("Als je begrijpt wat ik bedoel", ranked.last().first)
    }

    @Test
    fun exactMatchesComeFirstForCommonTitles() {
        fun first(q: String, movies: List<TvmSearchRank.Hit>, series: List<TvmSearchRank.Hit>) =
            TvmSearchRank.rank(q, movies, series).first().title
        assertEquals("Friends", first("friends", hits("movie", "Friends with Benefits", "Just Friends", "Friends"), hits("series", "Friends", "Smiling Friends")))
        assertEquals("The Simpsons", first("the simpsons", hits("movie", "The Simpsons Movie"), hits("series", "The Simpsons", "Inside the Simpsons")))
        assertEquals("Breaking Bad", first("Breaking Bad", hits("movie", "El Camino", "Breaking Bad Wolf"), hits("series", "Breaking Bad", "Breaking Bad: Original Minisodes")))
        assertEquals("Simpsons", first("the simpsons", hits("movie", "Inside Simpsons", "Simpsons"), emptyList()))
    }

    @Test
    fun tiers() {
        assertEquals(0, TvmSearchRank.tier("law & order", "Law and Order"))
        assertEquals(2, TvmSearchRank.tier("dexter", "Dexter: New Blood"))
        assertEquals(3, TvmSearchRank.tier("bad", "Breaking Bad"))
        assertEquals(2, TvmSearchRank.tier("lord of the rings", "The Lord of the Rings: The Two Towers"))
        assertEquals(4, TvmSearchRank.tier("dex", "Poindexter"))
        assertEquals(5, TvmSearchRank.tier("dexter", "Ghosted"))
    }

    @Test
    fun crossLinkedRecordKeepsArtworkOnlyOnTheEstablishedTitle() {
        val metas = listOf(
            JSONObject("""{"id":"tt0118933","name":"David","popularity":59.0498,"popularities":{"moviedb":2272.4,"stremio":59.0498,"trakt":1,"stremio_lib":0}}"""),
            JSONObject("""{"id":"tt0203259","name":"Law & Order: Special Victims Unit","popularity":59.0498,"popularities":{"a":0,"b":0,"c":0,"d":0,"moviedb":1771.5,"trakt":2178,"stremio":59.0498,"stremio_lib":0}}"""),
            JSONObject("""{"id":"tt0096697","name":"The Simpsons","popularity":40.1,"popularities":{"trakt":900}}"""),
            JSONObject("""{"id":"tt0168366","name":"Pokémon","popularity":6.45,"popularities":{"trakt":5}}"""),
            JSONObject("""{"id":"tt0176385","name":"#DUPE#","popularity":6.45,"popularities":{"trakt":50}}"""),
            JSONObject("""{"id":"tt1","name":"A","popularity":0,"popularities":{}}"""),
            JSONObject("""{"id":"tt2","name":"B","popularity":0,"popularities":{}}"""),
        )
        assertEquals(setOf("tt0118933"), TvmArtTrust.crossLinked(metas))
        TvmArtTrust.distrust(TvmArtTrust.crossLinked(metas))
        assertFalse(TvmArtTrust.trusted("https://images.metahub.space/poster/large/tt0118933/img"))
        assertFalse(TvmArtTrust.trusted("https://episodes.metahub.space/tt0118933/28/6/w780.jpg"))
        assertTrue(TvmArtTrust.trusted("https://images.metahub.space/poster/large/tt0203259/img"))
        assertTrue(TvmArtTrust.trusted("https://image.tmdb.org/t/p/w342/x.jpg"))
        assertTrue(TvmArtTrust.markedDuplicate("#DUPE#"))
    }

    @Test
    fun theListSurvivesARestartAndTellsThePageOnce() {
        val file = java.io.File.createTempFile("art-distrust", ".json")
        file.delete()
        TvmArtTrust.attach(file)
        val told = mutableListOf<Set<String>>()
        TvmArtTrust.onDistrusted = { told += it }
        TvmArtTrust.distrust(listOf("tt0118933"))
        TvmArtTrust.distrust(listOf("tt0118933"))
        assertEquals(listOf(setOf("tt0118933")), told)
        TvmArtTrust.onDistrusted = null
        // A new launch reads it back before any picture is asked for.
        TvmArtTrust.clear()
        assertFalse(TvmArtTrust.isDistrusted("tt0118933"))
        TvmArtTrust.attach(file)
        assertTrue(TvmArtTrust.isDistrusted("tt0118933"))
        assertFalse(TvmArtTrust.trusted("https://images.metahub.space/poster/large/tt0118933/img"))
        file.delete()
    }

    @Test
    fun distrustedArtworkIsNeverServedEvenFromTheCache() {
        TvmArtTrust.distrust(listOf("tt0118933"))
        val images = TvmImages(null, fetch = { TvmImages.Fetched(200, "image/jpeg", byteArrayOf(1)) }, sleep = {})
        assertEquals(404, images.load("https://images.metahub.space/poster/large/tt0118933/img").status)
        assertEquals(200, images.load("https://images.metahub.space/poster/large/tt0203259/img").status)
    }

    @Test
    fun downloadLanguageIsAMust() {
        assertTrue(TvmPlaybackChoice.languageOk("Show.S01E01.1080p.WEB.x264", "en"))
        assertFalse(TvmPlaybackChoice.languageOk("Show.S01E01.1080p.WEB.x264", "fr"))
        assertTrue(TvmPlaybackChoice.languageOk("Show.S01E01.FRENCH.1080p 🇫🇷", "fr"))
        assertFalse(TvmPlaybackChoice.languageOk("Show.S01E01.MULTi.1080p", "en"))
        assertFalse(TvmPlaybackChoice.languageOk("Show ITA ENG 1080p", "en"))
        assertTrue(TvmPlaybackChoice.languageOk("Show ITA ENG 1080p", "original"))
    }
}
