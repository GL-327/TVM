// Reads every published update channel and says which commit each carries.
const want = process.argv[2] ?? 'efacb74';
const repo = 'GL-327/TVM';
const dl = (tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;
const api = async (path) => (await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { 'user-agent': 'tvm-check', accept: 'application/vnd.github+json' } })).json();
const json = async (url) => {
  const response = await fetch(url, { headers: { 'user-agent': 'tvm-check' } });
  if (!response.ok) return { error: response.status };
  return response.json();
};
const mark = (commit) => (String(commit ?? '').startsWith(want) ? 'OK  ' : 'OLD ');
const rows = [];

const desktop = await json(dl('desktop-ui', 'desktop.json'));
rows.push([mark(desktop.commit), 'Mac/Linux/Windows engine feed (desktop-ui/desktop.json)', desktop.commit, desktop.builtAt]);

for (const channel of ['ios-ui', 'android-ui']) {
  const releases = await api('releases?per_page=30');
  const release = releases.find((r) => r.tag_name === channel || r.tag_name?.startsWith(channel));
  const asset = release?.assets?.find((a) => a.name.endsWith('.json'));
  const feed = asset ? await json(asset.browser_download_url) : { error: 'no release' };
  rows.push([mark(feed.commit), `phone interface feed (${release?.tag_name ?? channel})`, feed.commit ?? JSON.stringify(feed).slice(0, 80), feed.builtAt ?? '']);
}

const native = await api('releases/tags/native-windows');
const zip = native.assets?.find((a) => a.name === 'TVM-native-windows.zip');
rows.push([mark(zip?.label), 'Windows window (native-windows zip label)', zip?.label, zip?.updated_at]);

const devices = await api('releases/tags/devices');
for (const name of ['TVM.exe', 'TVM.apk', 'TVM.ipa', 'TVM-roku.zip', 'roku.json', 'TVM-desktop.zip', 'TVM-web.zip']) {
  const a = devices.assets?.find((x) => x.name === name);
  rows.push(['    ', `downloads page: ${name}`, a ? `${a.size} bytes` : 'MISSING', a?.updated_at]);
}
const roku = await json(dl('devices', 'roku.json'));
rows.push([String(roku.version) === '1.3.1' || String(roku.commit ?? '').startsWith(want) ? 'OK  ' : 'OLD ', 'Roku feed (devices/roku.json)', `${roku.version ?? ''} ${roku.commit ?? ''}`, roku.builtAt ?? '']);
for (const r of rows) console.log(r.join(' | '));
