package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/**
 * Plans, entitlements, billing and the developer unlock.
 *
 * Direct port of apps/ios/TVM/TVMPlans.swift. Both clients answer the same
 * `apps/ui` interface, so every key, default and ordering here matches the
 * Swift exactly.
 */

private val ISO_INSTANT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)

private fun isoNow(): String = ZonedDateTime.now(ZoneOffset.UTC).format(ISO_INSTANT)

fun formatGbp(pence: Int): String =
    if (pence == 0) "Free" else String.format(Locale.US, "£%.2f", pence / 100.0)

/**
 * The slice of TVMStore this module needs. Keeping it narrow lets the plans
 * logic stay free of Android APIs and testable against a plain directory.
 */
interface TvmPlansStore {
    fun readJson(name: String): Any?
    fun writeJson(name: String, value: Any)
}

/** Plain-directory implementation, mirroring TVMStore's readJSON/writeJSON. */
class TvmPlansFileStore(private val root: File) : TvmPlansStore {
    override fun readJson(name: String): Any? {
        val file = File(root, name)
        if (!file.isFile) return null
        val text = runCatching { file.readText(Charsets.UTF_8) }.getOrNull() ?: return null
        return runCatching { JSONTokener(text).nextValue() }.getOrNull()
    }

    override fun writeJson(name: String, value: Any) {
        val file = File(root, name)
        runCatching { file.parentFile?.mkdirs() }
        val text = value.toString()
        // Swift writes with .atomic; rename-over keeps a half-written plan or
        // receipt file from ever being read back.
        val temp = File(file.parentFile, file.name + ".tmp")
        val written = runCatching {
            temp.writeText(text, Charsets.UTF_8)
            if (!temp.renameTo(file)) {
                file.delete()
                if (!temp.renameTo(file)) throw IllegalStateException("rename failed")
            }
        }.isSuccess
        if (!written) {
            runCatching { temp.delete() }
            runCatching { file.writeText(text, Charsets.UTF_8) }
        }
    }
}

data class PlanDefinition(
    val id: String,
    val name: String,
    val basePricePence: Int,
    val liveTvAddonPence: Int,
    val mocks: Boolean,
    val liveTv: Boolean,
    val ads: Boolean,
    val stream: String,
    val maxHeight: Int,
    val queueMs: Int,
    val queueSkipToTop: Boolean,
    val startDelayMs: Int,
    val weeklySeconds: Int?,
    val profilesMax: Int,
    val skipRecap: Boolean,
    val extras: List<String>,
    val badges: List<String>,
) {
    fun catalogJson(): JSONObject {
        return Json.obj(
            "id" to id,
            "name" to name,
            "price" to formatGbp(basePricePence),
            "pricePence" to basePricePence,
            "basePrice" to formatGbp(basePricePence),
            "basePricePence" to basePricePence,
            "liveTvAddonPence" to liveTvAddonPence,
            "mocks" to mocks,
            "liveTv" to false,
            "extras" to JSONArray(extras),
        )
    }
}

data class StyleSpec(val id: String, val name: String, val minPlan: String) {
    fun json(): JSONObject = Json.obj("id" to id, "name" to name, "minPlan" to minPlan)
}

class TvmPlans(private val store: TvmPlansStore) {

    constructor(root: File) : this(TvmPlansFileStore(root))

    private var developerUnlocked: Boolean = false

    private val ranks: List<String> = listOf("free", "basic", "premium", "ultra", "max")

    private val styles: List<StyleSpec> = listOf(
        StyleSpec(id = "classic", name = "Classic", minPlan = "premium"),
        StyleSpec(id = "cinema", name = "Cinema", minPlan = "premium"),
        StyleSpec(id = "midnight", name = "Midnight", minPlan = "premium"),
        StyleSpec(id = "ember", name = "Ember", minPlan = "ultra"),
        StyleSpec(id = "forest", name = "Forest", minPlan = "ultra"),
        StyleSpec(id = "slate", name = "Slate", minPlan = "ultra"),
        StyleSpec(id = "contrast", name = "High contrast", minPlan = "ultra"),
        StyleSpec(id = "gold", name = "MAX Gold", minPlan = "max"),
        StyleSpec(id = "aurora", name = "Aurora", minPlan = "max"),
    )

