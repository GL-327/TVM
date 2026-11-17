import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
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
  "components/SetupScreen.xml",
  "components/SetupScreen.brs",
  "components/AccountScreen.xml",
  "components/AccountScreen.brs",
  "components/SettingsScreen.xml",
  "components/SettingsScreen.brs",
  "DEVICE_TESTING.md",
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
  "components/GlassPanel.xml",
  "components/GlassPanel.brs",
  "components/NavStrip.xml",
  "components/NavStrip.brs",
  "components/YouMenu.xml",
  "components/YouMenu.brs",
  "source/focus.brs",
  "scripts/make-glass.mjs",
  "scripts/focus.test.mjs",
  "scripts/fixtures/focus-cases.json",
  "images/glass/panel.9.png",
  "images/glass/pill.9.png",
  "images/glass/focus-ring.9.png",
  "images/glass/orb.png",
  "images/glass/ellipse.png",
  "images/glass/spoke.png",
  "images/glass/highlight.png",
  "source/spatial.brs",
  "source/hub.brs",
  "source/hubCore.brs",
  "source/data/hubFixture.json",
  "components/SpatialTabs.xml",
  "components/SpatialTabs.brs",
  "components/HubScreen.xml",
  "components/HubScreen.brs",
  "components/HubNetwork.xml",
  "components/HubNetwork.brs",
  "components/HubNode.xml",
  "components/HubNode.brs",
  "components/HubDevices.xml",
  "components/HubDevices.brs",
  "components/HubInspector.xml",
  "components/HubInspector.brs",
  "components/HubActivity.xml",
  "components/HubActivity.brs",
  "components/HubAgent.xml",
  "components/HubAgent.brs",
  "scripts/spatial.test.mjs",
  "scripts/hub.test.mjs",
  "scripts/make-hub-glyphs.mjs",
  "scripts/fixtures/spatial-cases.json",
  "scripts/fixtures/hub-cases.json",
  "scripts/fixtures/hub-fixture.json",
  "images/hub/tv.png",
  "images/hub/laptop.png",
  "images/hub/phone.png",
  "images/hub/web.png",
  "images/hub/user.png",
  "images/hub/dots.png",
  "images/hub/plus.png",
  "images/hub/chevron.png",
  "components/HubRemote.xml",
  "components/HubRemote.brs",
  "components/HubPair.xml",
  "components/HubPair.brs",
  "components/CodeSignInPanel.xml",
  "components/CodeSignInPanel.brs",
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
  "images/glass/panel.9.png",
  "images/glass/pill.9.png",
  "images/glass/focus-ring.9.png",
  "images/glass/orb.png",
  "images/glass/ellipse.png",
  "images/glass/spoke.png",
  "images/glass/highlight.png",
]) {
  const path = join(rokuRoot, image);
  if (!existsSync(path)) {
    fail(`missing ${image}`);
    continue;
  }
  const header = readFileSync(path).subarray(0, 8);
  if (!header.equals(pngMagic)) fail(`${image} is not a PNG`);
}

