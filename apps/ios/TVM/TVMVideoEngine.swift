import UIKit
import AVFoundation
import MobileVLCKit

/// The film's picture and sound, drawn by VLC under the page.
///
/// As on Android (TvmNativePlayer), the page's own player screen (its
/// controls, timeline, skip buttons and menus, styled by the shared phone
/// look) sits over the picture, transparent where the picture shows. This
/// engine answers the page's player bridge (`webkit.messageHandlers.tvmPlayer`:
/// open, play, pause, seek, volume, mute, rate, goLive, stop, nightMode,
/// sleepTimer, sleepResume, stats, playbackInfo, extrasUi) and reports state,
/// stats, sleep, ended, error and closed back to it while drawing frosted glass
/// stats and sleep overlays over the video.
/// VLC plays what Apple's player cannot (MKV, HEVC in Matroska, DTS, AC-3).
final class TVMVideoEngine: NSObject {
    let sessionID: String
    var onEvent: (([String: Any]) -> Void)?
    /// Called once the engine has let go of the picture (stop, end, close).
    var onFinish: (() -> Void)?
    /// The picture. The host lays it under the web view, filling the screen.
    let view = UIView()
    /// Transparent pass-through overlay drawn above the video (stats glass card, tap target, sleep badge).
    let overlayView: TVMNativeVideoOverlayView
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
    private var pauseAfterOpen = false
    private let player = VLCMediaPlayer()
    private var baseVolume: Double = 1
    private var audioLevel: Int32 = 100
    private var initiallyMuted = false
    private var nightModeEnabled = false
    private var statsVisible = false
    private var reactSheetOpen = false
    private var playbackMeta = TVMNativePlaybackMeta()
    private var sleepTracker = TVMSleepTimerState()
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
    /// ISO 639 code VLC picks the sound track by (the title's original language, English when unknown, or the
    /// language chosen in Settings). Without it VLC keeps the file's default track, often a dub.
    private let audioLanguage: String

    init(id: String, url: URL, startAt: Double, live: Bool, initialVolume: Double = 1, initialMuted: Bool = false,
         audioLanguage: String = "eng") {
        sessionID = id; source = url; resumeAt = startAt; self.live = live
        let code = audioLanguage.trimmingCharacters(in: .whitespaces).lowercased()
        self.audioLanguage = (2...3).contains(code.count) && code.allSatisfy({ $0 >= "a" && $0 <= "z" }) ? code : "eng"
        let clampedVol = initialVolume.isFinite ? max(0, min(1, initialVolume)) : 1
        baseVolume = clampedVol
        audioLevel = Int32(max(0, min(100, clampedVol * 100)))
        initiallyMuted = initialMuted
        overlayView = TVMNativeVideoOverlayView()
        super.init()
        view.backgroundColor = .black
        view.clipsToBounds = true
        view.isUserInteractionEnabled = false
        overlayView.onToggleStats = { [weak self] in
            guard let self else { return }
            self.setStatsVisible(!self.statsVisible, notify: true)
        }
        overlayView.onResumeSleep = { [weak self] in
            self?.resumeFromSleepTimer()
        }
        overlayView.onDismissSleep = { [weak self] in
            self?.dismissSleepExpiredOverlay()
        }
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
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.update() }
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

    static func compressorOptions(enabled: Bool) -> [String: Any] {
        guard enabled else { return [:] }
        // Mirrors WebAudio night-mode dynamics (threshold -26 dB, ratio 8:1, attack 5 ms, release 250 ms).
        return [
            "audio-filter": "compressor",
            "compressor-rms-peak": 0.2,
            "compressor-attack": 5.0,
            "compressor-release": 250.0,
            "compressor-threshold": -26.0,
            "compressor-ratio": 8.0,
            "compressor-knee": 6.0,
            "compressor-makeup-gain": 8.0,
        ]
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
        var options: [String: Any] = [
            "network-caching": 8000,
            "file-caching": 3000,
            "live-caching": 3000,
            "http-user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TVM-iOS",
            "audio-language": audioLanguage,
        ]
        for (k, v) in Self.compressorOptions(enabled: nightModeEnabled) {
            options[k] = v
        }
        media.addOptions(options)
        player.media = media
        player.play()
        applyCurrentAudioLevel()
        emitState(buffering: true, hasFrame: false)
    }

    private func applyCurrentAudioLevel() {
        let factor = sleepTracker.fadeFactor
        let effective = max(0, min(1, baseVolume * factor))
        let level = Int32(max(0, min(100, effective * 100)))
        audioLevel = level
        player.audio?.volume = level
        player.audio?.isMuted = initiallyMuted || level == 0
    }

    private func reopenWithCurrentNightMode() {
        guard player.media != nil else { return }
        let pos = max(lastPosition, Double(player.time.intValue) / 1000)
        if !live, pos > 0.5 { resumeAt = pos }
        pauseAfterOpen = sawPlayback && !player.isPlaying
        player.stop()
        startPlayback()
    }

    private func setStatsVisible(_ visible: Bool, notify: Bool) {
        statsVisible = visible
        overlayView.setStatsVisible(visible, sheetOpen: reactSheetOpen)
        let stats = collectStatsPayload()
        if visible {
            overlayView.updateStatsRows(TVMNativeStatsBuilder.rows(from: stats))
        }
        if notify {
            emit("stats", ["visible": visible, "stats": stats])
        }
    }

