// dump_schema.mjs — queries information_schema to show all columns per table
// Run from server/: node dump_schema.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
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

const TABLES = [
  'terrain_type_config',
  'gm_whitelist', 'profiles', 'games', 'game_participants',
  'hexes', 'scouted_hexes',
  'maps', 'map_hexes',
  'settings', 'unit_type_templates', 'unit_type_config',
  'factions', 'units', 'buildings', 'resource_tiles', 'faction_relationships',
  'movement_orders', 'production_queue', 'combat_log',
  'flight_groups', 'flight_group_units',
];

// Fetch one row from each table to get the column names.
for (const table of TABLES) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) {
    console.log(`${table}: ERROR — ${error.message}`);
    continue;
  }
  const cols = data?.length ? Object.keys(data[0]) : ['(empty table — no rows)'];
  console.log(`\n${table}:`);
  for (const col of cols) {
    const val = data?.[0]?.[col];
    const type = val === null ? 'null' : typeof val === 'boolean' ? 'boolean' : typeof val === 'number' ? 'number' : Array.isArray(val) ? 'array' : typeof val;
    console.log(`  ${col.padEnd(30)} ${type}`);
  }
}
