// export_maps.mjs — lists all games, then dumps hex+building data for each
// Run from server/: node export_maps.mjs

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
  if (Array.isArray(v)) return `ARRAY[${v.map(x=>`'${String(x).replace(/'/g,"''")}'`).join(',')}]::text[]`;
  return `'${String(v).replace(/'/g,"''")}'`;
}

async function exportGame(game) {
  console.log(`\nExporting: ${game.name} (${game.id})`);

  const hexes = await fetchAll(() => db.from('hexes').select('*').eq('game_id', game.id));
  const { data: buildings } = await db.from('buildings').select('*').eq('game_id', game.id);
  console.log(`  ${hexes.length} hexes, ${(buildings??[]).length} buildings`);

  const slug = game.name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const outDir = join(__dir, '../scripts/map_exports');
  mkdirSync(outDir, { recursive: true });

  const lines = [
    `-- Map export: ${game.name}`,
    `-- Game ID: ${game.id}`,
    `-- Exported: ${new Date().toISOString()}`,
    `-- Hexes: ${hexes.length}  Buildings: ${(buildings??[]).length}`,
    ``,
    `-- Usage: replace :GAME_ID with the target game UUID before running`,
    ``,
  ];

  if (hexes.length > 0) {
    const cols = Object.keys(hexes[0]).filter(k => k !== 'id' && k !== 'game_id');
    lines.push(`INSERT INTO hexes (game_id, ${cols.join(', ')}) VALUES`);
    lines.push(hexes.map(h => `  (:GAME_ID, ${cols.map(c=>esc(h[c])).join(', ')})`).join(',\n') + ';');
    lines.push('');
  }

  if ((buildings??[]).length > 0) {
    const bcols = Object.keys(buildings[0]).filter(k => k !== 'id' && k !== 'game_id');
    lines.push(`INSERT INTO buildings (game_id, ${bcols.join(', ')}) VALUES`);
    lines.push(buildings.map(b => `  (:GAME_ID, ${bcols.map(c=>esc(b[c])).join(', ')})`).join(',\n') + ';');
    lines.push('');
  }

  const outPath = join(outDir, `${slug}.sql`);
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`  → scripts/map_exports/${slug}.sql`);
}

async function main() {
  const { data: games, error } = await db.from('games').select('id, name, created_at').order('created_at', { ascending: false });
  if (error) { console.error('Failed to load games:', error.message); process.exit(1); }

  console.log('\nAll games in DB:');
  for (const g of games) {
    console.log(`  [${g.created_at?.slice(0,10)}] ${g.name.padEnd(40)} ${g.id}`);
  }

  for (const g of games) await exportGame(g);
  console.log('\nDone. SQL files are in scripts/map_exports/');
}

main().catch(e => { console.error(e); process.exit(1); });
