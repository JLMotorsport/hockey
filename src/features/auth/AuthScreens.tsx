import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useSides } from '@/lib/queries';
import { requireSupabase } from '@/lib/supabase';

/** `v3`: the V3 layout (board "Log in"), landing on Home. */
export function LoginScreen({ v3 = false }: { v3?: boolean } = {}) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  const home = v3 ? '/' : '/dashboard';
  if (session) return <Navigate to={home} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) setNotices([{ kind: 'error', text: 'Wrong email or password.' }]);
    else navigate(home);
  }

  async function forgot() {
    if (!email.includes('@')) {
      setNotices([{ kind: 'error', text: 'Enter your email above first.' }]);
      return;
    }
    await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/account`,
    });
    setNotices([{ kind: 'info', text: 'If that account exists, a reset link is on its way.' }]);
  }

  if (v3) {
    const field =
      'v3-glass flex min-h-[56px] flex-col justify-center rounded-2xl px-4 focus-within:border-[rgb(var(--v3-red))]';
    const input = 'bg-transparent text-[15px] text-white outline-none';
    return (
      <div className="mx-auto max-w-[26rem] px-[22px] pb-8">
        <div className="pt-8">
          <span className="v3-disp v3-red v3-glow flex h-[58px] w-[58px] items-center justify-center rounded-[18px] text-xl">
            FHC
          </span>
          <h1 className="v3-disp mb-0 mt-5 text-[54px] leading-[0.95]">
            Pick.
            <br />
            Captain.
            <br />
            <span className="text-[rgb(var(--v3-red))] [text-shadow:0_0_30px_rgb(255_51_71/.6)]">
              Win.
            </span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--v3-mut))]">
            The club&apos;s fantasy league. Build a squad from Felixstowe players and score from
            their real matches.
          </p>
        </div>
        <div className="mt-4">
          <Notices items={notices} />
        </div>
        <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-col gap-2.5">
          <label className={field}>
            <span className="v3-cap text-[9px]">Email</span>
            <input
              className={input}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className={field}>
            <span className="v3-cap text-[9px]">Password</span>
            <input
              className={input}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="v3-btn v3-red v3-glow mt-1.5" disabled={busy}>
            {busy ? 'Logging in' : 'Log in'}
          </button>
          <Link
            to="/register"
            className="v3-btn border border-white/15 bg-white/[0.05] text-white no-underline hover:no-underline"
          >
            Join the league
          </Link>
          <button
            type="button"
            onClick={() => void forgot()}
            className="min-h-[44px] text-center text-xs text-[rgb(var(--v3-mut))]"
          >
            Forgot password?
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="card mt-6 max-w-md">
      <h1 className="mt-0">Log in</h1>
      <Notices items={notices} />
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? 'Logging in' : 'Log in'}
        </button>
        <button type="button" className="btn btn-quiet ml-2" onClick={() => void forgot()}>
          Forgot password
        </button>
      </form>
      <p className="muted mt-4">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}

export function RegisterScreen() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    display_name: '',
    team_name: '',
    email: '',
    password: '',
    side_id: '',
  });
  const sides = useSides();
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  // A new account has no squad yet: start on Transfers to pick the 15.
  if (session) return <Navigate to="/transfers" replace />;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setNotices([{ kind: 'error', text: 'Password must be at least 8 characters.' }]);
      return;
    }
    setBusy(true);
    const { data, error } = await requireSupabase().auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          display_name: form.display_name.trim(),
          team_name: form.team_name.trim(),
          side_id: form.side_id,
        },
        emailRedirectTo: `${window.location.origin}/squad`,
      },
    });
    setBusy(false);
    if (error) {
      setNotices([{ kind: 'error', text: error.message }]);
    } else if (!data.session) {
      // Email confirmation is switched on in Supabase.
      setNotices([
        { kind: 'info', text: 'Check your email to confirm your account, then log in.' },
      ]);
    } else {
      navigate('/transfers');
    }
  }

  return (
    <div className="card mt-6 max-w-md">
      <h1 className="mt-0">Join the league</h1>
      <Notices items={notices} />
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          Your name
          <input
            className="input"
            required
            maxLength={80}
            value={form.display_name}
            onChange={set('display_name')}
          />
        </label>
        <label className="field">
          Fantasy team name
          <input
            className="input"
            required
            maxLength={80}
            value={form.team_name}
            onChange={set('team_name')}
          />
        </label>
        <label className="field">
          Your side (optional)
          <select className="input" value={form.side_id} onChange={set('side_id')}>
            <option value="">I don't play / not sure</option>
            {(sides.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="muted text-xs">
            Puts you in the Men's or Women's league and your side's own league too.
          </span>
        </label>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={form.password}
            onChange={set('password')}
          />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? 'Creating account' : 'Create account'}
        </button>
      </form>
      <p className="muted mt-4">
        Already signed up? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}

export function AccountScreen() {
  const { session, profile } = useAuth();
  const [teamName, setTeamName] = useState(profile?.team_name ?? '');
  const [sideId, setSideId] = useState(profile?.side_id ? String(profile.side_id) : '');
  const sides = useSides();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);

  if (!session || !profile) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const db = requireSupabase();
    const out: Notice[] = [];
    if (teamName.trim() && teamName.trim() !== profile!.team_name) {
      const { error } = await db
        .from('profiles')
        .update({ team_name: teamName.trim() })
        .eq('id', profile!.id);
      out.push(
        error
          ? { kind: 'error', text: error.message }
          : { kind: 'success', text: 'Team name saved.' },
      );
    }
    if (sideId !== (profile!.side_id ? String(profile!.side_id) : '')) {
      const { error } = await db
        .from('profiles')
        .update({ side_id: sideId ? Number(sideId) : null })
        .eq('id', profile!.id);
      out.push(
        error ? { kind: 'error', text: error.message } : { kind: 'success', text: 'Side saved.' },
      );
      await queryClient.invalidateQueries();
    }
    if (password) {
      if (password.length < 8)
        out.push({ kind: 'error', text: 'New password must be at least 8 characters.' });
      else {
        const { error } = await db.auth.updateUser({ password });
        out.push(
          error
            ? { kind: 'error', text: error.message }
            : { kind: 'success', text: 'Password changed.' },
        );
        setPassword('');
      }
    }
    setNotices(out.length ? out : [{ kind: 'info', text: 'Nothing to change.' }]);
  }

  return (
    <div className="card mt-6 max-w-md">
      <h1 className="mt-0">Account</h1>
      <p className="muted">
        {profile.display_name} · {session.user.email}
      </p>
      <Notices items={notices} />
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          Fantasy team name
          <input
            className="input"
            maxLength={80}
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
        </label>
        <label className="field">
          Your side (optional)
          <select className="input" value={sideId} onChange={(e) => setSideId(e.target.value)}>
            <option value="">I don't play / not sure</option>
            {(sides.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="muted text-xs">
            Puts you in the Men's or Women's league and your side's own league too.
          </span>
        </label>
        <label className="field">
          New password
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn">Save</button>
      </form>
      {!profile.is_super && (
        <p className="mb-0 mt-5 text-center text-sm">
          <Link to="/account/delete" className="muted underline">
            Delete account
          </Link>
        </p>
      )}
    </div>
  );
}
