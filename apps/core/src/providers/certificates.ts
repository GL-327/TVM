import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Age certificates for age limits.
 *
 * IMDb turns away automated requests, so certificates come from Wikidata,
 * looked up by the same IMDb id: the UK (BBFC) rating first, then the US
 * (MPA) one. A title with neither falls back to the genre rule in
 * parental.ts. Answers are cached on disk; unknown ones are retried weekly.
 */

const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'TVM-client/1.1 (https://github.com/GL-327/TVM)';
const FETCH_MS = 6_000;
const BATCH = 120;
const KNOWN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The youngest age a certificate suits, or null when the label means nothing to us. */
export function certificateAge(label: string): number | null {
  const value = label.replace(/\s*(certificate|rating|rated)\s*/gi, '').trim().toUpperCase();
  switch (value) {
    case 'U':
    case 'UC':
    case 'G':
    case 'TV-Y':
    case 'TV-G':
      return 0;
    case 'PG':
    case 'TV-Y7':
    case 'TV-PG':
      return 8;
    case '12':
    case '12A':
      return 12;
    case 'PG-13':
    case 'TV-14':
      return 13;
    case '15':
      return 15;
    case 'R':
      return 17;
    case '18':
    case 'R18':
    case 'NC-17':
    case 'TV-MA':
      return 18;
    default:
      return null;
  }
}

export interface Certificate {
  label: string;
  age: number;
}

interface Row {
  at: number;
  cert: Certificate | null;
}

/** BBFC first, then MPA, from one SPARQL result. */
export function certificatesFromSparql(json: unknown): Map<string, Certificate> {
  const out = new Map<string, Certificate>();
  const rows = (json as { results?: { bindings?: Array<Record<string, { value?: string }>> } })?.results?.bindings ?? [];
  const uk = new Map<string, Certificate>();
  const us = new Map<string, Certificate>();
  for (const row of rows) {
    const id = row['imdb']?.value?.toLowerCase();
    if (id === undefined) continue;
    for (const [key, target] of [['bbfcLabel', uk], ['mpaLabel', us]] as const) {
      const raw = row[key]?.value;
      if (raw === undefined) continue;
      const age = certificateAge(raw);
      if (age === null) continue;
      const label = raw.replace(/\s*certificate\s*/i, '').trim();
      const previous = target.get(id);
      // Two UK entries (12 and 12A) keep the stricter one.
      if (previous === undefined || age > previous.age) target.set(id, { label, age });
    }
  }
  for (const [id, cert] of us) out.set(id, cert);
  for (const [id, cert] of uk) out.set(id, cert);
  return out;
}

export function createCertificateService(options: { dataDir: string; fetch?: typeof fetch; now?: () => number }) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const path = join(options.dataDir, 'certificates.json');
  let rows: Record<string, Row> = {};
  try {
    rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Row>;
  } catch {
    rows = {};
  }
  let dirty = false;
  const fresh = (row: Row | undefined): boolean =>
    row !== undefined && now() - row.at < (row.cert === null ? UNKNOWN_TTL_MS : KNOWN_TTL_MS);

  const lookup = async (ids: string[]): Promise<void> => {
    const values = ids.map((id) => `"${id}"`).join(' ');
    const query =
      `SELECT ?imdb ?bbfcLabel ?mpaLabel WHERE { VALUES ?imdb { ${values} } ?f wdt:P345 ?imdb . ` +
      'OPTIONAL { ?f wdt:P2629 ?bbfc } OPTIONAL { ?f wdt:P1657 ?mpa } ' +
      'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }';
    const response = await fetchImpl(`${SPARQL}?query=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!response.ok) return;
    const found = certificatesFromSparql(await response.json());
    for (const id of ids) {
      rows[id] = { at: now(), cert: found.get(id) ?? null };
      dirty = true;
    }
  };

  return {
    /** The certificate if it is known now (no network). */
    get(id: string): Certificate | null | undefined {
      const row = rows[id.toLowerCase()];
      return row === undefined ? undefined : row.cert;
    },
    /** Looks up ids it has not seen recently, in batches; never throws. */
    async prime(ids: readonly string[], budgetMs = 5_000): Promise<void> {
      const wanted = [...new Set(ids.map((id) => id.toLowerCase()).filter((id) => /^tt\d{5,10}$/.test(id) && !fresh(rows[id])))];
      if (wanted.length === 0) return;
      const batches: string[][] = [];
      for (let index = 0; index < wanted.length; index += BATCH) batches.push(wanted.slice(index, index + BATCH));
      const work = Promise.allSettled(batches.slice(0, 6).map((batch) => lookup(batch)));
      await Promise.race([work, new Promise((resolve) => setTimeout(resolve, budgetMs).unref())]);
      if (dirty) {
        dirty = false;
        try {
          mkdirSync(options.dataDir, { recursive: true });
          writeFileSync(path, JSON.stringify(rows));
        } catch {
          // A read-only data folder only costs the cache.
        }
      }
    },
  };
}

export type CertificateService = ReturnType<typeof createCertificateService>;
