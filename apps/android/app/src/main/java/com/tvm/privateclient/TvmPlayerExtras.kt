package com.tvm.privateclient

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.audiofx.AudioEffect
import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.LoudnessEnhancer
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil

/**
 * Shared sleep timer math, playback telemetry formatting, real audio night-mode
 * compression, and glass overlays for native Android playback.
 */
object TvmSleepLogic {
    const val SLEEP_FADE_MS: Long = 5_000L

    fun normalizeChoice(raw: String): String = when (raw) {
        "15", "30", "45", "60", "end" -> raw
        else -> "off"
    }

    fun deadlineMs(choice: String, nowMs: Long): Long? = when (choice) {
        "15", "30", "45", "60" -> nowMs + choice.toLong() * 60_000L
        else -> null
    }

    fun fadeFactor(elapsedMs: Long): Float =
        (1f - elapsedMs.toFloat() / SLEEP_FADE_MS.toFloat()).coerceIn(0f, 1f)

    fun shouldStart(
        choice: String,
        deadlineMs: Long?,
        nowMs: Long,
        positionSec: Double,
        durationSec: Double,
        paused: Boolean,
    ): Boolean {
        if (choice == "off") return false
        if (choice == "end") {
            return !paused && durationSec.isFinite() && durationSec > 0.0 && positionSec >= durationSec - 5.0
        }
        return deadlineMs != null && nowMs >= deadlineMs
    }

    fun formatRemaining(ms: Long?): String? {
        if (ms == null || ms < 0L) return null
        val totalSeconds = ceil(ms / 1000.0).toLong().coerceAtLeast(0L)
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        return if (hours > 0L) {
            String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.US, "%d:%02d", minutes, seconds)
        }
    }
}

data class TvmSleepSnapshot(
    val choice: String,
    val remainingMs: Long?,
    val fading: Boolean,
    val expired: Boolean,
) {
    fun json(): JSONObject = Json.obj(
        "choice" to choice,
        "remainingMs" to remainingMs,
        "fading" to fading,
        "expired" to expired,
    )
}

class TvmSleepTimerState {
    data class StepResult(
        val volumeChanged: Boolean,
        val justExpired: Boolean,
        val stateChanged: Boolean,
        val active: Boolean,
        val snapshot: TvmSleepSnapshot,
    )

    var choice: String = "off"
        private set
    var deadlineMs: Long? = null
        private set
    private var fadeStartMs: Long? = null
    var fading: Boolean = false
        private set
    var expired: Boolean = false
        private set
    var fadeFactor: Float = 1f
        private set
    private var lastReportedSec: Long = -1L

    fun reset(rawChoice: String, nowMs: Long) {
        choice = TvmSleepLogic.normalizeChoice(rawChoice)
        deadlineMs = TvmSleepLogic.deadlineMs(choice, nowMs)
        fadeStartMs = null
        fading = false
        expired = false
        fadeFactor = 1f
        lastReportedSec = -1L
    }

    fun forceExpire(nowMs: Long): TvmSleepSnapshot {
        fadeStartMs = fadeStartMs ?: nowMs
        fading = false
        expired = true
        fadeFactor = 0f
        lastReportedSec = 0L
        return TvmSleepSnapshot(choice = choice, remainingMs = 0L, fading = false, expired = true)
    }

    fun step(nowMs: Long, positionSec: Double, durationSec: Double, paused: Boolean): StepResult {
        if (choice == "off" || expired) {
            return StepResult(
                volumeChanged = false,
                justExpired = false,
                stateChanged = false,
                active = false,
                snapshot = snapshot(nowMs, positionSec, durationSec),
            )
        }
        var volumeChanged = false
        var justExpired = false
        var stateChanged = false

        if (fadeStartMs == null && TvmSleepLogic.shouldStart(choice, deadlineMs, nowMs, positionSec, durationSec, paused)) {
            // A timed choice fades from its deadline even when the tick that notices it is late.
            val deadline = deadlineMs
            fadeStartMs = if (choice != "end" && deadline != null) minOf(deadline, nowMs) else nowMs
            fading = true
            stateChanged = true
        }

        val fadeStart = fadeStartMs
        if (fadeStart != null) {
            val nextFactor = TvmSleepLogic.fadeFactor(nowMs - fadeStart)
            if (abs(nextFactor - fadeFactor) > 0.005f) {
                fadeFactor = nextFactor
                volumeChanged = true
            }
            if (nextFactor == 0f) {
                fading = false
                expired = true
                fadeFactor = 0f
                justExpired = true
                stateChanged = true
            }
        }

        val snap = snapshot(nowMs, positionSec, durationSec)
        val remSec = snap.remainingMs?.let { ceil(it / 1000.0).toLong() } ?: -1L
        if (remSec != lastReportedSec) {
            lastReportedSec = remSec
            stateChanged = true
        }
        return StepResult(
            volumeChanged = volumeChanged,
            justExpired = justExpired,
            stateChanged = stateChanged,
            active = choice != "off",
            snapshot = snap,
        )
    }

