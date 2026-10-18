import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  currentSubscription,
  isIos,
  isStandalone,
  pushSupported,
  sendTest,
  subscribe,
  unsubscribe,
} from '@/lib/push';
import { requireSupabase } from '@/lib/supabase';

/** A 44px on/off switch. */
function Switch({
  on,
  disabled = false,
  label,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex h-11 w-[3.6rem] shrink-0 items-center justify-center disabled:opacity-40"
    >
      <span
        className={`relative h-[31px] w-[51px] rounded-full transition-colors ${on ? 'bg-[#1f7a4d]' : 'bg-[#c5cad3] dark:bg-[#3a404b]'}`}
      >
        <span
          className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-[2px]'}`}
        />
      </span>
    </button>
  );
}

/** Deadline reminders, at the top of Account: notify this phone, and when. */
export function Reminders() {
  const { session, profile } = useAuth();
  const queryClient = useQueryClient();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const supported = pushSupported();
  // iPhone only allows notifications for an app opened from the home screen.
  const needsHomeScreen = supported && isIos() && !isStandalone();

  useEffect(() => {
    void currentSubscription().then((s) => setOn(Boolean(s)));
  }, []);

  if (!session || !profile) return null;

  async function toggle(next: boolean) {
    setBusy(true);
    setNotices([]);
    try {
      if (next) await subscribe();
      else await unsubscribe();
      setOn(next);
      if (next)
        setNotices([
          { kind: 'success', text: 'This phone will get a reminder before each deadline.' },
        ]);
    } catch (e) {
      setNotices([{ kind: 'error', text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  async function onlyUnsaved(next: boolean) {
    const { error } = await requireSupabase()
      .from('profiles')
      .update({ remind_only_unsaved: next })
      .eq('id', profile!.id);
    if (error) setNotices([{ kind: 'error', text: error.message }]);
    await queryClient.invalidateQueries({ queryKey: ['profile', profile!.id] });
  }

  async function test() {
    setBusy(true);
    try {
      const sent = await sendTest();
      setNotices([
        sent
          ? { kind: 'success', text: 'Test sent. It should arrive in a few seconds.' }
          : { kind: 'error', text: 'No phones to send to. Turn notifications on first.' },
      ]);
    } catch (e) {
      setNotices([{ kind: 'error', text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-6 max-w-md">
      <h2 className="mb-0.5 mt-0">Deadline reminders</h2>
      <p className="muted mb-2 text-sm">The evening before each deadline, and an hour before it.</p>
      <Notices items={notices} />
      <div className="flex min-h-[56px] items-center gap-3 border-t border-line">
        <span className="flex flex-1 flex-col">
          <span className="font-bold">Notify this phone</span>
          <span className="muted text-sm">
            {!supported
              ? 'This browser can’t show notifications.'
              : needsHomeScreen
                ? 'Add the app to your home screen first.'
                : '7pm the day before, and an hour before'}
          </span>
        </span>
        <Switch
          on={Boolean(on)}
          disabled={!supported || needsHomeScreen || busy || on === null}
          label="Notify this phone"
          onChange={(next) => void toggle(next)}
        />
      </div>
      {needsHomeScreen && (
        <p className="muted mb-2 text-xs leading-snug">
          On iPhone: tap Share in Safari, then Add to Home Screen, open the app from there and come
          back here.
        </p>
      )}
      <div className="flex min-h-[56px] items-center gap-3 border-t border-line">
        <span className="flex flex-1 flex-col">
          <span className="font-bold">Only if I haven&apos;t changed my team</span>
          <span className="muted text-sm">Skip the reminder once you&apos;ve saved that week</span>
        </span>
        <Switch
          on={profile.remind_only_unsaved}
          label="Only if I haven't changed my team"
          onChange={(next) => void onlyUnsaved(next)}
        />
      </div>
      {on && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void test()}
          className="mt-1 min-h-tap w-full text-sm font-bold text-ink-soft"
        >
          Send a test notification
        </button>
      )}
    </section>
  );
}
