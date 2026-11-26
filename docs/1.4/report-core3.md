# CORE3 report · TVM 1.4.8

## Owner item 1 · Playback quality and language

Cinemeta supplied TMDB IDs but no original language for the four sample titles. Core now uses the declared language when present, reads the TMDB original-language field next, and uses a unique Wikidata original-language code when the TMDB lookup fails. The live Core resolved all four samples as `eng`. When metadata cannot resolve the language, ranking prefers English without claiming it is the title's original language in the API response.

Torrentio flags, language codes before and after the resolution tag, and dual-audio labels feed the ranking. Subtitle tags do not establish an audio language. Dub-only releases remain available at the end. Unmarked retail releases remain eligible for their native quality, so an explicitly labelled small English encode cannot displace a high-quality release merely because the larger release omits its language tag. Resolution, cache status, source type and bitrate break ties between suitable audio choices. The selected episode filename takes priority over the pack headline. A season pack's total bytes are excluded from episode bitrate calculations when Torrentio does not provide the file's own size.

Before the fix, explicit HTML5 capabilities could remove all HEVC/HDR/MKV releases before ffprobe or reject them after probing, even when Core could convert them. The legacy web request could reach ffmpeg, where re-encoding had an independent 1080p ceiling and every HLS session used audio stream 0. Core now chooses direct play, video-copy remux or H.264 conversion from the file probe. Conversion holds the source resolution within the plan, display and preference caps. Software encoding uses CRF 17 and hardware encoders use higher-quality settings. HLS maps the matching embedded audio track, and HDR conversion uses BT.709 tone mapping when the probe detects HDR and the client cannot display it. Playback can find FFmpeg already installed in Core's verified tools directory.

The mpv request still returns the unrestricted original file URL. Native passes the resolved original language to mpv's `--alang` when the viewer selects Original. The source path uses the Real-Debrid `unrestrict/link` download field. Ranked Torrentio playback does not request Real-Debrid's transcode endpoint.

### Live Torrentio catalogue results

Fetched public movie listings and the proper series episode listing for Breaking Bad. The movie-form URL for Breaking Bad returned the same 283 rows. These are release metadata estimates with a 2160p cap and no Real-Debrid key. Chrome with conversion available and mpv recommended the same source in each row.

| Title | Public rows | 2160p-cap recommendation | 1080p Chrome cap |
|---|---:|---|---|
| Interstellar · tt0816692 | 500 | 4K Dolby Vision REMUX, 81 Mb/s estimated. PROPER IMAX release with unmarked audio. | 1080p REMUX, 49.1 Mb/s, English listed |
| The Hunger Games · tt1392170 | 500 | 4K Dolby Vision REMUX, 78 Mb/s estimated. FraMeSToR release with unmarked audio. | 1080p REMUX, 45.7 Mb/s, English listed |
| Dune: Part Two · tt15239678 | 455 | 4K Dolby Vision REMUX, 73.6 Mb/s estimated. SGF release lists English with other tracks. | 1080p REMUX, 30.4 Mb/s, English listed |
| Breaking Bad S01E01 · tt0903747:1:1 | 283 | 4K WEB-DL XEBEC, 16.8 Mb/s estimated. Tagged AI upscales were excluded and the 50.81 GB pack no longer scored as a single episode. | 1080p REMUX, 29 Mb/s, unmarked audio |

