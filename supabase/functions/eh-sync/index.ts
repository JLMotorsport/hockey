// Supabase Edge Function: pull Felixstowe fixtures and scores from England
// Hockey into the fixtures table. Player stats are not in the feed; managers
// enter those in the app.
//
// Two ways in:
//   - the scheduler, holding the shared EH_SYNC_SECRET
//   - a league manager pressing "Sync from England Hockey" (their JWT)
//
// Deploy:  npx supabase functions deploy eh-sync --no-verify-jwt --use-api
// Secrets: EH_SYNC_SECRET (any long random string)
//
// Schedule (Supabase dashboard > SQL editor, needs pg_cron + pg_net enabled),
// Sunday and Monday at 20:00 UTC:
//   select cron.schedule('ff-eh-sync', '0 20 * * 0,1', $$
//     select net.http_post(
//       url := 'https://<project>.supabase.co/functions/v1/eh-sync',
//       headers := '{"Authorization":"Bearer <EH_SYNC_SECRET>"}'::jsonb
//     );
//   $$);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { EH_TEAM_PAGE, EhFeedError, findFeed, parseTeamFeed } from '../_shared/ehFixtures.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SYNC_SECRET = Deno.env.get('EH_SYNC_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Constant-time compare so the secret check doesn't leak through timing.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

async function callerIsAllowed(authHeader: string): Promise<boolean> {
  if (SYNC_SECRET && safeEqual(authHeader, `Bearer ${SYNC_SECRET}`)) return true;
  if (!authHeader) return false;
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await caller.rpc('is_admin');
  return !error && data === true;
}

async function fetchFeed(slug: string): Promise<unknown> {
  const page = await fetch(EH_TEAM_PAGE + slug);
  if (!page.ok) throw new EhFeedError(`team page returned ${page.status}`);
  const { url, key } = findFeed(await page.text());
  const feed = await fetch(url, { headers: { 'X-Api-Key': key } });
  if (!feed.ok) throw new EhFeedError(`feed returned ${feed.status}`);
  return feed.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!(await callerIsAllowed(req.headers.get('Authorization') ?? ''))) {
    return json({ error: 'Not allowed' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sides, error } = await admin
    .from('sides')
    .select('id, name, eh_slug')
    .not('eh_slug', 'is', null)
    .order('sort_order');
  if (error) return json({ error: error.message }, 500);

  const results: { side: string; ok: boolean; message: string }[] = [];
  for (const side of sides ?? []) {
    try {
      const { competition, rows } = parseTeamFeed(await fetchFeed(side.eh_slug), side.eh_slug);
      const { data, error: rpcError } = await admin.rpc('import_fixtures', {
        p_side_id: side.id,
        p_competition: competition,
        p_rows: rows,
      });
      if (rpcError) throw new Error(rpcError.message);
      const counts = data as { created: number; updated: number };
      results.push({
        side: side.name,
        ok: true,
        message: `${counts.created} new, ${counts.updated} updated`,
      });
    } catch (err) {
      // One side failing (a renamed page, a timeout) shouldn't stop the rest.
      results.push({ side: side.name, ok: false, message: (err as Error).message });
    }
  }
  return json({ results });
});
