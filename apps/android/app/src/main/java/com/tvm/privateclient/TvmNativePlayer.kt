package com.tvm.privateclient

import android.app.Activity
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem as Media3Item
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Format
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject

private const val TAG = "TVMPlayer"

/**
 * Native decode for the Android shell, answering the same bridge protocol the
 * iOS client speaks (see apps/ui/src/player/iosEngine.ts).
 *
 * The web layer keeps navigation, progress reporting and billing; this owns the
 * picture only. That split is why the interface can stay one codebase across
 * desktop, iPhone and Android.
 *
 * Media3 is here for the same reason MobileVLCKit is on iOS: a WebView's
 * <video> element cannot open Matroska, WebM or MPEG-TS, which is most of what
 * a debrid link or an IPTV channel actually is.
 */
class TvmNativePlayer(
    private val activity: Activity,
    private val webView: WebView,
    /**
     * True when a picture starts, false when the last one closes. The shell
     * uses it for full-screen landscape playback (TvmCinemaMode).
     */
    private val onPlaying: (Boolean) -> Unit = {},
) {
    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var view: PlayerView? = null
    private var container: FrameLayout? = null
    private var sessionId: String? = null
    private var ticking = false
    /** Media3 only reports a live offset for a stream it knows is live. */
    private var isLive = false
    /** Last level from the slider. Mute must not throw that away and unmute at full. */
    private var level = 1f
    /** The player screen is open (shell-enter), whether or not a stream is playing yet. */
    private var shellHeld = false
    /** The video track being played, for diagnosing a failure. */
    private var videoFormat: Format? = null
    /** Whether a film was playing when the app left the screen, so it can carry on when it returns. */
    private var resumeOnStart = false
    /** The stream being played, so a copy that fails here is not offered again (TvmPlaybackMemory). */
    private var currentUrl: String? = null
    /** A real frame has reached the screen (not just a moving clock). */
    private var firstFrame = false
    /** Only the first failure of a session is reported; the page retries once per report. */
    private var failedOnce = false
    private var stallCheck: Runnable? = null
    /** This session already fell back to the phone's software video decoder. */
    private var softwareVideo = false
    /** Position (ms) the current attempt started from, for the sound-without-picture check. */
    private var startedAtMs = 0L
    /** The current attempt has a video track (a sound-only stream needs no picture). */
    private var hasVideoTrack = false
    /** What the page sent with `open`, to start the same copy again with another decoder. */
    private var openMessage: JSONObject? = null

    /** Exposed to the page as `window.tvmPlayer`. JS interfaces only take primitives. */
    inner class Bridge {
        @JavascriptInterface
        fun send(payload: String) {
            val message = runCatching { JSONObject(payload) }.getOrNull() ?: return
            val id = message.text("id", "")
            val command = message.text("command", "")
            if (id.isEmpty() || command.isEmpty()) return
            main.post { handle(id, command, message) }
        }
    }

    fun bridge(): Bridge = Bridge()

    private fun handle(id: String, command: String, message: JSONObject) {
        when (command) {
            "open" -> open(id, message)
            "play" -> player?.play()
            "pause" -> player?.pause()
            "seek" -> {
                val seconds = message.optDouble("seconds", 0.0)
                if (seconds.isFinite() && seconds >= 0) player?.seekTo((seconds * 1000).toLong())
            }
            "volume" -> {
                val volume = message.optDouble("volume", 1.0)
                if (volume.isFinite()) {
                    level = volume.coerceIn(0.0, 1.0).toFloat()
                    player?.volume = level
                }
            }
            "mute" -> player?.volume = if (message.optBoolean("muted", false)) 0f else level
            "rate" -> {
                val rate = message.optDouble("rate", 1.0)
                if (rate.isFinite()) {
                    player?.playbackParameters = PlaybackParameters(rate.coerceIn(0.25, 2.0).toFloat())
                }
            }
            // Media3 knows where the live edge is, so returning to it is a
            // genuine seek rather than a reconnect: the buffer is kept.
            "goLive" -> player?.let { exo ->
                if (isLive) {
                    exo.seekToDefaultPosition()
                    exo.play()
                }
            }
            "stop" -> close(id, notify = false)
            // Android shell only (tvm-android.js): the player screen has opened
            // or closed. Turning to landscape here, before the stream is ready,
            // means the film never starts in a portrait loading screen.
            "shell-enter" -> if (!shellHeld) { shellHeld = true; onPlaying(true) }
            "shell-leave" -> if (shellHeld) {
                shellHeld = false
                if (player == null) onPlaying(false)
            }
        }
    }

    private fun open(id: String, message: JSONObject) {
        // Switching source (next episode, retry) is not the player closing:
        // stay full screen rather than rotating back and forth.
        close(sessionId, notify = false, leaving = false)
        sessionId = id
        val url = Json.string(message.opt("url")) ?: run {
            emit(id, "error", Json.obj("message" to "This source could not be played. Try another source."))
            return
        }
        val live = message.optBoolean("live", false)
        isLive = live
        val startAt = message.optDouble("startAt", 0.0)
        currentUrl = url
        failedOnce = false
        softwareVideo = false
        openMessage = message
        start(id, url, message, ((if (!live && startAt > 0) startAt else 0.0) * 1000).toLong(), software = false)
    }

    /**
     * One attempt at playing [url]. [software] prefers the phone's software
     * video decoder: the fallback when its hardware decoder cannot show this
     * copy's picture.
     */
    private fun start(id: String, url: String, message: JSONObject, startAtMs: Long, software: Boolean) {
        val live = message.optBoolean("live", false)
        firstFrame = false
        hasVideoTrack = false
        startedAtMs = startAtMs

        // The stream comes from our own loopback core, which proxies the real
        // provider; it still needs a player-shaped identity for the hops that
        // are served straight through.
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("VLC/3.0.20 LibVLC/3.0.20")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)

        // When the phone's preferred decoder cannot be created for a stream
        // (common for 4K / 10-bit HEVC and Dolby Vision), let Media3 try the
        // phone's other decoders before giving up.
        val renderers = DefaultRenderersFactory(activity).setEnableDecoderFallback(true)
        if (software) {
            // Software decoders first for video; everything else as Media3 chooses.
            renderers.setMediaCodecSelector { mime, secure, tunneling ->
                val all = MediaCodecUtil.getDecoderInfos(mime, secure, tunneling)
                if (mime.startsWith("video/")) all.sortedBy { if (it.softwareOnly) 0 else 1 } else all
            }
        }
        videoFormat = null
        val exo = ExoPlayer.Builder(activity, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            // Duck or pause for calls and other apps, and stop when headphones are pulled out.
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()
        player = exo
        val initialVolume = message.optDouble("initialVolume", 1.0)
        level = if (initialVolume.isFinite()) initialVolume.coerceIn(0.0, 1.0).toFloat() else 1f
        exo.volume = if (message.optBoolean("initialMuted", false)) 0f else level

        val builder = Media3Item.Builder().setUri(url)
        // Let Media3 sniff rather than trusting a provider's Content-Type,
        // except for HLS where naming it avoids a wasted probe.
        if (url.contains(".m3u8")) builder.setMimeType(MimeTypes.APPLICATION_M3U8)
        exo.setMediaItem(builder.build())

        exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                // The full story for development logs (adb logcat -s TVMPlayer):
                // the error code, the stream's format and the decoder's own cause.
                Log.e(TAG, "playback failed: ${error.errorCodeName} format=${videoFormat?.let(::formatLabel) ?: "unknown"} software=$software", error)
                // The picture's decoder failed: the same copy may still play
                // through the phone's software decoder.
                val renderer = (error as? ExoPlaybackException)?.takeIf { it.type == ExoPlaybackException.TYPE_RENDERER }
                val mime = renderer?.rendererFormat?.sampleMimeType ?: ""
                if (mime.startsWith("video/") && decoderError(error)) {
                    videoProblem(id, error.errorCodeName, mime, describe(error))
                    return
                }
                // A copy this phone cannot decode, or a link the source refuses,
                // is not offered again; a dropped connection is not the copy's fault.
                if (copyAtFault(error)) markFailed(error.errorCodeName)
                fail(id, describe(error))
            }

            override fun onTracksChanged(tracks: Tracks) {
                videoFormat = tracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO && it.isSelected }
                    ?.let { group -> (0 until group.length).firstOrNull { group.isTrackSelected(it) }?.let { group.getTrackFormat(it) } }
                    ?: videoFormat
                videoFormat?.let { Log.i(TAG, "video: ${formatLabel(it)} codecs=${it.codecs} ${it.width}x${it.height} software=$software") }
                val video = tracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }
                hasVideoTrack = video.isNotEmpty()
                video.forEach { group ->
                    (0 until group.length).forEach { i ->
                        val f = group.getTrackFormat(i)
                        Log.i(TAG, "video track: ${f.sampleMimeType} ${f.codecs} ${f.width}x${f.height} supported=${group.isTrackSupported(i)} selected=${group.isTrackSelected(i)}")
                    }
                }
                // The copy has a picture, but no decoder on this phone was
                // chosen for it: Media3 then plays the sound alone over a black
                // screen, without an error. That is a failure, not playback.
                if (video.isNotEmpty() && video.none { it.isSelected }) {
                    val f = video.first().getTrackFormat(0)
                    val mime = f.sampleMimeType ?: ""
                    videoProblem(id, "no video decoder chosen", mime, "This phone can't show the picture in this copy (${formatLabel(f)}). Press Retry to try another copy.")
                    return
                }
                val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
                audio.forEach { group ->
                    (0 until group.length).forEach { i ->
                        val f = group.getTrackFormat(i)
                        Log.i(TAG, "audio: ${f.sampleMimeType} ${f.channelCount}ch ${f.language ?: ""} supported=${group.isTrackSupported(i)} selected=${group.isTrackSelected(i)}")
                    }
                }
                // Sound tracks exist but this phone can decode none of them (often
                // TrueHD or DTS in a remux): the film would play silently.
                if (audio.isNotEmpty() && audio.none { it.isSupported }) {
                    val kinds = audio.mapNotNull { it.getTrackFormat(0).sampleMimeType?.removePrefix("audio/") }.distinct().joinToString(", ")
                    markFailed("no playable sound ($kinds)")
                    fail(id, "This phone can't play the sound in this copy ($kinds). Press Retry to try another copy.")
                }
            }

            override fun onRenderedFirstFrame() {
                if (firstFrame) return
                firstFrame = true
                stallCheck?.let(main::removeCallbacks)
                Log.i(TAG, "first frame on screen")
                pushState(id)
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) emit(id, "ended", JSONObject())
                pushState(id)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) = pushState(id)
        })

        // The picture is behind the WebView. An opaque page or WebView paints black over it.
        webView.setBackgroundColor(Color.TRANSPARENT)
        attachView(exo)
        onPlaying(true)
        if (startAtMs > 0) exo.seekTo(startAtMs)
        exo.prepare()
        exo.play()
        startTicking(id)
        watchForStall(id, exo)
    }

    /**
     * A copy that never shows a picture (too large for the connection, or a
     * server that stalls) left a black screen with no sound and no message.
     * After 30 seconds of trying without a frame, it is reported as failed and
     * not offered again, so the page's retry picks another copy.
     */
    private fun watchForStall(id: String, exo: ExoPlayer) {
        val check = Runnable {
            if (sessionId != id || player !== exo || firstFrame) return@Runnable
            // Paused by the person (or the app is in the background): not a stall.
            if (!exo.playWhenReady) { watchForStall(id, exo); return@Runnable }
            Log.w(TAG, "no picture after ${STALL_MS / 1000} s: state=${exo.playbackState} buffered=${exo.bufferedPosition} ms")
            markFailed("no picture after ${STALL_MS / 1000} s")
            fail(id, "This copy didn't start. Press Retry to try another copy.")
        }
        stallCheck?.let(main::removeCallbacks)
        stallCheck = check
        main.postDelayed(check, STALL_MS)
    }

    /**
     * The picture cannot be shown. Once per session the same copy is started
     * again from where it was with the phone's software video decoder (slower,
     * but it accepts profiles and levels the hardware one refuses). If that was
     * already tried, or the phone has no software decoder for this format, the
     * copy is marked as failed and the page's retry moves to another.
     */
    private fun videoProblem(id: String, why: String, mime: String, message: String) {
        if (sessionId != id || failedOnce) return
        val url = currentUrl
        val sent = openMessage
        val hasSoftware = mime.isNotEmpty() &&
            runCatching { MediaCodecUtil.getDecoderInfos(mime, false, false).any { it.softwareOnly } }.getOrDefault(false)
        Log.w(TAG, "no picture ($why, $mime): software tried=$softwareVideo, software available=$hasSoftware")
        if (!softwareVideo && hasSoftware && url != null && sent != null) {
            softwareVideo = true
            val at = player?.currentPosition?.coerceAtLeast(0L) ?: startedAtMs
            main.post {
                if (sessionId != id) return@post
                releasePlayer()
                start(id, url, sent, at, software = true)
            }
            return
        }
        markFailed(why)
        fail(id, message)
    }

    private fun decoderError(error: PlaybackException): Boolean = when (error.errorCode) {
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> true
        else -> false
    }

    /** The player and its view only; the session (id, landscape, page) stays. */
    private fun releasePlayer() {
        stallCheck?.let(main::removeCallbacks)
        player?.release()
        player = null
        view?.player = null
        view = null
        container?.let { frame -> (frame.parent as? ViewGroup)?.removeView(frame) }
        container = null
    }

    private fun markFailed(why: String) {
        currentUrl?.let { TvmPlaybackMemory.failed(it, why) }
    }

    private fun fail(id: String, message: String) {
        if (failedOnce) return
        failedOnce = true
        stallCheck?.let(main::removeCallbacks)
        player?.pause()
        emit(id, "error", Json.obj("message" to message))
    }

    private fun copyAtFault(error: PlaybackException): Boolean = when (error.errorCode) {
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        PlaybackException.ERROR_CODE_TIMEOUT,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED -> false
        else -> true
    }

    private fun attachView(exo: ExoPlayer) {
        // The WebView's own parent, so the picture can be put underneath it.
        // Added to android.R.id.content after that parent, it was drawn over the
        // interface, and the surface could blank out the player controls.
        val root = (webView.parent as? ViewGroup) ?: activity.findViewById(android.R.id.content)
        val frame = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        val playerView = PlayerView(activity).apply {
            useController = false // the interface draws its own chrome
            setKeepContentOnPlayerReset(true)
            // As large as the screen allows at the source's own shape: never
            // stretched or cropped.
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            player = exo
        }
        frame.addView(
            playerView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        root.addView(
            frame,
            0,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        // Index 0 puts it behind the WebView: the interface's own controls stay
        // on top and keep receiving touches. No elevation is set, because a
        // raised WebView would also cover the native menu and error pane.
        container = frame
        view = playerView
    }

    private fun startTicking(id: String) {
        if (ticking) return
        ticking = true
        val tick = object : Runnable {
            override fun run() {
                if (!ticking || sessionId != id) return
                pushState(id)
                // Sound for six seconds and still no picture: the video is not
                // reaching the screen (Media3 may play the sound on its own).
                player?.let { exo ->
                    if (!firstFrame && hasVideoTrack && exo.isPlaying && exo.currentPosition - startedAtMs > SOUND_ONLY_MS) {
                        videoProblem(id, "sound without picture", videoFormat?.sampleMimeType ?: "",
                            "This phone can't show the picture in this copy. Press Retry to try another copy.")
                    }
                }
                main.postDelayed(this, 250)
            }
        }
        main.postDelayed(tick, 250)
    }

    private fun pushState(id: String) {
        val exo = player ?: return
        val duration = exo.duration
        emit(
            id,
            "state",
            Json.obj(
                "position" to exo.currentPosition / 1000.0,
                "duration" to if (duration > 0) duration / 1000.0 else 0.0,
                "paused" to !exo.isPlaying,
                "buffering" to (exo.playbackState == Player.STATE_BUFFERING),
                "hasFrame" to firstFrame,
                // The sound actually being decoded and handed to the audio
                // output, for diagnostics and the emulator test: the codec, and
                // a count that grows while sound plays.
                "audio" to (exo.audioFormat?.sampleMimeType ?: ""),
                "audioBuffers" to (exo.audioDecoderCounters?.renderedOutputBufferCount ?: 0),
                // C.TIME_UNSET until the manifest establishes a live window.
                "liveDrift" to if (isLive && exo.currentLiveOffset != C.TIME_UNSET) {
                    (exo.currentLiveOffset / 1000.0).coerceAtLeast(0.0)
                } else {
                    0.0
                },
            ),
        )
    }

    fun close(id: String?, notify: Boolean, leaving: Boolean = true) {
        val wasOpen = player != null
        ticking = false
        stallCheck?.let(main::removeCallbacks)
        stallCheck = null
        player?.release()
        player = null
        view?.player = null
        view = null
        container?.let { frame ->
            (frame.parent as? ViewGroup)?.removeView(frame)
        }
        container = null
        webView.setBackgroundColor(Color.BLACK)
        if (notify && id != null) emit(id, "closed", JSONObject())
        sessionId = null
        // While the player screen is still open (retry, next episode) the
        // phone stays in landscape; it turns back when that screen closes.
        if (wasOpen && leaving && !shellHeld) onPlaying(false)
    }

    fun release() {
        val held = shellHeld
        shellHeld = false
        val playing = player != null
        close(sessionId, notify = false)
        if (held && !playing) onPlaying(false)
    }

    /**
     * The app left the screen (home button, another app, screen off). The
     * picture's surface is destroyed with the window, so pause here rather than
     * keep decoding into nothing, and tell the page so its controls agree.
     */
    fun onHostStop() {
        val exo = player ?: return
        resumeOnStart = exo.playWhenReady
        exo.pause()
        sessionId?.let { pushState(it) }
    }

    /** Back on screen: the surface comes back with the window; carry on where it was. */
    fun onHostStart() {
        val exo = player ?: return
        if (resumeOnStart) exo.play()
        resumeOnStart = false
        sessionId?.let { pushState(it) }
    }

    private fun describe(error: PlaybackException): String = when (error.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
        PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE ->
            "The source rejected this request. The link may have expired, or the subscription may not cover it."
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
            "TVM could not reach this source. Check the connection and try again."
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> {
            // Say what the video is, so it is clear this copy is the problem and
            // another (usually 1080p) source will play.
            val what = videoFormat?.let(::formatLabel)
            if (what != null) "This phone can't play the video in this copy ($what). Press Retry to try another copy."
            else "This phone can't play the video in this copy. Press Retry to try another copy."
        }
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED ->
            "This file is damaged or is not the format the source claimed. Try another source."
        else -> "This source could not be played. Try another source."
    }

    /** "4K · Dolby Vision · HEVC": resolution, dynamic range and codec of a video track. */
    private fun formatLabel(format: Format): String {
        val parts = mutableListOf<String>()
        val lines = minOf(format.width, format.height).takeIf { it > 0 }
        if (lines != null) parts += when {
            maxOf(format.width, format.height) >= 3200 -> "4K"
            lines >= 1000 -> "1080p"
            lines >= 700 -> "720p"
            else -> "${lines}p"
        }
        val mime = format.sampleMimeType ?: ""
        val transfer = format.colorInfo?.colorTransfer
        when {
            mime == MimeTypes.VIDEO_DOLBY_VISION || (format.codecs ?: "").startsWith("dv") -> parts += "Dolby Vision"
            transfer == C.COLOR_TRANSFER_ST2084 -> parts += "HDR10"
            transfer == C.COLOR_TRANSFER_HLG -> parts += "HLG"
        }
        parts += when (mime) {
            MimeTypes.VIDEO_H265, MimeTypes.VIDEO_DOLBY_VISION -> "HEVC"
            MimeTypes.VIDEO_H264 -> "H.264"
            MimeTypes.VIDEO_AV1 -> "AV1"
            MimeTypes.VIDEO_VP9 -> "VP9"
            "" -> "unknown codec"
            else -> mime.removePrefix("video/")
        }
        return parts.joinToString(" · ")
    }

    /** Back to the page as the CustomEvent the shared engine listens for. */
    private fun emit(id: String, command: String, payload: JSONObject) {
        payload.put("id", id)
        payload.put("command", command)
        val script = "window.dispatchEvent(new CustomEvent('tvm:native-player',{detail:$payload}))"
        main.post { runCatching { webView.evaluateJavascript(script, null) } }
    }

    private companion object {
        const val STALL_MS = 30_000L
        const val SOUND_ONLY_MS = 6_000L
    }
}
