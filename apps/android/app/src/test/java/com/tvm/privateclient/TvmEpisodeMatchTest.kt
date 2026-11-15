package com.tvm.privateclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvmEpisodeMatchTest {
    private val match = TvmEpisodeMatch.Fit.MATCH
    private val wrong = TvmEpisodeMatch.Fit.WRONG
    private val unknown = TvmEpisodeMatch.Fit.UNKNOWN

    // The real layout of a South Park "Seasons 1 to 25 ... Movie and Extras" pack.
    private val pack = listOf(
        TvmEpisodeMatch.File(1, "/Extras/Commentaries/South Park - S01E01 - Cartman Gets an Anal Probe (Commentary).mp4", 300),
        TvmEpisodeMatch.File(2, "/Season 01/South Park - S01E01 - Cartman Gets an Anal Probe.mp4", 243),
        TvmEpisodeMatch.File(3, "/Season 01/South Park - S01E02 - Weight Gain 4000.mp4", 240),
        TvmEpisodeMatch.File(4, "/Season 01/South Park - S01E05 - An Elephant Makes Love to a Pig.mp4", 268),
        TvmEpisodeMatch.File(5, "/Season 04/South Park - S04E10 - Probably (2).mp4", 346),
        TvmEpisodeMatch.File(6, "/South Park - Bigger Longer & Uncut.mkv", 2000),
        TvmEpisodeMatch.File(7, "/Season 01/info.nfo", 1),
    )

    @Test
    fun eachEpisodeGetsItsOwnFileNeverTheFirstOrTheCommentary() {
        assertEquals(2, TvmEpisodeMatch.pickFile(pack, 1, 1, null)?.id)
        assertEquals(3, TvmEpisodeMatch.pickFile(pack, 1, 2, null)?.id)
        assertEquals(4, TvmEpisodeMatch.pickFile(pack, 1, 5, 3)?.id)
        assertEquals(5, TvmEpisodeMatch.pickFile(pack, 4, 10, null)?.id)
        // An episode the pack does not have is not replaced by another one.
        assertNull(TvmEpisodeMatch.pickFile(pack, 9, 9, null))
        // Torrentio pointing at the commentary is not followed.
        assertEquals(2, TvmEpisodeMatch.pickFile(pack, 1, 1, 0)?.id)
    }

    @Test
    fun filmsTakeTheFilmNotAnEpisode() {
        assertEquals(6, TvmEpisodeMatch.pickFile(pack, null, null, null)?.id)
    }

    @Test
    fun namesFitTheRequest() {
        assertEquals(match, TvmEpisodeMatch.fit("South Park - S01E05 - An Elephant Makes Love to a Pig.mp4", 1, 5))
        assertEquals(wrong, TvmEpisodeMatch.fit("South Park - S01E01 - Cartman Gets an Anal Probe.mp4", 1, 5))
        assertEquals(wrong, TvmEpisodeMatch.fit("South Park - S01E05 (Creator Commentary).mkv", 1, 5))
        assertEquals(match, TvmEpisodeMatch.fit("South.Park.1x05.mkv", 1, 5))
        assertEquals(match, TvmEpisodeMatch.fit("South Park Season 1 Episode 5.mkv", 1, 5))
        assertEquals(unknown, TvmEpisodeMatch.fit("05 - An Elephant Makes Love to a Pig.mkv", 1, 5))
        assertEquals(wrong, TvmEpisodeMatch.fit("Show.S01E01.mkv", null, null))
        // Real titles that look like extras words are not refused.
        assertEquals(match, TvmEpisodeMatch.fit("Trailer.Park.Boys.S02E03.mkv", 2, 3))
        assertEquals(match, TvmEpisodeMatch.fit("Extras.S01E01.mkv", 1, 1))
        assertEquals(unknown, TvmEpisodeMatch.fit("The.Interview.2014.1080p.mkv", null, null))
        assertEquals(wrong, TvmEpisodeMatch.fit("Movie.2014.1080p-sample.mkv", null, null))
    }

    @Test
    fun theSourceFileIsReadFromTorrentioDescriptions() {
        val pack = "South Park Seasons 1 to 24 (UNCENSORED) Including the Movie and Extras [NVEnc H265]\nSouth Park - Season 1 - UNCENSORED/South Park - S01E05 - An Elephant Makes Love to a Pig.mp4\n👤 41 💾 101.5 MB ⚙️ 1337x"
        assertEquals(match, TvmEpisodeMatch.fit(TvmEpisodeMatch.sourceFile(pack), 1, 5))
        assertEquals(wrong, TvmEpisodeMatch.fit(TvmEpisodeMatch.sourceFile(pack), 1, 1))
        val single = "South Park S04E10 Probably 2160p MAX WEB-DL DDP5 1 H 265-NINJACENTRAL\n👤 8 💾 1.53 GB ⚙️ ThePirateBay"
        assertEquals(match, TvmEpisodeMatch.fit(TvmEpisodeMatch.sourceFile(single), 4, 10))
    }
}
