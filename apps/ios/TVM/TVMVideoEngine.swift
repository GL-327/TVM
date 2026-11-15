import UIKit
import AVFoundation
import MobileVLCKit

/// The film's picture and sound, drawn by VLC under the page.
///
/// As on Android (TvmNativePlayer), the page's own player screen (its
/// controls, timeline, skip buttons and menus, styled by the shared phone
/// look) sits over the picture, transparent where the picture shows. This
/// engine has no controls of its own: it answers the page's player bridge
/// (`webkit.messageHandlers.tvmPlayer`: open, play, pause, seek, volume, mute,
/// rate, goLive, stop) and reports state, ended, error and closed back to it.
/// VLC plays what Apple's player cannot (MKV, HEVC in Matroska, DTS, AC-3).
final class TVMVideoEngine: NSObject {
    let sessionID: String
    var onEvent: (([String: Any]) -> Void)?
    /// Called once the engine has let go of the picture (stop, end, close).
    var onFinish: (() -> Void)?
    /// The picture. The host lays it under the web view, filling the screen.
    let view = UIView()
    private let source: URL
    private let live: Bool
    /**
     Seconds behind the broadcast.

     A live stream advances with the clock, so any wall-clock time that does
     not turn into playback position is time spent behind: pause for thirty
     seconds and you are thirty seconds late for the rest of the channel.
     Measuring it this way works for MPEG-TS, where VLC reports neither a
     length nor a seekable range to compare against.
     */
    private var liveDrift: Double = 0
    private var driftAnchor: Date?
    private var driftBase: Double = 0
    private var resumeAt: Double
    private let player = VLCMediaPlayer()
    private var audioLevel: Int32 = 100
    private var initiallyMuted = false
    private var timer: Timer?
    private var startedAt = Date()
    private var sawPlayback = false
    private var finished = false
    private var failed = false
    private var lastPosition: Double = 0
    private var lastDuration: Double = 0
    private var lastGoodPosition: Double = 0
    private var lastProgressAt = Date()
    private var errorSince: Date?
    private var audioChecked = false

