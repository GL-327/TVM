import CommonCrypto
import Foundation

struct PlaybackClient: Equatable {
    var player: String
    var maxHeight: Int? = nil
    var hevc: Bool? = nil
    var hdr: Bool? = nil
    var mkv: Bool? = nil

    static let validPlayers: Set<String> = ["mpv", "html5", "exoplayer", "avplayer", "roku"]

    static func parse(_ raw: Any?) -> PlaybackClient? {
        guard let obj = raw as? [String: Any],
              let player = obj["player"] as? String,
              validPlayers.contains(player) else { return nil }
        let mh: Int?
        if let n = (obj["maxHeight"] as? NSNumber)?.doubleValue, n.isFinite, n > 0 {
            mh = Int(floor(n))
        } else {
            mh = nil
        }
        return PlaybackClient(
            player: player,
            maxHeight: mh,
            hevc: obj["hevc"] as? Bool,
            hdr: obj["hdr"] as? Bool,
            mkv: obj["mkv"] as? Bool
        )
    }
}

struct VersionAudio: Equatable {
    var codec: String?
    var channels: String?
    var atmos: Bool

    func json() -> [String: Any] {
        [
            "codec": JSONValue.orNull(codec),
            "channels": JSONValue.orNull(channels),
            "atmos": atmos,
        ]
    }
}

struct VersionInfo: Equatable {
    var id: String
    var label: String
    var height: Int?
    var hdr: String?
    var source: String
    var codec: String?
    var sizeBytes: Int64?
    var bitrateMbps: Double?
    var audio: VersionAudio
    var languages: [String]
    var upscaled: Bool
    var cached: Bool
    var recommended: Bool = false

    func json() -> [String: Any] {
        [
            "id": id,
            "label": label,
            "height": JSONValue.orNull(height),
            "hdr": JSONValue.orNull(hdr),
            "source": source,
            "codec": JSONValue.orNull(codec),
            "sizeBytes": JSONValue.orNull(sizeBytes),
            "bitrateMbps": JSONValue.orNull(bitrateMbps),
            "audio": audio.json(),
            "languages": languages,
            "upscaled": upscaled,
            "cached": cached,
            "recommended": recommended,
        ]
    }
}

struct RankedVersion {
    var stream: RdStream
    var version: VersionInfo
}

/// Source inspection, capability matching, and version ranking.
/// Direct port of apps/core/src/providers/versions.ts and TvmVersions.kt.
enum TVMVersions {
    static let poorReleasePattern = #"\b(?:cam|hdcam|camrip|telesync|telecine|hdts|hdtc|tsrip|ts|tc|screener|dvdscr|dvdscreener|scr|workprint)\b"#
    static let upscaledPattern = #"\b(?:up[ ._-]?scal(?:e[ds]?|ing)|aius|ups|re[ ._-]?grad(?:e[ds]?|ing))\b"#

