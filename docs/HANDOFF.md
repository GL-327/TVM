# TVM handoff and work queue

Working notes for whoever picks TVM up next. The architecture is settled in
[TVM_IMPLEMENTATION_PLAN.md](TVM_IMPLEMENTATION_PLAN.md); this file records
what is actually built, what is blocked, and what to do next.

Read the plan's section O before writing code. Nothing here overrides it.

## Start here

If you are picking this up cold, in this order:

1. **Section 7, the gotchas table.** Every row cost time once already. Reading
   it takes two minutes and saves more.
2. **Section 4, Phase 2.** This is the work. The hard part, the view stack
   reducer, is finished and tested; what remains is wiring it to React and
   building screens on top.
3. **Section 5, the provider contract**, before touching anything to do with
   media. Getting this shape wrong is expensive to undo later.

Do not start with the operating system image. It builds and boots, and the only
thing left there needs physical hardware.

Two rules that are not negotiable, both from the plan:

- **No secrets in the repository, in a bundle, or in a log.** The Real-Debrid
  token is the user's and lives in the OS credential store.
- **No torrent scraping and no Torrentio.** Real-Debrid is limited to the
  user's own cloud files and links they supply.

---

## 1. Where the project actually is

| Phase | State |
| --- | --- |
| 0. Plan in repo | **Done.** Committed |
| 1. Skeleton and bootable hello | **Done except real hardware.** Builds, boots in QEMU, remote-driven |
| 2. Shell and remote navigation | **Started.** The view stack is built and tested; nothing is wired to React yet |
| 3-11 | Not started |

### Verified working

- `pnpm build`, `pnpm test` (36 tests), `pnpm typecheck` all pass
- Core serves the built interface and its API on `127.0.0.1:7345`
- The Electron shell loads the interface, in kiosk or windowed mode
- Remote navigation on the splash, confirmed by driving the real window over
  the DevTools protocol: focus starts in the right place, moves with arrows,
  clamps at both ends, OK opens the panel, Back closes it and restores focus
- Path traversal against the static file server returns 404
- The Vite dev server proxies `/api` to core
- **The appliance image builds and boots.** mkosi 25.3 under WSL2 Debian 13
  produces a 2.7 GB UEFI image that boots in QEMU to the splash with no
  desktop, no login prompt and no boot log, with core healthy and the keyboard
  driving focus, OK and Back

### Not yet done

**Real hardware.** Section D of `os/BOOT_CHECKLIST.md`: a mini-PC, a
television, a USB stick and a remote. Nothing in a VM substitutes for it, and
the cursor and overscan questions can only be settled there.

Boot to splash took roughly 150 seconds in QEMU on a first boot, which is far
too slow. Measure a second boot before optimising; it is a Phase 11 concern,
not a Phase 1 blocker.

---

## 2. The build environment, already working

WSL2 Debian 13 is installed and the image builds there. This is the exact
environment, recorded because two of these steps are not obvious.

```bash
sudo apt install -y mkosi systemd-ukify systemd-boot-efi ovmf \
                    qemu-system-x86 mtools dosfstools e2fsprogs \
                    debian-archive-keyring netpbm socat git curl

# Debian ships Node 20, whose bundled corepack cannot launch pnpm 11.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pnpm@11.22.0
```

Two traps worth knowing:

- **Do not use corepack here.** It fails with
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. Install pnpm with npm instead. If a
  broken `/usr/bin/pnpm` shim is left behind, npm refuses to install over it,
  so delete it first.
- **Do not build on `/mnt/c`.** It is slow. Clone into the Linux filesystem
  with `git clone /mnt/c/Users/Gathe/Desktop/TVM ~/TVM`, which has the pleasant
  side effect of proving the committed tree builds.

Nested virtualization works, so QEMU runs with `accel=kvm`.

---

## 3. Phase 1 is built and booted

```bash
cd ~/TVM/os
./scripts/stage-app.sh
mkosi --force
./scripts/qemu-smoke.sh
```

This produces a 2.7 GB `output/tvm-appliance.raw` that boots to the splash.
Results and the four defects fixed on the first run are recorded at the bottom
of `os/BOOT_CHECKLIST.md`.

**What remains is section D: real hardware.** Flash the image to a USB stick,
boot a mini-PC from it into a television, and work through every box. Expect to
find things a VM cannot show: overscan, HDMI-CEC, audio routing, the cursor,
and the real boot time. `os/README.md` has a stage-by-stage walkthrough and,
more importantly, two ways to find out why a black screen is black.

That section is waiting on hardware, not on skill: the image is 2.7 GB and the
only sticks currently available here are 2 GB. It is not worth slimming to fit
one. Around 400 MB could go by dropping locales, docs and Vulkan, which still
would not fit, and the next saving after that means an initrd built for one
machine's hardware, which defeats the purpose of a portable stick. Phase 8's
A/B slots need roughly 8 GB anyway. The measurements are in `os/README.md`.

