// Supabase Edge Function: deadline reminders as phone notifications.
//
// Three ways in:
//   - the hourly job (public.call_reminders(), migration 0027) with the shared
//     EH_SYNC_SECRET: sends the evening-before or hour-before reminder when one
//     is due (each goes once per gameweek, recorded in reminder_log)
//   - a logged-in person with { init: true }: makes the signing keys if there
//     aren't any yet and returns the public one, so their phone can subscribe
//   - a logged-in person with { test: true }: a test notification to their phones
//
// Deploy: by deploy-functions.yml, as eh-sync (--no-verify-jwt).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { dueKind, reminderText } from '../_shared/reminders.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET = Deno.env.get('EH_SYNC_SECRET') ?? '';

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

type Admin = SupabaseClient;
interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The signing keys, made on first use. */
async function keys(admin: Admin): Promise<{ public_key: string; private_key: string }> {
  const found = await admin.from('vapid_keys').select('public_key, private_key').eq('id', 1);
  if (found.data?.length) return found.data[0];
  const made = webpush.generateVAPIDKeys();
  await admin.from('vapid_keys').upsert(
    { id: 1, public_key: made.publicKey, private_key: made.privateKey },
    {
      onConflict: 'id',
      ignoreDuplicates: true,
    },
  );
  const again = await admin.from('vapid_keys').select('public_key, private_key').eq('id', 1);
  if (!again.data?.length) throw new Error('Could not make the notification keys.');
  return again.data[0];
}

async function sender(admin: Admin) {
  const k = await keys(admin);
  webpush.setVapidDetails(`https://${new URL(SUPABASE_URL).host}`, k.public_key, k.private_key);
  return async (sub: Subscription, payload: Record<string, string>): Promise<boolean> => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      return true;
    } catch (err) {
      // Gone (the app was removed, or permission withdrawn): forget it.
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
      return false;
    }
  };
}

/** The scheduled run: send a reminder if one is due for the next gameweek. */
async function scheduled(admin: Admin): Promise<Record<string, unknown>> {
  const { data: gws } = await admin
    .from('gameweeks')
    .select('id, start_date, deadline')
    .order('start_date');
  const now = new Date();
  const next = (gws ?? []).find((g) => new Date(g.deadline) > now);
  if (!next) return { due: false, why: 'no upcoming gameweek' };
  const deadline = new Date(next.deadline);
  const kind = dueKind(now, deadline);
  if (!kind) return { due: false };
  // Once only: if this reminder is already in the log, someone sent it.
  const logged = await admin.from('reminder_log').insert({ gameweek_id: next.id, kind });
  if (logged.error) return { due: false, why: 'already sent' };
  const number = (gws ?? []).filter((g) => g.start_date <= next.start_date).length;
  const { data: targets, error } = await admin.rpc('reminder_targets', { p_gameweek: next.id });
  if (error) throw new Error(error.message);
  const send = await sender(admin);
  let sent = 0;
  for (const t of targets ?? []) {
    const text = reminderText(kind, number, deadline, t);
    if (
      await send(t, {
        ...text,
        url: t.has_squad ? '/squad' : '/transfers',
        tag: `gw${next.id}-${kind}`,
      })
    )
      sent += 1;
  }
  return { due: kind, gameweek: number, sent };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const authHeader = req.headers.get('Authorization') ?? '';
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    if (SECRET && safeEqual(authHeader, `Bearer ${SECRET}`)) {
      return json(await scheduled(admin));
    }

    // Otherwise a logged-in person, for their own phone.
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: who } = await caller.auth.getUser();
    if (!who.user) return json({ error: 'Not allowed' }, 401);
    const body = (await req.json().catch(() => ({}))) as { init?: boolean; test?: boolean };

    if (body.init) {
      return json({ publicKey: (await keys(admin)).public_key });
    }
    if (body.test) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', who.user.id);
      const send = await sender(admin);
      let sent = 0;
      for (const s of subs ?? []) {
        if (
          await send(s, {
            title: 'Reminders are on',
            body: "You'll get one the evening before each deadline, and an hour before.",
            url: '/squad',
            tag: 'test',
          })
        )
          sent += 1;
      }
      return json({ sent });
    }
    return json({ error: 'Nothing to do' }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
