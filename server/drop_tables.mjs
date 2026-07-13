// drop_tables.mjs — drops all application tables in dependency order
// Run from server/: node drop_tables.mjs

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

// Drop in reverse dependency order (children before parents)
const sql = `
  DROP TABLE IF EXISTS flight_group_units      CASCADE;
  DROP TABLE IF EXISTS flight_groups           CASCADE;
  DROP TABLE IF EXISTS combat_log              CASCADE;
  DROP TABLE IF EXISTS production_queue        CASCADE;
  DROP TABLE IF EXISTS movement_orders         CASCADE;
  DROP TABLE IF EXISTS faction_relationships   CASCADE;
  DROP TABLE IF EXISTS resource_tiles          CASCADE;
  DROP TABLE IF EXISTS buildings               CASCADE;
  DROP TABLE IF EXISTS units                   CASCADE;
  DROP TABLE IF EXISTS scouted_hexes           CASCADE;
  DROP TABLE IF EXISTS hexes                   CASCADE;
  DROP TABLE IF EXISTS unit_type_config        CASCADE;
  DROP TABLE IF EXISTS factions                CASCADE;
  DROP TABLE IF EXISTS map_hexes               CASCADE;
  DROP TABLE IF EXISTS maps                    CASCADE;
  DROP TABLE IF EXISTS unit_type_templates     CASCADE;
  DROP TABLE IF EXISTS settings                CASCADE;
  DROP TABLE IF EXISTS game_participants       CASCADE;
  DROP TABLE IF EXISTS games                   CASCADE;
  DROP TABLE IF EXISTS profiles                CASCADE;
  DROP TABLE IF EXISTS gm_whitelist            CASCADE;
  DROP TABLE IF EXISTS terrain_type_config     CASCADE;
  DROP FUNCTION IF EXISTS is_gm_in_game(UUID) CASCADE;
  DROP FUNCTION IF EXISTS handle_new_user()    CASCADE;
  DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
`;

const { error } = await db.rpc('exec_sql', { query: sql }).catch(() => ({ error: 'rpc not available' }));

if (error) {
  // rpc not available — use raw fetch to Supabase SQL endpoint
  console.log('RPC unavailable, trying direct SQL via pg...');
  console.log('Please run this SQL in the Supabase dashboard SQL editor:');
  console.log(sql);
} else {
  console.log('All tables dropped successfully.');
}