Two known problems to pick up there:

- **Boot to splash took about 150 seconds** in QEMU on a first boot. Measure a
  second boot before optimising, then find where the time actually goes with
  `systemd-analyze blame` rather than guessing.
- **Hardware decode firmware is non-free.** Adding it means enabling the
  `non-free-firmware` component. Phase 10 work, not a Phase 1 fix.

Do not paper over a failure by disabling the kiosk and leaving a desktop
behind. A visible desktop is a failed appliance.

---

## 4. Finish Phase 2: remote navigation everywhere

The hard part is done. `packages/nav` now contains:

- `intents.ts` — remote keys normalised into intents. Screens must never read
  `event.key` directly.
- `viewStack.ts` — a pure reducer holding the navigation rules, with 25 tests
  covering the invariants.

The rules the reducer already guarantees, which the React layer must not
undermine:

- The root can never be popped, so Back cannot empty the stack
- A modal always closes before the screen beneath it
- Pushing a screen never strands a modal underneath
- Transient entries (a preview a player was launched from) are dropped when
  the thing above them closes
- Every entry remembers its own focus, restored on return

### 4a. Bind the view stack to React

New file `apps/ui/src/nav/ViewStackProvider.tsx`.

- `useReducer(viewStackReducer, createViewStack('home'))`
- Context exposing `{ state, dispatch }`, plus hooks `useViewStack()` and
  `useNavigate()` returning `{ push, pushModal, replace, pop, home }`
- One `onIntent(window, ...)` subscription at this level, and only here:
  `back` dispatches `pop()`, `home` dispatches `home()`
- Render `visibleScreen(state)`, then `openModals(state)` above it
- Key each rendered screen by `entry.key`, never by `entry.name`, or two
  pushes of the same screen will share component state

### 4b. Focus engine

The plan chose `@noriginmedia/norigin-spatial-navigation`. Install it in
`apps/ui` and wrap it; do not scatter its API across screens.

- `FocusRoot` initialises the library once, with `nativeMode: false`
- Screens register a focus context; each declares its default focus
- On a transition, apply `focusToRestore(state)` if it is non-null, otherwise
  the screen's declared default. Never leave nothing focused.
- Before navigating away, dispatch `rememberFocus(currentFocusKey)`
- Modals must trap focus. Nothing behind an open modal may be reachable.

The one rule that matters: **it must be impossible to end up with no focused
element.** If a screen can reach that state, it is not finished.

### 4c. Dummy screens

Enough to exercise the stack, not real features: `home`, `library`, `details`,
`settings`, a confirm modal, and `recovery`. Plain lists of focusable buttons
are fine. Phase 3 makes them look like a product.

### 4d. Playwright keyboard suite

`apps/ui`, keyboard only. **Never use `page.click()`**; if a test needs the
mouse, the interface has failed. Cover:

- Arrow keys move focus in every direction on every dummy screen
- Something is always focused, after every single key press
- Back from a depth of three returns Home one step at a time
- Back at the root does not blank the screen
- A modal traps focus, and Back closes the modal rather than the page
- Focus is restored to the same element after returning to a screen

### 4e. Watchdog

Windows: the shell relaunches the renderer if it crashes. Linux: already
handled by `Restart=always` in `tvm-session.service`. Three crashes in 60
seconds must show the recovery screen rather than loop. Full safe mode is
Phase 9; Phase 2 only needs the crash counter and the screen.

---

## 5. Phase 5 provider contract, decided in advance

Do not improvise this shape. Everything in Phases 5 to 7 implements against
it, and the boundary is what keeps credentials out of the interface.

```ts
// apps/core/src/providers/types.ts — internal to core. The UI never imports this.

export type ProviderId = string;                 // 'jellyfin' | 'local' | 'tmdb' | ...
export type MediaId = `${ProviderId}:${string}`; // always namespaced, never bare

export interface ProviderManifest {
  id: ProviderId;
  name: string;
  capabilities: ReadonlyArray<'catalog' | 'meta' | 'children' | 'playback' | 'search' | 'progress'>;
}

/** Playback resolution either succeeds or explains itself. Never throw for the ordinary cases. */
export type PlaybackResolution =
  | { kind: 'stream'; url: string; headers?: Record<string, string>; subtitles?: Subtitle[] }
  | { kind: 'unavailable'; reason: 'not-in-library' | 'not-configured' | 'needs-auth' | 'region-blocked' };

export interface Provider {
  manifest(): ProviderManifest;
  catalogs?(): Promise<Catalog[]>;
  browse?(catalogId: string, page: number): Promise<MediaSummary[]>;
  search?(query: string): Promise<MediaSummary[]>;
  metadata?(id: MediaId): Promise<MediaDetail>;
  children?(id: MediaId): Promise<MediaSummary[]>;   // seasons, episodes
  resolvePlayback?(id: MediaId): Promise<PlaybackResolution>;
}
```

Rules that go with it:

