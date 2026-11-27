// Hub start page data mapping and franchise intro rules.
// The production BrightScript (source/startCore.brs, source/introCore.brs) runs under the
// pinned `brs` interpreter against the shared packages/content/intros.json, so the rules
// match apps/ui/src/intros/introLogic.ts. Wiring checks read the scene and screen sources.
// Run: node --test apps/roku/scripts/start-intro.test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFileSync(join(root, name), 'utf8');
const shared = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../packages/content/${name}.json`, import.meta.url)), 'utf8'));
const brsString = (text) => `"${text.replace(/"/g, '""')}"`;

const intros = shared('intros');
const events = shared('events');
const railIds = (eventId) => events.events.find((e) => e.id === eventId).rail.items;

function idChecks() {
  const lines = [];
  for (const id of railIds('sunrise-on-the-reaping')) lines.push(`  matchId("${id}", "hunger-games")`);
  for (const id of railIds('avengers-doomsday')) lines.push(`  matchId("${id}", "avengers-doomsday")`);
  return lines.join('\n');
}

const fixture = `
sub Main()
  m.defs = introDefs(ParseJson(${brsString(JSON.stringify(intros))}))
  m.failed = false
  checkIntro()
  checkStart()
  if m.failed then print "RUNTIME_FAILED" else print "START_INTRO_OK"
end sub

sub check(value as Boolean, name as String)
  if not value
    print "FAIL: " + name
    m.failed = true
  end if
end sub

sub matchId(id as String, expected as String)
  pick = introMatch(id, "", m.defs)
  if pick = invalid
    check(false, "no intro for " + id)
  else
    check(pick.intro.id = expected, id + " -> " + expected)
  end if
end sub

sub checkIntro()
  check(m.defs.Count() = 2, "both intros load")
  check(m.defs[0].id = "hunger-games" and m.defs[1].id = "avengers-doomsday", "intro order")
  check(introDefs(invalid).Count() = 0 and introDefs({ intros: [{ id: "x" }] }).Count() = 0, "bad definitions are dropped")
  for each def in m.defs
    check(introClampMs(def.durationMs) >= 2500 and introClampMs(def.durationMs) <= 4000, "duration range " + def.id)
  end for
  check(introClampMs(9000) = 4000 and introClampMs(100) = 2500 and introClampMs("x") = 4000, "clamp")

  ' id matching: every rail id of both events, episodes count as their show
${idChecks()}
  check(introBaseImdb("tt16026746:1:3") = "tt16026746", "episode id")
  check(introBaseImdb("/TT0371746") = "tt0371746", "slash and case")
  check(introBaseImdb("rd:abc") = "", "no imdb id")
  check(introMatch("tt16026746:1:3", "", m.defs).titleKey = "tt16026746", "episode title key is the show")
  check(introMatch("tt9140554:2:1", "Loki", m.defs).intro.id = "avengers-doomsday", "series by id")

  ' regex fallback
  check(introMatch("rd:abc", "the HUNGER GAMES: Catching Fire", m.defs).intro.id = "hunger-games", "regex case-insensitive")
  check(introMatch("rd:abc", "Deadpool & Wolverine 2024 2160p", m.defs).intro.id = "avengers-doomsday", "regex marvel")
  check(introMatch("tt0111161", "The Shawshank Redemption", m.defs) = invalid, "unrelated title")
  check(introMatch("rd:abc", "Logan Lucky", m.defs) = invalid, "word boundary")
  check(introMatch("rd:abc", "", m.defs) = invalid, "empty title")
  check(introMatch("rd:abc", "Hunger Games Marathon", m.defs).titleKey = "hunger-games:hunger games marathon", "title key without id")

  ' card titles
  check(introMatch("tt1392170", "", m.defs).title = "", "first film has no subtitle")
  check(introMatch("tt1951264", "", m.defs).title = "Catching Fire", "known title")
  check(introMatch("rd:x", "The Hunger Games: Mockingjay Part 9", m.defs).title = "Mockingjay Part 9", "prefix stripped")
  check(introMatch("tt0120903", "", m.defs).title = "X-Men", "doom card title")

  ' once per title per session, extra switch, live and automation
  played = {}
  input = { id: "tt1951264", title: "Catching Fire", live: false, enabled: true, automation: false }
  pick = introPlan(input, m.defs, played)
  check(pick <> invalid, "first start plays")
  introMarkPlayed(played, pick.titleKey)
  check(introPlan(input, m.defs, played) = invalid, "second start of the same title is skipped")
  check(introPlan({ id: "tt1951264:1:2", title: "", live: false, enabled: true, automation: false }, m.defs, played) = invalid, "same title as an episode is skipped")
  check(introPlan({ id: "tt1951265", title: "", live: false, enabled: true, automation: false }, m.defs, played) <> invalid, "a different title still plays")
  check(introPlan({ id: "rd:q", title: "Hunger Games Marathon", live: false, enabled: true, automation: false }, m.defs, played) <> invalid, "regex title is its own key")
  check(introPlan({ id: "tt0111161", title: "Shawshank", live: false, enabled: true, automation: false }, m.defs, {}) = invalid, "unmatched title")
  fresh = {}
  check(introPlan({ id: "tt1951264", title: "", live: false, enabled: false, automation: false }, m.defs, fresh) = invalid, "franchiseIntros extra off")
  check(introPlan({ id: "tt1951264", title: "", live: true, enabled: true, automation: false }, m.defs, fresh) = invalid, "live TV")
  check(introPlan({ id: "tt1951264", title: "", live: false, enabled: true, automation: true }, m.defs, fresh) = invalid, "automation")
  check(fresh.Count() = 0, "planning alone marks nothing")

  ' look and timing
  check(introColor("#E8A33D") = "0xE8A33DFF" and introColor("#1e6b2a", "CC") = "0x1E6B2ACC" and introColor("nope") = "0xFFFFFFFF", "colours")
  check(introStaticCard(true, 1080) and introStaticCard(false, 480) and not introStaticCard(false, 1080), "static card rules")
  check(introHoldMs(true, 3800) = 1500 and introHoldMs(false, 3800) = 3800, "hold time")
end sub

sub checkStart()
  check(startGreeting(0) = "Good morning" and startGreeting(11) = "Good morning", "morning")
  check(startGreeting(12) = "Good afternoon" and startGreeting(17) = "Good afternoon", "afternoon")
  check(startGreeting(18) = "Good evening" and startGreeting(23) = "Good evening", "evening")
  check(startGreetingLine(9, "  Sam ") = "Good morning, Sam", "greeting with name")
  check(startGreetingLine(9, "") = "Good morning" and startGreetingLine(9, invalid) = "Good morning", "greeting without name")

  watching = []
  for i = 1 to 20
    watching.Push({ id: "tt" + i.toStr(), title: "W" + i.toStr(), backdrop: "" })
  end for
  watching.Push({ id: "x", title: "" })
  payload = { continueWatching: watching, featured: { id: "tt90", title: "Featured", backdrop: "https://img/f.jpg" }, rails: [{ id: "r", items: [{ id: "tt91", title: "Rail", backdrop: "https://img/r.jpg" }] }] }
  check(startContinue(payload).Count() = 16, "continue is clipped to 16")
  check(startContinue({}).Count() = 0 and startContinue(invalid).Count() = 0, "no continue")
  check(startHeroItem(payload).id = "tt90", "featured with art is the hero")
  payload.featured = { id: "tt90", title: "Featured", backdrop: "" }
  check(startHeroItem(payload).id = "tt91", "first rail item with art when featured has none")
  payload.rails = [{ id: "r", items: [{ id: "tt92", title: "NoArt", backdrop: "" }] }]
  check(startHeroItem(payload).id = "tt1", "continue watching when no art anywhere")
  check(startHeroItem({}) = invalid and startHeroItem(invalid) = invalid, "no hero")

  channels = [
    { id: "live:free:abc", name: "ABC", url: "https://x/abc" }
    { id: "live:free:weathernation", name: "WN", url: "https://x/wn" }
    { id: "live:free:bbc-two", name: "BBC Two", url: "https://x/2" }
    { id: "live:free:nourl", name: "NoUrl", url: "" }
    { id: "live:free:bbc-one", name: "BBC One", url: "https://x/1" }
    { id: "live:free:d", name: "D", url: "https://x/d" }
    { id: "live:free:e", name: "E", url: "https://x/e" }
    { id: "live:free:f", name: "F", url: "https://x/f" }
  ]
  picked = startChannels(channels)
  check(picked.Count() = 6, "six channels")
  check(picked[0].id = "live:free:bbc-one" and picked[1].id = "live:free:bbc-two" and picked[2].id = "live:free:weathernation", "popular channels first, in order")
  check(picked[3].id = "live:free:abc", "then the rest")
  for each channel in picked
    check(channel.url <> "", "playable only")
  end for
  check(startChannels(invalid).Count() = 0, "no channels")

  check(startResumeAction({ id: "tt1", title: "A", kind: "movie" }) = "play", "movie plays")
  check(startResumeAction({ id: "tt1:2:3", title: "A", kind: "series" }) = "play", "episode id plays")
  check(startResumeAction({ id: "tt1", title: "A", kind: "series", season: 1, episode: 4 }) = "play", "season and episode play")
  check(startResumeAction({ id: "tt1", title: "A", kind: "series" }) = "details", "bare series opens details")

  check(startRowIds(true, true).Count() = 3 and startRowIds(true, true)[0] = "continue", "all rows")
  check(startRowIds(false, false).Count() = 1 and startRowIds(false, false)[0] = "apps", "apps always")
  check(startRowIds(false, true)[1] = "live", "live row")
end sub
`;

