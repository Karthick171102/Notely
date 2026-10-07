import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Shell from './Shell.jsx';

const STATUS_LABEL = { open: 'New', in_progress: 'In progress', resolved: 'Resolved', reopened: 'Reopened' };
const STATUS_CLASS = {
  open: 'bg-rose-100 text-rose-700', reopened: 'bg-rose-100 text-rose-700',
  in_progress: 'bg-amber-100 text-amber-700', resolved: 'bg-emerald-100 text-emerald-700',
};
const PRIORITY_CLASS = { critical: 'bg-rose-600 text-white', high: 'bg-rose-500 text-white', medium: 'bg-amber-500 text-white', low: 'bg-slate-400 text-white' };

export default function Inbox() {
  const [projects, setProjects] = useState([]);
  const [items, setItems] = useState(null); // [{project, comment}]
  const [selected, setSelected] = useState(new Set());
  const [filters, setFilters] = useState({ project: '', status: '', priority: '', q: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const ps = (await api('/api/projects')).projects;
        setProjects(ps);
        const all = await Promise.all(
          ps.map(async (p) => {
            const cs = (await api(`/api/projects/${p.id}/comments`)).comments;
            return cs.filter((c) => !c.parent_comment_id).map((c) => ({ project: p, comment: c }));
          })
        );
        setItems(all.flat());
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  const visible = useMemo(() => (items || []).filter(({ project, comment: c }) => {
    if (filters.project && project.id !== filters.project) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.priority && c.priority !== filters.priority) return false;
    if (filters.q) {
      const hay = `${c.title || ''} ${c.content} ${c.ref} ${c.author_name}`.toLowerCase();
      if (!hay.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  }), [items, filters]);

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function bulkResolve() {
    if (!selected.size) return;
    await Promise.all(
      [...selected].map((cid) => api(`/api/projects/comments/${cid}`, { method: 'PATCH', body: { status: 'resolved' } }).catch(() => {}))
    );
    setSelected(new Set());
    window.location.reload();
  }

  async function bulkAssign() {
    if (!selected.size) return;
    alert('Bulk assignment: pick members from the project page for now (MVP placeholder — bulk assign lands with the team page).');
  }

  return (
    <Shell active="Inbox">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Feedback inbox</h1>
            <p className="text-sm text-slate-500 mt-1">Every feedback item across all your projects, in one place.</p>
          </div>
          {selected.size > 0 && (
            <div className="flex gap-2">
              <span className="text-sm text-slate-500 self-center">{selected.size} selected</span>
              <button onClick={bulkResolve} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-semibold hover:bg-emerald-700">✓ Mark resolved</button>
              <button onClick={bulkAssign} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Assign…</button>
            </div>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2 mb-4">
          <select value={filters.project} onChange={(e) => setFilters({ ...filters, project: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">Any priority</option>
            {['critical', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search…" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm flex-1 min-w-40 outline-none focus:border-indigo-500" />
        </div>

        {items === null ? (
          <p className="text-slate-400 text-sm">Loading inbox…</p>
        ) : visible.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center text-slate-500">
            <div className="text-3xl mb-2">📭</div>
            Nothing here — inbox zero!
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 w-8"></th>
                  <th className="px-3 py-2.5 text-left font-semibold">Ref</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Title</th>
                  <th className="px-3 py-2.5 text-left font-semibold max-md:hidden">Project</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-left font-semibold max-md:hidden">Priority</th>
                  <th className="px-3 py-2.5 text-left font-semibold max-lg:hidden">Assignee</th>
                  <th className="px-3 py-2.5 text-left font-semibold max-lg:hidden">Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ project, comment: c }) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="rounded border-slate-300" /></td>
                    <td className="px-3 py-2.5 font-mono text-xs text-indigo-700">{c.ref}</td>
                    <td className="px-3 py-2.5 max-w-64"><Link to={`/projects/${project.id}`} className="text-slate-800 hover:text-indigo-600 font-medium truncate block">{c.title || c.content.slice(0, 60)}</Link></td>
                    <td className="px-3 py-2.5 text-slate-500 max-md:hidden">{project.name}</td>
                    <td className="px-3 py-2.5"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_CLASS[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                    <td className="px-3 py-2.5 max-md:hidden"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_CLASS[c.priority]}`}>{c.priority.toUpperCase()}</span></td>
                    <td className="px-3 py-2.5 text-slate-500 max-lg:hidden">{c.assignee_name || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs max-lg:hidden">{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
