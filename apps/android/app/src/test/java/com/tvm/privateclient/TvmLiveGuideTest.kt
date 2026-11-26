package com.tvm.privateclient

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.zip.GZIPOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TvmLiveGuideTest {
    private val window = GuideWindow.parse("2026-11-26T12:00:00Z", "3")!!
    private val xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE tv SYSTEM "xmltv.dtd">
        <tv>
          <channel id="bbc"><display-name>BBC One HD</display-name></channel>
          <channel id="other"><display-name>Unwanted</display-name></channel>
          <programme channel="bbc" start="20261126123000 +0100" stop="20261126133000 +0100"><title>News &amp; Weather</title><sub-title><![CDATA[Midday <live>]]></sub-title><desc>First bulletin</desc><category>News</category><icon src="https://example.test/news.jpg"/><episode-num>1.2.</episode-num></programme>
          <programme channel="bbc" start="20261126123000 +0100" stop="20261126133000 +0100"><title>Duplicate</title></programme>
          <programme channel="bbc" start="20261126110000 Z" stop="20261126120000 Z"><title>Ends at start</title></programme>
          <programme channel="bbc" start="20261126150000 UTC" stop="20261126160000 UTC"><title>Starts at end</title></programme>
          <programme channel="bbc" start="202611261400" stop="202611261600"><title>Afternoon</title><icon src="file:///private"/></programme>
          <programme channel="bbc" start="bad" stop="20261126160000 Z"><title>Bad date</title></programme>
          <programme channel="bbc" start="20261126140000 Z" stop="20261126130000 Z"><title>Backwards</title></programme>
          <programme channel="other" start="20261126130000 Z" stop="20261126140000 Z"><title>Not requested</title></programme>
        </tv>
    """.trimIndent()

    @Test fun pullsPlainXmlByIdAndNameAndKeepsOnlyOverlappingProgrammes() {
        val result = TvmXmlTv.parse(ByteArrayInputStream(xml.toByteArray()), listOf("BBC" to "BBC One HD"), window)
        assertFalse(result.containsKey("id:other"))
        val rows = TvmXmlTv.window(TvmXmlTv.match(result, "BbC", ""), window)
        assertEquals(listOf("News & Weather", "Afternoon"), rows.map { it.getString("title") })
        assertEquals("2026-11-26T11:30:00Z", rows[0].getString("start"))
        assertEquals("Midday <live>", rows[0].getString("subtitle"))
        assertEquals("1.2.", rows[0].getString("episode"))
        assertFalse(rows[1].has("image"))
        assertEquals(rows.map { it.toString() }, TvmXmlTv.window(TvmXmlTv.match(result, "missing", "bbc one hd"), window).map { it.toString() })
    }

    @Test fun sniffsGzipAndMatchesByNameWhenIdDoesNotMatch() {
        val bytes = ByteArrayOutputStream()
        GZIPOutputStream(bytes).use { it.write(xml.toByteArray()) }
        val result = TvmXmlTv.parse(ByteArrayInputStream(bytes.toByteArray()), listOf("provider-id" to "BBC One HD"), window)
        assertEquals("News & Weather", TvmXmlTv.match(result, "provider-id", "BBC One HD")[0].getString("title"))
    }

    @Test fun validatesWindowAndDefaultsToHalfHour() {
        for (hours in listOf("0", "25", "1.5", "NaN", "bad", "")) assertNull(GuideWindow.parse(null, hours))
        assertNull(GuideWindow.parse("not-a-date", "3"))
        assertNull(TvmXmlTv.date("20260230120000 +0000"))
        val parsed = GuideWindow.parse(null, null, Instant.parse("2026-11-26T12:47:00Z"))!!
        assertEquals(Instant.parse("2026-11-26T12:30:00Z"), parsed.start)
        assertEquals(Instant.parse("2026-11-26T15:30:00Z"), parsed.end)
        assertNotNull(GuideWindow.parse("2026-11-26T12:00:00+01:00", "24"))
    }

    @Test fun missingDataIsOneBlockForTheWholeWindow() {
        val result = TvmXmlTv.window(emptyList(), window)
        assertEquals(1, result.size)
        assertEquals("No guide information", result[0].getString("title"))
        assertEquals(window.start.toString(), result[0].getString("start"))
        assertEquals(window.end.toString(), result[0].getString("end"))
    }

    @Test fun xtreamDecodesBase64AndFiltersWindow() {
        val json = JSONObject("""{"epg_listings":[{"start":"2026-11-26 11:30:00","end":"2026-11-26 12:30:00","title":"TmV3cw==","description":"QnVsbGV0aW4="},{"start":"2026-11-26 15:00:00","end":"2026-11-26 16:00:00","title":"Outside"}]}""")
        val rows = TvmXmlTv.xtream(json, window)
        assertEquals(1, rows.size)
        assertEquals("News", rows[0].getString("title"))
        assertEquals("Bulletin", rows[0].getString("description"))
    }

    @Test fun malformedXmlIsNotCachedAsAValidFeed() {
        assertTrue(runCatching { TvmXmlTv.parse(ByteArrayInputStream("<tv><programme>".toByteArray()), emptyList(), window) }.isFailure)
    }
}
