import Foundation

struct PlanDefinition {
    var id: String
    var name: String
    var basePricePence: Int
    var liveTvAddonPence: Int
    var mocks: Bool
    var liveTv: Bool
    var ads: Bool
    var stream: String
    var maxHeight: Int
    var queueMs: Int
    var queueSkipToTop: Bool
    var startDelayMs: Int
    var weeklySeconds: Int?
    var profilesMax: Int
    var skipRecap: Bool
    var extras: [String]
    var badges: [String]

    func catalogJSON() -> [String: Any] {
        return [
            "id": id,
            "name": name,
            "price": formatGbp(basePricePence),
            "pricePence": basePricePence,
            "basePrice": formatGbp(basePricePence),
            "basePricePence": basePricePence,
            "liveTvAddonPence": liveTvAddonPence,
            "mocks": mocks,
            "liveTv": false,
            "extras": extras,
        ]
    }
}

func formatGbp(_ pence: Int) -> String {
    pence == 0 ? "Free" : String(format: "£%.2f", Double(pence) / 100)
}

struct StyleSpec {
    var id: String
    var name: String
    var minPlan: String
    func json() -> [String: Any] { ["id": id, "name": name, "minPlan": minPlan] }
}

final class TVMPlans {
    private let store: TVMStore
    private var developerUnlocked = false
    private let catalog: [PlanDefinition]
    private let styles: [StyleSpec]
    private let ranks = ["free", "basic", "premium", "ultra", "max"]

    init(store: TVMStore) {
        self.store = store
        styles = [
            StyleSpec(id: "classic", name: "Classic", minPlan: "premium"),
            StyleSpec(id: "cinema", name: "Cinema", minPlan: "premium"),
            StyleSpec(id: "midnight", name: "Midnight", minPlan: "premium"),
            StyleSpec(id: "ember", name: "Ember", minPlan: "ultra"),
            StyleSpec(id: "forest", name: "Forest", minPlan: "ultra"),
            StyleSpec(id: "slate", name: "Slate", minPlan: "ultra"),
            StyleSpec(id: "contrast", name: "High contrast", minPlan: "ultra"),
            StyleSpec(id: "gold", name: "MAX Gold", minPlan: "max"),
            StyleSpec(id: "aurora", name: "Aurora", minPlan: "max"),
        ]
        catalog = [
            PlanDefinition(id: "free", name: "TVM Free", basePricePence: 0, liveTvAddonPence: 0, mocks: false, liveTv: false, ads: true, stream: "basic", maxHeight: 720, queueMs: 28_000, queueSkipToTop: false, startDelayMs: 2500, weeklySeconds: 12 * 60 * 60, profilesMax: 1, skipRecap: false, extras: ["TVM Stream only", "Shared Real-Debrid pool when you add it", "Ads do not use watch hours"], badges: []),
            PlanDefinition(id: "basic", name: "TVM Basic", basePricePence: 499, liveTvAddonPence: 3999, mocks: false, liveTv: false, ads: true, stream: "basic", maxHeight: 1080, queueMs: 3500, queueSkipToTop: true, startDelayMs: 4000, weeklySeconds: nil, profilesMax: 2, skipRecap: false, extras: ["Live TV available separately", "Always skipped to the top of the queue", "Two TVM Stream profiles"], badges: ["Live"]),
            PlanDefinition(id: "premium", name: "TVM Premium", basePricePence: 899, liveTvAddonPence: 3999, mocks: false, liveTv: false, ads: false, stream: "premium", maxHeight: 1080, queueMs: 0, queueSkipToTop: false, startDelayMs: 1200, weeklySeconds: nil, profilesMax: 4, skipRecap: false, extras: ["Live TV available separately", "No ads", "No queue", "Cinema, Midnight and Classic styles", "Four profiles"], badges: ["Live"]),
            PlanDefinition(id: "ultra", name: "TVM Ultra", basePricePence: 1299, liveTvAddonPence: 3999, mocks: true, liveTv: false, ads: false, stream: "premium", maxHeight: 2160, queueMs: 0, queueSkipToTop: false, startDelayMs: 400, weeklySeconds: nil, profilesMax: 6, skipRecap: true, extras: ["Live TV available separately", "Mock Netflix, Prime Video, Max, Apple TV, Disney+, Hulu and Peacock", "4K", "Skip recap", "Six profiles"], badges: ["4K", "Dolby", "Live"]),
            PlanDefinition(id: "max", name: "TVM MAX", basePricePence: 1599, liveTvAddonPence: 3999, mocks: true, liveTv: false, ads: false, stream: "luxury", maxHeight: 2160, queueMs: 0, queueSkipToTop: false, startDelayMs: 0, weeklySeconds: nil, profilesMax: 10, skipRecap: true, extras: ["Live TV available separately", "Lightning-fast start", "Every style, including MAX Gold and Aurora", "Mock streaming services", "10 profiles"], badges: ["4K", "HDR", "Atmos", "Live"]),
        ]
    }

