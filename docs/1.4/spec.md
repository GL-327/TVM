# TVM 1.4 "Polish" — shared spec (every builder reads all of this)

The owner reviewed TVM on Windows and asked for the fixes below. Every platform gets every item unless the
item says otherwise or it truly cannot work there (then say so in your report). "Perfect" is the bar: check
your work visually (screenshots), not just with tests.

## 0. The owner's list (verbatim intent)

1. Rails: the looping rail shows a **double selection** (the hovered card and its looped copy both look
   selected). Exactly one card may ever look hovered/focused.
2. Cards **clip when hovered** (the scaled card is cut off at the top/left by the rail or the row header).
   Hover growth, shadow and focus ring must never be clipped, on any row, including the first card.
3. **Font isn't great** → new type system (section 2).
4. The **top nav pill is not actually centred** and **should be a solid colour** (section 3.3).
5. **Promo hero**: the promotional art must **play** (a muted looping trailer clip; animated art until the
   clip is ready) and the "weird funky block" (the glass box holding logo/text/buttons) must be replaced by
   something far cooler with animation (section 4).
6. **Bitrate is always weirdly low.** Find out why (trace what is actually played) and fix it.
7. Defaults: **original (base) language audio** and **native max resolution, never upscaled** → most
   things play 4K in English (section 5).
8. Player overlay **cannot always be seen in fullscreen** → fix.
9. **Click on the video pauses/plays.** (Double-click toggles fullscreen.)
10. **Live TV = a normal TV guide** (EPG grid like Freeview/Sky/Roku), for free channels and IPTV (M3U and
    Xtream) alike (section 6).
11. **Search becomes a spyglass** icon inside the nav pill (section 3.3).
12. **All the Jellyfin-plugin features** from before, plus many more, each with an **on/off switch in
    Settings** (section 7). Anything already built must be restyled to the new look.
13. **Settings menu redesigned** (section 8).
14. **Dev website** (private accounts dashboard) restyled to the TVM look without AI tells, and **remotely
    set Real-Debrid keys must work** (section 9). Most important item.
15. **More dev controls**, in the dashboard and in the app's developer menu (section 9).
16. **Liquid Glass is the big one**: it is not as good as Apple's. Redo it (section 3.1). One style only:
    the clear style is the only style (remove the Clear/Default/Tinted choice; keep an accessibility
    "Reduce transparency" switch that swaps glass for solid surfaces).
17. **Fewer weird pill buttons**: use the right control for each job (section 3.4).
18. **Avatar photos must be the characters, not the actors** (content data; a separate helper does it).
19. Fix any other issue you run into.

## 1. Root-cause notes already found by the lead

- Real-Debrid keys set on the dashboard: the service stores them correctly (all live accounts report
  `hasRdToken=true`). The failure is client-side caching: `apps/core/src/providers/remoteAccounts.ts` caches
  the key per session for 10 minutes, **including a cached `null`**, and `resolve()` only forgets the cache
  when `/v1/me` says there is **no** key — never when it says there **is** one. So a person who opened TVM
  before the owner saved their key keeps "no key" for up to 10 minutes, and the Windows app also loads its
  RD status once and never re-checks, so its "Connect Real-Debrid" prompt and RD page stay wrong until a
  restart. The same pattern must be checked in the phone cores (TvmAccounts.kt, TVMAccounts.swift) and the
  Roku local core (localCore.brs).
- Rails: `native/src/ui/scene.cpp` loops rails with a ring (`Rail::kRingOrigin`); hover/focus state is
  matched by item index, so the looped copy lights up too. Use the absolute ring slot.

## 2. Type system (all platforms)

- Family: **Geist** (SIL OFL 1.1, vercel/geist-font v1.9.2). Files are unpacked at
  `<lead scratchpad>/geist-dl/x/geist-font/`
  (`Geist/otf`, `Geist/ttf`, `Geist/webfonts/*.woff2`, `OFL.txt`). Ship Regular, Medium, SemiBold, Bold
  (and ExtraBold for display if you use it) plus OFL.txt. Inter stays available only as a fallback.