    fun snapshot(nowMs: Long, positionSec: Double, durationSec: Double): TvmSleepSnapshot {
        val fadeStart = fadeStartMs
        val dl = deadlineMs
        val remaining = when {
            expired -> 0L
            fadeStart != null -> (TvmSleepLogic.SLEEP_FADE_MS - (nowMs - fadeStart)).coerceAtLeast(0L)
            choice == "end" -> if (durationSec.isFinite() && durationSec > 0.0) {
                ((durationSec - positionSec).coerceAtLeast(0.0) * 1000.0).toLong()
            } else null
            dl != null -> (dl - nowMs).coerceAtLeast(0L)
            else -> null
        }
        return TvmSleepSnapshot(choice = choice, remainingMs = remaining, fading = fading, expired = expired)
    }
}

data class TvmPlaybackMeta(
    var source: String? = null,
    var versionLabel: String? = null,
    var codec: String? = null,
    var hdr: String? = null,
    var mimeType: String? = null,
    var bitrateMbps: Double? = null,
    var sizeBytes: Long? = null,
    var durationSeconds: Double? = null,
) {
    fun update(message: JSONObject) {
        Json.string(message.opt("source"))?.takeIf { it.isNotEmpty() }?.let { source = it }
        Json.string(message.opt("versionLabel"))?.takeIf { it.isNotEmpty() }?.let { versionLabel = it }
        Json.string(message.opt("codec"))?.takeIf { it.isNotEmpty() }?.let { codec = it }
        Json.string(message.opt("hdr"))?.takeIf { it.isNotEmpty() }?.let { hdr = it }
        Json.string(message.opt("mimeType"))?.takeIf { it.isNotEmpty() }?.let { mimeType = it }
        val br = message.optDouble("bitrateMbps", Double.NaN)
        if (br.isFinite() && br > 0.0) bitrateMbps = br
        val sb = message.optLong("sizeBytes", -1L)
        if (sb > 0L) sizeBytes = sb
        val dur = message.optDouble("durationSeconds", Double.NaN)
        if (dur.isFinite() && dur > 0.0) durationSeconds = dur
    }
}

object TvmNativeStats {
    fun codecName(mime: String?, codecs: String? = null): String {
        val m = mime.orEmpty().lowercase(Locale.US)
        val c = codecs.orEmpty().lowercase(Locale.US)
        return when {
            m == MimeTypes.VIDEO_H265 || m == MimeTypes.VIDEO_DOLBY_VISION || c.startsWith("hvc") || c.startsWith("hev") || c.startsWith("dvh") -> "HEVC"
            m == MimeTypes.VIDEO_H264 || c.startsWith("avc") -> "H.264"
            m == MimeTypes.VIDEO_AV1 || c.startsWith("av01") -> "AV1"
            m == MimeTypes.VIDEO_VP9 || c.startsWith("vp09") || c.startsWith("vp9") -> "VP9"
            m == MimeTypes.AUDIO_AAC || c.startsWith("mp4a") -> "AAC"
            m == MimeTypes.AUDIO_E_AC3 || m == MimeTypes.AUDIO_E_AC3_JOC || c.startsWith("ec-3") || c.startsWith("eac3") -> "EAC3"
            m == MimeTypes.AUDIO_AC3 || c.startsWith("ac-3") || c.startsWith("ac3") -> "AC3"
            m == MimeTypes.AUDIO_DTS || m == MimeTypes.AUDIO_DTS_HD || c.startsWith("dts") -> "DTS"
            m == MimeTypes.AUDIO_TRUEHD || c.startsWith("mlpa") -> "TrueHD"
            m == MimeTypes.AUDIO_OPUS || c.startsWith("opus") -> "Opus"
            m == MimeTypes.AUDIO_FLAC || c.startsWith("flac") -> "FLAC"
            m == MimeTypes.AUDIO_MPEG -> "MP3"
            m.isNotEmpty() -> m.substringAfter('/').uppercase(Locale.US)
            else -> ""
        }
    }

