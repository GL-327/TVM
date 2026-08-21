import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const rokuRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

const requiredFiles = [
  "manifest",
  "config.example.json",
  "README.md",
  "source/main.brs",
  "source/intents.brs",
  "source/viewStack.brs",
  "source/config.brs",
  "source/api.brs",
  "source/media.brs",
  "source/tokens.brs",
  "source/theme.brs",
  "source/themeGlass.brs",
  "source/fonts.brs",
  "source/layout.brs",
  "components/TVMScene.xml",
  "components/TVMScene.brs",
  "components/GlassOverlay.xml",
  "components/ApiTask.xml",
  "components/ApiTask.brs",
  "components/HomeScreen.xml",
  "components/HomeScreen.brs",
  "components/CatalogScreen.xml",
  "components/CatalogScreen.brs",
  "components/LiveScreen.xml",
  "components/LiveScreen.brs",
  "components/LivePicksScreen.xml",
  "components/LivePicksScreen.brs",
  "components/ChannelTile.xml",
  "components/ChannelTile.brs",
  "components/PlayerScreen.xml",
  "components/PlayerScreen.brs",
  "components/ProfilesScreen.xml",
  "components/ProfilesScreen.brs",
  "components/ProfileScreen.xml",
  "components/ProfileScreen.brs",
  "components/AppsScreen.xml",
  "components/AppsScreen.brs",
  "components/LibraryScreen.xml",
  "components/LibraryScreen.brs",
  "components/SearchPanel.xml",
  "components/SearchPanel.brs",
  "components/ServiceScreen.xml",
  "components/ServiceScreen.brs",
  "components/RealDebridScreen.xml",
  "components/RealDebridScreen.brs",
  "components/RibbonBar.xml",
  "components/RibbonBar.brs",
  "components/PosterCard.xml",
  "components/PosterCard.brs",
  "components/PosterRail.xml",
  "components/PosterRail.brs",
  "components/BrandLockup.xml",
  "components/BrandLockup.brs",
  "components/AppTile.xml",
  "components/AppTile.brs",
  "components/ConfirmPanel.xml",
  "components/ConfirmPanel.brs",
  "components/InfoScreen.xml",
  "components/InfoScreen.brs",
  "images/splash_hd.png",
  "images/splash_fhd.png",
  "images/icon_focus_hd.png",
  "preview/index.html",
  "preview/preview.css",
  "preview/preview.js",
];

for (const file of requiredFiles) {
  if (!existsSync(join(rokuRoot, file))) fail(`missing ${file}`);
}

if (existsSync(join(rokuRoot, "package.json"))) {
  fail("apps/roku must not be a Node package");
}

const manifestPath = join(rokuRoot, "manifest");
const manifestBytes = existsSync(manifestPath) ? readFileSync(manifestPath) : Buffer.alloc(0);
if (manifestBytes[0] === 0xef && manifestBytes[1] === 0xbb && manifestBytes[2] === 0xbf) {
  fail("manifest has a UTF-8 BOM; Roku can reject it");
}

const manifest = manifestBytes.toString("utf8");
for (const key of [
  "title",
  "major_version",
  "minor_version",
  "build_version",
  "mm_icon_focus_hd",
  "mm_icon_focus_sd",
  "splash_screen_hd",
  "splash_screen_fhd",
  "ui_resolutions",
]) {
  if (!new RegExp(`^${key}=`, "m").test(manifest)) fail(`manifest missing ${key}`);
}

if (!/^title=TVM\s*$/m.test(manifest)) fail("manifest title should be TVM");
if (!/ui_resolutions=hd/.test(manifest) || !/ui_resolutions=.*fhd/.test(manifest)) {
  fail("manifest should allow HD and FHD so 720p/1080p boxes scale the 4K canvas down");
}
if (/ui_resolutions=fhd\s*$/m.test(manifest) && !/ui_resolutions=hd/.test(manifest)) {
  fail("manifest must not be FHD-only");
}

for (const match of manifest.matchAll(/pkg:\/(\S+)/g)) {
  const rel = match[1];
  if (!existsSync(join(rokuRoot, rel))) fail(`manifest points at missing ${rel}`);
}

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const image of [
  "images/splash_sd.png",
  "images/splash_hd.png",
  "images/splash_fhd.png",
  "images/icon_focus_hd.png",
  "images/icon_focus_sd.png",
  "images/icons/home.png",
  "images/icons/search.png",
  "images/chrome/hero-vignette-left.png",
  "images/chrome/hero-vignette-bottom.png",
  "images/chrome/lockup-mark.png",
  "images/chrome/poster-mask.png",
  "images/chrome/app-tile-mask.png",
  "images/apps/netflix.png",
  "images/apps/prime.png",
  "images/apps/max.png",
  "images/apps/disney.png",
  "images/apps/marks/prime-smile.png",
  "images/apps/marks/yt-play.png",
  "images/apps/marks/paramount-peak.png",
  "images/apps/marks/tvm-gem.png",
]) {
  const path = join(rokuRoot, image);
  if (!existsSync(path)) {
    fail(`missing ${image}`);
    continue;
  }
  const header = readFileSync(path).subarray(0, 8);
  if (!header.equals(pngMagic)) fail(`${image} is not a PNG`);
}

