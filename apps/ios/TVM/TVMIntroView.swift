import SwiftUI
import UIKit

/// The startup reveal: the TVM logo is built from its parts rather than faded in.
///
/// A port of Android's TvmIntroView, drawn from the same geometry
/// (TVMLogoGeometry) on the same timeline (ms):
///  - 0–650     the violet→cyan wash blooms out of the dark background
///  - 280–1500  T, V and M are traced in outline, then filled, one after another
///  - 1050–2450 a glowing star travels the orbital trail, sweeping the lower and
///              right arcs into being; it passes behind the M where the trail breaks
///  - 2380–2950 the star lands, flares into the four-point star and the thin
///              upper arc streams out of its left arm
///  - 2900–3500 a shine passes over the letters and the glow settles
/// The last frame is the logo as in apps/brand/tvm-icon.png. After the reveal
/// the view holds the finished logo with a soft breathing glow until dismissed.
final class TVMIntroUIView: UIView {
    var onRevealed: (() -> Void)?

    private var link: CADisplayLink?
    private var startedAt: CFTimeInterval = 0
    private var elapsed: CGFloat = 0
    private var revealed = false
    private var idlePhase: CGFloat = 0

    private var unit: CGFloat = 1
    private var letters: [Poly] = []
    private var letterPaths: [CGPath] = []
    private var lettersAll = CGMutablePath()
    private var trailLower = CGMutablePath()
    private var trailRight = CGMutablePath()
    private var trailUpper = CGMutablePath()
    private var starShape = CGMutablePath()
    private var travel = Poly(points: [])
    private var upper = Poly(points: [])
    private var lowerEnd: CGFloat = 0
    private var rightStart: CGFloat = 0
    private var starCentre = CGPoint.zero
    private var builtFor = CGSize.zero

    private static let bgDark = UIColor(red: 7 / 255, green: 16 / 255, blue: 51 / 255, alpha: 1)
    private static let total: CGFloat = 3500
    private static let contentCX: CGFloat = 520, contentCY: CGFloat = 504
    private static let letterStart: CGFloat = 280, letterStagger: CGFloat = 170
    private static let travelStart: CGFloat = 1050, travelEnd: CGFloat = 2450
    private static let arriveStart: CGFloat = 2380, arriveEnd: CGFloat = 2950
    private static let upperStart: CGFloat = 2450, upperEnd: CGFloat = 3000
    private static let shineStart: CGFloat = 2900, shineEnd: CGFloat = 3500

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Self.bgDark
        isOpaque = true
        contentMode = .redraw
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func start() {
        guard link == nil else { return }
        if UIAccessibility.isReduceMotionEnabled {
            elapsed = Self.total
            finishReveal()
            setNeedsDisplay()
            return
        }
        startedAt = CACurrentMediaTime()
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() { link?.invalidate(); link = nil }

    @objc private func tick() {
        let now = CACurrentMediaTime()
        if !revealed {
            elapsed = min(Self.total, CGFloat((now - startedAt) * 1000))
            if elapsed >= Self.total { finishReveal() }
        } else {
            idlePhase = CGFloat((now - startedAt).truncatingRemainder(dividingBy: 2.6) / 2.6)
        }
        setNeedsDisplay()
    }

    private func finishReveal() {
        guard !revealed else { return }
        revealed = true
        startedAt = CACurrentMediaTime()
        onRevealed?()
    }

    // MARK: Geometry

    /// A polyline that can be measured, walked and cut, as Android's PathMeasure does.
    struct Poly {
        var points: [CGPoint]
        var lengths: [CGFloat] = []
        init(points: [CGPoint]) {
            self.points = points
            var total: CGFloat = 0
            lengths = points.indices.map { i in
                if i > 0 { total += hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) }
                return total
            }
        }
        var length: CGFloat { lengths.last ?? 0 }

        func point(at d: CGFloat) -> CGPoint {
            guard points.count > 1 else { return points.first ?? .zero }
            let at = max(0, min(length, d))
            var i = 1
            while i < lengths.count - 1 && lengths[i] < at { i += 1 }
            let span = max(0.0001, lengths[i] - lengths[i - 1])
            let f = (at - lengths[i - 1]) / span
            return CGPoint(x: points[i - 1].x + (points[i].x - points[i - 1].x) * f, y: points[i - 1].y + (points[i].y - points[i - 1].y) * f)
        }

        func segment(_ from: CGFloat, _ to: CGFloat) -> CGPath {
            let path = CGMutablePath()
            guard points.count > 1, to > from else { return path }
            path.move(to: point(at: from))
            for i in points.indices where lengths[i] > from && lengths[i] < to { path.addLine(to: points[i]) }
            path.addLine(to: point(at: to))
            return path
        }
    }

