'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    const form = new FormData(event.currentTarget);
    const credentials = {
      username: String(form.get('username') ?? ''),
      password: String(form.get('password') ?? ''),
    };

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error ?? 'Unable to sign in.');
      }

      router.replace('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm text-white/80">
        Operator username
        <input
          required
          name="username"
          autoComplete="username"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 placeholder:text-muted focus:border-pink"
          placeholder="Username"
        />
      </label>
      <label className="block text-sm text-white/80">
        Password
        <input
          required
          type="password"
          name="password"
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 placeholder:text-muted focus:border-pink"
          placeholder="Password"
        />
      </label>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-pink to-violet py-3 font-semibold disabled:opacity-60">
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      <p className="text-xs leading-relaxed text-muted">
        API access is authorized by the server after sign in; the API token is not entered here.
      </p>
    </form>
  );
}