- Appearance setting "Font": Geist (default) / Inter / System. Stored with the client's appearance prefs.
- Scale (1rem = 16px at 100%): display 3.25rem/700/-0.025em; h1 2.25/700/-0.02em; h2 1.5/650/-0.015em;
  title 1.125/600/-0.01em; body 0.9375/450/0; label 0.875/550/0; caption 0.8125/450/+0.005em;
  overline 0.6875/600/+0.08em uppercase. Numbers in clocks, timers and the guide use tabular figures.
- Text must render crisp: grayscale AA is fine, but snap text origins to whole pixels and never draw text
  inside a scaled/transformed layer at rest.

## 3. Visual system

### 3.1 Liquid Glass, rebuilt (one style)

Target: iOS 27 / visionOS glass. What makes Apple's glass read as glass, in order of importance:
1. **Clarity**: the middle of the surface is almost perfectly clear (very low diffusion, ~2-4 px at 1x for
   chrome, ~6-8 px for large sheets), with saturation ~1.5-1.7 and a slight luminance lift.
2. **Lensing at the edge**: a convex bezel (~12-18 px, at most ~22% of the short side) bends what is behind
   it strongly inward, with a touch of chromatic dispersion (<1 px). This is what makes it look like a thick
   piece of glass, and it must be visible on every glass element, not only big panels.
3. **Specular rim**: a crisp 1 px highlight that is brightest where the edge faces the light (upper-left,
   white ~75%), fading around the perimeter (~15%), a weaker counter-highlight on the lower-right (~35%),
   plus a soft inner glow on the top ~30% (white 5-7%). iOS 27 also darkens the edge where it runs across
   the light (a 1 px outer contour, black ~20-25%).
4. **Adaptive tint for legibility**: measure the brightness behind the surface; over bright content add a
   dark tint (up to ~20% black) and switch text to stay ≥ 4.5:1; over dark content a faint white tint (~5%).
5. **Soft shadow**: 0 10px 30px black ~30%, smaller for small controls.
6. **It reacts**: hover/focus lifts 2 px and brightens the rim ~20%; a pointer-following specular bloom
   (radial white ~10%, ~120 px) slides over the surface on desktop; press scales to 0.97 and springs back
   (stiffness ~420, damping ~32). Selection indicators inside glass (nav, segmented controls, tabs) move as
   a **liquid droplet**: springs to the new item, stretching up to ~1.25x along the motion while moving,
   then settles; reduced motion → cross-fade.
- "Reduce transparency" (Appearance, off by default) swaps every glass surface for a solid surface
  (`--surface` colours below) with the same rim and shadow. The old Clear/Default/Tinted choice is removed
  everywhere; migrate any stored value silently.
- Web: implement with SVG displacement (feDisplacementMap from a generated rounded-rect bezel map) behind a
  `backdrop-filter` blur/saturate where supported (Chromium/WebView2/Android WebView), and a clean
  blur/saturate + rim fallback where SVG backdrop filters do not work (Safari/WKWebView). Keep it fast:
  generate maps once per size, never per frame; no layout thrash.
- Roku: no backdrop sampling. Fake it well: blurred copy of the hero/backdrop art behind panels where
  possible, a 9-patch rim highlight bitmap with the specular gradient, and solid surfaces elsewhere.

### 3.2 Colours (dark theme; keep the existing light theme working)
- bg `#07080B`; surface `#12141A`; surface-2 `#1A1D25`; surface-3 `#232733`; hairline `rgba(255,255,255,.08)`.
- text `#F5F7FA`, text-2 `#A9B0BC`, text-3 `#6E7684`; accent stays the existing TVM accent token; live red
  `#E5484D`; success `#3DD68C`; warning `#F5A524`.

### 3.3 Top navigation
- One capsule **exactly centred on the window's horizontal centre** (not offset by the wordmark or the
  profile button; it may only shift if it would overlap them at narrow widths — then it sits in the free
  space between them).
