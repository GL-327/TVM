package com.tvm.privateclient

import android.app.Activity
import android.text.format.Formatter
import android.view.View
import android.widget.TextView
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator

/**
 * The app update, as one sheet that changes with each step: checking, an
 * update offered, the download with its progress, ready to install, up to
 * date, or what went wrong with a way to try again. It replaces a run of
 * separate dialogs and toasts.
 */
class TvmUpdateSheet(private val activity: Activity) {
    private var dialog: BottomSheetDialog? = null
    private lateinit var title: TextView
    private lateinit var body: TextView
    private lateinit var status: TextView
    private lateinit var progress: LinearProgressIndicator
    private lateinit var primary: MaterialButton
    private lateinit var secondary: MaterialButton

    val isShowing: Boolean get() = dialog?.isShowing == true

    private fun sheet(): BottomSheetDialog {
        dialog?.let { if (it.isShowing) return it }
        val d = BottomSheetDialog(activity)
        val view = activity.layoutInflater.inflate(R.layout.sheet_app_update, null)
        title = view.findViewById(R.id.update_title)
        body = view.findViewById(R.id.update_body)
        status = view.findViewById(R.id.update_status)
        progress = view.findViewById(R.id.update_progress)
        primary = view.findViewById(R.id.update_primary)
        secondary = view.findViewById(R.id.update_secondary)
        d.setContentView(view)
        d.behavior.state = BottomSheetBehavior.STATE_EXPANDED
        d.behavior.skipCollapsed = true
        d.setOnDismissListener { if (dialog === d) dialog = null }
        dialog = d
        d.show()
        return d
    }

    private fun show(
        titleText: String,
        bodyText: String,
        primaryText: String? = null,
        onPrimary: (() -> Unit)? = null,
        secondaryText: String? = null,
        onSecondary: (() -> Unit)? = null,
        cancelable: Boolean = true,
    ) {
        if (activity.isFinishing || activity.isDestroyed) return
        val d = sheet()
        d.setCancelable(cancelable)
        title.text = titleText
        body.text = bodyText
        primary.visibility = if (primaryText != null) View.VISIBLE else View.GONE
        primary.text = primaryText
        primary.setOnClickListener { onPrimary?.invoke() }
        secondary.visibility = if (secondaryText != null) View.VISIBLE else View.GONE
        secondary.text = secondaryText
        secondary.setOnClickListener { onSecondary?.invoke() ?: d.dismiss() }
        progress.visibility = View.GONE
        status.visibility = View.GONE
    }

    private fun size(bytes: Long): String = Formatter.formatShortFileSize(activity, bytes)

    fun checking() {
        show(activity.getString(R.string.update_checking_title), activity.getString(R.string.update_checking_body),
            secondaryText = activity.getString(R.string.close))
        progress.isIndeterminate = true
        progress.visibility = View.VISIBLE
    }

    fun available(build: String, mine: String, bytes: Long, known: Boolean, onUpdate: () -> Unit, onLater: () -> Unit) {
        val text = if (known) activity.getString(R.string.update_available_body, build, mine)
        else activity.getString(R.string.update_available_unknown, build)
        show(activity.getString(R.string.update_available_title), text,
            activity.getString(R.string.update_now), onUpdate,
            activity.getString(R.string.update_later), { onLater(); dismiss() })
        if (bytes > 0) {
            status.text = activity.getString(R.string.update_size, size(bytes))
            status.visibility = View.VISIBLE
        }
    }

    fun downloading(done: Long, total: Long) {
        if (!isShowing || title.text != activity.getString(R.string.update_downloading_title)) {
            show(activity.getString(R.string.update_downloading_title), activity.getString(R.string.update_downloading_body),
                cancelable = false)
        }
        progress.visibility = View.VISIBLE
        status.visibility = View.VISIBLE
        if (total > 0) {
            progress.isIndeterminate = false
            progress.max = 1000
            progress.setProgressCompat((done * 1000 / total).toInt().coerceIn(0, 1000), true)
            status.text = activity.getString(R.string.update_progress, size(done), size(total))
        } else {
            progress.isIndeterminate = true
            status.text = size(done)
        }
    }

    fun ready(onInstall: () -> Unit) = show(activity.getString(R.string.update_ready_title),
        activity.getString(R.string.update_ready_body), activity.getString(R.string.update_install), onInstall,
        activity.getString(R.string.close))

    fun allow(onOpen: () -> Unit) = show(activity.getString(R.string.update_allow_title),
        activity.getString(R.string.update_allow_body), activity.getString(R.string.update_allow_open), onOpen,
        activity.getString(R.string.update_later))

    fun current(build: String) = show(activity.getString(R.string.update_current_title),
        activity.getString(R.string.update_current_body, build), activity.getString(R.string.update_done), { dismiss() })

    fun failed(reason: String, onRetry: () -> Unit) = show(activity.getString(R.string.update_failed_title), reason,
        activity.getString(R.string.update_retry), onRetry, activity.getString(R.string.close))

    /** True while a download is under way (the sheet then stays, whatever happens). */
    var busy = false

    /** Playback has gone full screen: an offer or a result must not sit over the film. */
    fun yieldToPlayback() {
        if (!busy) dismiss()
    }

    fun dismiss() {
        runCatching { dialog?.dismiss() }
        dialog = null
    }
}