    func developer() -> Bool { developerUnlocked }
    func mobileAllowed() -> Bool {
        let current = status()
        return ["basic", "premium", "ultra", "max"].contains(current["id"] as? String ?? "") &&
            (JSONValue.int(current["maxHeight"]) ?? 0) >= 1080
    }
    func setDeveloper(_ value: Bool) { developerUnlocked = value }

    func maxHeight() -> Int { JSONValue.int(status()["maxHeight"]) ?? 720 }
    func profilesMax() -> Int { JSONValue.int(status()["profilesMax"]) ?? 1 }
    func hoursBlocked() -> Bool {
        if let remaining = JSONValue.int(status()["weeklyRemainingSeconds"]) { return remaining <= 0 }
        return false
    }

    func status() -> [String: Any] {
        let entitlement = readEntitlement()
        let plan = definition(entitlement.id)
        let liveTv = liveIncluded(plan, entitlement.liveTvAddon)
        let synthwaveOwned = entitlement.synthwaveAddon || entitlement.themeBundle
        let charged = plan.basePricePence
        let used = readUsage()
        let remaining = plan.weeklySeconds.map { max(0, $0 - used) }
        let styleIds = stylesFor(entitlement.id)
        let styleId = styleIds.contains(entitlement.styleId) ? entitlement.styleId : (styleIds.first ?? "classic")
        var extras = plan.extras.filter { $0 != "Live TV pack and your own playlist" && $0 != "Live TV available separately" && $0 != "Retro — 1970s/80s television-set look" }
        if synthwaveOwned { extras.insert("Retro — 1970s/80s television-set look", at: 0) }
        if liveTv { extras.insert("Live TV pack and your own playlist", at: 0) }
        var badges = plan.badges.filter { $0 != "Live" }
        if liveTv { badges.append("Live") }
        return [
            "id": plan.id,
            "name": plan.name,
            "price": formatGbp(charged),
            "pricePence": charged,
            "basePrice": formatGbp(plan.basePricePence),
            "basePricePence": plan.basePricePence,
            "liveTvAddonPence": plan.liveTvAddonPence,
            "liveTvOptional": plan.liveTvAddonPence > 0,
            "synthwave": developerUnlocked || synthwaveOwned,
            "synthwaveOwned": synthwaveOwned,
            "synthwaveAddonPence": 499,
            "anime": developerUnlocked || entitlement.animeAddon || entitlement.themeBundle,
            "animeOwned": entitlement.animeAddon || entitlement.themeBundle,
            "bundle": developerUnlocked || entitlement.themeBundle,
            "bundleOwned": entitlement.themeBundle,
            "animeAddonPence": 499, "themeBundlePence": 999,
            "mocks": plan.mocks,
            "liveTv": liveTv,
            "liveTvTerm": JSONValue.orNull(entitlement.liveTvTerm),
            "liveTvExpiresAt": JSONValue.orNull(entitlement.liveTvExpiresAt),
            "liveTvTerms": [
                ["id": "quarter", "name": "3-month", "usdCents": 3999, "amountPence": 3999, "interval": "month", "intervalCount": 3, "blurb": "Billed every 3 months"],
                ["id": "year", "name": "1-year", "usdCents": 8999, "amountPence": 8999, "interval": "year", "intervalCount": 1, "blurb": "Billed once per year"],
                ["id": "lifetime", "name": "Lifetime", "usdCents": 59900, "amountPence": 59900, "interval": NSNull(), "intervalCount": 0, "blurb": "One payment; access lasts only while the service stays online"],
            ],
            "ads": plan.ads,
            "stream": plan.stream,
            "maxHeight": plan.maxHeight,
            "queueMs": plan.queueMs,
            "queueSkipToTop": plan.queueSkipToTop,
            "startDelayMs": plan.startDelayMs,
            "weeklySeconds": JSONValue.orNull(plan.weeklySeconds),
            "weeklyUsedSeconds": used,
            "weeklyRemainingSeconds": JSONValue.orNull(remaining),
            "profilesMax": plan.profilesMax,
            "skipRecap": plan.skipRecap,
            "extras": extras,
            "badges": badges,
            "styleIds": styleIds,
            "styleId": styleId,
            "developer": developerUnlocked,
            "catalog": catalog.map { $0.catalogJSON() },
            "styles": styles.map { $0.json() },
        ]
    }

