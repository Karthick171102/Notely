import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getUser, clearSession } from '../api.js';
import Shell from './Shell.jsx';

export default function Projects() {
  const navigate = useNavigate();
  const user = getUser();
  const [projects, setProjects] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'website', client_name: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);

  async function load() {
    const data = await api('/api/projects');
    setProjects(data.projects);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function createProject(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/projects', { method: 'POST', body: form });
      setShowNew(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function snippet(p) {
    return `<script src="${location.origin}/embed/v1.js" data-project-id="${p.id}" defer></script>`;
  }

  function copy(p) {
    navigator.clipboard?.writeText(snippet(p));
    setCopied(p.id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Shell active="Projects">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
            <p className="text-sm text-slate-500 mt-1">Hey {user?.name?.split(' ')[0]} — embed one script tag into any prototype and review it in context.</p>
          </div>
          <button onClick={() => setShowNew(true)} className="rounded-lg bg-indigo-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-indigo-700">
            + New project
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

        {showNew && (
          <form onSubmit={createProject} className="mb-6 bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Project name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder="Acme Marketing Website"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
                <option value="website">Website</option>
                <option value="prototype">Prototype</option>
                <option value="internal_qa">Internal QA</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Client (optional)</span>
              <input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="Acme Inc."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Description (optional)</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            </label>
            <div className="md:col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                {busy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </form>
        )}

        {projects === null ? (
          <p className="text-slate-400 text-sm">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center">
            <div className="text-4xl mb-3">🎯</div>
            <h2 className="font-semibold text-slate-800">No projects yet</h2>
            <p className="text-sm text-slate-500 mt-1">Create your first project, then paste the embed script into your prototype's <code className="bg-slate-100 px-1 rounded">&lt;head&gt;</code>.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {projects.map((p) => (
              <li key={p.id} className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-4 flex-wrap hover:border-indigo-300 transition-colors">
                <div className="flex-1 min-w-56">
                  <div className="flex items-center gap-2">
                    <Link to={`/projects/${p.id}`} className="font-semibold text-slate-900 hover:text-indigo-600">{p.name}</Link>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{(p.type || 'website').replace('_', ' ')}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {p.total_count} feedback · {p.open_count} open
                    {p.last_activity ? ` · last activity ${new Date(p.last_activity).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <div className="h-2 w-28 bg-slate-100 rounded-full overflow-hidden" title={`${p.open_count} open of ${p.total_count}`}>
                  <div className="h-full bg-emerald-500" style={{ width: `${p.total_count ? Math.round(((p.total_count - p.open_count) / p.total_count) * 100) : 0}%` }} />
                </div>
                <button onClick={() => copy(p)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" title={snippet(p)}>
                  {copied === p.id ? '✓ Copied!' : 'Copy embed script'}
                </button>
                {p.prototype_url ? (
                  <a href={p.prototype_url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open prototype</a>
                ) : (
                  <a href={`/demo/${p.id}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" title="Sample prototype with this project's embed script already injected">Try on demo page</a>
                )}
                <Link to={`/projects/${p.id}`} className="rounded-lg bg-indigo-600 text-white px-3 py-2 text-xs font-semibold hover:bg-indigo-700">Open</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
