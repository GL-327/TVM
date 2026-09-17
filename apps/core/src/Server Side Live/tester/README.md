# IPTV tester

A pretend IPTV provider, so the live proxy can be tested without a
subscription, without the internet, and without anyone's programmes.

```bash
node "apps/core/src/Server Side Live/tester/cli.ts"            # run the panel
node "apps/core/src/Server Side Live/tester/cli.ts" --check    # and prove the proxy against a running Core
```

Windows: `scripts\iptv-tester.cmd` (add `--check` to run the checks).
Linux and macOS: `./scripts/iptv-tester.sh`.

It prints two ways to connect, and both work in **Settings → Live TV**:

| | |
| --- | --- |
| Playlist (M3U) | `http://127.0.0.1:7390/get.php?username=tvm&password=tester&type=m3u_plus&output=m3u8` |
| Xtream login | server `http://127.0.0.1:7390`, user `tvm`, password `tester` |

Use `--port` to move it. From a phone or a Roku, use this computer's LAN
address instead of `127.0.0.1` and start it with `--host 0.0.0.0` is not
needed: the proxy is the point, so the phone only ever talks to Core, and Core
talks to the tester on this computer.

## The channels

Each one is a way real panels are awkward:

| | Channel | What it proves |
| --- | --- | --- |
| 101 | Tester One — live HLS | A sliding live window, a master playlist with two renditions, and URIs written three ways (relative, root-relative and absolute). All of them must come back as Core addresses. |
| 102 | Tester Two — encrypted HLS | AES-128. The key URI must be rewritten too, and the key must reach the player through Core — a rewrite that misses it hands the panel's address to the player on the first decryption. |
| 103 | Tester Three — needs panel headers | Answers 403 unless the request carries the panel's own User-Agent and Referer. The playlist says so with `#EXTVLCOPT`, as real providers do. Both proxy paths now read those lines and send them on every request for that channel. |
| 104 | Tester Four — raw MPEG-TS | A never-ending transport stream, which is what Xtream panels serve by default and what TVM asks for. |

The picture is a synthetic test pattern and a tone made with FFmpeg (see
`fixtures/README.md`). The panel loops three two-second segments and moves each
loop along the timeline (`tsclock.ts`), so to a player it is indistinguishable
from a real live channel.

## What `--check` does

Against the Core at `--core` (default `http://127.0.0.1:7345`), it loads the
tester into Server Side Live and follows every channel through the proxy:
playlist, rendition, first segment. It then reads the panel's own request log
to confirm that no client credential ever reached the panel and that the
strict channel got its headers on every request.

It replaces Server Side Live's channel list (`PUT /api/live/sources`), which
nothing in the interface uses yet. It does not touch the Live TV playlist you
set in Settings.

The automated suite (`tester.test.ts`) covers the same ground and more, for
both paths — Server Side Live and the Live TV screen's `/api/live/stream` hop —
including byte-for-byte segment comparison and decrypting channel 102.

## Why not BBC One

BBC One is not public domain. Its live streams are only served to UK
addresses, watching them live needs a TV licence, and the BBC does not offer
them for relaying through a proxy — so a test that depended on one would fail
abroad, could break whenever the BBC changes a URL, and would be pointing TVM's
proxy at a broadcaster that has not agreed to it. A local panel tests exactly
the same code paths, every time, anywhere.
