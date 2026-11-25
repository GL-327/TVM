# Changelog rules

Every TVM app (Windows, web, desktop, iPhone, Android, Roku) shows the notes in
`packages/content/changelog.json`: once in the corner of Home after an update,
and in full under Settings > What's new. These rules apply to every change, by
anyone, human or agent.

## Always

1. A change a viewer can notice adds a line to the newest release in
   `packages/content/changelog.json`, in the same commit. Fixes count.
2. A release goes out with a version bump in the root `package.json`, and the
   newest release's `version` matches it. `pnpm check` fails otherwise.
3. Older releases are never rewritten, only corrected for facts.
4. A line that only applies to some apps lists them in `platforms`
   (`windows`, `web`, `desktop`, `ios`, `android`, `roku`). No `platforms`
   means every app.

## How it reads

Short, plain and specific, like a note from the person who made it.

- Say what changed for the viewer, then why it matters if that isn't obvious.
  "Volume slider now goes to 200%." Not "Improved volume handling."
- One line per change, 110 characters at most. Highlights: four at most.
- Name the real thing: the button, the page, the show.
- No hype or filler: seamless, effortless, robust, enhanced, elevate,
  delightful, unleash, supercharge, game-changing, streamlined, leverage,
  comprehensive, cutting-edge, "we're excited".
- No emoji, no exclamation marks, no "we've", no "various improvements".
- The release `title` is a few words about the update as a whole.

`scripts/check-changelog.mjs` enforces the shape, the version match, the
length limits and the banned words.