    private static let iso: [String: String] = [
        "ar": "ara", "be": "bel", "bg": "bul", "bn": "ben", "ca": "cat", "cs": "ces", "cy": "cym",
        "da": "dan", "de": "deu", "el": "ell", "en": "eng", "es": "spa", "et": "est", "eu": "eus",
        "fa": "fas", "fi": "fin", "fr": "fra", "ga": "gle", "gl": "glg", "gu": "guj", "he": "heb",
        "hi": "hin", "hr": "hrv", "hu": "hun", "id": "ind", "is": "isl", "it": "ita", "ja": "jpn",
        "ka": "kat", "kk": "kaz", "km": "khm", "kn": "kan", "ko": "kor", "lt": "lit", "lv": "lav",
        "mk": "mkd", "ml": "mal", "mr": "mar", "ms": "msa", "my": "mya", "ne": "nep", "nl": "nld",
        "nb": "nor", "no": "nor", "pa": "pan", "pl": "pol", "pt": "por", "ro": "ron", "ru": "rus",
        "sk": "slk", "sl": "slv", "sq": "sqi", "sr": "srp", "sv": "swe", "sw": "swa", "ta": "tam",
        "te": "tel", "th": "tha", "tl": "tgl", "tr": "tur", "uk": "ukr", "ur": "urd", "vi": "vie",
        "zh": "zho", "zu": "zul",
    ]
    private static let legacy: [String: String] = [
        "chi": "zho", "cze": "ces", "dut": "nld", "fre": "fra", "ger": "deu", "gre": "ell",
        "per": "fas", "rum": "ron", "slo": "slk", "alb": "sqi", "baq": "eus", "bur": "mya",
        "geo": "kat", "ice": "isl", "mac": "mkd", "may": "msa", "wel": "cym",
        "mandarin": "zho", "cantonese": "yue",
    ]
    private static let names: [String: String] = {
        var map: [String: String] = [
            "arabic": "ara", "belarusian": "bel", "bulgarian": "bul", "bengali": "ben", "bangla": "ben",
            "catalan": "cat", "czech": "ces", "welsh": "cym", "danish": "dan", "german": "deu",
            "greek": "ell", "english": "eng", "spanish": "spa", "estonian": "est", "basque": "eus",
            "persian": "fas", "finnish": "fin", "french": "fra", "irish": "gle", "galician": "glg",
            "gujarati": "guj", "hebrew": "heb", "hindi": "hin", "croatian": "hrv", "hungarian": "hun",
            "indonesian": "ind", "icelandic": "isl", "italian": "ita", "japanese": "jpn",
            "georgian": "kat", "kazakh": "kaz", "khmer": "khm", "kannada": "kan", "korean": "kor",
            "lithuanian": "lit", "latvian": "lav", "macedonian": "mkd", "malayalam": "mal",
            "marathi": "mar", "malay": "msa", "burmese": "mya", "nepali": "nep", "dutch": "nld",
            "norwegian": "nor", "punjabi": "pan", "polish": "pol", "portuguese": "por",
            "romanian": "ron", "russian": "rus", "slovak": "slk", "slovenian": "slv",
            "albanian": "sqi", "serbian": "srp", "swedish": "swe", "swahili": "swa", "tamil": "tam",
            "telugu": "tel", "thai": "tha", "tagalog": "tgl", "turkish": "tur", "ukrainian": "ukr",
            "urdu": "urd", "vietnamese": "vie", "chinese": "zho", "zulu": "zul",
        ]
        let en = Locale(identifier: "en")
        for (two, three) in iso {
            if let disp = en.localizedString(forLanguageCode: two)?.lowercased(), !disp.isEmpty, disp != two, map[disp] == nil {
                map[disp] = three
            }
        }
        return map
    }()
    private static let isoValues = Set(iso.values)
    private static let flags: [String: String] = [
        "US": "eng", "GB": "eng", "FR": "fra", "DE": "deu", "ES": "spa", "MX": "spa",
        "IT": "ita", "BR": "por", "PT": "por", "JP": "jpn", "KR": "kor", "CN": "zho",
        "TW": "zho", "HK": "yue", "RU": "rus", "UA": "ukr", "PL": "pol", "TR": "tur",
        "NL": "nld", "SE": "swe", "DK": "dan", "FI": "fin", "NO": "nor", "CZ": "ces",
        "HU": "hun", "RO": "ron", "GR": "ell", "IL": "heb", "IR": "fas", "SA": "ara",
        "TH": "tha", "VN": "vie", "ID": "ind",
    ]
    private static let sourceRank: [String: Int] = [
        "remux": 5, "bluray": 4, "web-dl": 3, "webrip": 2, "hdtv": 1, "other": 0,
    ]
    private static let sourceLabel: [String: String] = [
        "remux": "REMUX", "bluray": "BluRay", "web-dl": "WEB-DL", "webrip": "WEBRip", "hdtv": "HDTV", "other": "",
    ]