    private val catalog: List<PlanDefinition> = listOf(
        PlanDefinition(
            id = "free", name = "TVM Free", basePricePence = 0, liveTvAddonPence = 0,
            mocks = false, liveTv = false, ads = true, stream = "basic", maxHeight = 720,
            queueMs = 28_000, queueSkipToTop = false, startDelayMs = 2500,
            weeklySeconds = 12 * 60 * 60, profilesMax = 1, skipRecap = false,
            extras = listOf(
                "TVM Stream only",
                "Shared Real-Debrid pool when you add it",
                "Ads do not use watch hours",
            ),
            badges = emptyList(),
        ),
        PlanDefinition(
            id = "basic", name = "TVM Basic", basePricePence = 499, liveTvAddonPence = 3999,
            mocks = false, liveTv = false, ads = true, stream = "basic", maxHeight = 1080,
            queueMs = 3500, queueSkipToTop = true, startDelayMs = 4000,
            weeklySeconds = null, profilesMax = 2, skipRecap = false,
            extras = listOf(
                "Live TV available separately",
                "Always skipped to the top of the queue",
                "Two TVM Stream profiles",
            ),
            badges = listOf("Live"),
        ),
        PlanDefinition(
            id = "premium", name = "TVM Premium", basePricePence = 899, liveTvAddonPence = 3999,
            mocks = false, liveTv = false, ads = false, stream = "premium", maxHeight = 1080,
            queueMs = 0, queueSkipToTop = false, startDelayMs = 1200,
            weeklySeconds = null, profilesMax = 4, skipRecap = false,
            extras = listOf(
                "Live TV available separately",
                "No ads",
                "No queue",
                "Cinema, Midnight and Classic styles",
                "Four profiles",
            ),
            badges = listOf("Live"),
        ),
        PlanDefinition(
            id = "ultra", name = "TVM Ultra", basePricePence = 1299, liveTvAddonPence = 3999,
            mocks = true, liveTv = false, ads = false, stream = "premium", maxHeight = 2160,
            queueMs = 0, queueSkipToTop = false, startDelayMs = 400,
            weeklySeconds = null, profilesMax = 6, skipRecap = true,
            extras = listOf(
                "Live TV available separately",
                "Mock Netflix, Prime Video, Max, Apple TV, Disney+, Hulu and Peacock",
                "4K",
                "Skip recap",
                "Six profiles",
            ),
            badges = listOf("4K", "Dolby", "Live"),
        ),
        PlanDefinition(
            id = "max", name = "TVM MAX", basePricePence = 1599, liveTvAddonPence = 3999,
            mocks = true, liveTv = false, ads = false, stream = "luxury", maxHeight = 2160,
            queueMs = 0, queueSkipToTop = false, startDelayMs = 0,
            weeklySeconds = null, profilesMax = 10, skipRecap = true,
            extras = listOf(
                "Live TV available separately",
                "Lightning-fast start",
                "Every style, including MAX Gold and Aurora",
                "Mock streaming services",
                "10 profiles",
            ),
            badges = listOf("4K", "HDR", "Atmos", "Live"),
        ),
    )

    fun developer(): Boolean = developerUnlocked

    fun mobileAllowed(): Boolean {
        val current = status()
        val id = current.opt("id") as? String ?: ""
        return id in MOBILE_PLANS && (Json.int(current.opt("maxHeight")) ?: 0) >= 1080
    }

    fun setDeveloper(value: Boolean) {
        developerUnlocked = value
    }

    fun maxHeight(): Int = Json.int(status().opt("maxHeight")) ?: 720

    fun profilesMax(): Int = Json.int(status().opt("profilesMax")) ?: 1

    fun hoursBlocked(): Boolean {
        val remaining = Json.int(status().opt("weeklyRemainingSeconds")) ?: return false
        return remaining <= 0
    }

