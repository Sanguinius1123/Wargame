import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import ws from 'ws';

const realtimeOpts = { transport: ws };

export const adminDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }, realtime: realtimeOpts }
);

export const anonDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  { realtime: realtimeOpts }
);

// Supabase projects cap rows at max_rows (default 1000) per request.
// fetchAll paginates through all rows by calling the query builder repeatedly
// with increasing range offsets until a partial page signals we're done.
// Usage: const rows = await fetchAll(q => adminDb.from('hexes').select(...).eq('game_id', id), q);
export async function fetchAll(buildQuery) {
  const PAGE = 1000;
  const results = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return results;
}