    private func configureSleepTimer(_ choice: String) {
        let nowMs = Date().timeIntervalSince1970 * 1000
        let clean = TVMSleepTimerState.normalizedChoice(choice)
        if clean == "off" {
            sleepTracker.reset(choice: "off", nowMs: nowMs)
            applyCurrentAudioLevel()
            overlayView.updateSleep(choice: "off", remainingText: nil, expired: false, sheetOpen: reactSheetOpen)
            emitSleepState(nowMs: nowMs)
            return
        }
        sleepTracker.reset(choice: clean, nowMs: nowMs)
        applyCurrentAudioLevel()
        let snapshot = sleepTracker.snapshot(nowMs: nowMs, position: lastPosition, duration: lastDuration)
        overlayView.updateSleep(
            choice: snapshot.choice,
            remainingText: tvmFormatRemainingSleep(snapshot.remainingMs),
            expired: snapshot.expired,
            sheetOpen: reactSheetOpen
        )
        emitSleepState(nowMs: nowMs)
    }

    private func resumeFromSleepTimer() {
        let nowMs = Date().timeIntervalSince1970 * 1000
        sleepTracker.reset(choice: "off", nowMs: nowMs)
        applyCurrentAudioLevel()
        let phase = tvmNativePhase(player.state)
        if phase == .ended || phase == .stopped {
            resumeAt = 0
            startPlayback()
        } else {
            if !live, lastDuration > 0, lastPosition >= lastDuration - 0.5 {
                seek(0)
            }
            if failed { retry() } else { player.play() }
        }
        overlayView.updateSleep(choice: "off", remainingText: nil, expired: false, sheetOpen: reactSheetOpen)
        emitSleepState(nowMs: nowMs)
        emitState(buffering: false)
    }

    private func dismissSleepExpiredOverlay() {
        let nowMs = Date().timeIntervalSince1970 * 1000
        sleepTracker.reset(choice: "off", nowMs: nowMs)
        applyCurrentAudioLevel()
        overlayView.updateSleep(choice: "off", remainingText: nil, expired: false, sheetOpen: reactSheetOpen)
        emitSleepState(nowMs: nowMs)
        if tvmNativePhase(player.state) == .ended {
            emitState(buffering: false)
            emit("ended")
            shutdown()
        }
    }