    fun status(): JSONObject {
        val entitlement = readEntitlement()
        val plan = definition(entitlement.id)
        val liveTv = liveIncluded(plan, entitlement.liveTvAddon)
        val synthwaveOwned = entitlement.synthwaveAddon || entitlement.themeBundle
        val charged = plan.basePricePence
        val used = readUsage()
        val remaining = plan.weeklySeconds?.let { maxOf(0, it - used) }
        val styleIds = stylesFor(entitlement.id)
        val styleId = if (styleIds.contains(entitlement.styleId)) {
            entitlement.styleId
        } else {
            styleIds.firstOrNull() ?: "classic"
        }
        val extras = plan.extras.filter { it != LIVE_EXTRA && it != "Live TV available separately" && it != RETRO_EXTRA }.toMutableList()
        if (synthwaveOwned) extras.add(0, RETRO_EXTRA)
        if (liveTv) extras.add(0, LIVE_EXTRA)
        val badges = plan.badges.filter { it != "Live" }.toMutableList()
        if (liveTv) badges.add("Live")
        return Json.obj(
            "id" to plan.id,
            "name" to plan.name,
            "price" to formatGbp(charged),
            "pricePence" to charged,
            "basePrice" to formatGbp(plan.basePricePence),
            "basePricePence" to plan.basePricePence,
            "liveTvAddonPence" to plan.liveTvAddonPence,
            "liveTvOptional" to (plan.liveTvAddonPence > 0),
            "synthwave" to (developerUnlocked || synthwaveOwned),
            "synthwaveOwned" to synthwaveOwned,
            "synthwaveAddonPence" to 499,
            "anime" to (developerUnlocked || entitlement.animeAddon || entitlement.themeBundle),
            "animeOwned" to (entitlement.animeAddon || entitlement.themeBundle),
            "bundle" to (developerUnlocked || entitlement.themeBundle),
            "bundleOwned" to entitlement.themeBundle,
            "animeAddonPence" to 499,
            "themeBundlePence" to 999,
            "mocks" to plan.mocks,
            "liveTv" to liveTv,
            "liveTvTerm" to entitlement.liveTvTerm,
            "liveTvExpiresAt" to entitlement.liveTvExpiresAt,
            "liveTvTerms" to Json.array(
                listOf(
                    Json.obj("id" to "quarter", "name" to "3-month", "usdCents" to 3999, "amountPence" to 3999, "interval" to "month", "intervalCount" to 3, "blurb" to "Billed every 3 months"),
                    Json.obj("id" to "year", "name" to "1-year", "usdCents" to 8999, "amountPence" to 8999, "interval" to "year", "intervalCount" to 1, "blurb" to "Billed once per year"),
                    Json.obj("id" to "lifetime", "name" to "Lifetime", "usdCents" to 59900, "amountPence" to 59900, "interval" to null, "intervalCount" to 0, "blurb" to "One payment; access lasts only while the service stays online"),
                )
            ),
            "ads" to plan.ads,
            "stream" to plan.stream,
            "maxHeight" to plan.maxHeight,
            "queueMs" to plan.queueMs,
            "queueSkipToTop" to plan.queueSkipToTop,
            "startDelayMs" to plan.startDelayMs,
            "weeklySeconds" to plan.weeklySeconds,
            "weeklyUsedSeconds" to used,
            "weeklyRemainingSeconds" to remaining,
            "profilesMax" to plan.profilesMax,
            "skipRecap" to plan.skipRecap,
            "extras" to JSONArray(extras),
            "badges" to JSONArray(badges),
            "styleIds" to JSONArray(styleIds),
            "styleId" to styleId,
            "developer" to developerUnlocked,
            "catalog" to Json.array(catalog.map { it.catalogJson() }),
            "styles" to Json.array(styles.map { it.json() }),
        )
    }

    fun setPlan(id: String): JSONObject {
        if (!ranks.contains(id)) throw ClientException("unknown_plan")
        val entitlement = readEntitlement()
        writeEntitlement(
            entitlement.copy(
                id = id,
                source = "dev",
                styleId = clampStyle(id, entitlement.styleId),
                liveTvAddon = null,
            )
        )
        return status()
    }

    fun setStyle(id: String): JSONObject {
        val allowed = if (developerUnlocked) styles.map { it.id } else stylesFor(readEntitlement().id)
        if (!allowed.contains(id)) throw ClientException("That style is locked on this plan.")
        val entitlement = readEntitlement()
        writeEntitlement(entitlement.copy(styleId = id))
        return status()
    }

