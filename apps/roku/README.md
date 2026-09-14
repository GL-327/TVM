# TVM on Roku

The product UI is `apps/ui` (the same React app as desktop Electron). On this PC,
`TVM-roku.cmd` opens **that UI** in a 1920×1080 TV frame.

A Roku box cannot run Chromium or React. The sideloaded `tvm-roku.zip` is a
SceneGraph client that talks to Core over HTTP. It will not look identical to
desktop. Use the PC TV preview to judge the living-room look; use the zip only
to test a real remote and Roku playback.

The Electron app, Debian appliance, and `apps/ui` stay as they are.

## What this channel does

1. Launches with TVM branding.
2. Moves with the Roku remote (Up / Down / Left / Right). OK activates the
   focused item. Back closes overlays and returns. Back on Home does not exit.
3. Shows a white focus ring on the current item.
4. Loads Home from `GET /api/home` when Core is reachable. The hero matches the
   desktop watchline: **WATCH NOW** | source, Learn More underneath, and dots
   when Core returned more than one featured title. Both WATCH NOW and Learn
   More open details, as on desktop.
5. Opens Library, Watchlist, Search, Live TV, Household, Profiles, Apps, and
   Settings against the same Core APIs the React app uses.   The Home ribbon
   matches the desktop order: Profile, Inputs, Search, Home, Live TV,
   Watchlist, TVM Stream, Netflix, Prime Video, Freevee, YouTube, Disney+, Hulu,
   Apps, Settings.
6. Plays a stream Core returns from `POST /api/playback` on the Roku `Video`
   node, with custom overlay chrome (±10s, auto-hide). Progress is posted to
   `POST /api/progress`. Without Real-Debrid, Core still answers `unavailable`
   — paste a token on the Real-Debrid screen.
7. Saves titles with `PUT /api/watchlist`. Details is a full-bleed backdrop
   with poster, IMDb score, seasons/episodes for series, Play / My List / Back.
8. Apps tiles open **TVM mock studio hubs**, not the licensed Netflix/etc.
   channels. `GET /api/apps/:id` returns originals (TVMaze network match +
   curated films). Playback is still TVM Stream / Real-Debrid.

Layout for the **sideloaded channel** is a 3840×2160 SceneGraph canvas, scaled
on the box with `min(uiWidth/3840, uiHeight/2160)`. That is not the PC preview.
The PC preview is `apps/ui` at 1920×1080.

The Roku Home button always leaves the channel. That is a platform rule; TVM
cannot catch it.

This channel does **not** embed Netflix-style official apps, switch HDMI inputs,
or apply Core updates. Those stay in the existing TVM app. Studio tiles are
TVM catalogs of originals, labeled as such.

## Configure the Core URL

Roku cannot use `http://127.0.0.1:7345`. That address is the Roku itself.

1. On the computer that runs Core, find its LAN IPv4 address (`ipconfig` on
   Windows, look for the Wi-Fi or Ethernet adapter, not `127.0.0.1`).
2. Copy [`config.example.json`](config.example.json) to `config.json` in this
   folder.
3. Replace `YOUR-PC-LAN-IP` with that address. Keep the port unless you changed
   `TVM_CORE_PORT`:

```json
{
  "coreBaseUrl": "http://192.168.1.20:7345"
}
```

`config.json` is gitignored. Do not commit a machine-specific address. Never put
`TVM_LAN_TOKEN` in `config.json` or in the sideload zip.

You can also enter the URL on the device: the first launch opens a setup screen
if no URL is stored. After the URL, enter the same `TVM_LAN_TOKEN` used to start
Core (32 to 512 characters). Settings can edit the URL and the token later. Both
values live in the Roku registry and override `config.json`. The registry is not
an encrypted vault.

## Test on this PC (no Roku required)

Double-click `TVM-roku.cmd` in the repo root, or:

```powershell
.\TVM-roku.cmd
```

That starts Core on loopback (`127.0.0.1`, no Wi-Fi required), starts the Vite UI if
needed, rebuilds `apps/roku/tvm-roku.zip`, and opens the **desktop interface** at:

```
http://127.0.0.1:5173/?tv=1
```

Same React/CSS as `TVM.cmd`. The `?tv=1` flag only letterboxes a 1920×1080
stage, maps the usual remote keys (arrows / Enter / Esc), and hides OS
scrollbars. It is not a second visual language.

`http://127.0.0.1:7345/roku-preview/` is a thin loader that iframes that same
UI. Bookmark the Vite URL.

If the UI 404s, Vite is not running. Run `TVM-roku.cmd` again (it starts it).
If a Roku cannot reach Core, a desktop launcher probably started Core on
loopback. Close that Core/TVM window and start again with LAN bind and
`TVM_LAN_TOKEN`.

To start Core on the LAN and sideload onto a TV in developer mode:

```powershell
$env:TVM_LAN_TOKEN = "<random 32+ characters>"   # type this on the Roku
$env:TVM_ROKU_HOST = "192.168.x.x"              # the Roku, not this PC
$env:TVM_ROKU_PASSWORD = "your-rokudev-password"
.\TVM-roku.cmd -Sideload -Lan -CoreAddress 192.168.x.x   # this PC's LAN IPv4
```