    func command(_ name: String, data: [String: Any]) {
        switch name {
        case "play":
            if failed { retry() } else { player.play() }
        case "pause": player.pause()
        case "seek": if let seconds = data["seconds"] as? Double { seek(seconds) }
        case "volume":
            if let volume = data["volume"] as? Double, volume.isFinite {
                let clamped = max(0, min(1, volume))
                if !sleepTracker.fading && !sleepTracker.expired {
                    baseVolume = clamped
                }
                initiallyMuted = clamped == 0
                let level = Int32(max(0, min(100, clamped * 100)))
                audioLevel = level
                player.audio?.volume = level
                player.audio?.isMuted = initiallyMuted || level == 0
            }
        case "mute":
            let muted = data["muted"] as? Bool ?? false
            initiallyMuted = muted
            player.audio?.isMuted = muted
        case "rate":
            if let rate = data["rate"] as? Double, rate.isFinite {
                player.rate = Float(max(0.25, min(2, rate)))
            }
        case "nightMode":
            let enabled = data["enabled"] as? Bool ?? false
            guard enabled != nightModeEnabled else { break }
            nightModeEnabled = enabled
            reopenWithCurrentNightMode()
        case "sleepTimer":
            let choice = data["choice"] as? String ?? "off"
            configureSleepTimer(choice)
        case "sleepResume":
            resumeFromSleepTimer()
        case "stats":
            let next = (data["visible"] as? Bool) ?? !statsVisible
            setStatsVisible(next, notify: data["visible"] == nil)
        case "extrasUi":
            reactSheetOpen = data["sheetOpen"] as? Bool ?? false
            overlayView.setSheetOpen(reactSheetOpen)
        case "playbackInfo":
            playbackMeta.update(from: data)
            if statsVisible {
                overlayView.updateStatsRows(TVMNativeStatsBuilder.rows(from: collectStatsPayload()))
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
            if pauseAfterOpen { pauseAfterOpen = false; player.pause() }
            preferMainAudio()
        }
        let nowMs = Date().timeIntervalSince1970 * 1000
        let sleepStep = sleepTracker.step(nowMs: nowMs, position: lastPosition, duration: lastDuration, paused: !player.isPlaying)
        if sleepStep.volumeChanged {
            applyCurrentAudioLevel()
        }
        if sleepStep.justExpired {
            player.pause()
        }
        if sleepStep.active || sleepStep.stateChanged {
            overlayView.updateSleep(
                choice: sleepStep.snapshot.choice,
                remainingText: tvmFormatRemainingSleep(sleepStep.snapshot.remainingMs),
                expired: sleepStep.snapshot.expired,
                sheetOpen: reactSheetOpen
            )
            if sleepStep.stateChanged {
                emitSleepState(nowMs: nowMs)
            }
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
        if sleepTracker.expired {
            emitState(buffering: false, hasFrame: sawPlayback || pulse.hasOutput)
            return
        }
        if tvmNativeDidEnd(livePulse) {
            if sleepTracker.choice == "end" {
                let expiredSnap = sleepTracker.forceExpire(nowMs: nowMs)
                applyCurrentAudioLevel()
                player.pause()
                overlayView.updateSleep(choice: expiredSnap.choice, remainingText: "0:00", expired: true, sheetOpen: reactSheetOpen)
                emitSleepState(nowMs: nowMs)
                emitState(buffering: false)
                return
            }
            emitState(buffering: false); emit("ended"); shutdown(); return
        }
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

    private func collectStatsPayload() -> [String: Any] {
        let size = player.videoSize
        let tracks = (player.media?.tracksInformation as? [[AnyHashable: Any]]) ?? []
        let statsDict = (player.media?.stats as? [AnyHashable: Any]) ?? [:]
        let lostPictures = (statsDict["lostPictures"] as? NSNumber)?.intValue ?? player.media?.numberOfLostPictures
        let displayed = (statsDict["displayedPictures"] as? NSNumber)?.intValue
        let decoded = (statsDict["decodedVideo"] as? NSNumber)?.intValue
        let demuxBitrateMBs = (statsDict["demuxBitrate"] as? NSNumber)?.doubleValue ?? Double(player.media?.demuxBitrate ?? 0)
        let inputBitrateMBs = (statsDict["inputBitrate"] as? NSNumber)?.doubleValue ?? Double(player.media?.inputBitrate ?? 0)
        let readBytes = (statsDict["readBytes"] as? NSNumber)?.doubleValue
        let demuxReadBytes = (statsDict["demuxReadBytes"] as? NSNumber)?.doubleValue

        let audioNames = player.audioTrackNames as? [String] ?? []
        let audioIds = player.audioTrackIndexes as? [NSNumber] ?? []
        let currentAudioId = player.currentAudioTrackIndex
        let activeAudioName = audioIds.firstIndex(where: { $0.int32Value == currentAudioId })
            .flatMap { $0 < audioNames.count ? audioNames[$0] : nil }

        let subNames = player.videoSubTitlesNames as? [String] ?? []
        let subIds = player.videoSubTitlesIndexes as? [NSNumber] ?? []
        let currentSubId = player.currentVideoSubTitleIndex
        let activeSubName: String? = currentSubId < 0
            ? nil
            : subIds.firstIndex(where: { $0.int32Value == currentSubId })
                .flatMap { idx -> String? in
                    guard idx < subNames.count else { return nil }
                    let label = subNames[idx].trimmingCharacters(in: .whitespacesAndNewlines)
                    return label.isEmpty || label.lowercased() == "disable" ? nil : label
                }

        return TVMNativeStatsBuilder.build(
            videoWidth: Int(size.width),
            videoHeight: Int(size.height),
            tracks: tracks,
            currentAudioId: Int(currentAudioId),
            activeAudioName: activeAudioName,
            activeSubtitleName: activeSubName,
            lostPictures: lostPictures,
            displayedPictures: displayed,
            decodedVideo: decoded,
            demuxBitrateMBs: demuxBitrateMBs,
            inputBitrateMBs: inputBitrateMBs,
            readBytes: readBytes,
            demuxReadBytes: demuxReadBytes,
            durationSeconds: lastDuration,
            live: live,
            meta: playbackMeta
        )
    }

    private func emitSleepState(nowMs: Double) {
        let snapshot = sleepTracker.snapshot(nowMs: nowMs, position: lastPosition, duration: lastDuration)
        var fields: [String: Any] = [
            "choice": snapshot.choice,
            "fading": snapshot.fading,
            "expired": snapshot.expired,
        ]
        if let rem = snapshot.remainingMs { fields["remainingMs"] = rem }
        emit("sleep", fields)
    }

    private func emitState(buffering: Bool, hasFrame: Bool? = nil) {
        var fields: [String: Any] = [
            "position": lastPosition,
            "duration": lastDuration,
            "paused": !player.isPlaying,
            "buffering": buffering,
            "hasFrame": hasFrame ?? (sawPlayback || player.hasVideoOut),
            "liveDrift": live ? liveDrift : 0,
        ]
        let nowMs = Date().timeIntervalSince1970 * 1000
        if statsVisible {
            let stats = collectStatsPayload()
            fields["stats"] = stats
            overlayView.updateStatsRows(TVMNativeStatsBuilder.rows(from: stats))
        }
        if sleepTracker.choice != "off" || sleepTracker.expired {
            let sleepSnap = sleepTracker.snapshot(nowMs: nowMs, position: lastPosition, duration: lastDuration)
            var sleepObj: [String: Any] = [
                "choice": sleepSnap.choice,
                "fading": sleepSnap.fading,
                "expired": sleepSnap.expired,
            ]
            if let rem = sleepSnap.remainingMs { sleepObj["remainingMs"] = rem }
            fields["sleep"] = sleepObj
        }
        emit("state", fields)
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

// MARK: - Sleep Timer & Native Overlays

let tvmSleepFadeMs: Double = 5_000

func tvmSleepDeadlineMs(_ choice: String, nowMs: Double) -> Double? {
    switch choice {
    case "15", "30", "45", "60":
        return (Double(choice) ?? 0) * 60_000 + nowMs
    default:
        return nil
    }
}

func tvmSleepFadeFactor(elapsedMs: Double) -> Double {
    guard elapsedMs.isFinite else { return 1 }
    return max(0, min(1, 1 - elapsedMs / tvmSleepFadeMs))
}

func tvmSleepShouldStart(choice: String, deadlineMs: Double?, nowMs: Double,
                         position: Double, duration: Double, paused: Bool) -> Bool {
    if choice == "off" { return false }
    if choice == "end" {
        return !paused && duration.isFinite && duration > 0 && position >= duration - 5
    }
    guard let deadlineMs else { return false }
    return nowMs >= deadlineMs
}

func tvmFormatRemainingSleep(_ ms: Double?) -> String? {
    guard let ms, ms.isFinite, ms >= 0 else { return nil }
    let totalSeconds = max(0, Int(ceil(ms / 1000)))
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let seconds = totalSeconds % 60
    return hours > 0
        ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
        : String(format: "%d:%02d", minutes, seconds)
}

struct TVMNativeSleepSnapshot: Equatable {
    var choice: String
    var remainingMs: Double?
    var fading: Bool
    var expired: Bool
}

struct TVMSleepTimerState {
    struct StepResult {
        var volumeChanged: Bool
        var justExpired: Bool
        var stateChanged: Bool
        var active: Bool
        var snapshot: TVMNativeSleepSnapshot
    }

    private(set) var choice: String = "off"
    private(set) var deadlineMs: Double? = nil
    private(set) var fadeStartMs: Double? = nil
    private(set) var fading: Bool = false
    private(set) var expired: Bool = false
    private(set) var fadeFactor: Double = 1.0
    private var lastReportedSec: Int = -1

    static func normalizedChoice(_ raw: String) -> String {
        switch raw {
        case "15", "30", "45", "60", "end": return raw
        default: return "off"
        }
    }

    mutating func reset(choice rawChoice: String, nowMs: Double) {
        choice = Self.normalizedChoice(rawChoice)
        deadlineMs = tvmSleepDeadlineMs(choice, nowMs: nowMs)
        fadeStartMs = nil
        fading = false
        expired = false
        fadeFactor = 1.0
        lastReportedSec = -1
    }

    mutating func forceExpire(nowMs: Double) -> TVMNativeSleepSnapshot {
        fadeStartMs = fadeStartMs ?? nowMs
        fading = false
        expired = true
        fadeFactor = 0.0
        lastReportedSec = 0
        return TVMNativeSleepSnapshot(choice: choice, remainingMs: 0, fading: false, expired: true)
    }

    mutating func step(nowMs: Double, position: Double, duration: Double, paused: Bool) -> StepResult {
        if choice == "off" || expired {
            return StepResult(
                volumeChanged: false,
                justExpired: false,
                stateChanged: false,
                active: false,
                snapshot: snapshot(nowMs: nowMs, position: position, duration: duration)
            )
        }
        var volumeChanged = false
        var justExpired = false
        var stateChanged = false

        if fadeStartMs == nil && tvmSleepShouldStart(
            choice: choice,
            deadlineMs: deadlineMs,
            nowMs: nowMs,
            position: position,
            duration: duration,
            paused: paused
        ) {
            fadeStartMs = nowMs
            fading = true
            stateChanged = true
        }

        if let fadeStartMs {
            let nextFactor = tvmSleepFadeFactor(elapsedMs: nowMs - fadeStartMs)
            if abs(nextFactor - fadeFactor) > 0.005 {
                fadeFactor = nextFactor
                volumeChanged = true
            }
            if nextFactor == 0 {
                fading = false
                expired = true
                fadeFactor = 0
                justExpired = true
                stateChanged = true
            }
        }

        let snap = snapshot(nowMs: nowMs, position: position, duration: duration)
        let remSec = snap.remainingMs.map { Int(ceil($0 / 1000)) } ?? -1
        if remSec != lastReportedSec {
            lastReportedSec = remSec
            stateChanged = true
        }
        return StepResult(
            volumeChanged: volumeChanged,
            justExpired: justExpired,
            stateChanged: stateChanged,
            active: choice != "off",
            snapshot: snap
        )
    }

    func snapshot(nowMs: Double, position: Double, duration: Double) -> TVMNativeSleepSnapshot {
        let remaining: Double?
        if expired {
            remaining = 0
        } else if let fadeStartMs {
            remaining = max(0, tvmSleepFadeMs - (nowMs - fadeStartMs))
        } else if choice == "end" {
            remaining = duration.isFinite && duration > 0 ? max(0, (duration - position) * 1000) : nil
        } else if let deadlineMs {
            remaining = max(0, deadlineMs - nowMs)
        } else {
            remaining = nil
        }
        return TVMNativeSleepSnapshot(choice: choice, remainingMs: remaining, fading: fading, expired: expired)
    }
}

struct TVMNativePlaybackMeta {
    var source: String? = nil
    var versionLabel: String? = nil
    var codec: String? = nil
    var hdr: String? = nil
    var mimeType: String? = nil
    var bitrateMbps: Double? = nil
    var sizeBytes: Double? = nil
    var durationSeconds: Double? = nil

    mutating func update(from data: [String: Any]) {
        if let v = data["source"] as? String, !v.isEmpty { source = v }
        if let v = data["versionLabel"] as? String, !v.isEmpty { versionLabel = v }
        if let v = data["codec"] as? String, !v.isEmpty { codec = v }
        if let v = data["hdr"] as? String, !v.isEmpty { hdr = v }
        if let v = data["mimeType"] as? String, !v.isEmpty { mimeType = v }
        if let v = (data["bitrateMbps"] as? NSNumber)?.doubleValue, v.isFinite, v > 0 { bitrateMbps = v }
        if let v = (data["sizeBytes"] as? NSNumber)?.doubleValue, v.isFinite, v > 0 { sizeBytes = v }
        if let v = (data["durationSeconds"] as? NSNumber)?.doubleValue, v.isFinite, v > 0 { durationSeconds = v }
    }
}

enum TVMNativeStatsBuilder {
    static func decodeFourCC(_ raw: UInt32) -> String {
        guard raw != 0 else { return "" }
        let bytes: [UInt8] = [
            UInt8(raw & 0xFF),
            UInt8((raw >> 8) & 0xFF),
            UInt8((raw >> 16) & 0xFF),
            UInt8((raw >> 24) & 0xFF),
        ]
        let ascii = String(bytes: bytes, encoding: .ascii)?
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.controlCharacters)) ?? ""
        return normalizeCodecLabel(ascii)
    }

    static func normalizeCodecLabel(_ raw: String) -> String {
        let low = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch low {
        case "hevc", "h265", "hvc1", "hev1": return "HEVC"
        case "h264", "avc1", "avc3", "x264": return "H.264"
        case "av01", "av1": return "AV1"
        case "vp90", "vp09", "vp9": return "VP9"
        case "mp4v": return "MPEG-4"
        case "mp2v", "mpg2": return "MPEG-2"
        case "mp4a", "aac": return "AAC"
        case "a52", "ac-3", "ac3": return "AC3"
        case "eac3", "ec-3", "ec3": return "EAC3"
        case "dts", "dtsh", "dtse", "dtsx": return "DTS"
        case "mlp", "mlpa", "trhd": return "TrueHD"
        case "opus": return "Opus"
        case "flac": return "FLAC"
        case "vorb": return "Vorbis"
        case "mp3", "mpga": return "MP3"
        default: return low.isEmpty ? "" : low.uppercased()
        }
    }

    static func formatChannels(_ count: Int?) -> String? {
        guard let count, count > 0 else { return nil }
        switch count {
        case 1: return "Mono"
        case 2: return "Stereo"
        case 6: return "5.1"
        case 8: return "7.1"
        default: return "\(count)ch"
        }
    }

    static func formatHdr(_ raw: String?) -> String {
        guard let raw else { return "Unknown" }
        let low = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch low {
        case "", "unknown": return "Unknown"
        case "dv", "dolby vision": return "Dolby Vision"
        case "sdr": return "SDR"
        default: return low.uppercased()
        }
    }

    static func build(
        videoWidth: Int,
        videoHeight: Int,
        tracks: [[AnyHashable: Any]],
        currentAudioId: Int,
        activeAudioName: String?,
        activeSubtitleName: String?,
        lostPictures: Int?,
        displayedPictures: Int?,
        decodedVideo: Int?,
        demuxBitrateMBs: Double?,
        inputBitrateMBs: Double?,
        readBytes: Double?,
        demuxReadBytes: Double?,
        durationSeconds: Double,
        live: Bool,
        meta: TVMNativePlaybackMeta
    ) -> [String: Any] {
        var videoTrack: [AnyHashable: Any]?
        var matchedAudio: [AnyHashable: Any]?
        var fallbackAudio: [AnyHashable: Any]?

        for track in tracks {
            let kind = (track["type"] as? String) ?? ""
            if kind == "video", videoTrack == nil {
                videoTrack = track
            } else if kind == "audio" {
                if fallbackAudio == nil { fallbackAudio = track }
                if let tid = (track["id"] as? NSNumber)?.intValue, tid == currentAudioId {
                    matchedAudio = track
                }
            }
        }
        let audioTrack = matchedAudio ?? fallbackAudio

        let trackW = (videoTrack?["width"] as? NSNumber)?.intValue ?? 0
        let trackH = (videoTrack?["height"] as? NSNumber)?.intValue ?? 0
        let w = videoWidth > 0 ? videoWidth : trackW
        let h = videoHeight > 0 ? videoHeight : trackH
        let resolution = (w > 0 && h > 0) ? "\(w) × \(h)" : "Unknown"

        let vCodecRaw = (videoTrack?["codec"] as? NSNumber)?.uint32Value ?? 0
        let vCodec = {
            let d = decodeFourCC(vCodecRaw)
            if !d.isEmpty { return d }
            return meta.codec ?? "Unknown"
        }()

        let aCodecRaw = (audioTrack?["codec"] as? NSNumber)?.uint32Value ?? 0
        let aCodecDecoded = decodeFourCC(aCodecRaw)
        let aChannels = formatChannels((audioTrack?["channelsNumber"] as? NSNumber)?.intValue)
        let aLang = ((audioTrack?["language"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines))
            .flatMap { $0.isEmpty ? nil : $0 }
            ?? activeAudioName?.trimmingCharacters(in: .whitespacesAndNewlines)

        // libVLC demuxBitrate/inputBitrate are scaled so * 8000 = kb/s -> * 8.0 = Mb/s.
        let demuxMbps = (demuxBitrateMBs ?? 0) > 0 ? demuxBitrateMBs! * 8.0 : nil
        let inputMbps = (inputBitrateMBs ?? 0) > 0 ? inputBitrateMBs! * 8.0 : nil
        let liveMbps = demuxMbps ?? inputMbps

        let effectiveDuration = durationSeconds > 0 ? durationSeconds : (meta.durationSeconds ?? 0)
        let estMbps: Double? = {
            if let rate = meta.bitrateMbps, rate > 0 { return rate }
            if let bytes = meta.sizeBytes, bytes > 0, effectiveDuration > 0 {
                return (bytes * 8.0) / effectiveDuration / 1_000_000.0
            }
            return nil
        }()

        let bufferSeconds: Double? = {
            if let rb = readBytes, let db = demuxReadBytes, rb >= db, let mbps = liveMbps, mbps > 0 {
                let bytesPerSec = (mbps * 1_000_000.0) / 8.0
                return min(60.0, max(0.0, (rb - db) / bytesPerSec))
            }
            return nil
        }()

        let totalFrames: Int? = {
            let base = displayedPictures ?? decodedVideo
            guard let base, base >= 0 else { return nil }
            let dropped = max(0, lostPictures ?? 0)
            return max(base, base + dropped)
        }()

        var out: [String: Any] = [
            "resolution": resolution,
            "width": w,
            "height": h,
            "videoCodec": vCodec,
            "audioCodec": aCodecDecoded.isEmpty ? "Unknown" : aCodecDecoded,
            "hdr": formatHdr(meta.hdr),
            "subtitles": (activeSubtitleName?.isEmpty == false) ? activeSubtitleName! : "Off",
            "container": meta.mimeType ?? "Matroska / VLC",
            "source": meta.source ?? (live ? "LIVE" : "VLC"),
            "versionLabel": meta.versionLabel ?? "Unknown",
        ]
        if let aLang, !aLang.isEmpty { out["audioLanguage"] = aLang }
        if let aChannels { out["audioChannels"] = aChannels }
        if let lostPictures { out["droppedFrames"] = max(0, lostPictures) }
        if let totalFrames { out["totalFrames"] = totalFrames }
        if let liveMbps { out["bitrateMbps"] = liveMbps }
        if let estMbps { out["estimatedBitrateMbps"] = estMbps }
        if let bufferSeconds { out["bufferSeconds"] = bufferSeconds }
        return out
    }

    static func rows(from payload: [String: Any]) -> [(String, String)] {
        let resolution = (payload["resolution"] as? String) ?? "Unknown"
        let container = (payload["container"] as? String) ?? "Unknown"
        let vCodec = payload["videoCodec"] as? String
        let aCodec = payload["audioCodec"] as? String
        let codecs = [vCodec, aCodec].compactMap { s -> String? in
            guard let s, !s.isEmpty, s != "Unknown" else { return nil }
            return s
        }.joined(separator: " · ")
        let audioParts = [payload["audioLanguage"] as? String, payload["audioChannels"] as? String]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: " · ")
        let hdr = (payload["hdr"] as? String) ?? "Unknown"
        let subtitles = (payload["subtitles"] as? String) ?? "Off"
        let dropped: String = {
            if let d = payload["droppedFrames"] as? Int {
                if let t = payload["totalFrames"] as? Int { return "\(d) / \(t)" }
                return "\(d)"
            }
            return "Unknown"
        }()
        let bitrate: String = {
            if let live = payload["bitrateMbps"] as? Double, live > 0 {
                return String(format: "%.1f Mb/s", live)
            }
            if let est = payload["estimatedBitrateMbps"] as? Double, est > 0 {
                return String(format: "%.1f Mb/s", est)
            }
            return "Unknown"
        }()
        let source = (payload["source"] as? String) ?? "Unknown"
        let version = (payload["versionLabel"] as? String) ?? "Unknown"
        let buffer: String = {
            if let sec = payload["bufferSeconds"] as? Double, sec.isFinite {
                return String(format: "%.1f s", max(0, sec))
            }
            return "Unknown"
        }()
        return [
            ("Resolution", resolution),
            ("Container / MIME", container),
            ("Codecs", codecs.isEmpty ? "Unknown" : codecs),
            ("HDR", hdr),
            ("Audio", audioParts.isEmpty ? "Unknown" : audioParts),
            ("Subtitles", subtitles),
            ("Frames dropped / total", dropped),
            ("Bitrate", bitrate),
            ("Source", source),
            ("Version", version),
            ("Buffer ahead", buffer),
        ]
    }
}

class TVMPassThroughOverlayView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}

/// Frosted glass overlay drawn directly over the video surface on iPhone:
/// - Upper-left tap target pill (`Stats`) + active sleep timer countdown pill
/// - Expandable glass stats card matching React `.playback-stats`
/// - Centered glass "Sleep timer ended" Resume card when React is hidden
final class TVMNativeVideoOverlayView: TVMPassThroughOverlayView {
    var onToggleStats: (() -> Void)?
    var onResumeSleep: (() -> Void)?
    var onDismissSleep: (() -> Void)?

    private let pillStrip = UIStackView()
    private let statsToggleBtn = UIButton(type: .custom)
    private let statsToggleLabel = UILabel()
    private let sleepPill = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    private let sleepPillLabel = UILabel()

    private let statsCard = UIView()
    private let statsBlur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    private let statsRowsStack = UIStackView()

    private let sleepExpiredCard = UIView()
    private let sleepExpiredBlur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))