    func setPlan(_ id: String) throws -> [String: Any] {
        guard ranks.contains(id) else { throw ClientError.message("unknown_plan") }
        var entitlement = readEntitlement()
        entitlement.id = id
        entitlement.source = "dev"
        entitlement.styleId = clampStyle(id, entitlement.styleId)
        entitlement.liveTvAddon = nil
        writeEntitlement(entitlement)
        return status()
    }

    func setStyle(_ id: String) throws -> [String: Any] {
        let allowed = developerUnlocked ? styles.map(\.id) : stylesFor(readEntitlement().id)
        guard allowed.contains(id) else { throw ClientError.message("That style is locked on this plan.") }
        var entitlement = readEntitlement()
        entitlement.styleId = id
        writeEntitlement(entitlement)
        return status()
    }

    /**
     Applies what an activated account is entitled to.

     setLiveTv() refuses to switch Live TV on because a buyer is meant to
     pick a term at checkout, and there is no checkout. Both tiers map to
     the fullest plan and differ only by Live TV, which is the only
     difference anyone is choosing between. Recorded as lifetime with no
     expiry because it lasts exactly as long as the account stays activated.
     */
    func grantTier(_ tier: String) {
        var entitlement = readEntitlement()
        entitlement.id = "max"
        entitlement.source = "checkout"
        entitlement.styleId = clampStyle("max", entitlement.styleId)
        entitlement.liveTvAddon = tier == "stream-live"
        entitlement.liveTvTerm = tier == "stream-live" ? "lifetime" : nil
        entitlement.liveTvExpiresAt = nil
        // Both tiers promise every visual style, and nothing is sold here.
        entitlement.themeBundle = true
        entitlement.animeAddon = true
        entitlement.synthwaveAddon = true
        writeEntitlement(entitlement)
    }

    /// No usable account means no access; free is what that looks like now.
    func revokeTier() {
        var entitlement = readEntitlement()
        entitlement.id = "free"
        entitlement.source = "free"
        entitlement.liveTvAddon = false
        entitlement.liveTvTerm = nil
        entitlement.liveTvExpiresAt = nil
        writeEntitlement(entitlement)
    }

    func setLiveTv(_ enabled: Bool) throws -> [String: Any] {
        let plan = definition(readEntitlement().id)
        if plan.liveTvAddonPence <= 0 { throw ClientError.message("Live TV is a paid add-on from Basic up.") }
        if enabled { throw ClientError.message("Choose a Live TV plan at checkout: 3-month, 1-year, or lifetime.") }
        var entitlement = readEntitlement()
        entitlement.liveTvAddon = false
        entitlement.liveTvTerm = nil
        entitlement.liveTvExpiresAt = nil
        writeEntitlement(entitlement)
        return status()
    }

    func setSynthwave(_ enabled: Bool) throws -> [String: Any] {
        var entitlement = readEntitlement()
        if enabled && !developerUnlocked && entitlement.source != "checkout" && entitlement.source != "dev" {
            throw ClientError.message("Retro is a paid pack. Open Plans to buy it.")
        }
        entitlement.synthwaveAddon = enabled
        writeEntitlement(entitlement)
        return status()
    }