const fontsDir = join(rokuRoot, "fonts");
if (existsSync(fontsDir)) {
  for (const font of ["Inter-Regular.otf", "Inter-Bold.otf"]) {
    if (!existsSync(join(fontsDir, font))) fail(`fonts/${font} is missing`);
  }
} else {
  notes.push("fonts/ not present; channel will use system fonts");
}

const example = existsSync(join(rokuRoot, "config.example.json"))
  ? JSON.parse(read(join(rokuRoot, "config.example.json")))
  : {};
if (typeof example.coreBaseUrl !== "string" || !example.coreBaseUrl.includes("YOUR-PC-LAN-IP")) {
  fail("config.example.json must use YOUR-PC-LAN-IP, not a real address");
}

const xmlFiles = walk(join(rokuRoot, "components")).filter((file) => file.endsWith(".xml"));
const components = new Map();
for (const file of xmlFiles) {
  const source = read(file);
  const rel = relative(rokuRoot, file).replaceAll("\\", "/");
  const named = source.match(/<component\s+name="([^"]+)"\s+extends="([^"]+)"/);
  if (!named) {
    fail(`${rel} missing component name/extends`);
    continue;
  }
  components.set(named[1], { file: rel, extends: named[2], source });
  if (!source.includes("</component>")) fail(`${rel} missing </component>`);

  for (const script of source.matchAll(/uri="([^"]+)"/g)) {
    const uri = script[1];
    const resolved = uri.startsWith("pkg:/") ? join(rokuRoot, uri.slice(5)) : join(dirname(file), uri);
    if (!existsSync(resolved)) fail(`${rel} script missing: ${uri}`);
  }
}

if (!components.has("TVMScene")) fail("TVMScene component is missing");
if (components.get("TVMScene")?.extends !== "Scene") fail("TVMScene must extend Scene");
if (components.get("ApiTask")?.extends !== "Task") fail("ApiTask must extend Task");

