import Foundation

/// Whether a file is the episode (or film) that was asked for.
///
/// Ported from Android (TvmEpisodeMatch.kt). Every South Park episode played
/// the same Season 1 Episode 1 commentary edition, because two places took
/// "some file of this show" for "this episode":
///  - the library lookup used any copy of the show in the person's
///    Real-Debrid library, and inside a season pack fell back to its first file;
///  - a source whose own link did not resolve was added whole, every file
///    selected, and its first file played. The first file of a series pack is
///    S01E01 (in South Park's "…Movie and Extras" packs, a commentary edition),
///    and the pack then stayed in the library, so every later episode matched it.
/// Files are now chosen by their own season and episode numbers, a file
/// numbered as another episode is never played, extras (commentary editions,
/// featurettes, samples) are never taken for the episode itself, and when
/// nothing fits the request fails instead of playing something else.
enum TVMEpisodeMatch {
    enum Fit: Equatable { case match, unknown, wrong }

    struct File: Equatable {
        let id: Int
        let path: String
        let bytes: Int64
    }

    // Words that are also real titles (Extras, The Interview, Trailer Park
    // Boys, Bonus Family) are left out on purpose.
    private static let extras = #"\b(commentary|commentaries|featurettes?|behind[ ._-]the[ ._-]scenes|deleted[ ._-]scenes|gag[ ._-]reel|bloopers)\b|[ ._-]sample\.[a-z0-9]{2,4}$"#
    private static let video = #"\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|mpg|mpeg|wmv)$"#

    /// A commentary edition, featurette, sample or other bonus material.
    static func isExtra(_ name: String) -> Bool {
        name.range(of: extras, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func isVideo(_ path: String) -> Bool {
        path.range(of: video, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The season and episode a file's own name states, if it states one.
    /// Only the file's own name: a folder called "Season 1" says nothing about the file.
    static func episodeOf(_ name: String) -> (season: Int, episode: Int)? {
        let leaf = name.split(separator: "/").last.map(String.init) ?? name
        for pattern in [#"\bS(\d{1,2})[\s._-]*E(\d{1,3})\b"#, #"\b(\d{1,2})x(\d{1,3})\b"#] {
            if let pair = numbers(in: leaf, pattern: pattern) { return pair }
        }
        if let pair = numbers(in: leaf, pattern: #"\bseason[ ._-]*(\d{1,2})\b.*?\bepisode[ ._-]*(\d{1,3})\b"#) { return pair }
        return nil
    }

    private static func numbers(in text: String, pattern: String) -> (season: Int, episode: Int)? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges >= 3,
              let a = Range(match.range(at: 1), in: text), let b = Range(match.range(at: 2), in: text),
              let season = Int(text[a]), let episode = Int(text[b]), season > 0, episode > 0 else { return nil }
        return (season, episode)
    }

    /// How a file name fits the request. For an episode: match when it names
    /// that episode, wrong when it names another one or is an extra, unknown
    /// when it names none. For a film: wrong for an extra or an episode file.
    static func fit(_ name: String, season: Int?, episode: Int?) -> Fit {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .unknown }
        // The whole path: a pack keeps commentary editions in their own folder.
        if isExtra(name) { return .wrong }
        let stated = episodeOf(name)
        guard let season, let episode else { return stated == nil ? .unknown : .wrong }
        guard let stated else { return .unknown }
        return stated.season == season && stated.episode == episode ? .match : .wrong
    }

    /// The file a search result points at, from its description: Torrentio
    /// writes the torrent's name, then (for a pack) the file's own name, then
    /// seeds and size. The line naming a video file is the file; otherwise
    /// the first line (a single-file torrent is named after its file).
    static func sourceFile(_ description: String) -> String {
        let lines = description.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return lines.last(where: { isVideo($0) }) ?? lines.first ?? ""
    }

    /// The one file of a torrent to fetch. An episode needs a video file named
    /// as that episode (the file the search result pointed at first), else the
    /// pointed file when its name says nothing either way. A film takes the
    /// pointed file, or else the largest video that is not an extra.
    /// Torrentio's fileIdx is 0-based; Real-Debrid's file ids start at 1.
    static func pickFile(_ files: [File], season: Int?, episode: Int?, fileIdx: Int?) -> File? {
        let videos = files.filter { isVideo($0.path) }
        if videos.isEmpty { return nil }
        let pointed = fileIdx.flatMap { idx in videos.first { $0.id == idx + 1 } }
        if let season, let episode {
            if let pointed, fit(pointed.path, season: season, episode: episode) == .match { return pointed }
            if let best = videos.filter({ fit($0.path, season: season, episode: episode) == .match }).max(by: { $0.bytes < $1.bytes }) {
                return best
            }
            // Torrentio matched this file to the episode itself; its name just does not number it.
            if let pointed, fit(pointed.path, season: season, episode: episode) == .unknown { return pointed }
            return nil
        }
        if let pointed, fit(pointed.path, season: nil, episode: nil) != .wrong { return pointed }
        return videos.filter { fit($0.path, season: nil, episode: nil) != .wrong }.max(by: { $0.bytes < $1.bytes })
    }
}