    fun setLiveTv(enabled: Boolean): JSONObject {
        val plan = definition(readEntitlement().id)
        if (plan.liveTvAddonPence <= 0) throw ClientException("Live TV is a paid add-on from Basic up.")
        if (enabled) throw ClientException("Choose a Live TV plan at checkout: 3-month, 1-year, or lifetime.")
        val entitlement = readEntitlement()
        writeEntitlement(entitlement.copy(liveTvAddon = false, liveTvTerm = null, liveTvExpiresAt = null))
        return status()
    }

    fun setSynthwave(enabled: Boolean): JSONObject {
        val entitlement = readEntitlement()
        if (enabled && !developerUnlocked && entitlement.source != "checkout" && entitlement.source != "dev") {
            throw ClientException("Retro is a paid pack. Open Plans to buy it.")
        }
        writeEntitlement(entitlement.copy(synthwaveAddon = enabled))
        return status()
    }

    fun checkout(body: JSONObject): JSONObject {
        val simulate = body.opt("simulate") as? String
        if (simulate == "decline") {
            throw ClientException("Payment declined. Your plan has not changed.")
        }
        if (simulate == "cancel") {
            throw ClientException("Checkout cancelled. Your plan has not changed.")
        }
        val planId = body.opt("planId") as? String
        if (planId == null || !ranks.contains(planId)) throw ClientException("unknown_plan")
        var entitlement = readEntitlement()
        val packOnly = (body.opt("packOnly") as? Boolean) == true
        val plan = definition(if (packOnly) entitlement.id else planId)
        val explicitLive = body.opt("liveTv") as? Boolean
        val liveTermRaw = body.opt("liveTvTerm") as? String
        var liveTvTerm: String? = null
        var liveAmount = 0
        val includeLive: Boolean = when {
            packOnly -> liveIncluded(plan, entitlement.liveTvAddon).also { if (it) liveTvTerm = entitlement.liveTvTerm }
            liveTermRaw != null && liveTermRaw in listOf("quarter", "year", "lifetime") -> {
                liveTvTerm = liveTermRaw
                liveAmount = if (liveTermRaw == "quarter") 3999 else if (liveTermRaw == "year") 8999 else 59900
                plan.liveTvAddonPence > 0
            }
            explicitLive == true -> {
                liveTvTerm = "quarter"
                liveAmount = 3999
                plan.liveTvAddonPence > 0
            }
            else -> false
        }
        val pack = body.opt("pack") as? String
        if (pack != null && !PACKS.contains(pack)) throw ClientException("Unknown theme pack.")
        val includeBundle = pack == "theme-bundle"
        val includeAnime = includeBundle || pack == "anime"
        val includeSynthwave = includeBundle || pack == "synthwave" ||
            (body.opt("synthwave") as? Boolean) == true
        // Priced against what is already owned, before this order is applied.
        val packOneTime: Int = when {
            entitlement.themeBundle -> 0
            includeBundle -> 999
            else -> (if (includeAnime && !entitlement.animeAddon) 499 else 0) +
                (if (includeSynthwave && !entitlement.synthwaveAddon) 499 else 0)
        }
        val liveLifetime = if (!packOnly && includeLive && liveTvTerm == "lifetime") liveAmount else 0
        val oneTime = packOneTime + liveLifetime
        val quoted = Json.int(body.opt("quotedOneTimePence"))
        if (quoted != null && quoted != oneTime) throw ClientException("The order has changed. Reopen checkout.")
        if (includeBundle) entitlement = entitlement.copy(themeBundle = true)
        if (includeAnime) entitlement = entitlement.copy(animeAddon = true)
        entitlement = entitlement.copy(
            id = plan.id,
            source = if (plan.id == "free" && !includeSynthwave && !includeAnime && !includeLive) "free" else "checkout",
            styleId = clampStyle(plan.id, entitlement.styleId),
            liveTvAddon = includeLive,
            liveTvTerm = if (includeLive) liveTvTerm else null,
        )
        if (includeSynthwave) entitlement = entitlement.copy(synthwaveAddon = true)
        writeEntitlement(entitlement)
        var last4: String? = null
        val number = body.opt("number") as? String
        if (number != null) {
            val digits = number.filter { it.isDigit() }
            if (digits.length >= 4) last4 = digits.substring(digits.length - 4)
        }
        val monthly = if (packOnly) 0 else plan.basePricePence
        val liveRecurring = if (!packOnly && includeLive && liveTvTerm != "lifetime") liveAmount else 0
        val receipt = Json.obj(
            "id" to "PAY-" + UUID.randomUUID().toString().uppercase(Locale.US),
            "planId" to plan.id,
            "mode" to "test",
            "event" to "checkout",
            "currency" to "GBP",
            "monthlyPence" to monthly,
            "oneTimePence" to oneTime,
            "chargedPence" to monthly + liveRecurring + oneTime,
            "liveTv" to includeLive,
            "liveTvTerm" to liveTvTerm,
            "animePurchased" to includeAnime,
            "bundlePurchased" to includeBundle,
            "synthwavePurchased" to includeSynthwave,
            "at" to isoNow(),
            "last4" to last4,
        )
        val previous = readReceipts()
        val receipts = JSONArray()
        receipts.put(receipt)
        for (index in 0 until previous.length()) receipts.put(previous.opt(index))
        store.writeJson("billing.json", Json.obj("receipts" to receipts, "last4" to (last4 ?: "")))
        return status()
    }

