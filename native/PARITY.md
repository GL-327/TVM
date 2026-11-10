# Native parity status

The older phase-by-phase notes described an external development copy and
understated the features now present in native/src. This file describes the
current repository. Source references are relative to the repository.

## Implemented

Catalogue/search/details/service hubs, profiles/watchlist/progress,
Real-Debrid, Live TV login/playlists/channel selection, mpv playback,
downloads, diagnostics, recovery, legal/data controls and developer
administration all have native implementations.

The native UI now includes the shared app's supported Light and Dark looks.
Preferences survive motion/performance changes and retain unknown fields.
Navigation links, profile grids, info-page actions, details and player controls
reflow for narrow windows instead of relying only on a scaled 1080p layout.
Download filenames and collision handling follow the Electron downloader's
rules. An incomplete transfer is a failure and leaves no output reservation.

The shared browser UI retains responsive portrait/landscape layouts and
safe-area/keyboard handling used by the iOS and Android shells. Roku retains
its own TV layout and native video player. None of those clients is replaced
by the Windows-specific renderer.

## Remaining before retiring Electron

- Account-holder registration/login, activation, terms/email-verification
  and account/billing/donation flows in the C++ UI.
- Verified automatic native binary installation/restart, distinct from the
  shared Core/UI update feed.
- Native macOS/Linux implementations if those desktops are to stop using
  the shared browser/Electron path.
- Full visual, accessibility and playback QA on physical target devices.
  Matching motion constants or compiling a client does not establish parity.

The shared Core, UI and Electron shell remain intentional compatibility
components. The retired USB appliance and unreachable legacy cosmetic themes
are separate cleanup candidates; they are not required for any supported
client.

See README.md for native build/run instructions and ../docs/PLATFORMS.md for
the supported products. The native Windows workflow checks builds, unit tests,
snapshots and the install layout on every relevant main/PR change.
