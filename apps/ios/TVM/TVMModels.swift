import Foundation

enum StandalonePolicy {
    static let requiresLANToken = false
    static let bundledLANToken: String? = nil
    static let version = "0.1.0"

    enum Mode: Equatable { case onDevice, optionalHomeCore }
    static let defaultMode = Mode.onDevice

    static func localOrigin(port: UInt16) -> URL {
        URL(string: "http://127.0.0.1:\(port)/")!
    }
}

struct MediaItem: Equatable {
    var id: String
    var title: String
    var year: Int?
    var kind: String
    var synopsis: String
    var poster: String
    var backdrop: String
    var genres: [String]
    var rating: String
    var runtime: String?
    var playable: Bool
    var progress: Double?
    var filename: String?
    var hue: Int
    var mimeType: String?
    var season: Int?
    var episode: Int?
    var episodeName: String?
    var showTitle: String?
    var aired: String?
    var added: String?

    func json() -> [String: Any] {
        var body: [String: Any] = [
            "id": id,
            "title": title,
            "year": JSONValue.orNull(year),
            "kind": kind,
            "synopsis": synopsis,
            "poster": poster,
            "backdrop": backdrop,
            "genres": genres,
            "rating": rating,
            "playable": playable,
            "hue": hue,
        ]
        if let runtime { body["runtime"] = runtime }
        if let progress { body["progress"] = progress }
        if let filename { body["filename"] = filename }
        if let mimeType { body["mimeType"] = mimeType }
        if let season { body["season"] = season }
        if let episode { body["episode"] = episode }
        if let episodeName { body["episodeName"] = episodeName }
        if let showTitle { body["showTitle"] = showTitle }
        if let aired { body["aired"] = aired }
        if let added { body["added"] = added }
        return body
    }

    static func parse(_ raw: Any?) -> MediaItem? {
        guard let object = raw as? [String: Any],
              let id = object["id"] as? String, !id.isEmpty,
              let title = object["title"] as? String, !title.isEmpty else { return nil }
        let yearValue = object["year"]
        let year: Int?
        if let number = yearValue as? Int { year = number }
        else if let number = yearValue as? Double { year = Int(number) }
        else { year = nil }
        return MediaItem(
            id: id,
            title: title,
            year: year,
            kind: object["kind"] as? String ?? "movie",
            synopsis: object["synopsis"] as? String ?? "",
            poster: object["poster"] as? String ?? "",
            backdrop: object["backdrop"] as? String ?? "",
            genres: object["genres"] as? [String] ?? [],
            rating: object["rating"] as? String ?? "",
            runtime: object["runtime"] as? String,
            playable: object["playable"] as? Bool ?? true,
            progress: object["progress"] as? Double,
            filename: object["filename"] as? String,
            hue: object["hue"] as? Int ?? TVMTitle.hue(for: title),
            mimeType: object["mimeType"] as? String,
            season: object["season"] as? Int,
            episode: object["episode"] as? Int,
            episodeName: object["episodeName"] as? String,
            showTitle: object["showTitle"] as? String,
            aired: object["aired"] as? String,
            added: object["added"] as? String
        )
    }
}

struct CatalogRail {
    var id: String
    var title: String
    var items: [MediaItem]
    func json() -> [String: Any] {
        ["id": id, "title": title, "items": items.map { $0.json() }]
    }
}

struct RdStatus {
    var configured: Bool
    var username: String?
    var premium: Bool
    var error: String?
    func json() -> [String: Any] {
        [
            "configured": configured,
            "username": JSONValue.orNull(username),
            "premium": premium,
            "error": JSONValue.orNull(error),
        ]
    }
}

struct ProfileRecord: Equatable {
    var id: String
    var name: String
    var hue: Int
    var created: String
    func json() -> [String: Any] {
        ["id": id, "name": name, "hue": hue, "created": created]
    }
}

struct ProgressEntry {
    var position: Double
    var duration: Double
    var updated: String
}

enum TVMPlayback {
    static func phoneCanPlay(filename: String, mimeType: String?, url: String) -> Bool {
        let mime = mimeType?.lowercased() ?? ""
        if mime.contains("mpegurl") || mime.contains("x-mpegurl") { return true }
        if url.range(of: #"\.m3u8(\?|$)"#, options: .regularExpression) != nil { return true }
        if mime == "video/mp4" || mime == "video/quicktime" { return true }
        if url.range(of: #"\.(mp4|m4v|mov)(\?|$)"#, options: .regularExpression) != nil { return true }
        if filename.range(of: #"\.(mp4|m4v|mov|m3u8)$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return true
        }
        return false
    }

    static func needsConverter(filename: String, mimeType: String?, url: String) -> Bool {
        !phoneCanPlay(filename: filename, mimeType: mimeType, url: url)
    }
}

enum JSONValue {
    static func orNull(_ value: Any?) -> Any { value ?? NSNull() }

    static func data(_ value: Any) -> Data {
        (try? JSONSerialization.data(withJSONObject: value, options: [])) ?? Data("{}".utf8)
    }

    static func object(_ data: Data?) -> [String: Any] {
        guard let data, !data.isEmpty,
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return parsed
    }
}

struct HTTPReply {
    var status: Int
    var headers: [String: String]
    var body: Data

    static func json(_ status: Int, _ value: Any) -> HTTPReply {
        HTTPReply(
            status: status,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: JSONValue.data(value)
        )
    }

    static func bytes(_ status: Int, type: String, data: Data) -> HTTPReply {
        HTTPReply(status: status, headers: ["Content-Type": type], body: data)
    }

    static func empty(_ status: Int) -> HTTPReply {
        HTTPReply(status: status, headers: [:], body: Data())
    }
}
