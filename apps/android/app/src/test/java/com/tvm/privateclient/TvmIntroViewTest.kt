package com.tvm.privateclient

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

/**
 * Draws the startup reveal with the real Android canvas and checks that its
 * last frame is the TVM logo: white letters, trail and star over the brand wash.
 * Frames are written to build/intro-frames for anyone who wants to look.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class TvmIntroViewTest {
    private val w = 1024
    private val h = 1024

    private fun frame(view: TvmIntroView, ms: Float): Bitmap {
        val field = TvmIntroView::class.java.getDeclaredField("elapsed").apply { isAccessible = true }
        field.setFloat(view, ms)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        return bitmap
    }

    private fun view(): TvmIntroView {
        val v = TvmIntroView(ApplicationProvider.getApplicationContext())
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        return v
    }

    private fun isWhite(c: Int) = Color.red(c) > 235 && Color.green(c) > 235 && Color.blue(c) > 235

    @Test
    fun lastFrameIsTheLogo() {
        val v = view()
        val out = File("build/intro-frames").apply { mkdirs() }
        for (ms in listOf(0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2600, 2800, 3100, 3500)) {
            val b = frame(v, ms.toFloat())
            FileOutputStream(File(out, "frame-%04d.png".format(ms))).use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        val last = frame(v, 3500f)
        // Map logo-space points to this view the same way the view does.
        val unit = minOf(w * 0.86f / 900f, h * 0.62f / 483f)
        fun at(x: Float, y: Float) = last.getPixel(((x - 520f) * unit + w / 2f).toInt(), ((y - 504f) * unit + h / 2f).toInt())
        assertTrue("star centre is white", isWhite(at(TvmLogoGeometry.STAR_X, TvmLogoGeometry.STAR_Y)))
        assertTrue("T stem is white", isWhite(at(270f, 560f)))
        assertTrue("V is white", isWhite(at(478f, 600f)))
        assertTrue("M left leg is white", isWhite(at(630f, 560f)))
        assertTrue("lower trail is white", isWhite(at(110f, 690f)))
        fun mid(c: FloatArray) = at(c[c.size / 2 - (c.size / 2) % 2], c[c.size / 2 - (c.size / 2) % 2 + 1])
        assertTrue("right trail is white", isWhite(mid(TvmLogoGeometry.centreRight)))
        assertTrue("upper trail is white", isWhite(mid(TvmLogoGeometry.centreUpper)))
        assertTrue("lower trail centre is white", isWhite(mid(TvmLogoGeometry.centreLower)))
        // Between the letters: the violet-to-cyan wash, not white and not dark.
        val gap = at(360f, 600f)
        assertTrue("wash between letters", !isWhite(gap) && Color.blue(gap) > 200)
    }

    @Test
    fun startsDark() {
        val first = frame(view(), 0f)
        val c = first.getPixel(w / 2, h / 2)
        assertEquals(Color.parseColor("#071033"), c or 0xFF000000.toInt())
    }
}