Do not commit those values. Sideload is opt-in (`-Sideload`); the helper does
not probe Wi-Fi adapters just to open the PC preview. `-Lan` binds Core to
`0.0.0.0` and checks the bearer against this PC's LAN IP.

## Run Core so the Roku can reach it

Core binds `127.0.0.1` by default so TVM opens on a laptop with no Wi-Fi and
Windows does not ask to allow Node on public networks. A Roku cannot use
`127.0.0.1` (that is the Roku itself). For a box on the same private LAN:

```powershell
$env:TVM_CORE_BIND = "0.0.0.0"
$env:TVM_LAN_TOKEN = "<random 32+ characters>"
$env:TVM_ENV = "development"
corepack pnpm --filter @tvm/core dev
```

LAN clients must send `Authorization: Bearer <TVM_LAN_TOKEN>`. The channel
stores that token in the Roku registry and adds the header on every Core API
call and on Core-hosted streams. Phone/browser pairing uses
`POST /api/lan/session` to mint an HttpOnly `tvm_lan_session` cookie from the
same bearer; the Roku does not use that cookie path. Admin, billing, privacy,
update and maintenance routes stay loopback-only. `/api/health` is the only
unauthenticated LAN GET.

Use this PC's IPv4 address as the Core URL (`http://192.168.1.20:7345`), not a
DNS name and not `0.0.0.0`. The Host header must match Core's listen interface.
Allow the Node process on the Windows **private** network. Do not forward port
7345 on the router.

A Core that prints `listening on http://127.0.0.1:7345` is unreachable from
the Roku even with the correct token. Close that process and start with
`TVM_CORE_BIND=0.0.0.0`. After a LAN bind you should see `0.0.0.0` (or the NIC
address) and the `TVM_LAN_TOKEN` reminder.

Leave `pnpm dev` (Electron) as it is for the existing UI. You can run Core with
`TVM_CORE_BIND` and `TVM_LAN_TOKEN` in one terminal and the rest of TVM as usual
in another.

The product for this version is the sideloaded `tvm-roku.zip` over private-LAN
HTTP. This is not a Channel Store or HTTPS release.

## Enable Roku developer mode

On the Roku, from the home screen, press:

**Home** three times, **Up** twice, **Right**, **Left**, **Right**, **Left**, **Right**.

Follow the on-screen steps. Set a developer password. Note the Roku's IP
address shown on that screen.

## Package and sideload

From this folder:

```powershell
.\scripts\package.ps1
```

That writes `tvm-roku.zip`. On a PC browser open `http://<roku-ip>` (developer
username `rokudev`, plus the password you set). Upload the zip under **Install
and restart**.

If you created `config.json` before packaging, it is included in the zip. If
not, use the on-device setup screen after sideload.

Laptop copies of both the windowed desktop app and this Roku zip live in
`Desktop/` at the repo root. `Install-to-Desktop.cmd` puts them on your Desktop.

Check the project without a Roku:

```bash
node apps/roku/scripts/check.mjs
```

## Test remote navigation

After sideload:

1. The splash and then either Setup or Home should appear. Setup asks for the
   Core LAN URL, then the same `TVM_LAN_TOKEN` running on the PC. A wrong token
   is rejected; a matching token loads Home and is remembered across restarts.
2. Move between ribbon items with Left / Right. The focused item has a white
   ring and a visible label. The ribbon matches the desktop: Profile, Inputs,
   Search, Home, Live TV, Watchlist, TVM, Apps, Settings.
3. Down from Home's ribbon reaches poster rails when Core returned titles.
   Left / Right wrap on a rail. Up returns to the ribbon, then Learn More, then
   WATCH NOW.
4. OK on WATCH NOW or Learn More opens details (Play, My List, Back), matching
   desktop. OK on a poster also opens details.
5. Ribbon Search opens an on-screen keyboard. Live TV / Watchlist / Profile /
   Settings / Apps open those screens. Apps tiles open TVM originals hubs.
6. Back closes overlays. Back on Home stays on Home.
7. Settings can edit the Core URL and device access token, open the Real-Debrid
   screen, set a live playlist, open Profiles, and show network status. Display
   reports the 4K canvas scale. Billing, updates, cache wipe and factory reset
   stay on the computer.

## Limitations

- The PC TV preview is `apps/ui`. A Roku cannot load that stack. Hardware remains
  a separate SceneGraph client and will drift visually from desktop.
- A physical Roku has not been accepted. Building `tvm-roku.zip` is not device
  verification. There is no Channel Store package.
- LAN clients without a valid bearer are rejected (except `/api/health`).
  Admin, billing and privacy routes stay on the computer. HTTP on the LAN is
  not encrypted. Do not expose Core to the internet.
- The token is stored in the Roku channel registry. Do not embed it in
  `config.json` or the zip.
- `packages/nav` is TypeScript. This channel reimplements the same intent and
  view-stack rules in BrightScript; it does not import that package.
- Roku plays HLS / DASH / MP4 when Core returns a direct URL. Many other
  containers need ffmpeg on the Core host; without it, Core only serves
  MP4/WebM and some H.264 MKV. mpv is the desktop player, not the Roku path.