    fun cancel(): JSONObject {
        val entitlement = readEntitlement()
        writeEntitlement(
            entitlement.copy(
                id = "free",
                source = "free",
                styleId = "classic",
                liveTvAddon = false,
            )
        )
        return status()
    }

    fun billing(): JSONObject {
        val current = status()
        val receipts = readReceipts()
        val last4 = (store.readJson("billing.json") as? JSONObject)?.opt("last4") as? String
        val payment: Any = if (last4 != null && last4.length == 4) {
            Json.obj(
                "tokenId" to "card",
                "last4" to last4,
                "brand" to "card",
                "expiry" to "",
                "name" to "",
            )
        } else {
            JSONObject.NULL
        }
        return Json.obj(
            "mode" to "test",
            "livePaymentsEnabled" to false,
            "currency" to "GBP",
            "subscription" to if ((current.opt("id") as? String) == "free") "free" else "active",
            "monthlyPence" to (current.opt("pricePence") ?: 0),
            "nextChargeAt" to null,
            "anime" to (current.opt("anime") ?: false),
            "bundle" to (current.opt("bundle") ?: false),
            "animeAddonPence" to 499,
            "themeBundlePence" to 999,
            "animeOwned" to (current.opt("animeOwned") ?: false),
            "bundleOwned" to (current.opt("bundleOwned") ?: false),
            "synthwaveOwned" to (current.opt("synthwaveOwned") ?: false),
            "receipts" to receipts,
            "processor" to Json.obj("linked" to false, "reason" to "no_processor"),
            "paymentMethod" to payment,
        )
    }

    fun charge(): JSONObject {
        val last4 = (store.readJson("billing.json") as? JSONObject)?.opt("last4") as? String
        if (last4 == null || last4.isEmpty()) {
            return Json.obj(
                "status" to "declined",
                "reason" to "missing_token",
                "code" to "missing_token",
                "chargedPence" to 0,
                "currency" to "GBP",
                "tokenId" to null,
                "last4" to null,
                "brand" to null,
                "message" to "No saved card token. Add a card at checkout first. Nothing was charged.",
            )
        }
        return Json.obj(
            "status" to "declined",
            "reason" to "no_processor",
            "code" to "not_configured",
            "chargedPence" to 0,
            "currency" to "GBP",
            "tokenId" to "card",
            "last4" to last4,
            "brand" to "card",
            "message" to "No card processor is linked on this device.",
        )
    }

    fun tickUsage(seconds: Double, billable: Boolean): JSONObject {
        if (!billable || !seconds.isFinite() || seconds <= 0) return status()
        val used = readUsage() + Math.round(seconds).toInt()
        store.writeJson("usage.json", Json.obj("seconds" to used, "weekStart" to mondayUtc()))
        return status()
    }

    fun resetUsage(): JSONObject {
        store.writeJson("usage.json", Json.obj("seconds" to 0, "weekStart" to mondayUtc()))
        return status()
    }

