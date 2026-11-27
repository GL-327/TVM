import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const contentNames = ['changelog', 'events', 'free-channels', 'services', 'avatars', 'parental', 'intros'];
export function syncContent() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = fileURLToPath(new URL('../../../packages/content/', import.meta.url));
  const dest = join(root, 'source/data/content');
  mkdirSync(dest, { recursive: true });
  for (const name of contentNames) {
    const path = join(source, `${name}.json`);
    const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
    const data = JSON.parse(text);
    if (data.schema !== 1) throw new Error(`Unsupported content schema: ${name}`);
    writeFileSync(join(dest, `${name}.json`), text);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) syncContent();
