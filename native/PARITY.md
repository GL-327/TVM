# Desktop migration status

Electron is retired: `apps/shell`, its runtime dependency, download hooks and browser preload bridges have been removed.

Windows runs the C++20 Win32/Direct2D renderer and mpv. It includes catalogue/search/details, service hubs, profiles, watchlist/progress, Live TV, playback controls, downloads, settings, legal/data tools, diagnostics and recovery. Light/dark themes and native navigation, grids, forms and player controls reflow at narrow sizes.

The C++ desktop uses the shared Core for account registration/sign-in, terms/email verification, developer roles, activation/admin/mail operations, per-account media keys and plan-limited media resolution. Sessions are encrypted locally. Unusable accounts cannot open the library, and role/tier checks also guard navigation.

Donations use the existing Stripe payment screen in the system browser. Official service websites also open in the browser. The standalone donation route cannot navigate into the private library. Installed native renderer updates verify GitHub's digest/build identity and retain a rollback copy; Core/UI keep their existing verified update mechanism.

The shared Core and UI remain required products, not legacy leftovers. macOS/Linux desktop use the browser UI; iOS and Android bundle it with their native playback hosts. Roku retains its own TV UI. Mobile/desktop browser tests cover narrow, wide, portrait and landscape viewports. Native snapshots and unit tests cover Windows layout/input; physical device playback and accessibility still require hardware QA.

See [native setup](README.md), [desktop setup](../docs/DESKTOP.md) and [platforms](../docs/PLATFORMS.md). Git history retains the retired shell and USB appliance source if needed.