    func checkout(_ body: [String: Any]) throws -> [String: Any] {
        if body["simulate"] as? String == "decline" {
            throw ClientError.message("Payment declined. Your plan has not changed.")
        }
        if body["simulate"] as? String == "cancel" {
            throw ClientError.message("Checkout cancelled. Your plan has not changed.")
        }
        guard let planId = body["planId"] as? String, ranks.contains(planId) else {
            throw ClientError.message("unknown_plan")
        }
        var entitlement = readEntitlement()
        let packOnly = body["packOnly"] as? Bool == true
        let plan = definition(packOnly ? entitlement.id : planId)
        let includeLive: Bool
        var liveTvTerm: String? = nil
        var liveAmount = 0
        if packOnly {
            includeLive = liveIncluded(plan, entitlement.liveTvAddon)
            liveTvTerm = entitlement.liveTvTerm
        } else if let term = body["liveTvTerm"] as? String, ["quarter", "year", "lifetime"].contains(term) {
            includeLive = plan.liveTvAddonPence > 0
            liveTvTerm = term
            liveAmount = term == "quarter" ? 3999 : term == "year" ? 8999 : 59900
        } else if body["liveTv"] as? Bool == true {
            includeLive = plan.liveTvAddonPence > 0
            liveTvTerm = "quarter"
            liveAmount = 3999
        } else {
            includeLive = false
        }
        let pack = body["pack"] as? String
        if let pack, !["synthwave", "anime", "theme-bundle"].contains(pack) { throw ClientError.message("Unknown theme pack.") }
        let includeBundle = pack == "theme-bundle"
        let includeAnime = includeBundle || pack == "anime"
        let includeSynthwave = includeBundle || pack == "synthwave" || body["synthwave"] as? Bool == true
        let packOneTime = entitlement.themeBundle ? 0 : includeBundle ? 999 : (includeAnime && !entitlement.animeAddon ? 499 : 0) + (includeSynthwave && !entitlement.synthwaveAddon ? 499 : 0)
        let liveLifetime = (!packOnly && includeLive && liveTvTerm == "lifetime") ? liveAmount : 0
        let oneTime = packOneTime + liveLifetime
        if let quoted = body["quotedOneTimePence"] as? Int, quoted != oneTime { throw ClientError.message("The order has changed. Reopen checkout.") }
        if includeBundle { entitlement.themeBundle = true }
        if includeAnime { entitlement.animeAddon = true }
        entitlement.id = plan.id
        entitlement.source = plan.id == "free" && !includeSynthwave && !includeAnime && !includeLive ? "free" : "checkout"
        entitlement.styleId = clampStyle(plan.id, entitlement.styleId)
        entitlement.liveTvAddon = includeLive
        entitlement.liveTvTerm = includeLive ? liveTvTerm : nil
        if includeSynthwave { entitlement.synthwaveAddon = true }
        writeEntitlement(entitlement)
        var last4: String?
        if let number = body["number"] as? String {
            let digits = number.filter(\.isNumber)
            if digits.count >= 4 { last4 = String(digits.suffix(4)) }
        }
        let monthly = packOnly ? 0 : plan.basePricePence
        let liveRecurring = (!packOnly && includeLive && liveTvTerm != "lifetime") ? liveAmount : 0
        var receipts = readReceipts()
        let receipt: [String: Any] = [
            "id": "PAY-\(UUID().uuidString)",
            "planId": plan.id,
            "mode": "test",
            "event": "checkout",
            "currency": "GBP",
            "monthlyPence": monthly,
            "oneTimePence": oneTime,
            "chargedPence": monthly + liveRecurring + oneTime,
            "liveTv": includeLive,
            "liveTvTerm": JSONValue.orNull(liveTvTerm),
            "animePurchased": includeAnime, "bundlePurchased": includeBundle,
            "synthwavePurchased": includeSynthwave,
            "at": ISO8601DateFormatter().string(from: Date()),
            "last4": JSONValue.orNull(last4),
        ]
        receipts.insert(receipt, at: 0)
        store.writeJSON("billing.json", ["receipts": receipts, "last4": last4 ?? ""])
        return status()
    }

    func cancel() -> [String: Any] {
        var entitlement = readEntitlement()
        entitlement.id = "free"
        entitlement.source = "free"
        entitlement.styleId = "classic"
        entitlement.liveTvAddon = false
        writeEntitlement(entitlement)
        return status()
    }

    func billing() -> [String: Any] {
        let current = status()
        let receipts = readReceipts()
        let last4 = (store.readJSON("billing.json") as? [String: Any])?["last4"] as? String
        let payment: Any
        if let last4, last4.count == 4 {
            payment = [
                "tokenId": "card",
                "last4": last4,
                "brand": "card",
                "expiry": "",
                "name": "",
            ]
        } else {
            payment = NSNull()
        }
        return [
            "mode": "test",
            "livePaymentsEnabled": false,
            "currency": "GBP",
            "subscription": (current["id"] as? String) == "free" ? "free" : "active",
            "monthlyPence": current["pricePence"] ?? 0,
            "nextChargeAt": NSNull(),
            "anime": current["anime"] ?? false, "bundle": current["bundle"] ?? false,
            "animeAddonPence": 499, "themeBundlePence": 999,
            "animeOwned": current["animeOwned"] ?? false, "bundleOwned": current["bundleOwned"] ?? false,
            "synthwaveOwned": current["synthwaveOwned"] ?? false,
            "receipts": receipts,
            "processor": ["linked": false, "reason": "no_processor"],
            "paymentMethod": payment,
        ]
    }

