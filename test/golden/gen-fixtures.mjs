// Regenerate test/golden/fixtures.json from the live lib/ code:
//   npm run fixtures
// Review the diff before committing — fixtures pin exact output (Thai
// strings, hex colors, byte counts) on purpose.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './cases.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures.json');
fs.writeFileSync(out, JSON.stringify(buildAll(), null, 2) + '\n');
console.log(`wrote ${out}`);
