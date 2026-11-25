// Node 24 resolves an explicit test directory through its index file.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  for (const file of readdirSync(__dirname).filter((name) => name.endsWith('.test.mjs')).sort()) {
    await import(pathToFileURL(join(__dirname, file)).href);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
