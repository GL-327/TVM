package com.tvm.privateclient

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * The startup reveal: the TVM logo is built from its parts rather than faded in.
 *
 * Timeline (ms):
 *  - 0–650     the violet→cyan wash blooms out of the app's dark background
 *  - 280–1500  T, V and M are traced in outline, then filled, one after another
 *  - 1050–2450 a glowing star travels the orbital trail, sweeping the lower and
 *              right arcs into being; it passes behind the M exactly where the
 *              logo's trail breaks
 *  - 2400–2950 the star arrives at its place, flares into the four-point star and
 *              the thin upper arc streams out of its left arm
 *  - 2900–3500 a shine passes over the letters and the glow settles
 *
 * The last frame is the logo exactly as in apps/brand/tvm-icon.png. All shapes
 * come from [TvmLogoGeometry]. After the reveal the view holds the finished logo
 * with a soft breathing glow until the activity dismisses it.
 */
class TvmIntroView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    /** Called once, when the reveal has finished (or immediately with animations off). */
    var onRevealed: (() -> Unit)? = null

    private var elapsed = 0f
    private var revealed = false
    private var animator: ValueAnimator? = null
    private var idle: ValueAnimator? = null
    private var idlePhase = 0f

    private val toView = Matrix()
    private var unit = 1f

    private val letterPaths = arrayOf(Path(), Path(), Path())
    private val letterBounds = arrayOf(RectF(), RectF(), RectF())
    private val letterMeasures = arrayOfNulls<PathMeasure>(3)
    private val lettersAll = Path()
    private val trailLower = Path()
    private val trailRight = Path()
    private val trailUpper = Path()
    private val starShape = Path()
    private val travel = Path()
    private var travelMeasure = PathMeasure()
    private var travelLength = 0f
    private var lowerEnd = 0f
    private var rightStart = 0f
    private var rightEnd = 0f
    private var upperMeasure = PathMeasure()
    private var upperLength = 0f
    private val starCentre = FloatArray(2)

    private val bgDark = Color.parseColor("#071033")
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
    private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
    }
    private val sweep = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG)
    private val wash = Paint()
    private val veil = Paint()
    private val shine = Paint(Paint.ANTI_ALIAS_FLAG)
    private val scratch = Path()
    private val clipScratch = Path()
    private val pos = FloatArray(2)

    fun start() {
        animator?.cancel()
        if (!ValueAnimator.areAnimatorsEnabled()) {
            elapsed = TOTAL_MS
            finishReveal()
            invalidate()
            return
        }
        animator = ValueAnimator.ofFloat(0f, TOTAL_MS).apply {
            duration = TOTAL_MS.toLong()
            interpolator = LinearInterpolator()
            addUpdateListener {
                elapsed = it.animatedValue as Float
                invalidate()
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) = finishReveal()
            })
            start()
        }
    }

    fun stop() {
        animator?.cancel()
        animator = null
        idle?.cancel()
        idle = null
    }

    override fun onDetachedFromWindow() {
        stop()
        super.onDetachedFromWindow()
    }

    private fun finishReveal() {
        if (revealed) return
        revealed = true
        elapsed = TOTAL_MS
        if (ValueAnimator.areAnimatorsEnabled() && isAttachedToWindow) {
            idle = ValueAnimator.ofFloat(0f, 1f).apply {
                duration = 2600
                repeatCount = ValueAnimator.INFINITE
                interpolator = LinearInterpolator()
                addUpdateListener {
                    idlePhase = it.animatedValue as Float
                    invalidate()
                }
                start()
            }
        }
        onRevealed?.invoke()
    }

    // ---- Geometry -------------------------------------------------------------

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w == 0 || h == 0) return
        // The logo's artwork spans roughly x 70–970, y 262–745 of the 1024 master.
        val contentW = 900f
        val contentH = 483f
        unit = min(w * 0.86f / contentW, h * 0.62f / contentH)
        toView.reset()
        toView.postTranslate(-CONTENT_CX, -CONTENT_CY)
        toView.postScale(unit, unit)
        toView.postTranslate(w / 2f, h / 2f)
        buildPaths()
        wash.shader = LinearGradient(
            0f, 0f, w.toFloat(), 0f,
            TvmLogoGeometry.gradientColors, TvmLogoGeometry.gradientStops, Shader.TileMode.CLAMP,
        )
    }

    private fun polygon(points: FloatArray, into: Path) {
        into.reset()
        into.moveTo(points[0], points[1])
        var i = 2
        while (i < points.size) {
            into.lineTo(points[i], points[i + 1])
            i += 2
        }
        into.close()
        into.transform(toView)
    }

    /** A smooth open curve through the points (quadratics between midpoints). */
    private fun curve(points: FloatArray, into: Path, join: Boolean) {
        val n = points.size / 2
        if (join) into.lineTo(points[0], points[1]) else into.moveTo(points[0], points[1])
        for (i in 1 until n - 1) {
            val mx = (points[i * 2] + points[i * 2 + 2]) / 2f
            val my = (points[i * 2 + 1] + points[i * 2 + 3]) / 2f
            into.quadTo(points[i * 2], points[i * 2 + 1], mx, my)
        }
        into.lineTo(points[points.size - 2], points[points.size - 1])
    }

    private fun buildPaths() {
        val g = TvmLogoGeometry
        polygon(g.letterT, letterPaths[0])
        polygon(g.letterV, letterPaths[1])
        polygon(g.letterM, letterPaths[2])
        lettersAll.reset()
        for (i in 0 until 3) {
            letterPaths[i].computeBounds(letterBounds[i], true)
            letterMeasures[i] = PathMeasure(letterPaths[i], true)
            lettersAll.addPath(letterPaths[i])
        }
        polygon(g.trailLower, trailLower)
        polygon(g.trailRight, trailRight)
        polygon(g.trailUpper, trailUpper)

        // Star: cubic edges pulled towards the centre along each spoke.
        starShape.reset()
        val cx = g.STAR_X
        val cy = g.STAR_Y
        val tips = arrayOf(
            floatArrayOf(cx, cy - g.STAR_UP),
            floatArrayOf(cx + g.STAR_SIDE, cy),
            floatArrayOf(cx, cy + g.STAR_DOWN),
            floatArrayOf(cx - g.STAR_SIDE, cy),
        )
        starShape.moveTo(tips[0][0], tips[0][1])
        for (i in 0 until 4) {
            val a = tips[i]
            val b = tips[(i + 1) % 4]
            val p = g.STAR_PINCH
            starShape.cubicTo(
                a[0] + (cx - a[0]) * p, a[1] + (cy - a[1]) * p,
                b[0] + (cx - b[0]) * p, b[1] + (cy - b[1]) * p,
                b[0], b[1],
            )
        }
        starShape.close()
        starShape.transform(toView)
        starCentre[0] = cx
        starCentre[1] = cy
        toView.mapPoints(starCentre)

        // The star's journey: along the lower sweep, behind the M, up the right
        // arc and into its place. Flattened into one contour so PathMeasure walks
        // it continuously; each arc is revealed while the star is over it.
        val lower = Path()
        curve(g.centreLower, lower, join = false)
        lower.transform(toView)
        val bridge = Path()
        bridge.moveTo(g.centreLower[g.centreLower.size - 2], g.centreLower[g.centreLower.size - 1])
        bridge.quadTo(805f, 612f, g.centreRight[0], g.centreRight[1])
        bridge.transform(toView)
        val right = Path()
        curve(g.centreRight, right, join = false)
        right.quadTo(g.centreRight[g.centreRight.size - 2] + 2f, cy + 8f, cx, cy)
        right.transform(toView)
        travel.reset()
        val pts = sampleContours(listOf(lower, bridge, right))
        travel.moveTo(pts[0], pts[1])
        var i = 2
        while (i < pts.size) {
            travel.lineTo(pts[i], pts[i + 1])
            i += 2
        }
        travelMeasure = PathMeasure(travel, false)
        travelLength = travelMeasure.length
        lowerEnd = PathMeasure(lower, false).length
        rightStart = lowerEnd + PathMeasure(bridge, false).length
        rightEnd = travelLength

        val upper = Path()
        curve(g.centreUpper, upper, join = false)
        upper.transform(toView)
        upperMeasure = PathMeasure(upper, false)
        upperLength = upperMeasure.length
    }

    /** Flattens paths, in order, into one polyline (view space). */
    private fun sampleContours(paths: List<Path>): FloatArray {
        val out = ArrayList<Float>()
        val step = max(1f, unit * 3f)
        for (path in paths) {
            val m = PathMeasure(path, false)
            val len = m.length
            var d = 0f
            while (d < len) {
                m.getPosTan(d, pos, null)
                out.add(pos[0]); out.add(pos[1])
                d += step
            }
            m.getPosTan(len, pos, null)
            out.add(pos[0]); out.add(pos[1])
        }
        return out.toFloatArray()
    }

    // ---- Drawing --------------------------------------------------------------

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        if (w == 0f || h == 0f) return
        val t = elapsed

        // 1. Background: dark, then the brand wash blooms from the middle.
        canvas.drawColor(bgDark)
        val bloom = ease(span(t, 0f, 650f))
        if (bloom > 0f) {
            wash.alpha = (255 * bloom).toInt()
            canvas.drawRect(0f, 0f, w, h, wash)
            if (bloom < 1f) {
                val r = max(w, h) * (0.35f + 0.9f * bloom)
                veil.shader = RadialGradient(
                    w / 2f, h / 2f, r,
                    intArrayOf(Color.TRANSPARENT, withAlpha(bgDark, (255 * (1f - bloom)).toInt())),
                    floatArrayOf(0.55f, 1f), Shader.TileMode.CLAMP,
                )
                canvas.drawRect(0f, 0f, w, h, veil)
            }
        }

        // 2. The trail, drawn under the letters so it passes behind them.
        val travelT = easeInOut(span(t, TRAVEL_START, TRAVEL_END))
        val starAt = travelLength * travelT
        revealAlong(canvas, trailLower, 0f, lowerEnd, starAt)
        revealAlong(canvas, trailRight, rightStart, rightEnd, starAt)
        val upperT = ease(span(t, UPPER_START, UPPER_END))
        if (upperT > 0f) {
            clipScratch.reset()
            upperMeasure.getSegment(0f, upperLength * upperT, scratch.also { it.reset() }, true)
            sweep.strokeWidth = 70f * unit
            sweep.getFillPath(scratch, clipScratch)
            canvas.save()
            canvas.clipPath(clipScratch)
            fill.alpha = 255
            canvas.drawPath(trailUpper, fill)
            canvas.restore()
        }

        // 3. The travelling star (under the letters: it disappears behind the M).
        if (t >= TRAVEL_START && t < ARRIVE_END) drawComet(canvas, t, starAt)

        // 4. Letters: outline traced, then filled with a small rise.
        for (i in 0 until 3) drawLetter(canvas, i, t)

        // 5. The star in its place.
        drawStar(canvas, t)

        // 6. Shine across the letters, then the settled logo.
        val sh = span(t, SHINE_START, SHINE_END)
        if (sh > 0f && sh < 1f) {
            val b = letterBounds[0].left
            val e = letterBounds[2].right
            val x = b - 120f * unit + (e - b + 240f * unit) * easeInOut(sh)
            shine.shader = LinearGradient(
                x - 70f * unit, 0f, x + 70f * unit, 0f,
                intArrayOf(Color.TRANSPARENT, Color.argb(150, 160, 235, 255), Color.TRANSPARENT),
                floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP,
            )
            canvas.save()
            canvas.clipPath(lettersAll)
            canvas.drawRect(0f, 0f, w, h, shine)
            canvas.restore()
        }
        if (revealed) drawIdleGlow(canvas)
    }

    private fun revealAlong(canvas: Canvas, shape: Path, from: Float, to: Float, at: Float) {
        if (at <= from) return
        val end = min(at, to)
        clipScratch.reset()
        scratch.reset()
        travelMeasure.getSegment(from, end, scratch, true)
        sweep.strokeWidth = 150f * unit
        sweep.getFillPath(scratch, clipScratch)
        canvas.save()
        canvas.clipPath(clipScratch)
        fill.alpha = 255
        canvas.drawPath(shape, fill)
        canvas.restore()
    }

    private fun drawComet(canvas: Canvas, t: Float, at: Float) {
        val fadeIn = span(t, TRAVEL_START, TRAVEL_START + 180f)
        val fadeOut = 1f - span(t, ARRIVE_START, ARRIVE_END)
        val a = fadeIn * fadeOut
        if (a <= 0f) return
        // Tail: a run of fading lights behind the head.
        val tail = 220f * unit
        val steps = 18
        for (k in steps downTo 1) {
            val d = at - tail * k / steps
            if (d < 0f) continue
            travelMeasure.getPosTan(d, pos, null)
            val f = 1f - k / steps.toFloat()
            val r = (4f + 10f * f) * unit
            glow.shader = RadialGradient(
                pos[0], pos[1], r,
                intArrayOf(Color.argb((150 * f * a).toInt(), 255, 255, 255), Color.TRANSPARENT),
                null, Shader.TileMode.CLAMP,
            )
            canvas.drawCircle(pos[0], pos[1], r, glow)
        }
        travelMeasure.getPosTan(at, pos, null)
        val halo = 46f * unit
        glow.shader = RadialGradient(
            pos[0], pos[1], halo,
            intArrayOf(
                Color.argb((255 * a).toInt(), 255, 255, 255),
                Color.argb((170 * a).toInt(), 190, 245, 255),
                Color.TRANSPARENT,
            ),
            floatArrayOf(0f, 0.22f, 1f), Shader.TileMode.CLAMP,
        )
        canvas.drawCircle(pos[0], pos[1], halo, glow)
    }

    private fun drawLetter(canvas: Canvas, i: Int, t: Float) {
        val start = LETTER_START + i * LETTER_STAGGER
        val trace = span(t, start, start + 620f)
        if (trace <= 0f) return
        val filled = ease(span(t, start + 380f, start + 900f))
        val path = letterPaths[i]
        val bounds = letterBounds[i]
        val rise = (1f - filled) * 22f * unit
        canvas.save()
        canvas.translate(0f, rise)
        if (filled < 1f) {
            val measure = letterMeasures[i] ?: return
            scratch.reset()
            measure.getSegment(0f, measure.length * ease(trace), scratch, true)
            outline.strokeWidth = 3.2f * unit
            outline.alpha = (255 * (1f - filled * 0.6f)).toInt()
            canvas.drawPath(scratch, outline)
        }
        if (filled > 0f) {
            // Fill wipes up from the baseline while it fades in.
            val top = bounds.bottom - bounds.height() * min(1f, filled * 1.25f)
            canvas.save()
            canvas.clipRect(bounds.left - 4f * unit, top, bounds.right + 4f * unit, bounds.bottom + 4f * unit)
            fill.alpha = (255 * min(1f, 0.35f + filled)).toInt()
            canvas.drawPath(path, fill)
            canvas.restore()
            fill.alpha = 255
        }
        canvas.restore()
    }

    private fun drawStar(canvas: Canvas, t: Float) {
        val p = span(t, ARRIVE_START, ARRIVE_END)
        if (p <= 0f) return
        val scale = when {
            p < 0.6f -> backOut(p / 0.6f) * 1.0f
            else -> 1f
        }
        val cx = starCentre[0]
        val cy = starCentre[1]
        // Flare: a brief bloom and long thin rays as the star lands.
        val flare = if (p < 1f) sin(Math.PI * p).toFloat() else 0f
        if (flare > 0f) {
            val r = 150f * unit * (0.6f + 0.6f * flare)
            glow.shader = RadialGradient(
                cx, cy, r,
                intArrayOf(Color.argb((210 * flare).toInt(), 255, 255, 255), Color.argb((90 * flare).toInt(), 160, 240, 255), Color.TRANSPARENT),
                floatArrayOf(0f, 0.25f, 1f), Shader.TileMode.CLAMP,
            )
            canvas.drawCircle(cx, cy, r, glow)
            val ray = 260f * unit * flare
            sweep.shader = null
            sweep.strokeWidth = 2.2f * unit
            sweep.color = Color.argb((170 * flare).toInt(), 255, 255, 255)
            canvas.drawLine(cx - ray, cy, cx + ray, cy, sweep)
            canvas.drawLine(cx, cy - ray * 0.75f, cx, cy + ray * 0.75f, sweep)
            sweep.color = Color.WHITE
        }
        canvas.save()
        canvas.scale(scale, scale, cx, cy)
        fill.alpha = (255 * min(1f, p * 3f)).toInt()
        canvas.drawPath(starShape, fill)
        fill.alpha = 255
        canvas.restore()
    }

    private fun drawIdleGlow(canvas: Canvas) {
        val b = 0.5f - 0.5f * kotlin.math.cos(2.0 * Math.PI * idlePhase).toFloat()
        if (b <= 0.01f) return
        val r = 90f * unit
        glow.shader = RadialGradient(
            starCentre[0], starCentre[1], r,
            intArrayOf(Color.argb((70 * b).toInt(), 255, 255, 255), Color.TRANSPARENT),
            null, Shader.TileMode.CLAMP,
        )
        canvas.drawCircle(starCentre[0], starCentre[1], r, glow)
        canvas.drawPath(starShape, fill)
    }

    private companion object {
        const val TOTAL_MS = 3500f
        const val CONTENT_CX = 520f
        const val CONTENT_CY = 504f
        const val LETTER_START = 280f
        const val LETTER_STAGGER = 170f
        const val TRAVEL_START = 1050f
        const val TRAVEL_END = 2450f
        const val ARRIVE_START = 2380f
        const val ARRIVE_END = 2950f
        const val UPPER_START = 2450f
        const val UPPER_END = 3000f
        const val SHINE_START = 2900f
        const val SHINE_END = 3500f

        fun span(t: Float, a: Float, b: Float): Float = ((t - a) / (b - a)).coerceIn(0f, 1f)
        fun ease(x: Float): Float = 1f - (1f - x).pow(3)
        fun easeInOut(x: Float): Float = if (x < 0.5f) 4f * x * x * x else 1f - (-2f * x + 2f).pow(3) / 2f
        fun backOut(x: Float): Float {
            val c1 = 1.70158f
            val c3 = c1 + 1f
            return 1f + c3 * (x - 1f).pow(3) + c1 * (x - 1f).pow(2)
        }
        fun withAlpha(color: Int, alpha: Int): Int =
            Color.argb(alpha.coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
    }
}