    fun formatChannels(count: Int?): String? = when {
        count == null || count <= 0 -> null
        count == 1 -> "Mono"
        count == 2 -> "Stereo"
        count == 6 -> "5.1"
        count == 8 -> "7.1"
        else -> "${count}ch"
    }

    fun hdrLabel(sampleMime: String?, codecs: String?, colorTransfer: Int?, metaHdr: String?): String {
        val m = sampleMime.orEmpty().lowercase(Locale.US)
        val c = codecs.orEmpty().lowercase(Locale.US)
        val meta = metaHdr.orEmpty().trim().lowercase(Locale.US)
        return when {
            m == MimeTypes.VIDEO_DOLBY_VISION || c.startsWith("dv") -> "Dolby Vision"
            colorTransfer == C.COLOR_TRANSFER_ST2084 -> if (meta == "hdr10+") "HDR10+" else "HDR10"
            colorTransfer == C.COLOR_TRANSFER_HLG -> "HLG"
            meta == "dv" || meta == "dolby vision" -> "Dolby Vision"
            meta == "hdr10+" || meta == "hdr10" || meta == "hlg" -> meta.uppercase(Locale.US)
            colorTransfer == C.COLOR_TRANSFER_SDR -> "SDR"
            meta == "sdr" -> "SDR"
            else -> "Unknown"
        }
    }

    fun buildJson(
        videoWidth: Int,
        videoHeight: Int,
        videoFormat: Format?,
        audioFormat: Format?,
        droppedFrames: Int?,
        renderedFrames: Int?,
        bufferSeconds: Double?,
        activeSubtitle: String?,
        durationSeconds: Double,
        live: Boolean,
        meta: TvmPlaybackMeta,
    ): JSONObject {
        val width = if (videoWidth > 0) videoWidth else (videoFormat?.width ?: 0).coerceAtLeast(0)
        val height = if (videoHeight > 0) videoHeight else (videoFormat?.height ?: 0).coerceAtLeast(0)
        val resolution = if (width > 0 && height > 0) "$width × $height" else "Unknown"
        val vCodec = codecName(videoFormat?.sampleMimeType, videoFormat?.codecs).ifEmpty { meta.codec.orEmpty() }.ifEmpty { "Unknown" }
        val aCodec = codecName(audioFormat?.sampleMimeType, audioFormat?.codecs).ifEmpty { "Unknown" }
        val aChannels = formatChannels(audioFormat?.channelCount)
        // Media3 normalises "jpn" to "ja"; Stats shows the 3-letter code, as the iPhone and the web do.
        val aLang = audioFormat?.language?.trim()?.takeIf { it.isNotEmpty() }?.let { code ->
            if (code.length == 2) runCatching { Locale(code).isO3Language }.getOrNull()?.takeIf { it.isNotEmpty() } ?: code else code
        }
            ?: audioFormat?.label?.trim()?.takeIf { it.isNotEmpty() }
        val hdr = hdrLabel(
            sampleMime = videoFormat?.sampleMimeType,
            codecs = videoFormat?.codecs,
            colorTransfer = videoFormat?.colorInfo?.colorTransfer,
            metaHdr = meta.hdr,
        )
        val vBit = videoFormat?.bitrate?.takeIf { it > 0 }?.toDouble() ?: 0.0
        val aBit = audioFormat?.bitrate?.takeIf { it > 0 }?.toDouble() ?: 0.0
        val liveMbps = (vBit + aBit).takeIf { it > 0.0 }?.div(1_000_000.0)
        val effDuration = if (durationSeconds > 0.0) durationSeconds else (meta.durationSeconds ?: 0.0)
        val estMbps = meta.bitrateMbps?.takeIf { it > 0.0 } ?: meta.sizeBytes?.takeIf { it > 0L && effDuration > 0.0 }?.let { bytes ->
            (bytes.toDouble() * 8.0) / effDuration / 1_000_000.0
        }
        val totalFrames = renderedFrames?.let { r ->
            val d = droppedFrames?.coerceAtLeast(0) ?: 0
            (r + d).coerceAtLeast(0)
        }
        val container = meta.mimeType ?: videoFormat?.containerMimeType ?: "Media3"
        val source = meta.source ?: if (live) "LIVE" else "Media3"
        return JSONObject().apply {
            put("resolution", resolution)
            put("width", width)
            put("height", height)
            put("videoCodec", vCodec)
            put("audioCodec", aCodec)
            put("hdr", hdr)
            put("container", container)
            put("subtitles", activeSubtitle?.takeIf { it.isNotEmpty() } ?: "Off")
            put("source", source)
            put("versionLabel", meta.versionLabel ?: "Unknown")
            aLang?.let { put("audioLanguage", it) }
            aChannels?.let { put("audioChannels", it) }
            droppedFrames?.let { put("droppedFrames", it.coerceAtLeast(0)) }
            totalFrames?.let { put("totalFrames", it) }
            liveMbps?.let { put("bitrateMbps", it) }
            estMbps?.let { put("estimatedBitrateMbps", it) }
            bufferSeconds?.takeIf { it.isFinite() }?.let { put("bufferSeconds", it.coerceAtLeast(0.0)) }
        }
    }

