import SwiftUI

/// The floating tab bar and the You popup, drawn by the app in Liquid Glass.
///
/// Laid out exactly as the shared phone look's pill (tvm-android.css section
/// 2: five equal tabs, 64 pt tall, 10 pt above the home indicator, at most
/// 30 rem wide with 14 pt sides), with the same icons. Its state comes from
/// the page (tvm-ios.js 4) and every tap presses the page's own button, so the
/// destinations, the lit tab and the profile picture are always the page's.
/// iOS 26 draws it with the system's Liquid Glass; earlier versions with a
/// translucent material, a soft specular edge and a shadow.
struct TVMGlassBar: View {
    @ObservedObject var model: TVMShellModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var lit

    // The entrance (tvm-android.js 17d): frame, then tabs, then the lit tab.
    @State private var frameIn = true
    @State private var tabsIn: Set<Int> = [0, 1, 2, 3, 4]
    @State private var litIn = true

    private static let tabs: [(id: String, title: String, icon: String)] = [
        ("home-dock", "Home", "TabHome"), ("search", "Search", "TabSearch"), ("live", "Live TV", "TabLive"),
        ("watchlist", "Watchlist", "TabList"), ("more", "You", ""),
    ]
    static let ink = Color(red: 0xF4 / 255, green: 0xF6 / 255, blue: 0xFB / 255)
    static let muted = Color(red: 226 / 255, green: 232 / 255, blue: 244 / 255).opacity(0.62)
    static let tvmBlue = Color(red: 0x51 / 255, green: 0x70 / 255, blue: 0xFF / 255)

    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height
            let side = max(14, geometry.safeAreaInsets.leading, geometry.safeAreaInsets.trailing)
            let width = min(landscape ? 416 : 480, geometry.size.width - 2 * side)
            let height: CGFloat = landscape ? 54 : 64
            ZStack(alignment: .bottom) {
                if !model.bar.popup.isEmpty && model.bar.visible {
                    // A tap anywhere else closes the popup, as on Android.
                    Color.black.opacity(0.28)
                        .ignoresSafeArea()
                        .onTapGesture { model.dismissPopup() }
                        .transition(.opacity)
                }
                VStack(spacing: 10) {
                    if !model.bar.popup.isEmpty && model.bar.visible {
                        HStack {
                            Spacer(minLength: 0)
                            TVMYouPopup(model: model)
                                .frame(width: min(300, width))
                        }
                        .frame(width: width)
                        .transition(.asymmetric(
                            insertion: .scale(scale: 0.96, anchor: .bottomTrailing).combined(with: .opacity).combined(with: .offset(y: 8)),
                            removal: .scale(scale: 0.97, anchor: .bottomTrailing).combined(with: .opacity).combined(with: .offset(y: 6))
                        ))
                    }
                    bar(width: width, height: height)
                }
                .padding(.bottom, 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: model.bar.popup.isEmpty)
        }
        .opacity(model.bar.visible ? 1 : 0)
        .allowsHitTesting(model.bar.visible)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: model.bar.visible)
        .onChange(of: model.entranceToken) { _ in playEntrance() }
    }

    private func bar(width: CGFloat, height: CGFloat) -> some View {
        HStack(spacing: 2) {
            ForEach(Array(Self.tabs.enumerated()), id: \.element.id) { index, tab in
                let on = model.bar.active == tab.id
                Button { model.tap(tab.id) } label: {
                    VStack(spacing: 3) {
                        glyph(tab: tab, on: on)
                            .frame(width: 25, height: 25)
                        Text(tab.title)
                            .font(.system(size: 10.5, weight: on ? .bold : .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(on && litIn ? Self.ink : Self.muted)
                    .frame(maxWidth: .infinity, minHeight: height - 14)
                    .background {
                        if on {
                            Capsule()
                                .fill(Self.tvmBlue.opacity(0.16))
                                .overlay(Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5))
                                .matchedGeometryEffect(id: "lit", in: lit)
                                .opacity(litIn ? 1 : 0)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(TVMPressStyle())
                .opacity(tabsIn.contains(index) ? 1 : 0)
                .offset(y: tabsIn.contains(index) ? 0 : 5)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(6)
        .frame(width: width, height: height)
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86), value: model.bar.active)
        .modifier(TVMGlassSurface(shape: Capsule()))
        .opacity(frameIn ? 1 : 0)
        .scaleEffect(frameIn ? 1 : 0.965, anchor: .bottom)
        .offset(y: frameIn ? 0 : 12)
    }

    @ViewBuilder
    private func glyph(tab: (id: String, title: String, icon: String), on: Bool) -> some View {
        if tab.id == "more" {
            TVMAvatar(name: model.bar.youName, hue: model.bar.youHue, picture: model.bar.youPicture, size: 25, corner: 12.5)
                .overlay(Circle().strokeBorder(on ? Self.tvmBlue : .clear, lineWidth: 1.5))
        } else {
            Image(on ? tab.icon + "On" : tab.icon)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(on && litIn ? Self.tvmBlue : Self.muted)
        }
    }

    private func playEntrance() {
        guard !reduceMotion else { return }
        frameIn = false
        tabsIn = []
        litIn = false
        withAnimation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.42)) { frameIn = true }
        for index in 0..<Self.tabs.count {
            withAnimation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.34).delay(0.14 + Double(index) * 0.035)) {
                _ = tabsIn.insert(index)
            }
        }
        withAnimation(.easeOut(duration: 0.28).delay(0.46)) { litIn = true }
    }
}

