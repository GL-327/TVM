const { execSync } = require('child_process');
const fs = require('fs');
const old = JSON.parse(execSync('git show HEAD:packages/content/changelog.json', { maxBuffer: 1e8 }).toString());
const p = 'packages/content/changelog.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
const known = new Set(old.releases[0].changes.map((x) => x.text));
const added = c.releases[0].changes.filter((x) => !known.has(x.text));
c.releases[0] = old.releases[0];
c.releases.unshift({
  version: '1.4.10', date: '2026-11-27', title: 'Shooting star and steadier updates (test build)',
  highlights: [
    'The shooting star is back when TVM opens, even if Windows has animations turned off.',
    'If an update check fails or has to wait, TVM tries again after 10 minutes instead of 6 hours.',
  ],
  changes: added.length ? added : [
    { area: 'Updates', text: 'A failed or held-back update check now retries after 10 minutes.', platforms: ['windows'] },
  ],
  knownIssues: old.releases[0].knownIssues,
});
const out = JSON.stringify(c, null, 2) + '\n';
fs.writeFileSync(p, out);
for (const f of ['apps/ios/TVM/changelog.json', 'apps/roku/source/data/content/changelog.json', 'apps/android/app/src/main/assets/content/changelog.json']) fs.writeFileSync(f, out);
console.log('moved', added.length, 'lines into 1.4.10');