    fun rows(stats: JSONObject): List<Pair<String, String>> {
        val resolution = Json.string(stats.opt("resolution")) ?: "Unknown"
        val container = Json.string(stats.opt("container")) ?: "Unknown"
        val vCodec = Json.string(stats.opt("videoCodec"))?.takeIf { it != "Unknown" }
        val aCodec = Json.string(stats.opt("audioCodec"))?.takeIf { it != "Unknown" }
        val codecs = listOfNotNull(vCodec, aCodec).joinToString(" · ").ifEmpty { "Unknown" }
        val hdr = Json.string(stats.opt("hdr")) ?: "Unknown"
        val audioParts = listOfNotNull(
            Json.string(stats.opt("audioLanguage")),
            Json.string(stats.opt("audioChannels")),
        ).joinToString(" · ").ifEmpty { "Unknown" }
        val subtitles = Json.string(stats.opt("subtitles")) ?: "Off"
        val dropped = if (stats.has("droppedFrames") && !stats.isNull("droppedFrames")) {
            val d = stats.optInt("droppedFrames", 0)
            if (stats.has("totalFrames") && !stats.isNull("totalFrames")) {
                "$d / ${stats.optInt("totalFrames", d)}"
            } else {
                "$d"
            }
        } else {
            "Unknown"
        }
        val liveBr = stats.optDouble("bitrateMbps", Double.NaN).takeIf { it.isFinite() && it > 0.0 }
        val estBr = stats.optDouble("estimatedBitrateMbps", Double.NaN).takeIf { it.isFinite() && it > 0.0 }
        val bitrate = (liveBr ?: estBr)?.let { String.format(Locale.US, "%.1f Mb/s", it) } ?: "Unknown"
        val source = Json.string(stats.opt("source")) ?: "Unknown"
        val version = Json.string(stats.opt("versionLabel")) ?: "Unknown"
        val buffer = stats.optDouble("bufferSeconds", Double.NaN)
            .takeIf { it.isFinite() && it >= 0.0 }
            ?.let { String.format(Locale.US, "%.1f s", it) }
            ?: "Unknown"
        return listOf(
            "Resolution" to resolution,
            "Container / MIME" to container,
            "Codecs" to codecs,
            "HDR" to hdr,
            "Audio" to audioParts,
            "Subtitles" to subtitles,
            "Frames dropped / total" to dropped,
            "Bitrate" to bitrate,
            "Source" to source,
            "Version" to version,
            "Buffer ahead" to buffer,
        )
    }
}

/**
 * Applies real dynamic-range compression to the active ExoPlayer audio session:
 * - API 28+ (Android 9+): DynamicsProcessing multiband compressor + limiter
 * - API 26-27 (and HAL fallback): LoudnessEnhancer gentle night-mode boost
 */
class TvmNightAudioController {
    private var enabled = false
    private var sessionId: Int = C.AUDIO_SESSION_ID_UNSET
    private var activeEffect: AudioEffect? = null

    fun setEnabled(next: Boolean) {
        if (enabled == next) return
        enabled = next
        apply()
    }

    fun onAudioSessionIdChanged(nextSessionId: Int) {
        if (sessionId == nextSessionId && (activeEffect != null || !enabled)) return
        sessionId = nextSessionId
        apply()
    }

    fun release() {
        releaseEffects()
        sessionId = C.AUDIO_SESSION_ID_UNSET
    }

    private fun releaseEffects() {
        runCatching { activeEffect?.release() }
        activeEffect = null
    }