    static func languageCode(_ value: String?) -> String? {
        guard let value else { return nil }
        let code = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if code.isEmpty { return nil }
        if let mapped = legacy[code] ?? iso[code] ?? names[code] { return mapped }
        return code.range(of: #"^[a-z]{3}$"#, options: .regularExpression) != nil ? code : nil
    }

    static func releaseLanguages(_ release: String, title: String) -> [String] {
        var result: [String] = []
        var seen = Set<String>()
        func add(_ code: String?) {
            if let code, seen.insert(code).inserted { result.append(code) }
        }
        let scalars = Array(release.unicodeScalars)
        var i = 0
        while i + 1 < scalars.count {
            let v1 = scalars[i].value
            let v2 = scalars[i + 1].value
            if v1 >= 0x1f1e6 && v1 <= 0x1f1ff && v2 >= 0x1f1e6 && v2 <= 0x1f1ff {
                let c1 = Character(UnicodeScalar(v1 - 0x1f1e6 + 65)!)
                let c2 = Character(UnicodeScalar(v2 - 0x1f1e6 + 65)!)
                add(flags["\(c1)\(c2)"])
                i += 2
                continue
            }
            i += 1
        }
        let stripped = release.replacingOccurrences(of: title, with: "")
        var allTags = stripped.split(whereSeparator: { !$0.isLetter || !$0.isASCII }).map(String.init)
        if let regex = try? NSRegularExpression(pattern: #"(?:2160p|1080p|720p|480p|\b4k\b)"#, options: .caseInsensitive) {
            let matches = regex.matches(in: title, range: NSRange(title.startIndex..., in: title))
            if let first = matches.first, let end = Range(first.range, in: title)?.upperBound {
                let tail = String(title[end...])
                allTags.append(contentsOf: tail.split(whereSeparator: { !$0.isLetter || !$0.isASCII }).map(String.init))
            }
        }
        for rawTag in allTags {
            let code = rawTag.lowercased()
            if code.isEmpty { continue }
            let mapped = names[code] ?? legacy[code] ?? (isoValues.contains(code) ? code : nil)
            add(mapped)
        }
        return result
    }

    static func runtimeSeconds(_ value: String?) -> Double? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let hours = firstNumber(in: value, pattern: #"(\d+(?:\.\d+)?)\s*h"#) ?? 0
        let mins = firstNumber(in: value, pattern: #"(\d+(?:\.\d+)?)\s*m"#)
            ?? (value.trimmingCharacters(in: .whitespaces).range(of: #"^\d+$"#, options: .regularExpression) != nil
                ? Double(value.trimmingCharacters(in: .whitespaces)) ?? 0 : 0)
        let total = hours * 60 + mins
        return total > 0 ? total * 60 : nil
    }

    static func qualityCap(_ quality: String) -> Int {
        switch quality {
        case "original": return Int.max
        case "saver": return 720
        default: return Int(quality) ?? Int.max
        }
    }

    static func supportsVersion(_ version: VersionInfo, filename: String, client: PlaybackClient?) -> Bool {
        guard let client else { return true }
        if let h = version.height, h > (client.maxHeight ?? Int.max) { return false }
        let mpv = client.player == "mpv"
        let avplayer = client.player == "avplayer"
        let exoplayer = client.player == "exoplayer"
        if version.codec == "hevc" && !(client.hevc ?? (mpv || avplayer)) { return false }
        if version.hdr != nil && !(client.hdr ?? mpv) { return false }
        if filename.range(of: #"\.mkv\b"#, options: [.regularExpression, .caseInsensitive]) != nil &&
            !(client.mkv ?? (mpv || exoplayer)) {
            return false
        }
        let codec = version.codec ?? ""
        if avplayer && (["av1", "vp9", "vp8"].contains(codec) ||
            filename.range(of: #"\.(?:webm|avi)\b"#, options: [.regularExpression, .caseInsensitive]) != nil) {
            return false
        }
        if client.player == "roku" && (["av1", "vp9", "vp8"].contains(codec) ||
            filename.range(of: #"\.(?:webm|avi|mov)\b"#, options: [.regularExpression, .caseInsensitive]) != nil) {
            return false
        }
        return true
    }

    static func describeVersion(_ stream: RdStream, seconds: Double?) -> VersionInfo {
        let release = stream.details.isEmpty ? "\(stream.name) \(stream.title)".trimmingCharacters(in: .whitespaces) : stream.details
        let height: Int?
        if matches(release, #"\b(?:4k|uhd|2160p)\b"#) {
            height = 2160
        } else if let h = firstCapture(in: release, pattern: #"\b(1440|1080|720|576|480|360)[pi]\b"#).flatMap(Int.init) {
            height = h
        } else {
            height = nil
        }
        let hdr: String?
        if matches(release, #"\b(?:dv|dovi|dolby[ ._-]?vision)\b"#) { hdr = "dv" }
        else if matches(release, #"\bhdr10(?:\+|plus)"#) { hdr = "hdr10+" }
        else if matches(release, #"\bhlg\b"#) { hdr = "hlg" }
        else if matches(release, #"\bhdr(?:10)?\b"#) { hdr = "hdr10" }
        else { hdr = nil }

        let source: String
        if matches(release, #"\bremux\b"#) { source = "remux" }
        else if matches(release, #"\b(?:blu[ ._-]?ray|bdrip|brrip)\b"#) { source = "bluray" }
        else if matches(release, #"\bweb[ ._-]?dl\b"#) { source = "web-dl" }
        else if matches(release, #"\bweb[ ._-]?rip\b"#) { source = "webrip" }
        else if matches(release, #"\bhdtv\b"#) { source = "hdtv" }
        else { source = "other" }

        let codec: String?
        if matches(release, #"\b(?:hevc|[xh][ ._-]?265)\b"#) { codec = "hevc" }
        else if matches(release, #"\b(?:avc|[xh][ ._-]?264)\b"#) { codec = "h264" }
        else if matches(release, #"\bav1\b"#) { codec = "av1" }
        else if matches(release, #"\bvp9\b"#) { codec = "vp9" }
        else if matches(release, #"\bvp8\b"#) { codec = "vp8" }
        else { codec = nil }

        let rawAudio = firstCapture(in: release, pattern: #"\b(true[ ._-]?hd|dts[ ._-]?hd(?:[ ._-]?ma)?|dts[ ._-]?x|dts|ddp|eac3|dd\+|aac|ac3|flac|opus)(?=\b|\d)"#)
        let audio = VersionAudio(
            codec: rawAudio?.lowercased().replacingOccurrences(of: " ", with: "-").replacingOccurrences(of: ".", with: "-").replacingOccurrences(of: "_", with: "-"),
            channels: firstCapture(in: release, pattern: #"\b([257]\.1|2\.0|1\.0)\b"#),
            atmos: matches(release, #"\batmos\b"#)
        )

        var sizeBytes: Int64? = nil
        if let regex = try? NSRegularExpression(pattern: #"\b(\d+(?:[.,]\d+)?)\s*([kmgt])(?:i)?b\b"#, options: .caseInsensitive),
           let m = regex.firstMatch(in: release, range: NSRange(release.startIndex..., in: release)),
           let rNum = Range(m.range(at: 1), in: release),
           let rUnit = Range(m.range(at: 2), in: release),
           let raw = Double(release[rNum].replacingOccurrences(of: ",", with: ".")) {
            let unit = release[rUnit].lowercased()
            let mult: [String: Double] = ["k": 1024, "m": 1024 * 1024, "g": 1024 * 1024 * 1024, "t": 1024 * 1024 * 1024 * 1024]
            if let factor = mult[unit] { sizeBytes = Int64((raw * factor).rounded()) }
        }
        let bitrateMbps: Double?
        if let sizeBytes, let seconds, seconds > 0 {
            bitrateMbps = (Double(sizeBytes) * 80.0 / seconds / 1_000_000.0).rounded() / 10.0
        } else {
            bitrateMbps = nil
        }

        let hdrLabel = hdr == "dv" ? "Dolby Vision" : hdr?.uppercased()
        var parts: [String] = []
        if let height { parts.append(height == 2160 ? "4K" : "\(height)p") }
        if let hdrLabel { parts.append(hdrLabel) }
        if let srcLbl = sourceLabel[source], !srcLbl.isEmpty { parts.append(srcLbl) }
        if let bitrateMbps { parts.append("\(bitrateMbps) Mb/s") }
        let label = parts.isEmpty ? stream.title : parts.joined(separator: " \u{00b7} ")

        let cleanUrl = stream.url.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let scrubbedUrl: String
        if let rRegex = try? NSRegularExpression(pattern: "realdebrid=[^/]+", options: .caseInsensitive) {
            scrubbedUrl = rRegex.stringByReplacingMatches(in: cleanUrl, range: NSRange(cleanUrl.startIndex..., in: cleanUrl), withTemplate: "realdebrid")
        } else {
            scrubbedUrl = cleanUrl
        }
        let keyTail = stream.releaseId ?? scrubbedUrl
        let id = hashId(title: stream.title, release: release, keyTail: keyTail)
        return VersionInfo(
            id: id,
            label: label,
            height: height,
            hdr: hdr,
            source: source,
            codec: codec,
            sizeBytes: sizeBytes,
            bitrateMbps: bitrateMbps,
            audio: audio,
            languages: releaseLanguages(release, title: stream.title),
            upscaled: matches(release, upscaledPattern),
            cached: stream.cached,
            recommended: false
        )
    }

    static func rankVersions(
        _ streams: [RdStream],
        prefs: TVMPrefs,
        originalLanguage: String?,
        runtime: Double?,
        maxHeight: Int,
        client: PlaybackClient? = nil
    ) -> [RankedVersion] {
        let cap = min(maxHeight, client?.maxHeight ?? Int.max, qualityCap(prefs.quality))
        let preferred = prefs.audioLanguage == "original" ? originalLanguage : languageCode(prefs.audioLanguage)
        func match(_ v: VersionInfo) -> Int {
            guard let preferred else { return 0 }
            return v.languages.contains(preferred) ? 1 : 0
        }
        var seen = Set<String>()
        var eligible: [RankedVersion] = []
        for stream in streams {
            let combinedTitle = "\(stream.name) \(stream.title)"
            if matches(stream.title, poorReleasePattern) || matches(combinedTitle, poorReleasePattern) ||
                matches(stream.url, #"\.m3u8(?:\?|$)"#) {
                continue
            }
            let v = describeVersion(stream, seconds: runtime)
            if (v.height ?? 1080) > cap || (v.upscaled && (prefs.skipUpscaled || prefs.quality == "original")) { continue }
            if !supportsVersion(v, filename: "\(stream.title) \(stream.url)", client: client) { continue }
            if let originalLanguage, prefs.audioLanguage == "original",
               (!v.languages.isEmpty && !v.languages.contains(originalLanguage)) ||
                (v.languages.isEmpty && matches(combinedTitle, #"\b(?:dub(?:bed)?|fandub)\b"#) && !matches(combinedTitle, #"\b(?:dual|multi)\b"#)) {
                continue
            }
            if seen.insert(v.id).inserted {
                eligible.append(RankedVersion(stream: stream, version: v))
            }
        }
        eligible.sort { left, right in
            let a = left.version
            let b = right.version
            let ma = match(a), mb = match(b)
            if ma != mb { return mb < ma }
            if prefs.quality == "saver" {
                let sa = a.sizeBytes ?? Int64.max
                let sb = b.sizeBytes ?? Int64.max
                if sa != sb { return sa < sb }
                let ha = a.height ?? 1080
                let hb = b.height ?? 1080
                if ha != hb { return ha < hb }
            } else {
                let ha = a.height ?? 1080
                let hb = b.height ?? 1080
                if ha != hb { return hb < ha }
                let sa = sourceRank[a.source] ?? 0
                let sb = sourceRank[b.source] ?? 0
                if sa != sb { return sb < sa }
                let ba = a.bitrateMbps ?? (a.sizeBytes.map { Double($0) } ?? 0)
                let bb = b.bitrateMbps ?? (b.sizeBytes.map { Double($0) } ?? 0)
                if ba != bb { return bb < ba }
            }
            if a.cached != b.cached { return b.cached && !a.cached }
            return false
        }
        if !eligible.isEmpty { eligible[0].version.recommended = true }
        return eligible
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func firstCapture(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    private static func firstNumber(in text: String, pattern: String) -> Double? {
        firstCapture(in: text, pattern: pattern).flatMap(Double.init)
    }

    private static func hashId(title: String, release: String, keyTail: String) -> String {
        var data = Data(title.utf8)
        data.append(0)
        data.append(contentsOf: release.utf8)
        data.append(0)
        data.append(contentsOf: keyTail.utf8)
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { raw in
            _ = CC_SHA256(raw.baseAddress, CC_LONG(data.count), &digest)
        }
        return digest.prefix(12).map { String(format: "%02x", $0) }.joined()
    }
}