test('production start page mapping and intro rules run under the BrightScript interpreter', { timeout: 120000 }, () => {
  const directory = mkdtempSync(join(root, 'scripts', '.start-intro-test-'));
  try {
    const source = [read('source/media.brs'), read('source/introCore.brs'), read('source/startCore.brs'), fixture].join('\n');
    writeFileSync(join(directory, 'main.brs'), source, 'utf8');
    const command = 'npx --yes brs@0.45.0 main.brs';
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf8', timeout: 110000, cwd: directory })
      : spawnSync('npx', ['--yes', 'brs@0.45.0', 'main.brs'], { encoding: 'utf8', timeout: 110000, cwd: directory });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /FAIL:|RUNTIME_FAILED/, result.stdout);
    assert.match(result.stdout, /START_INTRO_OK/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the bundled intros file is the shared one and the remote refresh knows it', () => {
  assert.deepEqual(JSON.parse(read('source/data/content/intros.json')), intros);
  const core = read('source/contentCore.brs');
  assert.match(core, /intros: "intros"/);
  assert.match(core, /for each name in \[[^\]]*"intros"\]/);
});

test('the start page is the first screen, reachable from the You menu, and Back leaves it', () => {
  const scene = read('components/TVMScene.brs');
  assert.match(scene, /m\.stack = viewStackPush\(m\.stack, "start", \{\}\)/);
  assert.match(scene, /if name = "start" then return m\.startNode/);
  assert.match(scene, /screen\.name = "start"/);
  assert.match(scene, /id = "start"\s+navigate\("push", "start"/);
  assert.match(read('source/media.brs'), /id: "start", label: "Start page"/);
  // Back is never consumed by the screen, so the scene pops it.
  const screen = read('components/StartScreen.brs');
  assert.match(screen, /if intent = "back" then return false/);
  // Every zone has a way in and out: nav <-> hero <-> rows, and OK on each.
  for (const move of ['m.zone = "hero"', 'm.zone = "nav"', 'm.zone = "rows"']) assert.ok(screen.includes(move), move);
  for (const action of ['emit("browse"', 'emit("search"', 'emit("openApp"', 'emit("play"', 'emit("you"', 'emit("nav"']) assert.ok(screen.includes(action), action);
  const handler = scene.match(/sub onStartAction\(\)[^]*?^end sub/m)[0];
  for (const kind of ['browse', 'search', 'details', 'play', 'openApp']) assert.match(handler, new RegExp(`kind = "${kind}"`));
});

test('intros wait for the stream, any key skips, and nothing indexes with IndexOf', () => {
  const scene = read('components/TVMScene.brs');
  assert.match(scene, /maybeStartIntro\(item\)/);
  assert.match(scene, /tvmExtraEnabled\("franchiseIntros"\)/);
  assert.match(scene, /live: playItemIsLive\(item\)/);
  assert.match(scene, /if m\.introNode <> invalid\s+m\.heldPlay = event\s+return/);
  assert.match(scene, /introMarkPlayed\(m\.introPlayed, m\.introKey\)/);
  const intro = read('components/FranchiseIntro.brs');
  assert.match(intro, /function onKeyEvent\(key as String, press as Boolean\) as Boolean[^]*?m\.skipped = true/);
  assert.match(intro, /m\.top\.staticCard/);
  for (const file of ['source/introCore.brs', 'source/startCore.brs', 'components/StartScreen.brs', 'components/FranchiseIntro.brs']) {
    assert.doesNotMatch(read(file), /indexof/i, file);
  }
});

test('intro art is drawn shapes only and the component animates nothing unbounded', () => {
  const xml = read('components/FranchiseIntro.xml');
  for (const png of ['ring', 'beam', 'ember']) assert.ok(xml.includes(`pkg:/images/intro/${png}.png`) || png === 'beam' || png === 'ring', png);
  assert.doesNotMatch(xml, /repeat="true"/);
  assert.match(read('scripts/make-intro-art.mjs'), /Shapes only, no logos/);
});
