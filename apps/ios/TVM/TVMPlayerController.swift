import UIKit
import AVFoundation
import MobileVLCKit

/// Full-screen overlay that only keeps hits on real controls. Empty gradient,
/// labels and stack-view gutters pass through so a tap can show/hide chrome.
final class TVMChromeView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hit = super.hitTest(point, with: event) else { return nil }
        var node: UIView? = hit
        while let current = node, current !== self {
            if current is UIControl { return current }
            node = current.superview
        }
        return nil
    }
}

/// Full-screen native decoder. Auto Layout fills either orientation; VLC fits
/// the original picture inside the drawable without stretching or cropping.
final class TVMPlayerController: UIViewController, UIGestureRecognizerDelegate {
    let sessionID: String
    var onEvent: (([String: Any]) -> Void)?
    private let source: URL
    private let mediaTitle: String
    private let live: Bool
    private var resumeAt: Double
    private let player = VLCMediaPlayer()
    private let picture = UIView()
    private let tapShield = UIView()
    private let chrome = TVMChromeView()
    private let gradient = CAGradientLayer()
    private let playButton = UIButton(type: .system)
    private let slider = UISlider()
    private let clock = UILabel()
    private let elapsed = UILabel()
    private let status = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let skipFlash = UILabel()
    private let audioButton = UIButton(type: .system)
    private let subtitleButton = UIButton(type: .system)
    private var timer: Timer?
    private var hideWork: DispatchWorkItem?
    private var startedAt = Date()
    private var sawPlayback = false
    private var finished = false
    private var failed = false
    private var scrubbing = false
    private var controlsVisible = true
    private var lastTracks = ""
    private var lastPosition: Double = 0
    private var lastDuration: Double = 0
    private var lastGoodPosition: Double = 0
    private var lastProgressAt = Date()
    private var errorSince: Date?

