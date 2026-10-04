// Supabase Edge Function: pull Felixstowe fixtures, scores, line-ups, goal
// scorers and cards from England Hockey. Assists and player of the match are
// not published; managers add those in the app.
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
import {
  EH_TEAM_PAGE,
  EhFeedError,
  findFeed,
  fixtureFeedUrl,
  parseLineup,
  parseTeamFeed,
  type FeedLocation,
} from '../_shared/ehFixtures.ts';

// Line-ups are re-read for this long after a match, in case the team admin
// fills them in or corrects them late.
const LINEUP_REFRESH_DAYS = 14;

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

async function fetchJson(url: string, key: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'X-Api-Key': key } });
  if (!res.ok) throw new EhFeedError(`feed returned ${res.status}`);
  return res.json();
}

async function fetchFeed(slug: string): Promise<{ feed: FeedLocation; payload: unknown }> {
  const page = await fetch(EH_TEAM_PAGE + slug);
  if (!page.ok) throw new EhFeedError(`team page returned ${page.status}`);
  const feed = findFeed(await page.text());
  return { feed, payload: await fetchJson(feed.url, feed.key) };
}

type Admin = ReturnType<typeof createClient>;

// Read line-ups, goals and cards for this side's played fixtures that are new,
// recent, or not yet imported, skipping any a manager has locked.
async function importLineups(
  admin: Admin,
  sideId: number,
  feed: FeedLocation,
  rows: { eh_fixture_id: string; eh_team_id: string | null }[],
): Promise<string> {
  const since = new Date(Date.now() - LINEUP_REFRESH_DAYS * 86_400_000).toISOString();
  const { data: due, error } = await admin
    .from('fixtures')
    .select('id, eh_fixture_id')
    .eq('side_id', sideId)
    .eq('stats_locked', false)
    .not('goals_for', 'is', null)
    .not('eh_fixture_id', 'is', null)
    .lte('kickoff', new Date().toISOString())
    .or(`lineup_imported_at.is.null,kickoff.gte.${since}`);
  if (error) throw new Error(error.message);

  const teamIds = new Map(rows.map((r) => [r.eh_fixture_id, r.eh_team_id]));
  let imported = 0;
  let created = 0;
  let withheld = 0;
  let unmatched = 0;
  const unknown = new Set<string>();
  for (const fx of due ?? []) {
    const teamId = teamIds.get(fx.eh_fixture_id);
    if (!teamId) continue;
    const lineup = parseLineup(
      await fetchJson(fixtureFeedUrl(feed.url, fx.eh_fixture_id), feed.key),
      teamId,
    );
    lineup.unknownEvents.forEach((e) => unknown.add(e));
    withheld += lineup.withheld;
    unmatched += lineup.unmatched;
    if (!lineup.players.length) continue;
    const { data, error: rpcError } = await admin.rpc('import_lineup', {
      p_fixture_id: fx.id,
      p_players: lineup.players,
      p_withheld: lineup.unmatched,
    });
    if (rpcError) throw new Error(rpcError.message);
    const res = data as { created?: number; players?: number; skipped?: boolean };
    if (!res.skipped) {
      imported += 1;
      created += res.created ?? 0;
    }
  }
  let message = `${imported} line-ups, ${created} new players`;
  if (withheld) message += `, ${withheld} withheld-name appearances`;
  if (unmatched) message += `, ${unmatched} players with no England Hockey id`;
  if (unknown.size) message += ` (unscored events: ${[...unknown].join(', ')})`;
  return message;
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
      const { feed, payload } = await fetchFeed(side.eh_slug);
      const { competition, rows } = parseTeamFeed(payload, side.eh_slug);
      const { data, error: rpcError } = await admin.rpc('import_fixtures', {
        p_side_id: side.id,
        p_competition: competition,
        p_rows: rows,
      });
      if (rpcError) throw new Error(rpcError.message);
      const counts = data as { created: number; updated: number };
      const lineups = await importLineups(admin, side.id, feed, rows);
      results.push({
        side: side.name,
        ok: true,
        message: `${counts.created} new, ${counts.updated} updated fixtures; ${lineups}`,
      });
    } catch (err) {
      // One side failing (a renamed page, a timeout) shouldn't stop the rest.
      results.push({ side: side.name, ok: false, message: (err as Error).message });
    }
  }
  return json({ results });
});