    init(id: String, url: URL, startAt: Double, live: Bool, initialVolume: Double = 1, initialMuted: Bool = false) {
        sessionID = id; source = url; resumeAt = startAt; self.live = live
        audioLevel = initialVolume.isFinite ? Int32(max(0, min(100, initialVolume * 100))) : 100
        initiallyMuted = initialMuted
        super.init()
        view.backgroundColor = .black
        view.clipsToBounds = true
        view.isUserInteractionEnabled = false
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.willResignActiveNotification, object: nil)
    }

    deinit { timer?.invalidate(); NotificationCenter.default.removeObserver(self) }

    /// Starts once the picture is on screen.
    func start() {
        guard timer == nil, !finished else { return }
        UIApplication.shared.isIdleTimerDisabled = true
        player.drawable = view
        player.scaleFactor = 0
        player.videoAspectRatio = nil
        player.videoCropGeometry = nil
        startPlayback()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.update() }
    }

    /// The picture keeps its own shape, centred, whatever the screen's.
    func layout() {
        let mid = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        for sub in view.subviews {
            sub.isUserInteractionEnabled = false
            if sub.bounds.isEmpty { continue }
            sub.center = mid
        }
    }

    private func startPlayback() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        failed = false; sawPlayback = false; startedAt = Date(); audioChecked = false
        errorSince = nil; lastProgressAt = Date(); lastGoodPosition = 0
        // Reopening reconnects at the live edge, so the gap starts again at zero.
        liveDrift = 0; driftBase = 0; driftAnchor = live ? Date() : nil
        player.drawable = view
        let media = VLCMedia(url: source)
        media.addOptions([
            "network-caching": 8000,
            "file-caching": 3000,
            "live-caching": 3000,
            "http-user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TVM-iOS",
        ])
        player.media = media
        player.play()
        player.audio?.volume = audioLevel
        player.audio?.isMuted = initiallyMuted || audioLevel == 0
        emitState(buffering: true, hasFrame: false)
    }

    func command(_ name: String, data: [String: Any]) {
        switch name {
        case "play":
            if failed { retry() } else { player.play() }
        case "pause": player.pause()
        case "seek": if let seconds = data["seconds"] as? Double { seek(seconds) }
        case "volume":
            if let volume = data["volume"] as? Double, volume.isFinite {
                let level = Int32(max(0, min(100, volume * 100)))
                audioLevel = level
                initiallyMuted = level == 0
                player.audio?.volume = level
                player.audio?.isMuted = level == 0
            }
        case "mute":
            let muted = data["muted"] as? Bool ?? false
            initiallyMuted = muted
            player.audio?.isMuted = muted
        case "rate":
            if let rate = data["rate"] as? Double, rate.isFinite {
                player.rate = Float(max(0.25, min(2, rate)))
            }
        case "goLive":
            // VLC cannot seek forward in a live transport stream — there is no
            // index to seek within. Reopening the source reconnects at the
            // edge, which is what returning to live actually means here.
            guard live else { break }
            player.stop()
            startPlayback()
        case "stop": shutdown()
        default: break
        }
    }

    private func update() {
        guard !finished, !failed else { return }
        layout()
        let position = max(0, Double(player.time.intValue) / 1000)
        let duration = max(0, Double(player.media?.length.intValue ?? 0) / 1000)
        if duration > 0 { lastDuration = duration }
        if live, let anchor = driftAnchor {
            let elapsed = Date().timeIntervalSince(anchor)
            liveDrift = max(0, driftBase + elapsed - position)
        }
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
            preferMainAudio()
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
        if tvmNativeDidEnd(livePulse) { emitState(buffering: false); emit("ended"); shutdown(); return }
        let blocking = tvmNativeBlockingLoad(livePulse)
        let rebuffering = tvmNativeRebuffering(livePulse)
        emitState(buffering: blocking || rebuffering, hasFrame: sawPlayback || pulse.hasOutput)
    }

    /**
     A copy can carry the creators' commentary as one of its sound tracks;
     when that is the one VLC starts with, the episode's own sound is chosen
     instead (as on Android, TvmNativePlayer.preferMainAudio). Once per copy,
     so a track chosen afterwards is kept.
     */
    private func preferMainAudio() {
        guard !audioChecked else { return }
        let names = player.audioTrackNames as? [String] ?? []
        let ids = player.audioTrackIndexes as? [NSNumber] ?? []
        guard names.count == ids.count, names.count > 1 else { if !names.isEmpty { audioChecked = true }; return }
        audioChecked = true
        let current = player.currentAudioTrackIndex
        guard let at = ids.firstIndex(where: { $0.int32Value == current }),
              tvmIsCommentaryTrack(names[at]) else { return }
        if let main = zip(names, ids).first(where: { $0.1.int32Value >= 0 && !tvmIsCommentaryTrack($0.0) && $0.0.lowercased() != "disable" }) {
            player.currentAudioTrackIndex = main.1.int32Value
        }
    }

    private func emitState(buffering: Bool, hasFrame: Bool? = nil) {
        emit("state", ["position": lastPosition, "duration": lastDuration, "paused": !player.isPlaying,
                       "buffering": buffering, "hasFrame": hasFrame ?? (sawPlayback || player.hasVideoOut),
                       "liveDrift": live ? liveDrift : 0])
    }

    private func emit(_ command: String, _ fields: [String: Any] = [:]) {
        var data = fields; data["id"] = sessionID; data["command"] = command; onEvent?(data)
    }

    private func fail() {
        guard !failed, !finished, !player.isPlaying else { return }
        failed = true
        emitState(buffering: false, hasFrame: sawPlayback)
        emit("error", ["message": "This source could not be played. Press Retry, or go back to choose another source."])
    }

    private func retry() {
        failed = false
        startedAt = Date()
        errorSince = nil
        lastProgressAt = Date()
        resumeAt = max(lastGoodPosition, lastPosition)
        if player.media != nil { player.play() } else { startPlayback() }
    }

    private func seek(_ seconds: Double) {
        guard seconds.isFinite, player.isSeekable, !live else { return }
        let end = lastDuration > 0 ? lastDuration : Double(Int32.max) / 1000
        let clamped = min(Double(Int32.max), max(0, min(seconds, end)) * 1000)
        player.time = VLCTime(int: Int32(clamped))
    }

    /// Lets go of the picture and the sound. The page closes its own screen.
    func shutdown() {
        guard !finished else { return }; finished = true
        timer?.invalidate(); timer = nil
        player.stop(); player.drawable = nil
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        onFinish?()
    }

    @objc private func backgrounded() {
        guard !finished else { return }
        player.pause()
        emitState(buffering: false)
    }
}

/// A sound track named as commentary or audio description, not the main sound.
func tvmIsCommentaryTrack(_ name: String) -> Bool {
    name.range(of: #"commentary|director|descri"#, options: [.regularExpression, .caseInsensitive]) != nil
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