    init(id: String, url: URL, title: String, startAt: Double, live: Bool) {
        sessionID = id; source = url; mediaTitle = title; resumeAt = startAt; self.live = live
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { !controlsVisible }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override var shouldAutorotate: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        picture.backgroundColor = .black
        picture.clipsToBounds = true
        picture.isUserInteractionEnabled = false
        tapShield.backgroundColor = .clear
        tapShield.accessibilityLabel = "Show or hide playback controls"
        tapShield.accessibilityTraits = .button
        for child in [picture, tapShield, chrome] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
            NSLayoutConstraint.activate([
                child.topAnchor.constraint(equalTo: view.topAnchor), child.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                child.leadingAnchor.constraint(equalTo: view.leadingAnchor), child.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            ])
        }
        gradient.colors = [UIColor.black.withAlphaComponent(0.72).cgColor, UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.82).cgColor]
        gradient.locations = [0, 0.42, 1]
        chrome.layer.insertSublayer(gradient, at: 0)
        let back = button("chevron.left", "Back") { [weak self] in self?.close() }
        let heading = UILabel()
        heading.text = mediaTitle; heading.textColor = .white
        heading.font = .systemFont(ofSize: 18, weight: .semibold)
        heading.textAlignment = .center; heading.numberOfLines = 2
        heading.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let spacer = UIView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        spacer.widthAnchor.constraint(equalToConstant: 48).isActive = true
        spacer.heightAnchor.constraint(equalToConstant: 48).isActive = true
        let header = UIStackView(arrangedSubviews: [back, heading, spacer])
        header.spacing = 12; header.alignment = .center

        let rewind = button("gobackward.10", "Back 10 seconds", size: 36) { [weak self] in self?.skip(-10) }
        let forward = button("goforward.10", "Forward 10 seconds", size: 36) { [weak self] in self?.skip(10) }
        configure(playButton, symbol: "pause.fill", label: "Pause", size: 44)
        playButton.backgroundColor = UIColor.white.withAlphaComponent(0.14)
        playButton.layer.cornerRadius = 44
        playButton.layer.borderWidth = 1
        playButton.layer.borderColor = UIColor.white.withAlphaComponent(0.28).cgColor
        playButton.clipsToBounds = true
        playButton.addAction(UIAction { [weak self] _ in self?.toggle() }, for: .touchUpInside)
        playButton.widthAnchor.constraint(equalToConstant: 88).isActive = true
        playButton.heightAnchor.constraint(equalToConstant: 88).isActive = true
        let transport = UIStackView(arrangedSubviews: [rewind, playButton, forward])
        transport.spacing = 38; transport.alignment = .center
        rewind.isEnabled = !live; forward.isEnabled = !live

        slider.minimumTrackTintColor = UIColor(red: 0.898, green: 0.035, blue: 0.078, alpha: 1)
        slider.maximumTrackTintColor = .white.withAlphaComponent(0.28)
        slider.setThumbImage(Self.thumbImage(), for: .normal)
        slider.setThumbImage(Self.thumbImage(scale: 1.25), for: .highlighted)
        slider.accessibilityLabel = "Playback position"
        slider.addAction(UIAction { [weak self] _ in self?.scrubbing = true; self?.hideWork?.cancel() }, for: .touchDown)
        slider.addAction(UIAction { [weak self] _ in
            guard let self else { return }; self.seek(Double(self.slider.value)); self.scrubbing = false; self.reveal()
        }, for: [.touchUpInside, .touchUpOutside, .touchCancel])
        elapsed.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium); elapsed.textColor = .white
        clock.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium); clock.textColor = UIColor.white.withAlphaComponent(0.78)
        clock.textAlignment = .right
        let timeline = UIStackView(arrangedSubviews: [elapsed, slider, clock]); timeline.spacing = 10
        elapsed.setContentCompressionResistancePriority(.required, for: .horizontal)
        clock.setContentCompressionResistancePriority(.required, for: .horizontal)
        configure(audioButton, symbol: "waveform", label: "Audio")
        configure(subtitleButton, symbol: "captions.bubble", label: "Subtitles")
        let speed = button("speedometer", "Playback speed") { }
        for control in [audioButton, subtitleButton, speed] {
            control.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
            control.widthAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        }
        speed.showsMenuAsPrimaryAction = true
        speed.menu = UIMenu(title: "Playback speed", children: [0.5, 0.75, 1, 1.25, 1.5, 2].map { rate in
            UIAction(title: "\(rate)×") { [weak self] _ in self?.player.rate = Float(rate); self?.reveal() }
        })
        speed.isEnabled = !live
        let tools = UIStackView(arrangedSubviews: [audioButton, subtitleButton, speed])
        tools.distribution = .equalSpacing
        let footer = UIStackView(arrangedSubviews: [timeline, tools]); footer.axis = .vertical; footer.spacing = 8
        status.textColor = .white; status.font = .systemFont(ofSize: 14, weight: .medium)
        status.numberOfLines = 3; status.textAlignment = .center
        spinner.color = .white; spinner.hidesWhenStopped = true
        skipFlash.textColor = .white
        skipFlash.font = .systemFont(ofSize: 42, weight: .semibold)
        skipFlash.textAlignment = .center
        skipFlash.alpha = 0
        skipFlash.layer.shadowColor = UIColor.black.cgColor
        skipFlash.layer.shadowOpacity = 0.6
        skipFlash.layer.shadowRadius = 8
        for child in [header, transport, footer, status, spinner, skipFlash] {
            child.translatesAutoresizingMaskIntoConstraints = false; chrome.addSubview(child)
        }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
            header.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16), header.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            transport.centerXAnchor.constraint(equalTo: view.centerXAnchor), transport.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            footer.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 20), footer.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -20),
            footer.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -10),
            status.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24), status.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
            status.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 4),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor), spinner.centerYAnchor.constraint(equalTo: transport.centerYAnchor),
            skipFlash.centerXAnchor.constraint(equalTo: view.centerXAnchor), skipFlash.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -110),
        ])
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        doubleTap.delegate = self
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.delegate = self
        tap.require(toFail: doubleTap)
        tapShield.addGestureRecognizer(doubleTap)
        tapShield.addGestureRecognizer(tap)
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(swiped(_:))); edge.edges = .left
        view.addGestureRecognizer(edge)
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.willResignActiveNotification, object: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard timer == nil, !finished else { return }
        UIApplication.shared.isIdleTimerDisabled = true
        player.drawable = picture
        player.scaleFactor = 0
        player.videoAspectRatio = nil
        player.videoCropGeometry = nil
        startPlayback()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.update() }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        gradient.frame = chrome.bounds
        muteVideoHits()
        centerPicture()
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { shutdown() }
    }
    deinit { timer?.invalidate(); hideWork?.cancel(); NotificationCenter.default.removeObserver(self) }

    private func startPlayback() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        failed = false; sawPlayback = false; startedAt = Date()
        errorSince = nil; lastProgressAt = Date(); lastGoodPosition = 0
        player.drawable = picture
        let media = VLCMedia(url: source)
        media.addOptions([
            "network-caching": 8000,
            "file-caching": 3000,
            "live-caching": 3000,
            "http-user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TVM-iOS",
        ])
        player.media = media
        player.play()
        status.text = "Opening stream…"; spinner.startAnimating(); playButton.alpha = 0; playButton.isEnabled = false; reveal()
    }
    func command(_ name: String, data: [String: Any]) {
        switch name {
        case "play": player.play(); reveal()
        case "pause": player.pause(); reveal()
        case "seek": if let seconds = data["seconds"] as? Double { seek(seconds) }
        case "volume": if let volume = data["volume"] as? Double, volume.isFinite { player.audio?.volume = Int32(max(0, min(100, volume * 100))) }
        case "mute": player.audio?.isMuted = data["muted"] as? Bool ?? false
        case "stop": if !finished { shutdown(); dismiss(animated: false) }
        default: break
        }
    }
    private func update() {
        guard !finished, !failed else { return }
        centerPicture()
        let position = max(0, Double(player.time.intValue) / 1000)
        let duration = max(0, Double(player.media?.length.intValue ?? 0) / 1000)
        if duration > 0 { lastDuration = duration }
        let phase = tvmNativePhase(player.state)
        if phase != .ended {
            if position + 0.75 < lastGoodPosition {
                // VLC often rewinds its clock during a buffer; keep the last good time.
            } else {
                lastPosition = max(lastPosition, position)
                if position >= lastGoodPosition + 0.2 {
                    lastGoodPosition = position
                    lastProgressAt = Date()
                }
            }
        }
        if player.isPlaying {
            if resumeAt > 0, player.isSeekable { seek(resumeAt); resumeAt = 0 }
        }
        if phase == .error {
            if errorSince == nil { errorSince = Date() }
        } else {
            errorSince = nil
        }
        let pulse = TVMNativePulse(
            phase: phase,
            isPlaying: player.isPlaying,
            hasOutput: player.hasVideoOut || lastGoodPosition > 0.25,
            position: lastGoodPosition,
            duration: lastDuration,
            sawPlayback: sawPlayback,
            elapsed: Date().timeIntervalSince(startedAt),
            sinceProgress: Date().timeIntervalSince(lastProgressAt),
            sinceError: errorSince.map { Date().timeIntervalSince($0) } ?? 0
        )
        if tvmNativeMarkPlayback(pulse) { sawPlayback = true }
        let livePulse = TVMNativePulse(
            phase: pulse.phase, isPlaying: pulse.isPlaying, hasOutput: pulse.hasOutput,
            position: pulse.position, duration: pulse.duration, sawPlayback: sawPlayback,
            elapsed: pulse.elapsed, sinceProgress: pulse.sinceProgress, sinceError: pulse.sinceError
        )
        if tvmNativeShouldFail(livePulse) { fail(); return }
        if tvmNativeDidEnd(livePulse) { emitState(buffering: false); emit("ended"); shutdown(); dismiss(animated: true); return }
        if !scrubbing { slider.maximumValue = Float(max(1, lastDuration)); slider.value = Float(lastPosition) }
        slider.isEnabled = !live && player.isSeekable && lastDuration > 0
        if live {
            elapsed.text = "LIVE"
            clock.text = ""
        } else {
            elapsed.text = format(lastPosition)
            clock.text = lastDuration > 0 ? format(max(0, lastDuration - lastPosition)) : format(lastDuration)
        }
        let blocking = tvmNativeBlockingLoad(livePulse)
        let rebuffering = tvmNativeRebuffering(livePulse)
        status.text = blocking ? "Opening stream…" : (rebuffering ? "Buffering…" : nil)
        if blocking { spinner.startAnimating() } else { spinner.stopAnimating() }
        playButton.alpha = blocking ? 0 : 1
        playButton.isEnabled = !blocking
        configure(playButton, symbol: player.isPlaying ? "pause.fill" : "play.fill", label: player.isPlaying ? "Pause" : "Play", size: 44)
        updateTracks()
        emitState(buffering: blocking || rebuffering, hasFrame: sawPlayback || pulse.hasOutput)
    }
    private func emitState(buffering: Bool, hasFrame: Bool? = nil) {
        emit("state", ["position": lastPosition, "duration": lastDuration, "paused": !player.isPlaying,
                       "buffering": buffering, "hasFrame": hasFrame ?? (sawPlayback || player.hasVideoOut)])
    }
    private func emit(_ command: String, _ fields: [String: Any] = [:]) {
        var data = fields; data["id"] = sessionID; data["command"] = command; onEvent?(data)
    }
    private func fail() {
        guard !failed, !finished, !player.isPlaying else { return }
        failed = true
        spinner.stopAnimating()
        playButton.alpha = 1; playButton.isEnabled = true
        status.text = "This source could not be played. Tap Retry, or go back to choose another source."
        configure(playButton, symbol: "arrow.clockwise", label: "Retry", size: 40)
        emitState(buffering: false, hasFrame: sawPlayback); emit("error", ["message": status.text!]); reveal()
    }
    private func toggle() {
        if failed {
            failed = false
            startedAt = Date()
            errorSince = nil
            lastProgressAt = Date()
            resumeAt = max(lastGoodPosition, lastPosition)
            if player.media != nil {
                player.play()
            } else {
                startPlayback()
            }
        } else if player.isPlaying { player.pause() } else { player.play() }
        reveal()
    }
    private func skip(_ seconds: Double) {
        seek(Double(player.time.intValue) / 1000 + seconds)
        flash(seconds >= 0 ? "+10" : "−10")
        reveal()
    }
    private func seek(_ seconds: Double) {
        guard seconds.isFinite, player.isSeekable, !live else { return }
        let end = lastDuration > 0 ? lastDuration : Double(Int32.max) / 1000
        let clamped = min(Double(Int32.max), max(0, min(seconds, end)) * 1000)
        player.time = VLCTime(int: Int32(clamped))
    }
    private func close() { emitState(buffering: false); emit("closed"); shutdown(); dismiss(animated: true) }
    func shutdown() {
        guard !finished else { return }; finished = true
        timer?.invalidate(); timer = nil; hideWork?.cancel()
        player.stop(); player.drawable = nil
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    @objc private func backgrounded() { player.pause(); emitState(buffering: false); reveal() }
    @objc private func tapped() { setControls(!controlsVisible); if controlsVisible { reveal() } }
    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        let x = gesture.location(in: view).x
        if live { toggle(); return }
        if x < view.bounds.width * 0.38 { skip(-10) }
        else if x > view.bounds.width * 0.62 { skip(10) }
        else { toggle() }
    }
    @objc private func swiped(_ gesture: UIScreenEdgePanGestureRecognizer) {
        if gesture.state == .ended && (gesture.translation(in: view).x > 70 || gesture.velocity(in: view).x > 650) { close() }
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var node = touch.view
        while let current = node { if current is UIControl { return false }; node = current.superview }
        return true
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
    private func reveal() {
        setControls(true); hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.player.isPlaying, !self.failed, !self.scrubbing else { return }
            self.setControls(false)
        }
        hideWork = work; DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }
    private func setControls(_ visible: Bool) {
        controlsVisible = visible; chrome.isUserInteractionEnabled = visible
        UIView.animate(withDuration: 0.2) { self.chrome.alpha = visible ? 1 : 0 }
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }
    private func muteVideoHits() {
        picture.isUserInteractionEnabled = false
        for sub in picture.subviews { sub.isUserInteractionEnabled = false }
    }
    private func centerPicture() {
        muteVideoHits()
        let mid = CGPoint(x: picture.bounds.midX, y: picture.bounds.midY)
        for sub in picture.subviews {
            if sub.bounds.isEmpty { continue }
            sub.center = mid
        }
    }
    private func flash(_ text: String) {
        skipFlash.text = text
        skipFlash.alpha = 1
        UIView.animate(withDuration: 0.45, delay: 0.15, options: .curveEaseOut) { self.skipFlash.alpha = 0 }
    }
    private func updateTracks() {
        let names = (player.audioTrackNames as? [String] ?? []) + (player.videoSubTitlesNames as? [String] ?? [])
        let signature = "\(names)|\(player.currentAudioTrackIndex)|\(player.currentVideoSubTitleIndex)"
        guard signature != lastTracks else { return }; lastTracks = signature
        func menu(names: [String], ids: [NSNumber], current: Int32, select: @escaping (Int32) -> Void) -> UIMenu {
            UIMenu(children: zip(names, ids).map { name, id in
                UIAction(title: name, state: id.int32Value == current ? .on : .off) { _ in select(id.int32Value) }
            })
        }
        audioButton.menu = menu(names: player.audioTrackNames as? [String] ?? [], ids: player.audioTrackIndexes as? [NSNumber] ?? [], current: player.currentAudioTrackIndex) { [weak self] in self?.player.currentAudioTrackIndex = $0; self?.reveal() }
        subtitleButton.menu = menu(names: player.videoSubTitlesNames as? [String] ?? [], ids: player.videoSubTitlesIndexes as? [NSNumber] ?? [], current: player.currentVideoSubTitleIndex) { [weak self] in self?.player.currentVideoSubTitleIndex = $0; self?.reveal() }
        audioButton.showsMenuAsPrimaryAction = true; subtitleButton.showsMenuAsPrimaryAction = true
        audioButton.isEnabled = !(audioButton.menu?.children.isEmpty ?? true)
        subtitleButton.isEnabled = !(subtitleButton.menu?.children.isEmpty ?? true)
    }
    private func configure(_ button: UIButton, symbol: String, label: String, size: CGFloat = 22) {
        button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: .medium)), for: .normal)
        button.tintColor = .white; button.accessibilityLabel = label
        button.setTitle(nil, for: .normal)
    }
    private func button(_ symbol: String, _ label: String, size: CGFloat = 22, action: @escaping () -> Void) -> UIButton {
        let control = UIButton(type: .system); configure(control, symbol: symbol, label: label, size: size)
        control.widthAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        control.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        control.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return control
    }
    private func format(_ seconds: Double) -> String {
        let value = Int(max(0, seconds))
        return value >= 3600 ? String(format: "%d:%02d:%02d", value / 3600, value / 60 % 60, value % 60) : String(format: "%d:%02d", value / 60, value % 60)
    }
    private static func thumbImage(scale: CGFloat = 1) -> UIImage {
        let side = 14 * scale
        let size = CGSize(width: side, height: side)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            UIColor.white.setFill()
            UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
        }
    }
}