    private fun apply() {
        releaseEffects()
        val id = sessionId
        if (!enabled || id == C.AUDIO_SESSION_ID_UNSET || id == 0) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && tryAttachDynamicsProcessing(id)) {
            return
        }
        runCatching {
            LoudnessEnhancer(id).apply {
                setTargetGain(800)
                setEnabled(true)
            }
        }.onSuccess { activeEffect = it }
    }

    @RequiresApi(Build.VERSION_CODES.P)
    private fun tryAttachDynamicsProcessing(id: Int): Boolean = runCatching {
        val builder = DynamicsProcessing.Config.Builder(
            DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
            2,
            false, 0,
            true, 1,
            false, 0,
            true,
        )
        val mbc = DynamicsProcessing.Mbc(true, true, 1).apply {
            setBand(
                0,
                DynamicsProcessing.MbcBand(
                    true,
                    20000f,
                    5f,
                    250f,
                    8f,
                    -26f,
                    6f,
                    -90f,
                    1f,
                    0f,
                    6f,
                ),
            )
        }
        val limiter = DynamicsProcessing.Limiter(true, true, 0, 1f, 60f, 10f, -2f, 0f)
        builder.setMbcAllChannelsTo(mbc)
        builder.setLimiterAllChannelsTo(limiter)
        activeEffect = DynamicsProcessing(0, id, builder.build()).apply { setEnabled(true) }
    }.isSuccess
}

/**
 * Pass-through glass overlay drawn over the video surface on Android:
 * - Upper-left corner tap target (`Stats`) + Sleep timer countdown pill
 * - Expandable frosted-glass Stats panel matching React `.playback-stats`
 * - Centered Sleep Timer Ended (`Resume` / `Close`) card when React is hidden
 */