- **Solid colour**: an opaque `surface` (#12141A at ~94% so it reads solid) with the glass rim + shadow from
  3.1 — it must NOT show a gradient of whatever is behind it.
- Items: Home, Movies, Series, Live TV, Library, then a **spyglass** (magnifier) icon button as the last item
  inside the capsule (same height, circular hit area, 18-20 px stroke icon, label "Search" for
  accessibility/tooltip). Remove the "Search" text tab.
- Selected item: a solid light capsule (white ~92%, text near-black) that moves between items as the liquid
  droplet from 3.1. Hover on unselected: text brightens + faint fill.

### 3.4 Controls — the right control for each job (fewer pills)
- **Buttons**: rounded rectangles, radius 12 (10 for small), height 44 (36 small). Primary = solid (accent
  or white-on-dark), secondary = glass, tertiary = text. Icon buttons are circles. Full pills are only for
  the nav, filter chips and tags.
- **On/off** → iOS-style switch (track 46×28, knob springs, accent when on). E.g. "Kids profile".
- **2-5 exclusive options** → segmented control (glass/solid track with the droplet indicator). E.g. age
  limit Up to 7 / 12 / 15 / No limit; skip segments Off / Button / Automatic.
- **Many options** → a select/dropdown or a list sheet. **Avatar sets** → a horizontally scrolling row of
  set tiles (cover art of the show/film + title), the chosen tile outlined; avatars below as circles
  (96 px) with the character name under them, selected ring in accent.
- Text fields: 48 high, radius 12, filled surface-2, 2 px accent focus ring. PIN: 4 separate digit boxes.
- Sliders: thin track (4 px), knob 18 px, value label.

### 3.5 Cards and rails
- Poster radius 12, landscape (continue watching) radius 14. Hover/focus: scale 1.06, lift, deeper shadow,
  2 px focus ring on keyboard/remote focus. The row viewport reserves room for the grown card + ring +
  shadow (top, bottom, and the first/last card's sides) so nothing is clipped. Titles under posters: one
  line, fade-out truncation; full title appears in the focused card's caption (marquee or two lines).
- Looping rails keep working (seamless, endless), but exactly one copy may be hovered/focused.

### 3.6 Motion
- Springs: snappy (420/32), gentle (220/26). Page transitions 260-300 ms, cubic-bezier(.2,.8,.2,1).
- Reduced motion (OS setting or Appearance switch) → fades only, no particles, no Ken Burns, clip paused.

## 4. Home hero ("spotlight") — replaces the glass box

- **Media**: full-bleed. When Settings → Extras → "Hero previews" is on and a clip is available
  (`GET /api/extras/hero-clip`), play it muted, looping, cover-fit, starting with a 600 ms cross-fade from
  the art. Until then (and as the fallback): the background art with a slow Ken Burns move (scale 1.00→1.08
  over ~20 s, slight drift, alternate direction each loop). Pause media when the hero is scrolled out of
  view, the window is hidden/minimised, or a video is playing.
- **No box.** Legibility comes from scrims: a left-to-right gradient (bg at ~88% → 0 at ~58% width), a
  bottom gradient that melts into the page background (rails float over it), and a light vignette.
- **Event glow + particles**: a radial glow in the event's `glow` colour behind the logo that breathes
  (opacity .22↔.38, ~6 s). Particles from the event's new `effect` field in `events.json`
  (`embers` | `sparks` | `snow` | `dust` | `stars` | `none`; default `dust`): e.g. embers rise and flicker in
  accent/glow colours with additive blending, 40-70 particles, drift + wobble, fade near the top.
- **Content block** (left, vertically ~58% down): kicker chip ("IN CINEMAS NOW" with a pulsing dot in the
  accent, or the countdown "IN CINEMAS IN 3 DAYS" before `release`); the title **logo** image (Cinemeta /
  metahub logo; text title in display type if none), max ~44% width; the event `line` (body, text-2); a meta
  row (year · genres · IMDb rating · "6 films"); buttons: primary solid "Watch the saga"/"Play" with a play
  glyph and soft accent glow, secondary glass "Details", and a round glass mute/unmute button only while the
  clip plays.
- **Entrance**: logo resolves from blur 12 px + scale .96 + opacity 0 (900 ms), then a diagonal light sweep
  crosses the logo once (and every ~9 s after); kicker, line, meta and buttons rise 8 px and fade in with
  80 ms stagger.
- **Parallax**: desktop pointer moves media ~1.5% and content ~0.5% opposite; scrolling down scales the media
  slightly and dims it.
- Non-event days: the same hero for the top recommended/trending title (no particles unless `effect`).

## 5. Playback quality and language (Core decides; players obey)

- New prefs (Core `/api/prefs`, per device, all optional in PUT):
  - `quality`: `'original'` (default: highest **native** resolution available, never upscaled) | `'2160'` |
    `'1080'` | `'720'` | `'saver'` (≤720p, smallest good file). Caps never exceed what the client says it
    can show (see `client` below).
  - `audioLanguage`: `'original'` (default: the title's original language) | an ISO 639-2 code.
  - `skipUpscaled`: boolean, default true.
  - `subtitleMode`: `'off'` | `'foreign'` (default: on when the audio is not in the profile's language) |
    `'always'`.
  - `subtitleStyle`: `{ size: 's'|'m'|'l'|'xl', color: 'white'|'yellow'|'cyan', background: 'shadow'|'box'|'none' }`
    default `m`/`white`/`shadow`.
- Ranking for `'original'`: drop cams/TS/TC/screeners and upscales (`upscale`, `upscaled`, `AI upscale`,
  `UPS`, `AIUS`, regrades that are upscales); prefer releases whose audio is the original language (reject
  dub-only releases whose only languages are not the original — `MULTI`/dual audio containing the original is
  fine and then the player selects the original track); then the highest resolution; within a resolution
  prefer REMUX > BluRay > WEB-DL > WEBRip > HDTV and higher bitrate (size ÷ runtime), HDR/DV allowed (mpv
  tone-maps); cached on Real-Debrid first. Most mainstream English titles should land on 4K English.
- `POST /api/playback` accepts optional `versionId` and
  `client: { player: 'mpv'|'html5'|'exoplayer'|'avplayer'|'roku', maxHeight?: number, hevc?: boolean, hdr?: boolean, mkv?: boolean }`
  and only picks versions the client can play natively (no Core transcoding when the client can play the
  file). The response gains `version` (a Version, below), `originalLanguage` (ISO 639-2 or null) and
  `audioLanguages`.
- `GET /api/playback/versions?id=&season=&episode=` → `{ originalLanguage, versions: Version[] }`, best
  first. `Version = { id, label, height, hdr: 'dv'|'hdr10+'|'hdr10'|'hlg'|null, source: 'remux'|'bluray'|'web-dl'|'webrip'|'hdtv'|'other', codec, sizeBytes, bitrateMbps: number|null, audio: { codec, channels, atmos: boolean }, languages: string[], upscaled: boolean, cached: boolean, recommended: boolean }`.
  `label` reads like "4K · Dolby Vision · REMUX · 58 Mb/s".
- **Bitrate**: the low bitrate is probably either small encodes winning the ranking, Real-Debrid's
  *transcoded* streaming links being used instead of the original download link, or a Core HLS/ffmpeg path
  re-encoding. Trace it end to end on each player and fix the cause; players must play the original file
  whenever they can. Native shows a "Stats" overlay (key `I`, and in the player menu) with resolution,
  codec, HDR, container, actual bitrate (mpv `video-bitrate`/`file-size`÷`duration`), dropped frames and the
  version label; web shows the same where the browser exposes it.
- Players pick the audio track matching `audioLanguage`/`originalLanguage` and apply `subtitleMode`.

## 6. Live TV guide

- `GET /api/live/guide?start=<ISO>&hours=<1..24>&group=<optional>` →
  `{ now: ISO, start: ISO, end: ISO, groups: string[], channels: [{ id, number, name, logo, group, source: 'free'|'m3u'|'xtream', programmes: [{ start, end, title, subtitle?, description?, category?, image?, episode? }] }] }`.
  Sources: M3U `url-tvg`/`x-tvg-url` XMLTV (gz or plain) matched by `tvg-id`/name; Xtream `xmltv.php`
  (fallback `get_short_epg`); free channels from a free public XMLTV feed (Core builder: research and verify
  one that covers the BBC/UK and other channels in `packages/content/free-channels.json`; store per-channel
  `epgId` + a feed list there). Parse streaming (big files), cache to disk, refresh every 6 h, never block
  the channel list. Channels without data still appear (one "No guide information" block).
- Look (every platform): top bar with "Guide", a day picker ("Today ▾"), a channel filter ("All channels ▾",
  favourites, groups), a search button and a clock (tabular). Left column (~220 px): channel number, logo,
  name. Timeline header with ticks every 30 min ("11:30", "12:00"), 2.5-3 h visible. Rows ~64 px; programme
  blocks are rounded (8 px) solid surface-2 cells with 1 px gaps; the airing programme gets a thin accent
  bar on its left and progress tint; the focused cell is solid white with dark text. A **red now line**
  (`#E5484D`) runs down the grid with a dot on the timeline. Past time is dimmed. Bottom info panel: title
  (h2), "NOW" badge, time range, category tags, description, channel logo/thumbnail, Watch button.
- Keys: arrows move cell to cell (up/down keeps the time position), Enter plays the channel, PageUp/PageDown
  jump 8 channels, number keys tune (TV style, 1.5 s entry), Left at the first visible cell scrolls back
  30 min, Back closes. Mouse: click a cell to select, double-click/second click to watch, wheel scrolls
  channels, shift+wheel scrolls time. Roku: use the SceneGraph `TimeGrid` node or an equivalent grid.
- The old channel list stays reachable (a "Channels" toggle), and the M3U/Xtream setup screens are restyled.

## 7. Extras (Jellyfin-plugin features, built in, each switchable)

Core prefs gain `extras: { <id>: boolean }` (GET returns every id with its value; PUT merges a partial
object) plus `webhookUrl: string|null` and `homeSections: { id: string, visible: boolean }[]`. Existing
`skipSegments`, `autoplayNext`, `subtitleLanguages`, `heroPreviews` stay where they are.

| id | default | what | where |
|---|---|---|---|
| `onlineSubtitles` | on | OpenSubtitles tracks (built in 1.2) | all |
| `trailers` | on | Trailer button; plays **inside TVM** where possible (native: mpv + yt-dlp; web: YouTube nocookie embed; Roku: hide) | all |
| `trailerBackdrops` | on | muted trailer behind the Details header after 3 s | desktop/web |
| `collections` | on | Collection row on Details (1.2) | all |
| `comingUp` | on | next-episode line + "New episodes this week" row (1.2) | all |
| `watchStats` | on | record history; Your stats page (1.2) | all |
| `animeTitles` | on | AniList English title line (1.2) | all |
| `ratings` | on | IMDb rating on Details and (optionally) cards | all |
| `qualityBadges` | on | 4K / HDR / DV / Atmos badges on Details and on cards when known | all |
| `versionPicker` | on | pick a version (Merge Versions) on Details and in the player | all |
| `chapters` | on | chapter ticks on the seek bar, next/previous chapter | native (mpv), others if exposed |
| `seekPreviews` | on | thumbnail preview while scrubbing (Trickplay) via a second hidden mpv | native only |
| `themeSongs` | off | soft theme tune on series/film Details (ThemerrDB + yt-dlp) | desktop/web |
| `spoilerBlur` | off | blur unwatched episode stills and synopses | all |
| `surpriseMe` | on | "Surprise me" button (random pick from recommendations/watchlist) on Home/Library | all |
| `autoCollections` | on | extra Home rows: Because you watched X, Top rated <genre>, decades | all |
| `sleepTimer` | on | player menu: 15/30/45/60 min, end of episode | all |
| `nightMode` | off | dynamic range compression (mpv `dynaudnorm`/WebAudio compressor) | all but Roku |
| `pauseOnMinimize` | on | pause when the window is minimised/hidden | desktop |
| `shortcutsOverlay` | on | "?" shows keyboard shortcuts | desktop/web |
| `webhook` | off | POST play/pause/stop/finish events to `webhookUrl` (Discord webhook URLs get a Discord message) | Core |
| `announcements` | on | show owner announcements from the dashboard on Home | all |

New Core endpoints: `GET /api/extras/hero-clip?id=` → 200 `{status:'ready', url, width, height, seconds}` |
202 `{status:'preparing'}` (poll every 5 s, up to 2 min) | 404 `{status:'unavailable'}`; the clip is a muted
H.264 MP4 (≤1080p, ~30-45 s from the trailer's middle, faststart) served by `GET /api/extras/hero-clip.mp4?id=`
with Range support. `GET /api/extras/theme?id=` → `{url}`|404 (m4a/mp3 served by Core). `GET /api/extras/ytdlp`
→ `{path}`|404 (native mpv uses it for in-app trailers). `GET /api/extras/surprise` → `{item: MediaItem}`.
`POST /api/progress/remove {id}` (drop from Continue watching), `POST /api/progress/watched {id, season?, episode?, watched}`.
`GET /api/announcement` → `{ announcement: {id, text, level:'info'|'warning'|'critical', link?:string} | null, minVersion: string|null, flags: Record<string, boolean> }`
(Core proxies the service's public `/v1/config`, cached 5 min). yt-dlp and ffmpeg are installed by Core on
demand exactly like mpv (official GitHub release, checksum verified, never bundled in git), and their
absence just hides the features. Phones' on-device cores return 404 for hero-clip/theme/ytdlp.

## 8. Settings, redesigned (every platform)

- Two panes. Left: a search field ("Search settings"), then categories with icons: **Account**, **Profiles**,
  **Playback**, **Audio & subtitles**, **Appearance**, **Home screen**, **Extras**, **Live TV**,
  **Real-Debrid**, **Downloads**, **Updates**, **Your stats**, **About**, and **Developer** (admins only).
  Right: the category title (h1) + one-line description, then grouped cards (surface, radius 16, hairline
  dividers) of rows: label (label type) + description (caption, text-2) on the left, the control on the
  right (switch, segmented, select, value + chevron, button). Searching filters rows across all categories.
- Phones: categories list → push into a category (iOS Settings pattern) with a back button. Roku/TV: left
  list focus, Right enters the panel, Back returns; every control works with the remote.
- Playback: Quality (Original — best available / 4K / 1080p / 720p / Data saver), Skip upscaled releases,
  Audio language (Original / list), Autoplay next episode, Skip intro & credits (Off/Button/Automatic),
  Volume boost max, Sleep timer default. Audio & subtitles: Subtitle mode (Off/Foreign audio only/Always),
  preferred subtitle languages (ordered), subtitle style (size/colour/background with live preview), Night
  mode. Appearance: Font, Reduce transparency, Reduce motion, Accent (if the theme has accents), Poster
  titles. Home screen: reorder/hide rows (up/down buttons + switch), Hero previews, Spotlight events.
  Extras: every row of section 7 with its description and a platform note when not everywhere.
- Your stats and the changelog/what's new get the new look too.

## 9. Accounts dashboard + developer powers (private repo `C:\Users\Gathe\Desktop\TVM-accounts`)

- Dashboard (`/admin`): TVM look — Geist (Google Fonts is fine for this page), bg/surface tokens above, the TVM
  wordmark, a centred solid nav capsule (Accounts, Activity, Announcements, Settings), cards radius 16,
  people list with initials avatars and status dots, segmented filter with counts (All / Waiting / Active /
  Suspended), instant search, a right-side drawer to manage a person (not a modal), toasts, keyboard
  shortcuts (/ to search, Esc to close). No AI tells: no emoji, no sparkle icons, no gradient blobs, no
  "Seamlessly"/"Effortlessly" copy, sentence case, specific labels, real empty states.
- Real-Debrid: "Test key" validates a key against Real-Debrid (`GET https://api.real-debrid.com/rest/1.0/user`
  with the key, from the Worker) and shows username, premium/expiry; saving a key runs the same check and
  stores username + premium-until + checked-at (never return the key). The drawer shows that status. After
  saving: "Saved. TVM picks it up within a minute." (true after the client fixes).
- More controls: edit display name and email; set a new password (owner types it); change plan tier and
  role; Live TV; suspend/restore; notes; per-session list (client, created, last used) with revoke and
  "Sign out everywhere"; delete account (type the email to confirm); audit log view (Activity) with filters;
  CSV export; bulk approve/suspend; **Announcements** (text, level, optional link, start/end) and **app
  settings**: `minVersion` (apps below it show "Update required" and update), and remote feature flags
  (`flags` map, e.g. turn an Extra off for everyone). Public `GET /v1/config` (no auth, cacheable 60 s)
  serves `{ announcement, minVersion, flags }`.
- In-app developer menu (admins): install/remove the admin key (native has no UI for this today — add one),
  then manage accounts, announcements and flags through Core (`/api/admin/*` → service admin API); plus
  diagnostics (Core version/commit, update channel, check/apply update now, clear caches, reload content
  files, open logs folder), and UI toggles (show FPS, glass debug overlay, simulate reduced motion).

## 10. Rules for every builder

- Read `CLAUDE.md`. Do not commit, push, or create branches; the lead integrates. Touch only the paths your
  job owns. Convert files you edit to LF. Never put secrets, admin keys or developer-code digests in the
  public repo. Don't add the owner's email anywhere.
- Code against the contracts above even if the other side is not built yet: a missing endpoint (404) or
  field just hides the feature.
- Keep the code style of the surrounding code; comment the why. All existing tests must stay green and new
  logic gets tests.
- Look at your work: render screenshots at desktop (1920×1080 and 1280×720) and, where relevant, phone/TV
  sizes, and fix what looks off. Save the final screenshots under
  `<lead scratchpad>/shots/<job>/`.
- Finish with a report at `.../scratchpad/reports/<job>.md`: what changed (by owner item number), how it was
  verified, what is not done or not verified, and anything another platform must match.

## 11. Email links and open sign-ups (added by the owner mid-build)

- **Mail**: the accounts Worker sends email through a pluggable provider chosen by secrets:
  `MAIL_PROVIDER` = `brevo` (HTTP API, works with a single verified sender address, no domain needed) or
  `resend` (HTTP API, needs a verified domain), `MAIL_API_KEY`, `MAIL_FROM` ("TVM <address>"). With no
  provider configured, mail features report `mail: false` and everything works as today (manual
  verification). Never log addresses or tokens. Plain-text + simple HTML emails in the TVM look (dark,
  Geist/system font, one button, the link also as text), sentence case, no emoji.
- **Verification link**: on a new registration the service emails a link `https://<service>/verify?t=<token>`
  (32 random bytes, only its SHA-256 stored, 24 h expiry, single use). The `/verify` page (TVM look) marks the
  email verified and says what happens next. `POST /v1/verify/resend {email}` (rate limited, always 202,
  reveals nothing) and `POST /v1/me/verify/resend` (session) re-send. `/v1/me` exposes `emailVerified`.
- **Password reset by link**: `POST /v1/password/forgot {email}` (always 202) emails `https://<service>/reset?t=…`
  (1 h, single use); the `/reset` page sets a new password (same rules as sign-up) and revokes all sessions.
- **Open sign-ups** (dashboard → Settings, a switch, default off): Off = every account waits for the owner,
  as today (the dashboard shows whether the email is verified). On = an account is approved automatically the
  moment its email is verified, on the default tier chosen next to the switch, and the person adds **their
  own** Real-Debrid key in the app (the owner's key is never handed out). The service's public `/v1/config`
  includes `openSignups` and `mail` so apps can word their screens.
- **Apps** (Core proxies: `POST /api/account/verify/resend`, `POST /api/account/password/forgot`): after
  creating an account show "Check your inbox" (the address, "Resend email" with a 60 s cooldown, "Use a
  different email"), poll `/api/account` every 5 s and move on as soon as the email is verified — to the app
  when open sign-ups approved it, otherwise to the waiting screen, which now shows "Email verified"/"Not
  verified yet" as plain text. Sign-in screens get "Forgot password?" (sends the link; TVs show the link page
  URL/QR instead of a form). The Real-Debrid onboarding prompt explains in one line that each person uses
  their own Real-Debrid account and links to how to get a key.

## 12. Accounts service API additions (the accounts builder implements; Core proxies them)

Public: `GET /v1/config` → `{ announcement: {id, text, level, link?}|null, minVersion: string|null, flags: Record<string, boolean>, openSignups: boolean, mail: boolean }`
(no auth, `Cache-Control: public, max-age=60`); pages `GET /verify?t=`, `GET /reset?t=`; `POST /v1/verify/resend {email}` → 202;
`POST /v1/me/verify/resend` (session) → 202; `POST /v1/password/forgot {email}` → 202; `POST /v1/password/reset {token, password}` → 204.
Account objects (member and admin views) gain `emailVerified` (exists), and admin views gain `rdUsername`, `rdPremiumUntil`, `rdCheckedAt`.

Admin key only: `GET|PUT /v1/admin/config` `{ announcement|null (+ startsAt?, endsAt?), minVersion, flags, openSignups, openSignupsTier: 'stream'|'stream-live' }`;
`GET /v1/admin/accounts/:id/sessions` → `{ sessions: [{ id /* short prefix */, client, createdAt, lastUsedAt }] }`;
`DELETE /v1/admin/accounts/:id/sessions/:sid`; `POST /v1/admin/accounts/:id/profile {displayName?, email?}`;
`POST /v1/admin/accounts/:id/password {password}` (revokes sessions); `POST /v1/admin/accounts/:id/tier {tier}`;
`POST /v1/admin/rd/test {token}` → `{ ok, username, premium, premiumUntil }`; `GET /v1/admin/audit?offset=&type=` → `{ events: [{ at, type, accountId?, detail }], nextOffset }`;
`GET /v1/admin/accounts.csv`; `POST /v1/admin/accounts/bulk {ids, action: 'activate'|'suspend'|'restore', tier?}`;
`POST /v1/admin/mail/test {to}`. Existing endpoints keep working unchanged.
Core mirrors these for the in-app developer menu under `/api/admin/*` (admin key installed in Core, as today) and
adds `GET /api/config` (cached `/v1/config`) for every client.

## 13. Universal Real-Debrid key (added by the owner; the service side is LIVE)

The owner can set one universal key in the dashboard. `GET /v1/me/rd-token` returns the account's own key,
else the universal key when the owner allows it for that account (hand-approved accounts; never open
sign-ups). `/v1/me` reports `hasRdToken: true` in both cases and never says which. Every app/engine must:
keep any key that came from the service in memory only (never disk, registry, prefs, logs, crash reports or
the UI), never send it to the UI layer (the UI only ever sees connected/username/premium), and show the
Real-Debrid page as "Connected through your TVM account" with no key field when the key comes from the
account and the person has not entered their own. Real-Debrid refuses requests from Cloudflare, so all
Real-Debrid calls stay on the viewer's own connection, exactly as today.

## 14. Patch notes pop-up (added by the owner; the switch is LIVE in the dashboard)

The service's public `/v1/config` now carries `flags.patchNotesPopup` (currently `true`); Core passes `flags`
through `/api/config` (and phone/Roku cores the same). Releases in `changelog.json` may carry an optional
`knownIssues: string[]` (things that may be broken or unfinished in that release).
- When `flags.patchNotesPopup` is true, the first time someone opens an app whose version is newer than the
  last notes they saw, show the newest release as a **modal pop-up over the app** (not the corner card):
  dimmed backdrop, a centred sheet (max ~720 px wide, scrollable body), a version chip ("TVM 1.4.0"), the
  release title (h1), highlights as short bold lines, then the changes grouped by area with small platform
  tags, then — if present — a clearly marked **"Known issues"** block (warning colour, one line each). One
  primary button "Got it" closes it; Esc/Back also closes it; focus starts on "Got it" (TV remotes too).
  Remember the version so it shows once. When the flag is false or missing, keep the existing corner card.
- Settings → What's new still shows every release, including known issues.