enum TVMNativePhase: Equatable {
    case opening, buffering, playing, paused, stopped, ended, error, other
}

struct TVMNativePulse: Equatable {
    var phase: TVMNativePhase
    var isPlaying: Bool
    var hasOutput: Bool
    var position: Double
    var duration: Double
    var sawPlayback: Bool
    var elapsed: Double
    var sinceProgress: Double
    var sinceError: Double
}

func tvmNativePhase(_ state: VLCMediaPlayerState) -> TVMNativePhase {
    switch state {
    case .opening: return .opening
    case .buffering: return .buffering
    case .playing: return .playing
    case .paused: return .paused
    case .stopped: return .stopped
    case .ended: return .ended
    case .error: return .error
    @unknown default: return .other
    }
}

func tvmNativeMarkPlayback(_ pulse: TVMNativePulse) -> Bool {
    if pulse.sawPlayback { return true }
    if pulse.isPlaying || pulse.hasOutput { return true }
    if pulse.position >= 0.3 { return true }
    return pulse.phase == .playing || pulse.phase == .paused
}

func tvmNativeBlockingLoad(_ pulse: TVMNativePulse) -> Bool {
    if pulse.sawPlayback { return false }
    if pulse.phase == .paused { return false }
    return pulse.phase == .opening || pulse.phase == .buffering
}

func tvmNativeRebuffering(_ pulse: TVMNativePulse) -> Bool {
    if !pulse.sawPlayback { return false }
    if pulse.phase == .paused || pulse.isPlaying { return false }
    if pulse.phase != .buffering && pulse.phase != .opening { return false }
    return pulse.sinceProgress > 1.5
}

func tvmNativeShouldFail(_ pulse: TVMNativePulse) -> Bool {
    if pulse.isPlaying { return false }
    if pulse.phase == .paused { return false }
    if pulse.hasOutput && pulse.sinceProgress < 8 { return false }
    if !pulse.sawPlayback {
        return pulse.elapsed > 45 && pulse.sinceProgress >= 45
    }
    if pulse.phase == .error { return pulse.sinceError >= 12 && pulse.sinceProgress >= 8 }
    return pulse.sinceProgress >= 45 && (pulse.phase == .buffering || pulse.phase == .opening || pulse.phase == .stopped)
}

func tvmNativeDidEnd(_ pulse: TVMNativePulse) -> Bool {
    if !pulse.sawPlayback { return false }
    if pulse.phase == .ended { return true }
    if pulse.duration > 1, pulse.position >= pulse.duration - 1.25, pulse.phase == .stopped { return true }
    return false
}
