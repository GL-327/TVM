import UIKit
import AVFoundation
import MobileVLCKit

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
    private let chrome = UIView()
    private let gradient = CAGradientLayer()
    private let playButton = UIButton(type: .system)
    private let slider = UISlider()
    private let clock = UILabel()
    private let status = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
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
    private var stallSince: Date?

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
        for child in [picture, chrome] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
            NSLayoutConstraint.activate([
                child.topAnchor.constraint(equalTo: view.topAnchor), child.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                child.leadingAnchor.constraint(equalTo: view.leadingAnchor), child.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            ])
        }
        gradient.colors = [UIColor.black.withAlphaComponent(0.8).cgColor, UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.85).cgColor]
        gradient.locations = [0, 0.48, 1]
        chrome.layer.insertSublayer(gradient, at: 0)
        let back = button("arrow.left", "Back") { [weak self] in self?.close() }
        let rotate = button("arrow.up.left.and.arrow.down.right", "Rotate player") { [weak self] in self?.rotate() }
        let heading = UILabel()
        heading.text = mediaTitle; heading.textColor = .white
        heading.font = .systemFont(ofSize: 17, weight: .semibold)
        heading.textAlignment = .center; heading.numberOfLines = 2
        heading.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let header = UIStackView(arrangedSubviews: [back, heading, rotate])
        header.spacing = 12; header.alignment = .center

        let rewind = button("gobackward.10", "Back 10 seconds", size: 32) { [weak self] in self?.skip(-10) }
        let forward = button("goforward.10", "Forward 10 seconds", size: 32) { [weak self] in self?.skip(10) }
        configure(playButton, symbol: "pause.fill", label: "Pause", size: 48)
        playButton.addAction(UIAction { [weak self] _ in self?.toggle() }, for: .touchUpInside)
        playButton.widthAnchor.constraint(equalToConstant: 88).isActive = true
        playButton.heightAnchor.constraint(equalToConstant: 88).isActive = true
        let transport = UIStackView(arrangedSubviews: [rewind, playButton, forward])
        transport.spacing = 38; transport.alignment = .center
        rewind.isEnabled = !live; forward.isEnabled = !live

        slider.minimumTrackTintColor = UIColor(red: 0.98, green: 0.32, blue: 0.25, alpha: 1)
        slider.maximumTrackTintColor = .white.withAlphaComponent(0.3)
        slider.accessibilityLabel = "Playback position"
        slider.addAction(UIAction { [weak self] _ in self?.scrubbing = true; self?.hideWork?.cancel() }, for: .touchDown)
        slider.addAction(UIAction { [weak self] _ in
            guard let self else { return }; self.seek(Double(self.slider.value)); self.scrubbing = false; self.reveal()
        }, for: [.touchUpInside, .touchUpOutside, .touchCancel])
        clock.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium); clock.textColor = .white
        clock.textAlignment = .right
        let timeline = UIStackView(arrangedSubviews: [slider, clock]); timeline.spacing = 14
        clock.setContentCompressionResistancePriority(.required, for: .horizontal)
        configure(audioButton, symbol: "waveform", label: "Audio")
        configure(subtitleButton, symbol: "captions.bubble", label: "Subtitles")
        let speed = button("speedometer", "Playback speed") { }
        for (control, title) in [(audioButton, " Audio"), (subtitleButton, " Subtitles"), (speed, " Speed")] {
            control.setTitle(title, for: .normal); control.setTitleColor(.white, for: .normal)
            control.titleLabel?.font = .systemFont(ofSize: 12, weight: .medium)
            control.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        }
        speed.showsMenuAsPrimaryAction = true
        speed.menu = UIMenu(title: "Playback speed", children: [0.5, 0.75, 1, 1.25, 1.5, 2].map { rate in
            UIAction(title: "\(rate)×") { [weak self] _ in self?.player.rate = Float(rate); self?.reveal() }
        })
        speed.isEnabled = !live
        let tools = UIStackView(arrangedSubviews: [audioButton, subtitleButton, speed])
        tools.distribution = .equalSpacing
        let footer = UIStackView(arrangedSubviews: [timeline, tools]); footer.axis = .vertical; footer.spacing = 10
        status.textColor = .white; status.font = .systemFont(ofSize: 14, weight: .medium)
        status.numberOfLines = 3; status.textAlignment = .center
        spinner.color = .white; spinner.hidesWhenStopped = true
        for child in [header, transport, footer, status, spinner] {
            child.translatesAutoresizingMaskIntoConstraints = false; chrome.addSubview(child)
        }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
            header.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16), header.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            transport.centerXAnchor.constraint(equalTo: view.centerXAnchor), transport.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            footer.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24), footer.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
            footer.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -12),
            status.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24), status.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
            status.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 4),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor), spinner.centerYAnchor.constraint(equalTo: transport.centerYAnchor),
        ])
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped)); tap.delegate = self
        view.addGestureRecognizer(tap)
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
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); gradient.frame = chrome.bounds }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { shutdown() }
    }
    deinit { timer?.invalidate(); hideWork?.cancel(); NotificationCenter.default.removeObserver(self) }

    private func startPlayback() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        failed = false; sawPlayback = false; startedAt = Date(); stallSince = nil
        let media = VLCMedia(url: source)
        media.addOptions(["network-caching": 1500])
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
        let position = max(0, Double(player.time.intValue) / 1000)
        let duration = max(0, Double(player.media?.length.intValue ?? 0) / 1000)
        if duration > 0 { lastDuration = duration }
        // VLC can reset its clock at EOF; retain the final known position.
        if player.state != .ended { lastPosition = position }
        if player.isPlaying {
            sawPlayback = true
            if resumeAt > 0, player.isSeekable { seek(resumeAt); resumeAt = 0 }
        }
        let waiting = player.state == .opening || player.state == .buffering
        if waiting { if stallSince == nil { stallSince = Date() } } else { stallSince = nil }
        if player.state == .error || (!sawPlayback && Date().timeIntervalSince(startedAt) > 45)
            || (sawPlayback && stallSince.map({ Date().timeIntervalSince($0) > 30 }) == true) {
            fail(); return
        }
        if sawPlayback && player.state == .ended { emitState(buffering: false); emit("ended"); shutdown(); dismiss(animated: true); return }
        if !scrubbing { slider.maximumValue = Float(max(1, duration)); slider.value = Float(position) }
        slider.isEnabled = !live && player.isSeekable && duration > 0
        clock.text = live ? "LIVE" : "\(format(position))  /  \(format(duration))"
        status.text = waiting ? "Buffering…" : nil
        waiting ? spinner.startAnimating() : spinner.stopAnimating()
        playButton.alpha = waiting ? 0 : 1
        playButton.isEnabled = !waiting
        configure(playButton, symbol: player.isPlaying ? "pause.fill" : "play.fill", label: player.isPlaying ? "Pause" : "Play", size: 48)
        updateTracks()
        emitState(buffering: waiting)
    }
    private func emitState(buffering: Bool) {
        emit("state", ["position": lastPosition, "duration": lastDuration, "paused": !player.isPlaying,
                       "buffering": buffering, "hasFrame": player.hasVideoOut])
    }
    private func emit(_ command: String, _ fields: [String: Any] = [:]) {
        var data = fields; data["id"] = sessionID; data["command"] = command; onEvent?(data)
    }
    private func fail() {
        failed = true; player.pause(); spinner.stopAnimating()
        playButton.alpha = 1; playButton.isEnabled = true
        status.text = "This source could not be played. Tap Retry, or go back to choose another source."
        configure(playButton, symbol: "arrow.clockwise", label: "Retry", size: 40)
        emitState(buffering: false); emit("error", ["message": status.text!]); reveal()
    }
    private func toggle() {
        if failed { resumeAt = lastPosition; player.stop(); startPlayback() }
        else if player.isPlaying { player.pause() } else { player.play() }
        reveal()
    }
    private func skip(_ seconds: Double) { seek(Double(player.time.intValue) / 1000 + seconds); reveal() }
    private func seek(_ seconds: Double) {
        guard seconds.isFinite, player.isSeekable, !live else { return }
        let end = lastDuration > 0 ? lastDuration : Double(Int32.max) / 1000
        player.time = VLCTime(int: Int32(min(Double(Int32.max), max(0, min(seconds, end)) * 1000)))
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
    @objc private func swiped(_ gesture: UIScreenEdgePanGestureRecognizer) {
        if gesture.state == .ended && (gesture.translation(in: view).x > 70 || gesture.velocity(in: view).x > 650) { close() }
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var node = touch.view
        while let current = node { if current is UIControl { return false }; node = current.superview }
        return true
    }
    private func reveal() {
        setControls(true); hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.player.isPlaying, !self.failed, !self.scrubbing else { return }
            self.setControls(false)
        }
        hideWork = work; DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: work)
    }
    private func setControls(_ visible: Bool) {
        controlsVisible = visible; chrome.isUserInteractionEnabled = visible
        UIView.animate(withDuration: 0.2) { self.chrome.alpha = visible ? 1 : 0 }
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }
    private func rotate() {
        guard let scene = view.window?.windowScene else { return }
        let orientation: UIInterfaceOrientationMask = scene.interfaceOrientation.isPortrait ? .landscapeRight : .portrait
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientation))
        reveal()
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
}
