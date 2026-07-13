// export_map_library.mjs — exports all saved map templates (maps + map_hexes tables)
// Run from server/: node export_map_library.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '.env'), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function fetchAll(buildQuery) {
  const PAGE = 1000; const results = []; let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    results.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return results;
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const { data: maps, error } = await db.from('maps').select('*').order('created_at', { ascending: true });
  if (error) { console.error(error.message); process.exit(1); }

  console.log(`Found ${maps.length} map templates.\n`);

  const outDir = join(__dir, '../scripts/map_exports');
  mkdirSync(outDir, { recursive: true });

  for (const map of maps) {
    const hexes = await fetchAll(() => db.from('map_hexes').select('*').eq('map_id', map.id));
    console.log(`${map.name}: ${hexes.length} hexes`);

    const slug = map.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const lines = [
      `-- Map library export: ${map.name}`,
      `-- Map ID: ${map.id}`,
      `-- Exported: ${new Date().toISOString()}`,
      `-- Hexes: ${hexes.length}`,
      ``,
      `INSERT INTO maps (id, name, description) VALUES (`,
      `  '${map.id}',`,
      `  ${esc(map.name)},`,
      `  ${esc(map.description)}`,
      `) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;`,
      ``,
    ];

    if (hexes.length > 0) {
      const cols = Object.keys(hexes[0]).filter(k => k !== 'id' && k !== 'map_id');
      lines.push(`INSERT INTO map_hexes (map_id, ${cols.join(', ')}) VALUES`);
      lines.push(hexes.map(h => `  ('${map.id}', ${cols.map(c => esc(h[c])).join(', ')})`).join(',\n') + ';');
      lines.push('');
    }

    const outPath = join(outDir, `maplibrary_${slug}.sql`);
    writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`  → scripts/map_exports/maplibrary_${slug}.sql`);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