    private data class Entitlement(
        val id: String,
        val styleId: String,
        val source: String,
        val liveTvAddon: Boolean?,
        val liveTvTerm: String? = null,
        val liveTvExpiresAt: String? = null,
        val animeAddon: Boolean = false,
        val themeBundle: Boolean = false,
        val synthwaveAddon: Boolean,
    )

    private fun readEntitlement(): Entitlement {
        val saved = store.readJson("plan.json") as? JSONObject
        val id = saved?.opt("id") as? String
        if (saved != null && id != null && ranks.contains(id)) {
            return Entitlement(
                id = id,
                styleId = saved.opt("styleId") as? String ?: "classic",
                source = saved.opt("source") as? String ?: "free",
                liveTvAddon = saved.opt("liveTvAddon") as? Boolean,
                liveTvTerm = saved.opt("liveTvTerm") as? String,
                liveTvExpiresAt = saved.opt("liveTvExpiresAt") as? String,
                animeAddon = saved.opt("animeAddon") as? Boolean ?: false,
                themeBundle = saved.opt("themeBundle") as? Boolean ?: false,
                synthwaveAddon = saved.opt("synthwaveAddon") as? Boolean ?: false,
            )
        }
        return Entitlement(
            id = "free",
            styleId = "classic",
            source = "free",
            liveTvAddon = null,
            synthwaveAddon = false,
        )
    }

    private fun writeEntitlement(value: Entitlement) {
        val body = Json.obj(
            "id" to value.id,
            "styleId" to value.styleId,
            "source" to value.source,
            "animeAddon" to value.animeAddon,
            "themeBundle" to value.themeBundle,
            "synthwaveAddon" to value.synthwaveAddon,
        )
        // Absent means "follow the plan default"; only an explicit choice is stored.
        value.liveTvAddon?.let { body.put("liveTvAddon", it) }
        value.liveTvTerm?.let { body.put("liveTvTerm", it) }
        value.liveTvExpiresAt?.let { body.put("liveTvExpiresAt", it) }
        store.writeJson("plan.json", body)
    }

    private fun definition(id: String): PlanDefinition =
        catalog.firstOrNull { it.id == id } ?: catalog[0]

    private fun liveIncluded(plan: PlanDefinition, addon: Boolean?): Boolean {
        if (plan.liveTvAddonPence <= 0) return false
        return addon == true
    }

    private fun stylesFor(id: String): List<String> {
        val rank = ranks.indexOf(id).let { if (it < 0) 0 else it }
        return styles
            .filter { ranks.indexOf(it.minPlan).let { index -> if (index < 0) 0 else index } <= rank }
            .map { it.id }
    }

    private fun clampStyle(planId: String, styleId: String): String {
        val allowed = stylesFor(planId)
        return if (allowed.contains(styleId)) styleId else (allowed.firstOrNull() ?: "classic")
    }

    private fun readUsage(): Int =
        Json.int((store.readJson("usage.json") as? JSONObject)?.opt("seconds")) ?: 0

    /** Swift casts the whole array at once, so one bad row discards the file. */
    private fun readReceipts(): JSONArray {
        val root = store.readJson("billing.json") as? JSONObject ?: return JSONArray()
        val rows = root.opt("receipts") as? JSONArray ?: return JSONArray()
        for (index in 0 until rows.length()) {
            if (rows.opt(index) !is JSONObject) return JSONArray()
        }
        return rows
    }

    private fun mondayUtc(): String {
        val today = ZonedDateTime.now(ZoneOffset.UTC).toLocalDate()
        val monday = today.minusDays((today.dayOfWeek.value - 1).toLong())
        return String.format(
            Locale.US,
            "%04d-%02d-%02d",
            monday.year,
            monday.monthValue,
            monday.dayOfMonth,
        )
    }

    private companion object {
        const val LIVE_EXTRA = "Live TV pack and your own playlist"
        const val RETRO_EXTRA = "Retro — 1970s/80s television-set look"
        val MOBILE_PLANS: List<String> = listOf("basic", "premium", "ultra", "max")
        val PACKS: List<String> = listOf("synthwave", "anime", "theme-bundle")
    }
}