    func charge() -> [String: Any] {
        let last4 = (store.readJSON("billing.json") as? [String: Any])?["last4"] as? String
        if last4 == nil || last4?.isEmpty == true {
            return [
                "status": "declined",
                "reason": "missing_token",
                "code": "missing_token",
                "chargedPence": 0,
                "currency": "GBP",
                "tokenId": NSNull(),
                "last4": NSNull(),
                "brand": NSNull(),
                "message": "No saved card token. Add a card at checkout first. Nothing was charged.",
            ]
        }
        return [
            "status": "declined",
            "reason": "no_processor",
            "code": "not_configured",
            "chargedPence": 0,
            "currency": "GBP",
            "tokenId": "card",
            "last4": JSONValue.orNull(last4),
            "brand": "card",
            "message": "No card processor is linked on this device.",
        ]
    }

    func tickUsage(_ seconds: Double, billable: Bool) -> [String: Any] {
        guard billable, seconds > 0, seconds.isFinite else { return status() }
        let used = readUsage() + Int(seconds.rounded())
        store.writeJSON("usage.json", ["seconds": used, "weekStart": mondayUtc()])
        return status()
    }

    func resetUsage() -> [String: Any] {
        store.writeJSON("usage.json", ["seconds": 0, "weekStart": mondayUtc()])
        return status()
    }

    private struct Entitlement {
        var id: String
        var styleId: String
        var source: String
        var liveTvAddon: Bool?
        var liveTvTerm: String?
        var liveTvExpiresAt: String?
        var animeAddon: Bool = false
        var themeBundle: Bool = false
        var synthwaveAddon: Bool
    }

    private func readEntitlement() -> Entitlement {
        if let object = store.readJSON("plan.json") as? [String: Any],
           let id = object["id"] as? String, ranks.contains(id) {
            return Entitlement(
                id: id,
                styleId: object["styleId"] as? String ?? "classic",
                source: object["source"] as? String ?? "free",
                liveTvAddon: object["liveTvAddon"] as? Bool,
                liveTvTerm: object["liveTvTerm"] as? String,
                liveTvExpiresAt: object["liveTvExpiresAt"] as? String,
                animeAddon: object["animeAddon"] as? Bool ?? false,
                themeBundle: object["themeBundle"] as? Bool ?? false,
                synthwaveAddon: object["synthwaveAddon"] as? Bool ?? false
            )
        }
        return Entitlement(id: "free", styleId: "classic", source: "free", liveTvAddon: nil, synthwaveAddon: false)
    }

    private func writeEntitlement(_ value: Entitlement) {
        var body: [String: Any] = [
            "id": value.id,
            "styleId": value.styleId,
            "source": value.source,
            "animeAddon": value.animeAddon, "themeBundle": value.themeBundle,
            "synthwaveAddon": value.synthwaveAddon,
        ]
        if let live = value.liveTvAddon { body["liveTvAddon"] = live }
        if let term = value.liveTvTerm { body["liveTvTerm"] = term }
        if let expiry = value.liveTvExpiresAt { body["liveTvExpiresAt"] = expiry }
        store.writeJSON("plan.json", body)
    }

    private func definition(_ id: String) -> PlanDefinition {
        catalog.first { $0.id == id } ?? catalog[0]
    }

    private func liveIncluded(_ plan: PlanDefinition, _ addon: Bool?) -> Bool {
        if plan.liveTvAddonPence <= 0 { return false }
        return addon == true
    }

    private func stylesFor(_ id: String) -> [String] {
        let rank = ranks.firstIndex(of: id) ?? 0
        return styles.filter { (ranks.firstIndex(of: $0.minPlan) ?? 0) <= rank }.map(\.id)
    }

    private func clampStyle(_ planId: String, _ styleId: String) -> String {
        let allowed = stylesFor(planId)
        return allowed.contains(styleId) ? styleId : (allowed.first ?? "classic")
    }

    private func readUsage() -> Int {
        (store.readJSON("usage.json") as? [String: Any])?["seconds"] as? Int ?? 0
    }

    private func readReceipts() -> [[String: Any]] {
        (store.readJSON("billing.json") as? [String: Any])?["receipts"] as? [[String: Any]] ?? []
    }

    private func mondayUtc() -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = Date()
        let weekday = calendar.component(.weekday, from: now)
        let offset = weekday == 1 ? -6 : 2 - weekday
        let monday = calendar.date(byAdding: .day, value: offset, to: now) ?? now
        let parts = calendar.dateComponents([.year, .month, .day], from: monday)
        return String(format: "%04d-%02d-%02d", parts.year ?? 2026, parts.month ?? 1, parts.day ?? 1)
    }
}