- **IDs are always namespaced.** `jellyfin:abc`, never `abc`. Merging search
  results across providers depends on it.
- **`unavailable` is a value, not an exception.** A TMDB result with no
  playback source shows "Not in your libraries" and no Play button. Never show
  a Play button that cannot play.
- **Credentials never leave core.** The interface may know
  `{ configured: true, username }`. It may never see a token. There is no code
  path where a token reaches the renderer.
- **A provider failing is not core failing.** One dead provider degrades its
  own rows and leaves the rest of the home screen working.
- **Redact before logging.** `Authorization`, tokens and cookies never reach a
  log file.

`packages/types` holds the core-to-interface DTOs only, which is a narrower set
than the above. Providers stay invisible to the interface.

---

## 6. Later phases, unchanged

Phases 3, 4 and 6 to 11 stand as written in the plan. Nothing found so far
contradicts them. Two notes worth carrying forward:

- **Phase 6 replaces Chromium with the Electron shell plus an mpv plane on the
  appliance.** `start-session.sh` is written so only its final `exec` line
  changes.
- **Phase 7 must not regress the credential boundary.** The Real-Debrid token
  is entered in the wizard, stored by the operating system, and used only for
  `/user`, `/downloads` and `/unrestrict/link`.

---

## 7. Gotchas already paid for

These cost time once. They should not cost it twice.

| Thing | What to know |
| --- | --- |
| pnpm is not on PATH | `corepack enable` needs an elevated terminal here. Otherwise prefix everything: `corepack pnpm install` |
| TypeScript 7 | Installed as `^7.0.2`. `moduleResolution: node10` was **removed**; use `nodenext`. Old tsconfig snippets will fail |
| pnpm 11 settings | `onlyBuiltDependencies` lives in `pnpm-workspace.yaml`, not `package.json`. pnpm warns and ignores it in the wrong place |
| Electron's binary | pnpm blocks install scripts by default. It is approved in `pnpm-workspace.yaml`, but if `node_modules/electron/dist` is missing after install, run `node install.js` inside the electron package |
| Line endings | A CRLF shell script fails on Linux with `bad interpreter: /bin/sh^M`. `.gitattributes` forces LF. Never disable it |
| Core dev runs TypeScript directly | `node --watch src/index.ts`. Node 24 strips types natively, so there is no tsx or ts-node in the tree. Keep core free of TypeScript-only runtime features such as enums and decorators |
| Why core serves the interface | One same-origin transport. The alternative needs CORS in development and breaks from `file://` in a packaged app |
| Ports | Core 7345, Vite 5173. `strictPort` is on because the shell polls that exact origin |
| Driving the shell for verification | Launch Electron with `--remote-debugging-port=9222`, then use the DevTools protocol over the WebSocket built into Node. This is how remote navigation was verified without a browser |
| `TVM_WINDOWED=1` | Runs the shell in a window instead of fullscreen. Essential when developing on a desktop |
| pnpm inside WSL2 | Debian's Node 20 has a corepack too old for pnpm 11; it dies with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. Install Node 22 and then pnpm with npm. Delete any leftover `/usr/bin/pnpm` shim first, or npm refuses to overwrite it |
| Build in the Linux filesystem | `git clone /mnt/c/Users/Gathe/Desktop/TVM ~/TVM`. Building on `/mnt/c` is slow, and cloning has the side effect of proving the committed tree builds. Bundle hashes came out identical to the Windows build |
| mkosi fails late, not early | A missing kernel is only reported after the whole image is built. Read the last line of the log, not the first error you see |
| mkosi appends the format suffix | `Output=tvm-appliance`, not `tvm-appliance.raw`, or you get `.raw.raw` |
| Nothing may prompt at boot | `systemd-firstboot` will stop the boot and ask the television to configure itself. It is preset and masked. Any new unit that can ask a question is a bug |
| Debugging on hardware | There is no console, so the journal is configured to persist. Power off, read the stick from WSL2 with `wsl --mount`, and use `journalctl -D`. `os/README.md` has the commands |
| A 2 GB stick is too small | The image is 2.7 GB, roughly 1.6 GB of it real content. Do not shrink it by building a machine-specific initrd; that breaks the one thing a USB appliance must do |
| One network manager only | mkosi enables systemd-networkd and Debian enables NetworkManager. Both together race for the interfaces and look like flaky internet rather than a misconfiguration. TVM keeps NetworkManager, for the Wi-Fi screen's sake. Check `multi-user.target.wants` after changing packages |

---

## 8. Things that must not happen

Repeating these because they are the ones a hurried session gets wrong.

- No secrets in the repository, in any form, ever
- No Torrentio, torrent search, magnet handling or index scraping
- Core binds `127.0.0.1`, never `0.0.0.0`
- No code copied from stremio-web, stremio-core, or the Dodgy Fire Stick
  prototype
- No control that needs a mouse
- No `--no-verify`, and no force-push to `main`
