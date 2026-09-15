package com.tvm.privateclient

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.media3.common.MediaItem as Media3Item
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONObject

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
) {
    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var view: PlayerView? = null
    private var container: FrameLayout? = null
    private var sessionId: String? = null
    private var ticking = false

    /** Exposed to the page as `window.tvmPlayer`. JS interfaces only take primitives. */
    inner class Bridge {
        @JavascriptInterface
        fun send(payload: String) {
            val message = runCatching { JSONObject(payload) }.getOrNull() ?: return
            val id = message.optString("id", "")
            val command = message.optString("command", "")
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
                if (volume.isFinite()) player?.volume = volume.coerceIn(0.0, 1.0).toFloat()
            }
            "mute" -> player?.volume = if (message.optBoolean("muted", false)) 0f else 1f
            "stop" -> close(id, notify = false)
        }
    }

    private fun open(id: String, message: JSONObject) {
        close(sessionId, notify = false)
        sessionId = id
        val url = Json.string(message.opt("url")) ?: run {
            emit(id, "error", Json.obj("message" to "This source could not be played. Try another source."))
            return
        }
        val live = message.optBoolean("live", false)
        val startAt = message.optDouble("startAt", 0.0)

        // The stream comes from our own loopback core, which proxies the real
        // provider; it still needs a player-shaped identity for the hops that
        // are served straight through.
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("VLC/3.0.20 LibVLC/3.0.20")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)

        val exo = ExoPlayer.Builder(activity)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .build()
        player = exo

        val builder = Media3Item.Builder().setUri(url)
        // Let Media3 sniff rather than trusting a provider's Content-Type,
        // except for HLS where naming it avoids a wasted probe.
        if (url.contains(".m3u8")) builder.setMimeType(MimeTypes.APPLICATION_M3U8)
        exo.setMediaItem(builder.build())

        exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                emit(id, "error", Json.obj("message" to describe(error)))
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) emit(id, "ended", JSONObject())
                pushState(id)
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) = pushState(id)
        })

        attachView(exo)
        if (!live && startAt > 0) exo.seekTo((startAt * 1000).toLong())
        exo.prepare()
        exo.play()
        startTicking(id)
    }

    private fun attachView(exo: ExoPlayer) {
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        val frame = FrameLayout(activity)
        val playerView = PlayerView(activity).apply {
            useController = false // the interface draws its own chrome
            setKeepContentOnPlayerReset(true)
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
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        // Behind the WebView: the interface's own controls must stay on top and
        // keep receiving touches.
        frame.z = 0f
        webView.z = 1f
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
                "hasFrame" to (exo.currentPosition > 200),
            ),
        )
    }

    fun close(id: String?, notify: Boolean) {
        ticking = false
        player?.release()
        player = null
        view?.player = null
        view = null
        container?.let { frame ->
            (frame.parent as? ViewGroup)?.removeView(frame)
        }
        container = null
        if (notify && id != null) emit(id, "closed", JSONObject())
        sessionId = null
    }

    fun release() = close(sessionId, notify = false)

    private fun describe(error: PlaybackException): String = when (error.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
        PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE ->
            "The source rejected this request. The link may have expired, or the subscription may not cover it."
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
            "TVM could not reach this source. Check the connection and try again."
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED ->
            "This phone could not decode the video in this file. Try another source."
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED ->
            "This file is damaged or is not the format the source claimed. Try another source."
        else -> "This source could not be played. Try another source."
    }

    /** Back to the page as the CustomEvent the shared engine listens for. */
    private fun emit(id: String, command: String, payload: JSONObject) {
        payload.put("id", id)
        payload.put("command", command)
        val script = "window.dispatchEvent(new CustomEvent('tvm:native-player',{detail:$payload}))"
        main.post { runCatching { webView.evaluateJavascript(script, null) } }
    }
}
