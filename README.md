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
| `apps/core` | Local service on `127.0.0.1`. Owns all business logic, and serves the interface in production |
| `apps/shell` | Electron kiosk window for the Windows SKU |
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
| `TVM_UI_URL` | Origin the shell loads |
| `TVM_WINDOWED=1` | Run the shell in a window instead of fullscreen |
| `TVM_ENV=production` | Shell goes kiosk and loads the interface from core |

## The appliance

See [os/README.md](os/README.md). In short: a flash drive plugged into a
television's USB port cannot boot an operating system. TVM boots a small x86
computer from USB, and that computer drives the television over HDMI.

## Rules that are not negotiable

- **No secrets in the repository.** Not in source, not in committed env files,
  never in the interface bundle. Credentials belong in the operating system's
  credential store, reached only by core.
- **Core binds `127.0.0.1`.** It holds credentials, so it is never exposed to
  the network.
- **No torrent indexing, magnet search or scraping.** Real-Debrid is a client
  for files the user already owns and links the user supplies, not a search
  engine.
- **Everything works with arrows, OK and Back.** A control that needs a pointer
  is not finished.
