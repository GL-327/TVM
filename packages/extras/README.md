# TVM Extras

`createExtras({ fetch, cache?, now?, timeoutMs? })` provides segments, subtitles,
WebVTT conversion, trailers, collections, upcoming episodes and anime titles.
All runtime code in `src/index.ts` is pure TypeScript using Web APIs. The default
deadline is six seconds, including response bodies. Failures return empty values;
successful lookups are cached and simultaneous identical requests are shared.
`summarizeWatchHistory` and `watchedDelta` calculate local stats without fetching.

Build with `corepack pnpm --filter @tvm/extras build` after changing shared code.
The package exports JavaScript and declarations from `dist` for UI fallbacks.
The existing workspace glob already includes the package.

Core's release copies only its own `dist` tree and has no runtime dependencies.
`sync-core.mjs` therefore copies the canonical shared TypeScript into a marked
generated block in `apps/core/src/providers/extras.ts`. Core's regular `tsc`
includes it in the standalone release. Edit the package source, then build;
never edit that generated block. Package tests and typechecking detect drift.
The install `prepare` step also builds and syncs the adapter on a fresh install.

Core supplies the disk cache, profile preferences, sealed local history,
certificate filtering, HTTP routes and a 1.45-second playback enrichment budget.
Subtitle files require HTTPS strem.io hosts, reject redirects, and are limited to
2 MB each. Core keeps at most 32 subtitle files on disk and eight in memory.
