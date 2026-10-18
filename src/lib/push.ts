// Phone notifications for deadline reminders (migration 0027, the reminders
// function and public/sw.js). Each phone that says yes stores a push
// subscription; the reminders function sends to them.
import { requireSupabase } from './supabase';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Opened from the home screen (iPhone only allows notifications there). */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return reg ? reg.pushManager.getSubscription() : null;
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask the phone for permission, subscribe it, and save the subscription. */
export async function subscribe(userId: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      "Notifications are turned off for this app. Allow them in your phone's settings, then try again.",
    );
  }
  const db = requireSupabase();
  let key = (await db.rpc('vapid_public_key')).data;
  if (!key) {
    // The reminders function makes its keys the first time anyone asks.
    const res = await db.functions.invoke('reminders', { body: { init: true } });
    const made = res.data as { publicKey?: string } | null;
    if (res.error || !made?.publicKey)
      throw new Error('Reminders aren’t switched on yet. Try again later.');
    key = made.publicKey;
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    }));
  const json = sub.toJSON();
  await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  const { error } = await db.from('push_subscriptions').insert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  });
  if (error) throw new Error(error.message);
}

export async function unsubscribe(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await requireSupabase().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** A test notification to your own phones. */
export async function sendTest(): Promise<number> {
  const res = await requireSupabase().functions.invoke('reminders', { body: { test: true } });
  if (res.error) throw new Error('Couldn’t send a test. Try again in a minute.');
  return (res.data as { sent?: number } | null)?.sent ?? 0;
}