[Interstellar](https://torrentio.strem.fun/stream/movie/tt0816692.json) · [The Hunger Games](https://torrentio.strem.fun/stream/movie/tt1392170.json) · [Dune: Part Two](https://torrentio.strem.fun/stream/movie/tt15239678.json) · [Breaking Bad S01E01](https://torrentio.strem.fun/stream/series/tt0903747:1:1.json)

## Owner item 2 · The Hunger Games: Sunrise on the Reaping

Cinemeta reported 20 November 2026 and the live `/api/media?id=tt32558705` already returned `playable: true`. The public Torrentio feed returned 15 rows and all 15 were cinema recordings. The availability failure was the old CAM filter at ingestion and the second filter in the ranker. Core now keeps CAM, TS, TC and equivalent tags as a fallback, only when the feed has no retail release. Screeners and workprints are still excluded. The public versions endpoint on the Free plan returned three candidates with the recommended English/French 720p recording labelled **Cinema recording, low quality**. With a 2160p cap the English/French 1080p CinemaCity recording ranked first. Credential-free listings expose release metadata only. Playback continues to require a working Real-Debrid connection. [Cinemeta title](https://v3-cinemeta.strem.io/meta/movie/tt32558705.json) · [Public release listing](https://torrentio.strem.fun/stream/movie/tt32558705.json)

## Owner item 3 · Extras

Ran the repository Core on `127.0.0.1:7347` with a fresh temporary `TVM_DATA_DIR` and no Real-Debrid key. A separate temporary Core used a generated 4K file for the playback result checks. It contacted the real metadata and subtitles services.

| Feature | Endpoint | Real result | Fix or disposition |
|---|---|---|---|
| Skip segments · TheIntroDB | `GET /api/extras/segments?id=tt0903747&season=1&episode=1` | Breaking Bad pilot intro 228.632–246.528 s and credits from 3432.873 s. The same data arrived in the fixture playback response. | Direct IMDb lookup through TheIntroDB v4 removes the serial Wikidata/TMDB lookup. Core starts enrichment early and honors Off. [API documentation](https://theintrodb.github.io/theintrodb-npm/getting-started.html) |
| Skip segments · AniSkip | `GET /api/extras/segments?id=tt0388629&season=1&episode=103&anime=1&title=One%20Piece` | AniSkip fallback returned intro 14.652–174.652 s and credits 1312.009–1402.009 s. | Fallback remains active. Playback can recognize Japanese animation using title language and genre when the catalogue labels it Animation. |
| OpenSubtitles | `GET /api/extras/subtitles`, `GET /api/extras/subtitle.vtt`, `POST /api/playback` | Breaking Bad pilot returned 22 tracks in both the list and fixture playback. French-first prefs reordered the list. Chrome parsed 587 English VTT cues. | Core starts track lookup while resolving the file to fit the playback enrichment deadline. |
| Trailers | `GET /api/extras/trailers?id=tt0816692`, `GET /api/extras/ytdlp` | Five Interstellar YouTube IDs. The yt-dlp route installed a checksum-verified executable and returned its path. | Existing lookup worked. Disabling both trailers and trailer backdrops returned an empty list. Disabling trailers made the tool route return 404. |
| Collections | `GET /api/extras/collection?id=tt1392170` | The Hunger Games collection returned six films. | Existing lookup and preference gate worked. |
| Coming up | `GET /api/extras/upcoming?id=tt0206512`, `GET /api/extras/upcoming/home` | SpongeBob SquarePants S18E01, 27 November at 22:00 UTC. Saving the show put it in the upcoming Home response. | Expired TVmaze air dates are ignored on fresh lookups. Both routes hid the data when disabled. |
| Stats | `GET /api/extras/stats`, `POST /api/extras/stats/clear` | The Breaking Bad pilot appeared in history after 31 seconds of test progress. Clear returned 204 and reset totals. | Existing recording worked. No further time accumulated with Watch stats off. |
| Anime titles | `GET /api/extras/anime-title?title=Shingeki%20no%20Kyojin` | Attack on Titan, MAL 16498. | Existing AniList lookup and preference gate worked. |
| Ratings | `GET /api/media?id=tt0816692`, `GET /api/reviews?id=tt0816692` | IMDb 8.7 in both responses. Reviews also returned Letterboxd data. | Ratings visibility belongs to the client. The Core data is present. |
| Quality badges | `GET /api/playback/versions`, `POST /api/playback` | The 4K-cap sample exposes height 2160, Dolby Vision and Atmos fields. The live Free plan endpoint caps its list at 720p. | Corrected the source and bitrate inputs for badge and version consumers. Badge visibility belongs to the client. |
| Versions | `GET /api/playback/versions?id=tt32558705` and the four sample IDs | Live Free plan returned a nonempty list including three Sunrise cinema versions. The original language was English. | Added public release metadata when no Debrid key is configured. Authenticated requests continue to use the Debrid feed. |
| Surprise | `GET /api/extras/surprise` | Returned a catalogue item. Disabled returned `{item:null}`. | Existing preference gate worked. |
| Hero clip | `GET /api/extras/hero-clip?id=tt0816692`, `GET/HEAD /api/extras/hero-clip.mp4?id=tt0816692` | Initial 202, then a muted 1920×1080 H.264 MP4 of 38 seconds. Chrome played it. HEAD returned 200 and a 1,024-byte range returned 206. | Added a yt-dlp format fallback when only a non-MP4 source is offered. Disabling Hero previews made both routes return 404. |
| Theme songs | `GET /api/extras/theme?id=tt0944947`, `GET /api/extras/theme.m4a?id=tt0944947` | 404 by default. With the switch on, the Game of Thrones ThemerrDB entry produced cached AAC audio. A 1,024-byte range returned 206. | Added an audio-only download fallback for releases without an M4A source. Disabling the switch made both routes return 404. |
| Extras prefs | `GET/PUT /api/prefs` | GET returned all 23 current switches. Partial PUT preserved unrelated settings. Toggling the switches exercised all 13 API gates in the disabled matrix. | Playback enrichment and the segments route now honor Skip segments Off. |

## Verification and integration

- `corepack pnpm -r run typecheck` passed across the workspace.
- `npx vitest run` in `apps/core` passed 716 tests in 71 files. The suite includes the live release names as fixtures. A sync test could mistake timestamp digits for the plaintext test PIN. Its check now looks for the quoted PIN value.
- `npx vitest run` in `packages/extras` passed 13 tests. The shared source and generated Core block match. `git diff --check` passed for the owned paths, and edited files use LF.
- Chrome 158 decoded the Core-converted 3840×2160 H.264 stream from a synthetic HEVC MKV. The source defaulted to French and the output contained English AAC. The mpv API request returned the original MKV URL and native transport. The actual mpv executable and authenticated Real-Debrid playback were outside this credential-free verification.
- The 1920×1080 and 1280×720 screenshots show the Core test player, with framing checked at both sizes. [4K at 1920](../shots/core3/chrome-4k-1920.png) · [4K at 1280](../shots/core3/chrome-4k-1280.png) · [Hero at 1920](../shots/core3/hero-clip-1920.png) · [Hero at 1280](../shots/core3/hero-clip-1280.png)
- The UI can send `client: {player:'html5', maxHeight, hevc, hdr, mkv}` when it knows the browser's capabilities. The legacy request still works and uses conservative browser codec support. Preserve the display, plan and quality caps when surfacing the version picker. Use the cinema label as returned, and distinguish release metadata from a connected playback account.
- Node Core covers web, desktop and the Windows Core path. Match ranking and availability in the standalone Android, iOS and Roku engines where supported. This job did not change those engines or the React UI.

### Changelog handoff

The lead owns the shared changelog and version bump. Suggested lines for the affected Node Core clients follow.

- Web playback keeps the source resolution when it needs to convert the video.
- Playback prefers original audio, with dubbed releases available as a fallback.
- Cinema recordings are offered with a low-quality label when no retail release exists.
- Skip segments and online subtitles load earlier when playback starts.