const main = existsSync(join(rokuRoot, "source/main.brs")) ? read(join(rokuRoot, "source/main.brs")) : "";
if (!/^\s*sub Main\(/m.test(main)) fail("source/main.brs must define sub Main()");
if (!main.includes('CreateScene("TVMScene")')) fail("Main() must create TVMScene");

const playerXml = existsSync(join(rokuRoot, "components/PlayerScreen.xml"))
  ? read(join(rokuRoot, "components/PlayerScreen.xml"))
  : "";
const playerBrs = existsSync(join(rokuRoot, "components/PlayerScreen.brs"))
  ? read(join(rokuRoot, "components/PlayerScreen.brs"))
  : "";
if (!/id="skipRecap"/.test(playerXml)) fail("PlayerScreen.xml must declare Skip Recap");
if (!/id="overlayFocus"/.test(playerXml)) fail("PlayerScreen.xml must expose overlay focus");
if (!/id="chrome"[\s\S]*<\/Group>[\s\S]*id="skipRecap"/.test(playerXml)) {
  fail("Skip Recap must sit on the overlay so it stays selectable when chrome hides");
}
if (!/player-skip-recap/.test(playerBrs)) fail("PlayerScreen must tag Skip Recap for selection");
if (!/sub doSkipRecap\(/.test(playerBrs)) fail("PlayerScreen must OK-activate Skip Recap");
if (!/function skipRecapFocused\(/.test(playerBrs)) fail("PlayerScreen must keep Skip Recap focusable");
if (!/intent = "select" and skipRecapFocused\(/.test(playerBrs)) {
  fail("PlayerScreen must select Skip Recap with OK");
}
if (!/sub seekBy\(/.test(playerBrs) || !/function seekKeysActive\(/.test(playerBrs)) {
  fail("PlayerScreen must keep Left/Right seek on the overlay");
}
if (!/intent = "left" and seekKeysActive\(/.test(playerBrs) || !/seekBy\(-10\)/.test(playerBrs)) {
  fail("PlayerScreen must Left-seek while overlay focus is held");
}
if (!/intent = "right" and seekKeysActive\(/.test(playerBrs) || !/seekBy\(10\)/.test(playerBrs)) {
  fail("PlayerScreen must Right-seek while overlay focus is held");
}
if (!/sub claimOverlayFocus\(/.test(playerBrs)) fail("PlayerScreen must reclaim overlay focus");
if (!/enableUI = false/.test(playerBrs)) fail("PlayerScreen must disable Video UI so overlay keeps keys");
if (!/m\.video\.focusable = false/.test(playerBrs)) fail("PlayerScreen Video must not take SceneGraph focus");
if (/^\s*[^'\n].*video\.setFocus\(\s*true\s*\)/m.test(playerBrs)) {
  fail("PlayerScreen must not give Video SceneGraph focus");
}
if (!/overlayFocus/.test(playerBrs)) fail("PlayerScreen must publish overlay focus");
if (!/recapEndSeconds\(/.test(existsSync(join(rokuRoot, "source/media.brs")) ? read(join(rokuRoot, "source/media.brs")) : "")) {
  fail("media.brs must read recap end metadata");
}

const builtin = new Set([
  "Animation",
  "Vector2DFieldInterpolator",
  "FloatFieldInterpolator",
  "MaskGroup",
  "Timer",
  "KeyboardDialog",
  "Font",
  "Poster",
  "Rectangle",
  "Label",
  "Group",
  "LayoutGroup",
  "Task",
  "Scene",
  "Video",
  "RowList",
  "MarkupGrid",
  "ContentNode",
]);

const allBrs = walk(rokuRoot).filter((file) => file.endsWith(".brs"));
for (const file of allBrs) {
  const source = read(file);
  const rel = relative(rokuRoot, file).replaceAll("\\", "/");
  for (const match of source.matchAll(/CreateObject\("roSGNode",\s*"([^"]+)"\)/g)) {
    const name = match[1];
    if (!builtin.has(name) && !components.has(name)) {
      fail(`${rel} creates unknown node ${name}`);
    }
  }
}

for (const [name, meta] of components) {
  for (const match of meta.source.matchAll(/<([A-Z][A-Za-z0-9]+)\b/g)) {
    const child = match[1];
    if (child === "Children" || child === "Interface" || child === "Script" || child === "Field" || child === "Function") {
      continue;
    }
    if (!builtin.has(child) && !components.has(child) && child !== name) {
      fail(`${meta.file} uses undeclared child <${child}>`);
    }
  }
}

const bannedName = /package\.json|node_modules|\.tsx$|\.jsx$|\.vue$/i;
const bannedSource = /(?:^|\n)\s*(?:import |require\(|from ['"]react|electron)/;
const jsCompare = /===|!==/;
const ipv4 = /\b(?!0\.0\.0\.0\b)(?:\d{1,3}\.){3}\d{1,3}\b/;

for (const file of walk(rokuRoot)) {
  const rel = relative(rokuRoot, file).replaceAll("\\", "/");
  if (rel.startsWith("scripts/")) continue;
  if (rel.startsWith("preview/")) continue;
  if (bannedName.test(rel)) fail(`Node/React artifact not allowed: ${rel}`);

  if (!/\.(brs|xml)$/i.test(rel)) continue;
  const source = read(file);
  if (bannedSource.test(source)) fail(`${rel} looks like Node/React code`);
  if (/\.brs$/i.test(rel) && jsCompare.test(source)) fail(`${rel} uses JS equality`);
  if (ipv4.test(source)) fail(`${rel} hard-codes an IP address`);

  if (/\.brs$/i.test(rel)) {
    const starts = (source.match(/^\s*(sub|function)\s+/gim) ?? []).length;
    const ends = (source.match(/^\s*end (sub|function)/gim) ?? []).length;
    if (starts !== ends) fail(`${rel}: ${starts} sub/function vs ${ends} end sub/function`);
  }
}

const zipPath = join(rokuRoot, "tvm-roku.zip");
if (!existsSync(zipPath)) {
  notes.push("tvm-roku.zip not present; run scripts/package.ps1");
} else {
  let listing = [];
  try {
    const { listZipNames } = await import("./package.mjs");
    listing = listZipNames(readFileSync(zipPath));
  } catch (error) {
    fail(`tvm-roku.zip could not be read (${error instanceof Error ? error.message : "unknown error"})`);
  }

  if (listing.length > 0) {
    if (!listing.includes("manifest")) fail("zip must contain manifest at the archive root");
    if (!listing.includes("source/main.brs") && !listing.includes("source\\main.brs")) {
      fail("zip must contain source/main.brs");
    }
    const backslash = listing.filter((name) => name.includes("\\"));
    if (backslash.length > 0) {
      fail(`zip uses Windows backslash paths (Roku will not load them): ${backslash.slice(0, 3).join(", ")}`);
    }
    const nestedRoot = listing.some((name) => /^[^/]+\/manifest$/.test(name.replaceAll("\\", "/")));
    if (nestedRoot) fail("zip nests the channel in a folder; manifest must sit at the zip root");
    if (listing.some((name) => name.replaceAll("\\", "/").startsWith("preview/"))) {
      fail("zip must not include the PC preview; that is served by Core in development");
    }
  }
}

if (errors.length > 0) {
  console.error("Roku app check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Roku app looks sideloadable.");
console.log(`Components: ${[...components.keys()].sort().join(", ")}`);
for (const note of notes) console.log(note);
