#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '../src/update/paths.ts';
import { readSealedReadOnly } from '../src/providers/vault.ts';
import { entitlementMigrationReport } from '../src/providers/entitlementMigration.ts';

// Run with Node 24+: node apps/core/scripts/entitlement-migration-report.mjs [data-dir]
// No services are constructed: even vault master-key creation/upgrade is disabled.
const dataDir = process.argv[2] ?? resolveDataDir();
const input = {};
const stores = [];
for (const name of ['accounts', 'entitlement', 'billing', 'payments', 'subscriptions']) {
  const path = join(dataDir, 'secrets', `${name}.enc`);
  const present = existsSync(path);
  const value = present ? readSealedReadOnly(dataDir, path) : null;
  const recognized = value && typeof value === 'object' && !Array.isArray(value) && (
    name === 'entitlement' ? typeof value.id === 'string'
      : name === 'billing' ? [2, 3].includes(value.version) && Array.isArray(value.receipts)
        : name === 'accounts' ? value.version === 1 && Array.isArray(value.accounts)
          : name === 'payments' ? value.version === 1 && Array.isArray(value.orders)
            : value.version === 1 && (value.current === null || typeof value.current === 'object')
  );
  stores.push({ store: name, state: !present ? 'missing' : value === null ? 'unreadable' : !recognized ? 'unrecognized_schema' : 'read', operatorVerification: present && !recognized });
  input[name] = value;
}
const report = entitlementMigrationReport(input);
report.warnings.push(...stores.filter(store => store.operatorVerification).map(store => `${store.store}:${store.state}_operator_verification_required`));
process.stdout.write(`${JSON.stringify({ ...report, stores }, null, 2)}\n`);
if (stores.some(store => store.operatorVerification)) process.exitCode = 2;