    private func toView(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: (x - Self.contentCX) * unit + bounds.width / 2, y: (y - Self.contentCY) * unit + bounds.height / 2)
    }

    private func polygonPoints(_ flat: [CGFloat]) -> [CGPoint] {
        stride(from: 0, to: flat.count - 1, by: 2).map { toView(flat[$0], flat[$0 + 1]) }
    }

    private func polygon(_ flat: [CGFloat]) -> CGMutablePath {
        let path = CGMutablePath()
        path.addLines(between: polygonPoints(flat))
        path.closeSubpath()
        return path
    }

    /// A smooth open curve through the points (quadratics between midpoints), flattened.
    private func curvePoints(_ flat: [CGFloat]) -> [CGPoint] {
        let p = polygonPoints(flat)
        guard p.count > 2 else { return p }
        var out = [p[0]]
        var current = p[0]
        for i in 1..<(p.count - 1) {
            let mid = CGPoint(x: (p[i].x + p[i + 1].x) / 2, y: (p[i].y + p[i + 1].y) / 2)
            out += quad(from: current, control: p[i], to: mid)
            current = mid
        }
        out.append(p[p.count - 1])
        return out
    }

    private func quad(from a: CGPoint, control c: CGPoint, to b: CGPoint, steps: Int = 8) -> [CGPoint] {
        (1...steps).map { s in
            let t = CGFloat(s) / CGFloat(steps), u = 1 - t
            return CGPoint(x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y)
        }
    }

    private func build() {
        guard bounds.size != builtFor, bounds.width > 0, bounds.height > 0 else { return }
        builtFor = bounds.size
        // The artwork spans roughly x 70–970, y 262–745 of the 1024 master.
        unit = min(bounds.width * 0.86 / 900, bounds.height * 0.62 / 483)
        let g = TVMLogoGeometry.self
        letters = []
        letterPaths = []
        lettersAll = CGMutablePath()
        for flat in [g.letterT, g.letterV, g.letterM] {
            var pts = polygonPoints(flat)
            pts.append(pts[0])
            letters.append(Poly(points: pts))
            let path = polygon(flat)
            letterPaths.append(path)
            lettersAll.addPath(path)
        }
        trailLower = polygon(g.trailLower)
        trailRight = polygon(g.trailRight)
        trailUpper = polygon(g.trailUpper)

        // Star: cubic edges pulled towards the centre along each spoke.
        let cx: CGFloat = g.starX, cy: CGFloat = g.starY
        let top: (CGFloat, CGFloat) = (cx, cy - g.starUp)
        let rightTip: (CGFloat, CGFloat) = (cx + g.starSide, cy)
        let bottom: (CGFloat, CGFloat) = (cx, cy + g.starDown)
        let leftTip: (CGFloat, CGFloat) = (cx - g.starSide, cy)
        let tips: [(CGFloat, CGFloat)] = [top, rightTip, bottom, leftTip]
        starShape = CGMutablePath()
        starShape.move(to: toView(tips[0].0, tips[0].1))
        for i in 0..<4 {
            let a: (CGFloat, CGFloat) = tips[i]
            let b: (CGFloat, CGFloat) = tips[(i + 1) % 4]
            let p: CGFloat = g.starPinch
            let c1x: CGFloat = a.0 + (cx - a.0) * p, c1y: CGFloat = a.1 + (cy - a.1) * p
            let c2x: CGFloat = b.0 + (cx - b.0) * p, c2y: CGFloat = b.1 + (cy - b.1) * p
            starShape.addCurve(to: toView(b.0, b.1), control1: toView(c1x, c1y), control2: toView(c2x, c2y))
        }
        starShape.closeSubpath()
        starCentre = toView(cx, cy)

        // The star's journey: the lower sweep, behind the M, up the right arc, into place.
        let lower = curvePoints(g.centreLower)
        let lowerLast = toView(g.centreLower[g.centreLower.count - 2], g.centreLower[g.centreLower.count - 1])
        let bridge = quad(from: lowerLast, control: toView(805, 612), to: toView(g.centreRight[0], g.centreRight[1]))
        var right = curvePoints(g.centreRight)
        let rightLast = (g.centreRight[g.centreRight.count - 2], g.centreRight[g.centreRight.count - 1])
        right += quad(from: toView(rightLast.0, rightLast.1), control: toView(rightLast.0 + 2, cy + 8), to: toView(cx, cy))
        lowerEnd = Poly(points: lower).length
        rightStart = Poly(points: lower + bridge).length
        travel = Poly(points: lower + bridge + right)
        upper = Poly(points: curvePoints(g.centreUpper))
    }

    // MARK: Drawing

    override func draw(_ rect: CGRect) {
        build()
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        let t = elapsed
        let w = bounds.width, h = bounds.height

        // 1. Background: dark, then the brand wash blooms from the middle.
        ctx.setFillColor(Self.bgDark.cgColor)
        ctx.fill(bounds)
        let bloom = Self.ease(Self.span(t, 0, 650))
        if bloom > 0 {
            ctx.saveGState()
            ctx.setAlpha(bloom)
            let colors = TVMLogoGeometry.gradientColors.map { Self.color($0).cgColor } as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: TVMLogoGeometry.gradientStops) {
                ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: w, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            }
            ctx.restoreGState()
            if bloom < 1 {
                let r = max(w, h) * (0.35 + 0.9 * bloom)
                radial(ctx, at: CGPoint(x: w / 2, y: h / 2), radius: r,
                       colors: [UIColor.clear, Self.bgDark.withAlphaComponent(1 - bloom)], locations: [0.55, 1])
            }
        }

        // 2. The trail, under the letters so it passes behind them.
        let travelT = Self.easeInOut(Self.span(t, Self.travelStart, Self.travelEnd))
        let starAt = travel.length * travelT
        revealAlong(ctx, shape: trailLower, from: 0, to: lowerEnd, at: starAt)
        revealAlong(ctx, shape: trailRight, from: rightStart, to: travel.length, at: starAt)
        let upperT = Self.ease(Self.span(t, Self.upperStart, Self.upperEnd))
        if upperT > 0 {
            let reach = upper.segment(0, upper.length * upperT).copy(strokingWithWidth: 70 * unit, lineCap: .round, lineJoin: .round, miterLimit: 10)
            ctx.saveGState()
            ctx.addPath(reach); ctx.clip()
            ctx.setFillColor(UIColor.white.cgColor)
            ctx.addPath(trailUpper); ctx.fillPath()
            ctx.restoreGState()
        }

        // 3. The travelling star (under the letters: it disappears behind the M).
        if t >= Self.travelStart && t < Self.arriveEnd { drawComet(ctx, t: t, at: starAt) }

        // 4. Letters: outline traced, then filled with a small rise.
        for i in 0..<letters.count { drawLetter(ctx, i, t: t) }

        // 5. The star in its place.
        drawStar(ctx, t: t)

        // 6. Shine across the letters.
        let sh = Self.span(t, Self.shineStart, Self.shineEnd)
        if sh > 0 && sh < 1 {
            let box = lettersAll.boundingBox
            let x = box.minX - 120 * unit + (box.width + 240 * unit) * Self.easeInOut(sh)
            ctx.saveGState()
            ctx.addPath(lettersAll); ctx.clip()
            let colors = [UIColor.clear.cgColor, UIColor(red: 160 / 255, green: 235 / 255, blue: 1, alpha: 150 / 255).cgColor, UIColor.clear.cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.5, 1]) {
                ctx.drawLinearGradient(gradient, start: CGPoint(x: x - 70 * unit, y: 0), end: CGPoint(x: x + 70 * unit, y: 0), options: [])
            }
            ctx.restoreGState()
        }
        if revealed { drawIdleGlow(ctx) }
    }

    private func revealAlong(_ ctx: CGContext, shape: CGPath, from: CGFloat, to: CGFloat, at: CGFloat) {
        guard at > from else { return }
        let reach = travel.segment(from, min(at, to)).copy(strokingWithWidth: 150 * unit, lineCap: .round, lineJoin: .round, miterLimit: 10)
        ctx.saveGState()
        ctx.addPath(reach); ctx.clip()
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.addPath(shape); ctx.fillPath()
        ctx.restoreGState()
    }

    private func drawComet(_ ctx: CGContext, t: CGFloat, at: CGFloat) {
        let a = Self.span(t, Self.travelStart, Self.travelStart + 180) * (1 - Self.span(t, Self.arriveStart, Self.arriveEnd))
        guard a > 0 else { return }
        let tail = 220 * unit, steps = 18
        for k in stride(from: steps, through: 1, by: -1) {
            let d = at - tail * CGFloat(k) / CGFloat(steps)
            if d < 0 { continue }
            let f = 1 - CGFloat(k) / CGFloat(steps)
            radial(ctx, at: travel.point(at: d), radius: (4 + 10 * f) * unit,
                   colors: [UIColor.white.withAlphaComponent(150 / 255 * f * a), .clear], locations: [0, 1])
        }
        radial(ctx, at: travel.point(at: at), radius: 46 * unit,
               colors: [UIColor.white.withAlphaComponent(a), UIColor(red: 190 / 255, green: 245 / 255, blue: 1, alpha: 170 / 255 * a), .clear],
               locations: [0, 0.22, 1])
    }

    private func drawLetter(_ ctx: CGContext, _ i: Int, t: CGFloat) {
        let start = Self.letterStart + CGFloat(i) * Self.letterStagger
        let trace = Self.span(t, start, start + 620)
        guard trace > 0 else { return }
        let filled = Self.ease(Self.span(t, start + 380, start + 900))
        let bounds = letterPaths[i].boundingBox
        ctx.saveGState()
        ctx.translateBy(x: 0, y: (1 - filled) * 22 * unit)
        if filled < 1 {
            let poly = letters[i]
            ctx.addPath(poly.segment(0, poly.length * Self.ease(trace)))
            ctx.setStrokeColor(UIColor.white.withAlphaComponent(1 - filled * 0.6).cgColor)
            ctx.setLineWidth(3.2 * unit)
            ctx.setLineJoin(.round); ctx.setLineCap(.round)
            ctx.strokePath()
        }
        if filled > 0 {
            // The fill wipes up from the baseline while it fades in.
            let top = bounds.maxY - bounds.height * min(1, filled * 1.25)
            ctx.saveGState()
            ctx.clip(to: CGRect(x: bounds.minX - 4 * unit, y: top, width: bounds.width + 8 * unit, height: bounds.maxY - top + 4 * unit))
            ctx.setFillColor(UIColor.white.withAlphaComponent(min(1, 0.35 + filled)).cgColor)
            ctx.addPath(letterPaths[i]); ctx.fillPath()
            ctx.restoreGState()
        }
        ctx.restoreGState()
    }

    private func drawStar(_ ctx: CGContext, t: CGFloat) {
        let p = Self.span(t, Self.arriveStart, Self.arriveEnd)
        guard p > 0 else { return }
        let scale = p < 0.6 ? Self.backOut(p / 0.6) : 1
        let c = starCentre
        // Flare: a brief bloom and long thin rays as the star lands.
        let flare = p < 1 ? sin(.pi * p) : 0
        if flare > 0 {
            radial(ctx, at: c, radius: 150 * unit * (0.6 + 0.6 * flare),
                   colors: [UIColor.white.withAlphaComponent(210 / 255 * flare), UIColor(red: 160 / 255, green: 240 / 255, blue: 1, alpha: 90 / 255 * flare), .clear],
                   locations: [0, 0.25, 1])
            let ray = 260 * unit * flare
            ctx.setStrokeColor(UIColor.white.withAlphaComponent(170 / 255 * flare).cgColor)
            ctx.setLineWidth(2.2 * unit)
            ctx.setLineCap(.round)
            ctx.strokeLineSegments(between: [CGPoint(x: c.x - ray, y: c.y), CGPoint(x: c.x + ray, y: c.y),
                                             CGPoint(x: c.x, y: c.y - ray * 0.75), CGPoint(x: c.x, y: c.y + ray * 0.75)])
        }
        ctx.saveGState()
        ctx.translateBy(x: c.x, y: c.y); ctx.scaleBy(x: scale, y: scale); ctx.translateBy(x: -c.x, y: -c.y)
        ctx.setFillColor(UIColor.white.withAlphaComponent(min(1, p * 3)).cgColor)
        ctx.addPath(starShape); ctx.fillPath()
        ctx.restoreGState()
    }

    private func drawIdleGlow(_ ctx: CGContext) {
        let b = 0.5 - 0.5 * cos(2 * .pi * idlePhase)
        guard b > 0.01 else { return }
        radial(ctx, at: starCentre, radius: 90 * unit, colors: [UIColor.white.withAlphaComponent(70 / 255 * b), .clear], locations: [0, 1])
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.addPath(starShape); ctx.fillPath()
    }

    private func radial(_ ctx: CGContext, at point: CGPoint, radius: CGFloat, colors: [UIColor], locations: [CGFloat]) {
        guard radius > 0, let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors.map(\.cgColor) as CFArray, locations: locations) else { return }
        ctx.drawRadialGradient(gradient, startCenter: point, startRadius: 0, endCenter: point, endRadius: radius, options: [])
    }

    static func span(_ t: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat { max(0, min(1, (t - a) / (b - a))) }
    static func ease(_ x: CGFloat) -> CGFloat { 1 - pow(1 - x, 3) }
    static func easeInOut(_ x: CGFloat) -> CGFloat { x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2 }
    static func backOut(_ x: CGFloat) -> CGFloat {
        let c1: CGFloat = 1.70158, c3 = c1 + 1
        return 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2)
    }
    private static func color(_ rgb: UInt32) -> UIColor {
        UIColor(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

/// The reveal in SwiftUI. Reports when the logo is complete.
struct TVMIntro: UIViewRepresentable {
    var onRevealed: () -> Void

    func makeUIView(context: Context) -> TVMIntroUIView {
        let view = TVMIntroUIView(frame: .zero)
        view.onRevealed = onRevealed
        DispatchQueue.main.async { view.start() }
        return view
    }

    func updateUIView(_ view: TVMIntroUIView, context: Context) {}

    static func dismantleUIView(_ view: TVMIntroUIView, coordinator: ()) { view.stop() }
}

extension Notification.Name {
    /// The page is on screen, and "Who's watching?" is up when the app has just started.
    static let tvmPageReady = Notification.Name("tvm.pageReady")
}