// Added for the R0/R1 redesign: 9-patch guide check for the glass borders.
function parsePngChunks(buf) {
  const chunks = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

for (const image of [
  "images/glass/panel.9.png",
  "images/glass/pill.9.png",
  "images/glass/focus-ring.9.png",
  ...["panel", "pill", "tab", "chip", "card"].flatMap(shape =>
    ["fill", "body", "gloss", "focus", "shadow", "focus-glow"].map(layer => `images/glass/${shape}-${layer}.9.png`)),
  "images/glass/progress.9.png",
]) {
  const path = join(rokuRoot, image);
  if (!existsSync(path)) continue;
  const chunks = parsePngChunks(readFileSync(path));
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  if (!ihdr) {
    fail(`${image} has no IHDR chunk`);
    continue;
  }
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  if (colorType !== 6 || bitDepth !== 8) {
    fail(`${image} must be RGBA8 (colour type 6, bit depth 8)`);
    continue;
  }
  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  const raw = inflateSync(idat);
  const stride = width * 4;
  if (raw.length < height * (stride + 1)) {
    fail(`${image} has truncated image data`);
    continue;
  }
  const rows = [];
  let filtersOk = true;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    if (raw[start] !== 0) {
      filtersOk = false;
      break;
    }
    rows.push(raw.subarray(start + 1, start + 1 + stride));
  }
  if (!filtersOk) {
    notes.push(`${image} uses PNG filters; 9-patch pixel check skipped`);
    continue;
  }
  const px = (x, y) => {
    const o = x * 4;
    return { r: rows[y][o], g: rows[y][o + 1], b: rows[y][o + 2], a: rows[y][o + 3] };
  };
  const isBlack = (p) => p.r === 0 && p.g === 0 && p.b === 0 && p.a === 255;
  const xs = Array.from({ length: width }, (_, i) => i);
  const ys = Array.from({ length: height }, (_, i) => i);
  if (px(0, 0).a !== 0) fail(`${image}: pixel (0,0) must be transparent`);
  if (!xs.some((x) => isBlack(px(x, 0)))) fail(`${image}: top border has no opaque black pixel`);
  if (!ys.some((y) => isBlack(px(0, y)))) fail(`${image}: left border has no opaque black pixel`);
  if (!xs.some((x) => isBlack(px(x, height - 1)))) fail(`${image}: bottom border has no opaque black pixel`);
  if (!ys.some((y) => isBlack(px(width - 1, y)))) fail(`${image}: right border has no opaque black pixel`);
  const centre = px(Math.floor(width / 2), Math.floor(height / 2));
  const filled = /-(?:fill|body|gloss|shadow)\.9\.png$|\/progress\.9\.png$/.test(image);
  if (!filled && centre.a !== 0) {
    fail(`${image}: centre pixel must be transparent`);
  }
  if (/-fill\.9\.png$/.test(image) && centre.a !== 255) fail(`${image}: fill centre must be opaque white for tinting`);
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
if (Object.keys(example).some((key) => key !== "coreBaseUrl")) {
  fail("config.example.json may contain only coreBaseUrl; never package TVM_LAN_TOKEN");
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
if (!components.get("ApiTask")?.source.includes('id="authToken"')) {
  fail("ApiTask must expose authToken so LAN requests can send a bearer");
}
if (!components.get("ApiTask")?.source.includes('id="accountToken"')) {
  fail("ApiTask must expose accountToken so Roku can send a TVM account session");
}
if (components.get("AccountScreen")?.extends !== "Group") fail("AccountScreen must extend Group");

const apiTaskBrs = existsSync(join(rokuRoot, "components/ApiTask.brs"))
  ? read(join(rokuRoot, "components/ApiTask.brs"))
  : "";
if (!/AddHeader\(\s*"Authorization"\s*,\s*"Bearer "\s*\+/.test(apiTaskBrs)) {
  fail("ApiTask.brs must send Authorization: Bearer for LAN Core");
}
if (!/AddHeader\(\s*"X-TVM-Account"/.test(apiTaskBrs)) {
  fail("ApiTask.brs must send X-TVM-Account so sign-in can share the Authorization header with the LAN token");
}

const apiBrs = existsSync(join(rokuRoot, "source/api.brs")) ? read(join(rokuRoot, "source/api.brs")) : "";
if (!/task\.authToken/.test(apiBrs) || !/isCoreToken\(/.test(apiBrs)) {
  fail("api.brs must attach the stored Core token to ApiTask");
}
if (!/task\.accountToken/.test(apiBrs) || !/isAccountToken\(/.test(apiBrs)) {
  fail("api.brs must attach the stored account session to ApiTask");
}

const configBrs = existsSync(join(rokuRoot, "source/config.brs")) ? read(join(rokuRoot, "source/config.brs")) : "";
if (!/function loadCoreToken\(/.test(configBrs) || !/function saveCoreToken\(/.test(configBrs)) {
  fail("config.brs must store the LAN token in the device registry, not config.json");
}
if (!/function isCoreToken\(/.test(configBrs)) fail("config.brs must validate TVM_LAN_TOKEN length");
if (!/function loadAccountToken\(/.test(configBrs) || !/function saveAccountToken\(/.test(configBrs)) {
  fail("config.brs must store the TVM account session in the device registry");
}

const sceneBrs = existsSync(join(rokuRoot, "components/TVMScene.brs"))
  ? read(join(rokuRoot, "components/TVMScene.brs"))
  : "";
if (!/loadCoreToken\(/.test(sceneBrs) || !/showTokenKeyboard\(/.test(sceneBrs)) {
  fail("TVMScene must collect and persist the LAN access token");
}
if (!/loadAccountToken\(/.test(sceneBrs) || !/showAccountGate\(/.test(sceneBrs)) {
  fail("TVMScene must collect a TVM account before Home");
}
if (!/createViewStack\("home"\)/.test(sceneBrs) || !/enterHome\(/.test(sceneBrs)) {
  fail("TVMScene must only open Home after a usable account");
}
if (!/headers\["Authorization"\] = "Bearer " \+ m\.coreToken/.test(sceneBrs)) {
  fail("TVMScene must send the LAN bearer on Core-hosted streams");
}
if (!/submitOwnerCode\(/.test(sceneBrs) || !/ownerDoor/.test(sceneBrs)) {
  fail("TVMScene must accept the hidden owner code without advertising it");
}
const accountBrs = existsSync(join(rokuRoot, "components/AccountScreen.brs"))
  ? read(join(rokuRoot, "components/AccountScreen.brs"))
  : "";
if (!/ownerDoor/.test(accountBrs)) fail("AccountScreen must open the owner door from seven Info presses");
if (!/I'm a dev/.test(accountBrs)) fail("AccountScreen must offer I'm a dev on the sign-in screen");
if (!/devCode/.test(sceneBrs) || !/submitDevSignIn\(/.test(sceneBrs)) {
  fail("TVMScene must sign the Roku in as the dev account and keep that session");
}
if (!/sub onAccountSignInDone\(\)[\s\S]*?loadAccount\(true\)/.test(sceneBrs)) {
  fail("A successful Roku sign-in must reload /api/account so the gate sees signedIn");
}
const homeBrs = existsSync(join(rokuRoot, "components/HomeScreen.brs"))
  ? read(join(rokuRoot, "components/HomeScreen.brs"))
  : "";
if (!/ownerDoor/.test(homeBrs)) fail("HomeScreen must open the owner door from seven Info presses");
const settingsBrs = existsSync(join(rokuRoot, "components/SettingsScreen.brs"))
  ? read(join(rokuRoot, "components/SettingsScreen.brs"))
  : "";
if (!/ownerDoor/.test(settingsBrs)) fail("SettingsScreen must open the owner door from seven Info presses");

const rokuReadme = existsSync(join(rokuRoot, "README.md")) ? read(join(rokuRoot, "README.md")) : "";
if (/no API authentication/i.test(rokuReadme)) {
  fail("apps/roku/README.md must not claim Core has no API authentication");
}
if (/pairing token is not implemented/i.test(rokuReadme)) {
  fail("apps/roku/README.md must describe the TVM_LAN_TOKEN bearer contract");
}

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

// Added for the R0/R1 redesign: read a file if present, otherwise an empty string so the regex reports the gap.
function fileText(rel) {
  return existsSync(join(rokuRoot, rel)) ? read(join(rokuRoot, rel)) : "";
}

// Added for the R0/R1 redesign: Home uses NavStrip and the emit/rail/hero helpers.
const homeScreenBrs = fileText("components/HomeScreen.brs");
const homeScreenXml = fileText("components/HomeScreen.xml");
if (!/emit\("play"/.test(homeScreenBrs)) fail("HomeScreen.brs must emit play");
if (!/railFocusKey\(/.test(homeScreenBrs)) fail("HomeScreen.brs must use railFocusKey()");
if (!/homeHeroMeta\(/.test(homeScreenBrs)) fail("HomeScreen.brs must use homeHeroMeta()");
if (!/<NavStrip/.test(homeScreenXml)) fail("HomeScreen.xml must use NavStrip");
if (/<RibbonBar/.test(homeScreenXml)) fail("HomeScreen.xml must not use RibbonBar");

// Added for the R0/R1 redesign: rails window their items instead of looping copies.
const posterRailBrs = fileText("components/PosterRail.brs");
if (/m\.copies/.test(posterRailBrs)) fail("PosterRail.brs must not loop copies");
if (!/railWindow\(/.test(posterRailBrs)) fail("PosterRail.brs must use railWindow()");

// Added for the R0/R1 redesign: poster art loads at 2x the display budget, never 1280 or 780.
const posterCardBrs = fileText("components/PosterCard.brs");
if (!/loadWidth = 400/.test(posterCardBrs) || !/loadWidth = 300/.test(posterCardBrs)) {
  fail("PosterCard.brs must load poster art at the 2x budget (loadWidth 400/300)");
}
if (/1280|780/.test(posterCardBrs)) fail("PosterCard.brs must not load 1280 or 780 art");

// Added for the R0/R1 redesign: DetailsPanel backdrop is full HD and restores focus.
const detailsPanelXml = fileText("components/DetailsPanel.xml");
const detailsPanelBrs = fileText("components/DetailsPanel.brs");
if (!/id="backdrop"[^>]*loadWidth="1920"[^>]*loadHeight="1080"/.test(detailsPanelXml)) {
  fail("DetailsPanel.xml backdrop must load at 1920x1080");
}
if (!/sub onRestoreKey\(/.test(detailsPanelBrs) || !/idChanged/.test(detailsPanelBrs)) {
  fail("DetailsPanel.brs must restore focus and handle idChanged");
}

// Added for the R0/R1 redesign: no repeating background animations on the scene.
if (/repeat="true"/.test(fileText("components/TVMScene.xml"))) {
  fail("TVMScene.xml must not declare repeating animations");
}
if (!/m\.global\.addFields/.test(sceneBrs) || !/function screenNode\(/.test(sceneBrs) || !/sub applyRestoreKey\(/.test(sceneBrs)) {
  fail("TVMScene.brs must publish global fields, use screenNode() and applyRestoreKey()");
}

// Added for the R0/R1 redesign: reduce-motion and reduce-transparency settings.
if (!/function loadReduceMotion\(/.test(configBrs) || !/function loadReduceTransparency\(/.test(configBrs)) {
  fail("config.brs must load reduce-motion and reduce-transparency settings");
}
if (!settingsBrs.includes("Reduce Motion") || !settingsBrs.includes("Reduce Transparency")) {
  fail("SettingsScreen must offer Reduce Motion and Reduce Transparency");
}

// Added for the R0/R1 redesign: glass pill variant, type-size and motion tokens, and the font cache.
if (!fileText("components/FocusButton.brs").includes("glassPill")) fail("FocusButton.brs must support glassPill");
for (const component of ["GlassPanel", "FocusButton", "NavStrip", "SpatialTabs", "HubNode", "HubNetwork", "HubInspector", "HubDevices", "HubActivity", "YouMenu", "PosterCard"]) {
  if (/cornerRadius/.test(fileText(`components/${component}.xml`))) fail(`${component} must use a rounded PNG silhouette`);
}
const glassXml = fileText("components/GlassPanel.xml");
for (const layer of ["shadow", "glow", "tint", "bodyGradient", "sheen", "rim"]) {
  if (!glassXml.includes(`id="${layer}"`)) fail(`GlassPanel missing ${layer}`);
}
if (!fileText("components/AmbientBackdrop.xml").includes('loadWidth="96" loadHeight="54"')) fail("Ambient art must decode at 96x54");
if (!fileText("source/media.brs").includes('aaGet(payload, "trending", [])')) fail("Home heroes must prefer Core trending");
if (!fileText("components/HomeScreen.brs").includes('observeField("loadStatus", "onHeroArtLoad")')) fail("Hero must wait for incoming artwork before crossfade");
if (!fileText("components/SettingsScreen.brs").includes('"toggleBackground"')) fail("Settings must expose Background");
const semiBold = join(rokuRoot, "fonts/Inter-SemiBold.otf");
if (!existsSync(semiBold) || createHash("sha256").update(readFileSync(semiBold)).digest("hex") !== "8c1990b6012254ea2b487161697d107357dd0ee55811cfd91c8c11227bbef457") fail("Inter SemiBold checksum mismatch");
const lighthouse = join(rokuRoot, "images/lighthouse.jpg");
if (!existsSync(lighthouse) || statSync(lighthouse).size >= 250000) fail("Lighthouse must be packaged below 250 KB");
if (!fileText("images/ASSETS.md").includes("public domain")) fail("Lighthouse source and public-domain licence must be recorded");
const packagePath = join(rokuRoot, "tvm-roku.zip");
if (existsSync(packagePath) && statSync(packagePath).size >= 4000000) fail("Roku zip must stay below 4 MB");
const tokensBrs = fileText("source/tokens.brs");
if (!/function tvmTypeSize\(/.test(tokensBrs) || !/function tvmReduceMotion\(/.test(tokensBrs)) {
  fail("tokens.brs must define tvmTypeSize() and tvmReduceMotion()");
}
if (!/tvmFontCache/.test(fileText("source/fonts.brs"))) fail("fonts.brs must define tvmFontCache");

// Added for the R2/R3 TVM Hub: pure geometry, Core helpers, screens, remote and pairing.
const spatialBrs = fileText("source/spatial.brs");
for (const fn of ["spatialLayout", "spatialProject", "spatialNeighbour", "spatialMove", "spatialReconcileFocus", "spatialSpoke", "spatialAssign"]) {
  if (!new RegExp(`function ${fn}\\(`).test(spatialBrs)) fail(`spatial.brs must define ${fn}()`);
}
if (!/ratio: 0\.58/.test(spatialBrs) || !/depthMin: 0\.84/.test(spatialBrs) || !/maxSpokes: 6/.test(spatialBrs)) {
  fail("spatial.brs must project onto a 0.58 tilted ellipse with depth 0.84-1.0 and at most 6 spokes");
}
if (!/0\.5 \* lateral/.test(spatialBrs) || !/lateral <= along/.test(spatialBrs)) {
  fail("spatial.brs D-pad must use a 90 degree cone and score = distance + 0.5 * lateral");
}
if (!/edge: "tabs"/.test(spatialBrs) || !/edge: "inspector"/.test(spatialBrs) || !/edge: "add"/.test(spatialBrs)) {
  fail("spatial.brs must define the explicit up/right/down edges");
}

const hubBrs = fileText("source/hub.brs");
const hubCoreBrs = fileText("source/hubCore.brs");
if (!hubCoreBrs.includes("/api/hub/v1")) fail("hubCore.brs must use the /api/hub/v1 base path");
if (!hubCoreBrs.includes("hubInstallationId") || !hubCoreBrs.includes("hubDeviceSecret")) {
  fail("hubCore.brs must keep the registry keys hubInstallationId and hubDeviceSecret");
}
if (!hubBrs.includes("GetChannelClientId()")) fail("hub.brs must send roDeviceInfo.GetChannelClientId() as clientId");
if (!/statusCode = 404 or statusCode = 503/.test(hubBrs)) fail("hub.brs must treat 404 or 503 as Hub unavailable");
if (!hubCoreBrs.includes("hubFixture") || !hubCoreBrs.includes("pkg:/source/data/hubFixture.json")) {
  fail("hubCore.brs must load the bundled hubFixture data");
}
for (const fn of ["hubDecide", "hubActionsFor", "hubAgeSeconds", "hubRemoteCommand", "hubPairNormalize", "hubPairPollNext", "hubSortDevices"]) {
  if (!new RegExp(`function ${fn}\\(`).test(hubBrs)) fail(`hub.brs must define ${fn}()`);
}
for (const action of ["playback.pause", "playback.resume", "playback.seek", "playback.skip", "nav.dpad", "nav.select", "nav.back", "play.title"]) {
  if (!hubBrs.includes(`"${action}"`)) fail(`hub.brs must handle the ${action} command`);
}
if (fileText("source/data/hubFixture.json") !== fileText("scripts/fixtures/hub-fixture.json")) {
  fail("source/data/hubFixture.json must be an exact copy of scripts/fixtures/hub-fixture.json");
}

const hubAgentBrs = fileText("components/HubAgent.brs");
if (!/m\.heartbeat\.duration = 30/.test(hubAgentBrs) || !/m\.inbox\.duration = 3/.test(hubAgentBrs)) {
  fail("HubAgent must heartbeat every 30 s and poll the inbox every 3 s");
}
if (!/function heartbeatNow\(/.test(hubAgentBrs) || !/"\/commands\/" \+ ack\.id \+ "\/ack"/.test(hubAgentBrs)) {
  fail("HubAgent must heartbeat on state change and ack every command");
}
if (!/fixture = true/.test(hubAgentBrs)) fail("HubAgent must stay silent on demo data");

const hubScreenXml = fileText("components/HubScreen.xml");
const hubScreenBrs = fileText("components/HubScreen.brs");
if (!/id="poll" duration="15" repeat="true"/.test(hubScreenXml)) fail("HubScreen must poll the overview every 15 s");
if (!hubScreenXml.includes("TVM Hub") || !hubScreenXml.includes("Demo data")) fail("HubScreen must be titled TVM Hub and label Demo data");
for (const tag of ["SpatialTabs", "HubNetwork", "HubDevices", "HubActivity", "HubInspector"]) {
  if (!new RegExp(`<${tag}`).test(hubScreenXml)) fail(`HubScreen.xml must host <${tag}>`);
}
if (!/\["network", "devices", "activity"\]/.test(hubScreenBrs)) fail("HubScreen tabs must be Network, Devices, Activity");
if (!/top\.fixture = true/.test(hubScreenBrs)) fail("HubScreen must not send commands on demo data");
if (!/"\/commands"/.test(hubScreenBrs) || !/"\/commands\/" \+ id/.test(hubScreenBrs) || !/hubIdempotencyKey\(/.test(hubScreenBrs)) {
  fail("HubScreen must POST /commands with an idempotency key and poll GET /commands/:id");
}
if (!/\/pair\/lookup\?userCode=/.test(hubScreenBrs) || !/"\/pair\/" \+ kind/.test(hubScreenBrs)) {
  fail("HubScreen must look up and approve or deny pair codes");
}
if (!/sub openRemote\(/.test(hubScreenBrs) || !/sub startAddDevice\(/.test(hubScreenBrs)) fail("HubScreen must open the remote and Add device");

const spatialTabsBrs = fileText("components/SpatialTabs.brs");
if (!/function handleIntent\(/.test(spatialTabsBrs) || !/previewIndex/.test(spatialTabsBrs) || !/function rememberFocus\(/.test(spatialTabsBrs)) {
  fail("SpatialTabs must preview on Left/Right, activate on OK and remember focus per tab");
}
const hubNetworkBrs = fileText("components/HubNetwork.brs");
if (!hubNetworkBrs.includes("spoke.png") || !/spatialLayout\(/.test(hubNetworkBrs)) fail("HubNetwork must draw spoke.png spokes from spatialLayout()");
if (!fileText("components/HubNode.xml").includes("orb.png")) fail("HubNode must share the one orb texture");
const inspectorBrs = fileText("components/HubInspector.brs");
if (!/hubNowPlayingView\(/.test(inspectorBrs) || !/hubActionsFor\(/.test(inspectorBrs) || !/hubLastSeenText\(/.test(inspectorBrs)) {
  fail("HubInspector must use now-playing scoping, capability-filtered actions and server-time ages");
}
if (!/function setFeedback\(/.test(inspectorBrs) || !/timed_out/.test(inspectorBrs) || !/rejected/.test(inspectorBrs)) {
  fail("HubInspector must show pending, confirmed, timed out and rejected feedback");
}
const hubDevicesBrs = fileText("components/HubDevices.brs");
if (!/sortKey/.test(hubDevicesBrs) || !/railViewFirst\(/.test(hubDevicesBrs)) fail("HubDevices must sort and window its rows");
const hubPairBrs = fileText("components/HubPair.brs");
if (!/hubPairAlphabet\(/.test(hubPairBrs) || !/emit\("lookup"/.test(hubPairBrs)) fail("HubPair must enter the code from the 8-character alphabet and look it up");
if (!/hubRemoteCommand\(/.test(fileText("components/HubRemote.brs"))) fail("HubRemote must map keys with hubRemoteCommand()");

if (!/X-TVM-Device/.test(apiTaskBrs) || !/deviceCredential/.test(apiBrs)) fail("ApiTask and api.brs must send X-TVM-Device for Hub routes");
if (!/name = "hub"/.test(sceneBrs) || !/navigate\("push", "hub"/.test(sceneBrs) || /Coming in the next update\. Your devices/.test(sceneBrs)) {
  fail("TVMScene must route You > TVM Hub to the HubScreen");
}
if (!/sub initHubAgent\(/.test(sceneBrs) || !/sub onHubEffect\(/.test(sceneBrs) || !/sub hubInjectIntent\(/.test(sceneBrs) || !/hubFinishPlayCommand\(/.test(sceneBrs)) {
  fail("TVMScene must run the HubAgent and apply Hub commands");
}
if (!/sub startCodeSignIn\(/.test(sceneBrs) || !/hubPairPollNext\(/.test(sceneBrs) || !/"\/pair\/token"/.test(sceneBrs)) {
  fail("TVMScene must sign in with a code and poll pair/token with slow_down handling");
}
if (!/emit\("codeSignIn"\)/.test(fileText("components/AccountScreen.brs"))) fail("AccountScreen must offer Sign in with a code");
if (!/id="playState"/.test(playerXml) || !/function applyRemote\(/.test(playerBrs)) fail("PlayerScreen must publish playState and apply remote commands");
for (const base of ["HomeScreen", "SettingsScreen", "YouMenu", "PlayerScreen", "HubScreen", "ConfirmPanel", "NoticePanel"]) {
  if (!/id="remoteIntent"/.test(fileText(`components/${base}.xml`))) fail(`${base} must accept remote intents`);
}

const builtin = new Set([
  "Animation",
  "Vector2DFieldInterpolator",
  "FloatFieldInterpolator",
  "MaskGroup",
  "Timer",
  "KeyboardDialog",
  "StandardKeyboardDialog",
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

  if (listing.length === 0) fail("zip is empty or has no valid central directory");
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

console.log("Roku static/package checks passed. Hardware installation and playback are still required.");
console.log(`Components: ${[...components.keys()].sort().join(", ")}`);
for (const note of notes) console.log(note);