/// The You popup: the page's rows (Profile, Settings, …) on the same glass.
struct TVMYouPopup: View {
    @ObservedObject var model: TVMShellModel

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(model.bar.popup.enumerated()), id: \.element.id) { index, row in
                if index > 0 {
                    Rectangle().fill(Color.white.opacity(0.1)).frame(height: 0.5).padding(.leading, 62)
                }
                Button { model.choose(row: row.id) } label: {
                    HStack(spacing: 12) {
                        icon(for: row)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(row.on ? TVMGlassBar.tvmBlue : TVMGlassBar.ink)
                            if !row.detail.isEmpty {
                                Text(row.detail)
                                    .font(.system(size: 13))
                                    .foregroundStyle(TVMGlassBar.muted)
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 58)
                    .contentShape(Rectangle())
                }
                .buttonStyle(TVMPressStyle(dim: true))
            }
        }
        .padding(6)
        .modifier(TVMGlassSurface(shape: RoundedRectangle(cornerRadius: 22, style: .continuous)))
    }

    @ViewBuilder
    private func icon(for row: TVMBarState.Row) -> some View {
        if row.id == "more-profile" {
            TVMAvatar(name: model.bar.youName, hue: model.bar.youHue, picture: model.bar.youPicture, size: 38, corner: 11)
        } else {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(Color.white.opacity(0.08))
                .frame(width: 38, height: 38)
                .overlay(Image(systemName: row.id == "more-settings" ? "gearshape" : "square.grid.2x2")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(TVMGlassBar.ink))
        }
    }
}

/// A profile's picture, or its initial on its own colour (tvm-android.js paintAvatar).
struct TVMAvatar: View {
    let name: String
    let hue: Double
    let picture: UIImage?
    let size: CGFloat
    let corner: CGFloat

    var body: some View {
        ZStack {
            if let picture {
                Image(uiImage: picture).resizable().scaledToFill()
            } else {
                Color(hue: (hue.truncatingRemainder(dividingBy: 360)) / 360, saturation: 0.62, brightness: 0.78)
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.48, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
    }
}

/// Pressed: a slight give, as the shared look's controls do.
struct TVMPressStyle: ButtonStyle {
    var dim = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed && dim ? 0.75 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Liquid Glass on iOS 26 (TVM blue, barely tinted); a material with a
/// specular rim before it. Only the bar and the popup use it.
struct TVMGlassSurface<S: InsettableShape>: ViewModifier {
    let shape: S

    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(TVMGlassBar.tvmBlue.opacity(0.08)).interactive(), in: shape)
                .shadow(color: .black.opacity(0.35), radius: 18, y: 10)
        } else {
            fallback(content)
        }
        #else
        fallback(content)
        #endif
    }

    private func fallback(_ content: Content) -> some View {
        content
            .background {
                shape.fill(.ultraThinMaterial)
                    .environment(\.colorScheme, .dark)
                    .overlay(shape.fill(Color(red: 22 / 255, green: 26 / 255, blue: 36 / 255).opacity(0.42)))
            }
            .overlay {
                // The specular rim: brighter along the top edge, as light catches glass.
                shape.strokeBorder(
                    LinearGradient(colors: [.white.opacity(0.28), .white.opacity(0.06), .white.opacity(0.12)],
                                   startPoint: .top, endPoint: .bottom),
                    lineWidth: 0.75
                )
            }
            .shadow(color: .black.opacity(0.45), radius: 17, y: 12)
    }
}
