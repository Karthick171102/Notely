import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const data = await api(path, { method: 'POST', body });
      setSession(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-indigo-600 text-white font-extrabold flex items-center justify-center">C</span>
            <span className="text-2xl font-bold text-slate-900">Contextly</span>
          </div>
          <p className="text-slate-500 text-sm mt-2">Visual feedback, in context.</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>

          {mode === 'signup' && (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input value={form.name} onChange={set('name')} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15" placeholder="Dana Designer" />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input type="email" value={form.email} onChange={set('email')} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15" placeholder="you@studio.com" />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input type="password" value={form.password} onChange={set('password')} required minLength={8} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15" placeholder="8+ characters" />
          </label>

          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" disabled={busy} className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>

          <p className="text-sm text-slate-500 text-center">
            {mode === 'login' ? (
              <>New here? <button type="button" onClick={() => setMode('signup')} className="text-indigo-600 font-semibold hover:underline">Create an account</button></>
            ) : (
              <>Already have an account? <button type="button" onClick={() => setMode('login')} className="text-indigo-600 font-semibold hover:underline">Log in</button></>
            )}
          </p>
        </form>

        {mode === 'login' && (
          <p className="text-xs text-slate-400 text-center mt-4">Demo account: dana@contextly.test / password123</p>
        )}
      </div>
    </div>
  );
}