    private var statsVisible = false
    private var sleepActive = false
    private var sleepExpired = false
    private var reactSheetOpen = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        setupViews()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupViews() {
        pillStrip.axis = .horizontal
        pillStrip.spacing = 8
        pillStrip.alignment = .center
        pillStrip.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pillStrip)

        // Tap target pill
        let statsPillBlur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        statsPillBlur.isUserInteractionEnabled = false
        statsPillBlur.translatesAutoresizingMaskIntoConstraints = false
        statsToggleBtn.clipsToBounds = true
        statsToggleBtn.layer.cornerRadius = 14
        statsToggleBtn.layer.borderWidth = 1
        statsToggleBtn.layer.borderColor = UIColor.white.withAlphaComponent(0.19).cgColor
        statsToggleBtn.backgroundColor = UIColor(red: 17/255, green: 21/255, blue: 30/255, alpha: 0.72)
        statsToggleBtn.accessibilityLabel = "Toggle playback stats"
        statsToggleBtn.addTarget(self, action: #selector(statsTapped), for: .touchUpInside)
        statsToggleBtn.addSubview(statsPillBlur)
        NSLayoutConstraint.activate([
            statsPillBlur.topAnchor.constraint(equalTo: statsToggleBtn.topAnchor),
            statsPillBlur.leadingAnchor.constraint(equalTo: statsToggleBtn.leadingAnchor),
            statsPillBlur.trailingAnchor.constraint(equalTo: statsToggleBtn.trailingAnchor),
            statsPillBlur.bottomAnchor.constraint(equalTo: statsToggleBtn.bottomAnchor),
        ])
        statsToggleLabel.text = "Stats"
        statsToggleLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        statsToggleLabel.textColor = UIColor(red: 245/255, green: 247/255, blue: 250/255, alpha: 0.92)
        statsToggleLabel.isUserInteractionEnabled = false
        statsToggleLabel.translatesAutoresizingMaskIntoConstraints = false
        statsToggleBtn.addSubview(statsToggleLabel)
        NSLayoutConstraint.activate([
            statsToggleLabel.topAnchor.constraint(equalTo: statsToggleBtn.topAnchor, constant: 5),
            statsToggleLabel.bottomAnchor.constraint(equalTo: statsToggleBtn.bottomAnchor, constant: -5),
            statsToggleLabel.leadingAnchor.constraint(equalTo: statsToggleBtn.leadingAnchor, constant: 11),
            statsToggleLabel.trailingAnchor.constraint(equalTo: statsToggleBtn.trailingAnchor, constant: -11),
        ])
        pillStrip.addArrangedSubview(statsToggleBtn)

        // Sleep timer remaining pill
        sleepPill.clipsToBounds = true
        sleepPill.layer.cornerRadius = 14
        sleepPill.layer.borderWidth = 1
        sleepPill.layer.borderColor = UIColor.white.withAlphaComponent(0.19).cgColor
        sleepPill.contentView.backgroundColor = UIColor(red: 17/255, green: 21/255, blue: 30/255, alpha: 0.72)
        sleepPill.isUserInteractionEnabled = false
        sleepPill.isHidden = true
        sleepPillLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        sleepPillLabel.textColor = UIColor(red: 245/255, green: 247/255, blue: 250/255, alpha: 0.92)
        sleepPillLabel.translatesAutoresizingMaskIntoConstraints = false
        sleepPill.contentView.addSubview(sleepPillLabel)
        NSLayoutConstraint.activate([
            sleepPillLabel.topAnchor.constraint(equalTo: sleepPill.contentView.topAnchor, constant: 5),
            sleepPillLabel.bottomAnchor.constraint(equalTo: sleepPill.contentView.bottomAnchor, constant: -5),
            sleepPillLabel.leadingAnchor.constraint(equalTo: sleepPill.contentView.leadingAnchor, constant: 11),
            sleepPillLabel.trailingAnchor.constraint(equalTo: sleepPill.contentView.trailingAnchor, constant: -11),
        ])
        pillStrip.addArrangedSubview(sleepPill)

        NSLayoutConstraint.activate([
            pillStrip.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 60),
            pillStrip.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 16),
        ])

        // Expandable Glass Stats Panel (matches React .playback-stats)
        statsCard.clipsToBounds = true
        statsCard.layer.cornerRadius = 12
        statsCard.layer.borderWidth = 1
        statsCard.layer.borderColor = UIColor.white.withAlphaComponent(0.19).cgColor
        statsCard.isHidden = true
        statsCard.translatesAutoresizingMaskIntoConstraints = false
        addSubview(statsCard)

        statsBlur.translatesAutoresizingMaskIntoConstraints = false
        statsBlur.contentView.backgroundColor = UIColor(red: 17/255, green: 21/255, blue: 30/255, alpha: 0.76)
        statsCard.addSubview(statsBlur)
        NSLayoutConstraint.activate([
            statsBlur.topAnchor.constraint(equalTo: statsCard.topAnchor),
            statsBlur.leadingAnchor.constraint(equalTo: statsCard.leadingAnchor),
            statsBlur.trailingAnchor.constraint(equalTo: statsCard.trailingAnchor),
            statsBlur.bottomAnchor.constraint(equalTo: statsCard.bottomAnchor),
        ])

        let headingRow = UIStackView()
        headingRow.axis = .horizontal
        headingRow.alignment = .center
        headingRow.distribution = .equalSpacing
        headingRow.translatesAutoresizingMaskIntoConstraints = false
        let headingLabel = UILabel()
        headingLabel.text = "Playback stats"
        headingLabel.font = .systemFont(ofSize: 12, weight: .bold)
        headingLabel.textColor = UIColor(red: 245/255, green: 247/255, blue: 250/255, alpha: 1)
        let closeBtn = UIButton(type: .custom)
        closeBtn.setTitle("×", for: .normal)
        closeBtn.setTitleColor(.white, for: .normal)
        closeBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        closeBtn.backgroundColor = UIColor.white.withAlphaComponent(0.10)
        closeBtn.layer.cornerRadius = 6
        closeBtn.accessibilityLabel = "Close playback stats"
        closeBtn.addTarget(self, action: #selector(statsTapped), for: .touchUpInside)
        closeBtn.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            closeBtn.widthAnchor.constraint(equalToConstant: 28),
            closeBtn.heightAnchor.constraint(equalToConstant: 24),
        ])
        headingRow.addArrangedSubview(headingLabel)
        headingRow.addArrangedSubview(closeBtn)

        let scroll = UIScrollView()
        scroll.showsVerticalScrollIndicator = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        statsRowsStack.axis = .vertical
        statsRowsStack.spacing = 4
        statsRowsStack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(statsRowsStack)

        statsCard.addSubview(headingRow)
        statsCard.addSubview(scroll)
        let scrollHeight = scroll.heightAnchor.constraint(equalTo: statsRowsStack.heightAnchor)
        scrollHeight.priority = .defaultHigh
        NSLayoutConstraint.activate([
            headingRow.topAnchor.constraint(equalTo: statsCard.topAnchor, constant: 10),
            headingRow.leadingAnchor.constraint(equalTo: statsCard.leadingAnchor, constant: 12),
            headingRow.trailingAnchor.constraint(equalTo: statsCard.trailingAnchor, constant: -12),
            scroll.topAnchor.constraint(equalTo: headingRow.bottomAnchor, constant: 8),
            scroll.leadingAnchor.constraint(equalTo: statsCard.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: statsCard.trailingAnchor, constant: -12),
            scroll.bottomAnchor.constraint(equalTo: statsCard.bottomAnchor, constant: -10),
            scrollHeight,
            statsRowsStack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            statsRowsStack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            statsRowsStack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            statsRowsStack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            statsRowsStack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            statsCard.topAnchor.constraint(equalTo: pillStrip.bottomAnchor, constant: 8),
            statsCard.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 16),
            statsCard.widthAnchor.constraint(lessThanOrEqualToConstant: 310),
            statsCard.trailingAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor, constant: -16),
            statsCard.bottomAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.bottomAnchor, constant: -16),
        ])

        // Sleep timer expired fallback card (used when React layer is hidden behind native surface)
        sleepExpiredCard.clipsToBounds = true
        sleepExpiredCard.layer.cornerRadius = 16
        sleepExpiredCard.layer.borderWidth = 1
        sleepExpiredCard.layer.borderColor = UIColor.white.withAlphaComponent(0.19).cgColor
        sleepExpiredCard.isHidden = true
        sleepExpiredCard.translatesAutoresizingMaskIntoConstraints = false
        addSubview(sleepExpiredCard)

        sleepExpiredBlur.translatesAutoresizingMaskIntoConstraints = false
        sleepExpiredBlur.contentView.backgroundColor = UIColor(red: 18/255, green: 20/255, blue: 26/255, alpha: 0.88)
        sleepExpiredCard.addSubview(sleepExpiredBlur)
        NSLayoutConstraint.activate([
            sleepExpiredBlur.topAnchor.constraint(equalTo: sleepExpiredCard.topAnchor),
            sleepExpiredBlur.leadingAnchor.constraint(equalTo: sleepExpiredCard.leadingAnchor),
            sleepExpiredBlur.trailingAnchor.constraint(equalTo: sleepExpiredCard.trailingAnchor),
            sleepExpiredBlur.bottomAnchor.constraint(equalTo: sleepExpiredCard.bottomAnchor),
        ])

        let sleepTitle = UILabel()
        sleepTitle.text = "Sleep timer ended"
        sleepTitle.font = .systemFont(ofSize: 18, weight: .bold)
        sleepTitle.textColor = .white
        sleepTitle.textAlignment = .center

        let resumeBtn = UIButton(type: .custom)
        resumeBtn.setTitle("Resume", for: .normal)
        resumeBtn.setTitleColor(.white, for: .normal)
        resumeBtn.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        resumeBtn.backgroundColor = UIColor(red: 47/255, green: 107/255, blue: 255/255, alpha: 1)
        resumeBtn.layer.cornerRadius = 10
        resumeBtn.addTarget(self, action: #selector(resumeTapped), for: .touchUpInside)

        let dismissBtn = UIButton(type: .custom)
        dismissBtn.setTitle("Close", for: .normal)
        dismissBtn.setTitleColor(UIColor.white.withAlphaComponent(0.85), for: .normal)
        dismissBtn.titleLabel?.font = .systemFont(ofSize: 14, weight: .medium)
        dismissBtn.backgroundColor = UIColor.white.withAlphaComponent(0.10)
        dismissBtn.layer.cornerRadius = 10
        dismissBtn.addTarget(self, action: #selector(dismissSleepTapped), for: .touchUpInside)

        let sleepStack = UIStackView(arrangedSubviews: [sleepTitle, resumeBtn, dismissBtn])
        sleepStack.axis = .vertical
        sleepStack.spacing = 10
        sleepStack.translatesAutoresizingMaskIntoConstraints = false
        sleepExpiredCard.addSubview(sleepStack)
        NSLayoutConstraint.activate([
            resumeBtn.heightAnchor.constraint(equalToConstant: 44),
            dismissBtn.heightAnchor.constraint(equalToConstant: 40),
            sleepStack.topAnchor.constraint(equalTo: sleepExpiredCard.topAnchor, constant: 18),
            sleepStack.leadingAnchor.constraint(equalTo: sleepExpiredCard.leadingAnchor, constant: 18),
            sleepStack.trailingAnchor.constraint(equalTo: sleepExpiredCard.trailingAnchor, constant: -18),
            sleepStack.bottomAnchor.constraint(equalTo: sleepExpiredCard.bottomAnchor, constant: -18),
            sleepExpiredCard.centerXAnchor.constraint(equalTo: centerXAnchor),
            sleepExpiredCard.centerYAnchor.constraint(equalTo: centerYAnchor),
            sleepExpiredCard.widthAnchor.constraint(equalToConstant: 260),
        ])
    }

    func setStatsVisible(_ visible: Bool, sheetOpen: Bool) {
        statsVisible = visible
        reactSheetOpen = sheetOpen
        syncVisibility()
    }

    func setSheetOpen(_ open: Bool) {
        reactSheetOpen = open
        syncVisibility()
    }

    func updateSleep(choice: String, remainingText: String?, expired: Bool, sheetOpen: Bool) {
        reactSheetOpen = sheetOpen
        sleepActive = choice != "off" && !expired
        self.sleepExpired = expired
        if let remainingText, sleepActive {
            sleepPillLabel.text = choice == "end" ? "Sleep End · \(remainingText)" : "Sleep \(remainingText)"
        } else if sleepActive {
            sleepPillLabel.text = choice == "end" ? "Sleep · End" : "Sleep"
        }
        syncVisibility()
    }

    func updateStatsRows(_ rows: [(String, String)]) {
        statsRowsStack.arrangedSubviews.forEach { view in
            statsRowsStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        for (label, value) in rows {
            let row = UIStackView()
            row.axis = .horizontal
            row.alignment = .top
            row.spacing = 8
            let k = UILabel()
            k.text = label
            k.font = .systemFont(ofSize: 11, weight: .regular)
            k.textColor = UIColor(red: 169/255, green: 176/255, blue: 188/255, alpha: 1)
            k.numberOfLines = 1
            k.setContentHuggingPriority(.required, for: .horizontal)
            let v = UILabel()
            v.text = value
            v.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
            v.textColor = UIColor(red: 245/255, green: 247/255, blue: 250/255, alpha: 1)
            v.numberOfLines = 2
            k.translatesAutoresizingMaskIntoConstraints = false
            k.widthAnchor.constraint(equalToConstant: 112).isActive = true
            row.addArrangedSubview(k)
            row.addArrangedSubview(v)
            statsRowsStack.addArrangedSubview(row)
        }
    }

    private func syncVisibility() {
        pillStrip.isHidden = reactSheetOpen
        statsCard.isHidden = reactSheetOpen || !statsVisible
        sleepPill.isHidden = reactSheetOpen || !sleepActive
        sleepExpiredCard.isHidden = reactSheetOpen || !sleepExpired
        statsToggleLabel.text = statsVisible ? "Stats ×" : "Stats"
        statsToggleBtn.backgroundColor = statsVisible
            ? UIColor(red: 47/255, green: 107/255, blue: 255/255, alpha: 0.45)
            : UIColor(red: 17/255, green: 21/255, blue: 30/255, alpha: 0.72)
    }

    @objc private func statsTapped() { onToggleStats?() }
    @objc private func resumeTapped() { onResumeSleep?() }
    @objc private func dismissSleepTapped() { onDismissSleep?() }
}
