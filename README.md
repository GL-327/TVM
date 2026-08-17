# TVM

A remote-first television appliance. A small computer boots TVM from USB,
outputs HDMI to a television, and is driven entirely with a D-pad remote: your
own media, licensed sources you already pay for, and the streaming services you
already subscribe to, behind one home screen.

**Status: Phase 1** — repository skeleton and a bootable splash. The
architecture is fixed in
[docs/TVM_IMPLEMENTATION_PLAN.md](docs/TVM_IMPLEMENTATION_PLAN.md); read it
before changing anything structural.

## Layout

| Path | What it is |
| --- | --- |
| `apps/ui` | React interface, built for a ten-foot viewing distance |
| `apps/core` | Local service on `127.0.0.1` by default. Owns all business logic, and serves the interface in production |
| `apps/shell` | Electron kiosk window for the Windows SKU |
| `apps/roku` | Roku SceneGraph client. Talks to Core over HTTP on the LAN; see [apps/roku/README.md](apps/roku/README.md) |
| `packages/design` | Design tokens: colour, type scale, spacing, motion, focus |
| `packages/nav` | Remote input normalised into intents |
| `os/` | The Debian appliance image, USB flashing and the boot checklist |
| `docs/` | Architecture and implementation plan |

The interface never talks to a provider or holds a credential. It talks to core
over `/api`, and core talks to everything else.

## Prerequisites

- Node.js 22 or newer
- pnpm 11, via corepack: `corepack enable pnpm`

On Windows, `corepack enable` writes into `C:\Program Files\nodejs` and needs an
elevated terminal. Without it, prefix commands with `corepack`, as in
`corepack pnpm install`.

## Commands

```bash
pnpm install
pnpm dev          # core on 7345, interface on 5173, Electron kiosk
pnpm build
pnpm test
pnpm typecheck
```

In development the Vite server serves the interface and proxies `/api` to core.
In production core serves both, so the interface is always same-origin with its
API and there is no CORS layer to get wrong.

Useful environment variables:

| Variable | Effect |
| --- | --- |
| `TVM_CORE_PORT` | Core's port. Default 7345 |
| `TVM_CORE_BIND` | Core's listen address. Default `127.0.0.1` so TVM opens with no Wi-Fi. Set `0.0.0.0` only when a Roku on the LAN must reach Core. Core has no API auth |
| `TVM_UI_URL` | Origin the shell loads |
| `TVM_WINDOWED=1` | Run the shell in a window instead of fullscreen. `TVM-windowed.cmd`, `Desktop/TVM.cmd`, and the Desktop copies set this; `TVM.cmd` does not |
| `TVM_ENV=production` | Shell loads the interface from core |
| `TVM_ROKU_HOST` / `TVM_ROKU_PASSWORD` | Optional. `TVM-roku.cmd` uses these to sideload `apps/roku/tvm-roku.zip` onto a developer-mode Roku |

On this PC, double-click `TVM-roku.cmd` to start Core and the UI, then open the **desktop interface** in a 1920×1080 TV frame at `http://127.0.0.1:5173/?tv=1`. That is the same React app as `TVM.cmd`, not a separate channel mock. A Roku cannot run that UI; sideload `apps/roku/tvm-roku.zip` only to exercise SceneGraph on hardware.

## Laptop / Desktop copies

The living-room launcher (`TVM.cmd`) is a fullscreen kiosk. For a laptop, use the windowed copies:

| Copy | How to run |
| --- | --- |
| Desktop app (windowed) | `Desktop/TVM.cmd` (Windows) or `Desktop/TVM.sh` (Linux/macOS) |
| Roku preview + zip | `Desktop/TVM-roku.cmd` or `Desktop/TVM-roku.sh` |

Double-click `Install-to-Desktop.cmd` (or run `scripts/copy-to-desktop.sh`) to put **both** the windowed desktop app and the Roku sideload zip on your Desktop:

- `TVM.cmd` / `TVM.sh` — window sized to the laptop work area, mouse cursor visible
- `TVM Roku.cmd` / `TVM-roku.sh` — TV-frame preview of the same UI
- `TVM-roku.zip` — sideload onto a developer-mode Roku

## The appliance

See [os/README.md](os/README.md) and [os/USB.md](os/USB.md). In short: a flash
drive plugged into a television's USB port cannot boot an operating system.
TVM boots a small x86 computer from USB, and that computer drives the
television over HDMI. On this PC run `os/scripts/prepare-usb.ps1` to copy the
flash kit onto D:.

## Rules that are not negotiable

- **No secrets in the repository.** Not in source, not in committed env files,
  never in the interface bundle. Credentials belong in the operating system's
  credential store, reached only by core.
- **Core binds `127.0.0.1` by default.** It holds credentials, so the appliance
  and production Electron SKU never expose it. A Roku on the LAN needs
  `TVM_CORE_BIND=0.0.0.0`; laptop launchers do not, so Windows never asks to
  allow Node on Wi-Fi.
- **No torrent indexing, magnet search or scraping.** Real-Debrid is a client
  for files the user already owns and links the user supplies, not a search
  engine.
- **Everything works with arrows, OK and Back.** A control that needs a pointer
  is not finished.