class TvmNativeVideoOverlayView(
    context: Context,
    private val onToggleStats: () -> Unit,
    private val onResumeSleep: () -> Unit,
    private val onDismissSleep: () -> Unit,
) : FrameLayout(context) {
    private val pillStrip: LinearLayout
    private val statsToggleBtn: TextView
    private val sleepPill: TextView
    private val statsCard: LinearLayout
    private val statsRowsContainer: LinearLayout
    private val sleepExpiredCard: LinearLayout

    private var statsVisible = false
    private var sleepActive = false
    private var sleepExpired = false
    private var reactSheetOpen = false

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun glassBg(color: Int, cornerDp: Int, borderColor: Int = 0x30FFFFFF): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(cornerDp).toFloat()
            setStroke(dp(1), borderColor)
        }

    init {
        isClickable = false
        isFocusable = false
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)

        pillStrip = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = false
            isFocusable = false
        }

        statsToggleBtn = TextView(context).apply {
            text = "Stats"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#EDF1F7"))
            setPadding(dp(11), dp(6), dp(11), dp(6))
            background = glassBg(0xB811151E.toInt(), 14)
            isClickable = true
            isFocusable = true
            contentDescription = "Toggle playback stats"
            setOnClickListener { onToggleStats() }
            // Stats is switched on from the player's settings (the 18 November look has no button on the video).
            visibility = View.GONE
        }
        pillStrip.addView(
            statsToggleBtn,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )

        sleepPill = TextView(context).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            fontFeatureSettings = "tnum"
            setTextColor(Color.parseColor("#EDF1F7"))
            setPadding(dp(11), dp(6), dp(11), dp(6))
            background = glassBg(0xB811151E.toInt(), 14)
            visibility = View.GONE
            isClickable = false
        }
        pillStrip.addView(
            sleepPill,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = dp(8)
            },
        )

        val leftStack = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            isClickable = false
            isFocusable = false
        }
        leftStack.addView(
            pillStrip,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )

        statsCard = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = glassBg(0xEB11151E.toInt(), 12)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            visibility = View.GONE
            isClickable = true
            elevation = dp(8).toFloat()
        }

        val headingRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = TextView(context).apply {
            text = "Playback stats"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#F5F7FA"))
        }
        val closeBtn = TextView(context).apply {
            text = "×"
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            background = glassBg(0x1EFFFFFF, 6, 0x00000000)
            setPadding(dp(9), dp(2), dp(9), dp(3))
            contentDescription = "Close playback stats"
            setOnClickListener { onToggleStats() }
        }
        headingRow.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        headingRow.addView(closeBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        statsCard.addView(
            headingRow,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )

        statsRowsContainer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(6), 0, 0)
        }
        val scroll = ScrollView(context).apply {
            isVerticalScrollBarEnabled = true
            addView(statsRowsContainer, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        statsCard.addView(
            scroll,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
        leftStack.addView(
            statsCard,
            LinearLayout.LayoutParams(dp(300), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            },
        )

        val leftParams = LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP or Gravity.START
            leftMargin = dp(20)
            topMargin = dp(64)
            rightMargin = dp(16)
            bottomMargin = dp(16)
        }
        addView(leftStack, leftParams)

        // Centered Sleep Timer Ended dialog (when React layer is hidden/not presenting)
        sleepExpiredCard = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = glassBg(0xF012141A.toInt(), 16)
            setPadding(dp(18), dp(18), dp(18), dp(18))
            visibility = View.GONE
            isClickable = true
            elevation = dp(16).toFloat()
        }
        val sleepTitle = TextView(context).apply {
            text = "Sleep timer ended"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(12))
        }
        val resumeBtn = TextView(context).apply {
            text = "Resume"
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            background = glassBg(Color.parseColor("#2F6BFF"), 10, 0x00000000)
            setPadding(dp(16), dp(11), dp(16), dp(11))
            setOnClickListener { onResumeSleep() }
        }
        val dismissBtn = TextView(context).apply {
            text = "Close"
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#D8DEE8"))
            background = glassBg(0x1EFFFFFF, 10, 0x00000000)
            setPadding(dp(16), dp(9), dp(16), dp(9))
            setOnClickListener { onDismissSleep() }
        }
        sleepExpiredCard.addView(sleepTitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        sleepExpiredCard.addView(resumeBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        sleepExpiredCard.addView(
            dismissBtn,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            },
        )
        addView(
            sleepExpiredCard,
            LayoutParams(dp(260), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.CENTER
            },
        )

        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val lp = leftStack.layoutParams as LayoutParams
            lp.leftMargin = maxOf(dp(20), bars.left + dp(12))
            lp.topMargin = bars.top + dp(62)
            lp.bottomMargin = bars.bottom + dp(16)
            leftStack.layoutParams = lp
            insets
        }
    }

    fun setStatsVisible(visible: Boolean, sheetOpen: Boolean) {
        statsVisible = visible
        reactSheetOpen = sheetOpen
        syncVisibility()
    }

    fun setSheetOpen(open: Boolean) {
        reactSheetOpen = open
        syncVisibility()
    }

    fun updateSleep(choice: String, remainingText: String?, expired: Boolean, sheetOpen: Boolean) {
        reactSheetOpen = sheetOpen
        sleepActive = choice != "off" && !expired
        sleepExpired = expired
        sleepPill.text = when {
            remainingText != null && choice == "end" -> "Sleep End · $remainingText"
            remainingText != null -> "Sleep $remainingText"
            choice == "end" -> "Sleep · End"
            else -> "Sleep"
        }
        syncVisibility()
    }

    fun updateStatsRows(rows: List<Pair<String, String>>) {
        statsRowsContainer.removeAllViews()
        for ((label, value) in rows) {
            val row = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(3), 0, dp(3))
            }
            val k = TextView(context).apply {
                text = label
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setTextColor(Color.parseColor("#A9B0BC"))
            }
            val v = TextView(context).apply {
                text = value
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                fontFeatureSettings = "tnum"
                setTextColor(Color.parseColor("#F5F7FA"))
            }
            row.addView(k, LinearLayout.LayoutParams(dp(116), ViewGroup.LayoutParams.WRAP_CONTENT))
            row.addView(v, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            statsRowsContainer.addView(row)
        }
    }

    private fun syncVisibility() {
        pillStrip.visibility = if (reactSheetOpen) View.GONE else View.VISIBLE
        statsCard.visibility = if (!reactSheetOpen && statsVisible) View.VISIBLE else View.GONE
        sleepPill.visibility = if (!reactSheetOpen && sleepActive) View.VISIBLE else View.GONE
        sleepExpiredCard.visibility = if (!reactSheetOpen && sleepExpired) View.VISIBLE else View.GONE
        statsToggleBtn.text = if (statsVisible) "Stats ×" else "Stats"
        statsToggleBtn.background = if (statsVisible) {
            glassBg(0x732F6BFF, 14)
        } else {
            glassBg(0xB811151E.toInt(), 14)
        }
    }
}
