import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getUser } from '../api.js';
import { exportCSV, exportExcel, exportPDF } from '../export.js';
import Shell from './Shell.jsx';

const STATUS_LABEL = { open: 'New', in_progress: 'In progress', resolved: 'Resolved', reopened: 'Reopened' };
const STATUS_CLASS = {
  open: 'bg-rose-100 text-rose-700', reopened: 'bg-rose-100 text-rose-700',
  in_progress: 'bg-amber-100 text-amber-700', resolved: 'bg-emerald-100 text-emerald-700',
};
const PRIORITY_CLASS = { critical: 'bg-rose-600 text-white', high: 'bg-rose-500 text-white', medium: 'bg-amber-500 text-white', low: 'bg-slate-400 text-white' };
const TYPES = [['bug', 'Bug'], ['design_change', 'Design change'], ['ux', 'UX concern'], ['content', 'Content change'], ['accessibility', 'Accessibility'], ['performance', 'Performance'], ['question', 'Question'], ['other', 'Other']];
const TYPE_ICON = { bug: '🐞', design_change: '🎨', ux: '🧭', content: '✏️', accessibility: '♿', performance: '⚡', question: '❓', other: '💬', suggestion: '💡' };

export default function ProjectDetail() {
  const { id } = useParams();
  const user = getUser();
  const [project, setProject] = useState(null);
  const [comments, setComments] = useState([]);
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('feedback');
  const [filters, setFilters] = useState({ status: '', type: '', priority: '', q: '' });
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const [p, c, m] = await Promise.all([
      api(`/api/projects/${id}`),
      api(`/api/projects/${id}/comments`),
      api(`/api/projects/${id}/assignees`),
    ]);
    setProject(p.project);
    setComments(c.comments);
    setMembers(m.members);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const visible = useMemo(() => comments.filter((c) => {
    if (c.parent_comment_id) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.type && c.type !== filters.type) return false;
    if (filters.priority && c.priority !== filters.priority) return false;
    if (filters.q) {
      const hay = `${c.title || ''} ${c.content} ${c.ref} ${c.author_name} ${c.element_selector}`.toLowerCase();
      if (!hay.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  }), [comments, filters]);

  const thread = selected ? comments.find((c) => c.id === selected) : null;
  const counts = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_comment_id);
    return {
      total: roots.length,
      open: roots.filter((c) => c.status === 'open' || c.status === 'reopened').length,
      in_progress: roots.filter((c) => c.status === 'in_progress').length,
      resolved: roots.filter((c) => c.status === 'resolved').length,
    };
  }, [comments]);

  async function updateComment(cid, body) {
    await api(`/api/projects/comments/${cid}`, { method: 'PATCH', body });
    await load();
  }
  async function addReply(cid, content) {
    await api(`/api/projects/${id}/comments`, { method: 'POST', body: { content, parent_comment_id: cid } });
    await load();
  }
  async function deleteComment(cid) {
    await api(`/api/projects/comments/${cid}`, { method: 'DELETE' });
    setSelected(null);
    await load();
  }

  if (error && !project) {
    return <Shell active="Projects"><div className="p-10 text-rose-600">{error}</div></Shell>;
  }
  if (!project) return <Shell active="Projects"><div /></Shell>;

  return (
    <Shell active="Projects">
      <div className="flex flex-col min-h-full">
        <header className="bg-white border-b border-slate-200">
          <div className="px-6 h-16 flex items-center gap-4">
            <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">← Projects</Link>
            <div className="h-6 w-px bg-slate-200" />
            <h1 className="font-bold text-slate-900 truncate">{project.name}</h1>
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{(project.type || 'website').replace('_', ' ')}</span>
            <nav className="ml-auto flex gap-1">
              {['feedback', 'rounds', 'settings'].map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold capitalize ${tab === t ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}>
                  {t}
                </button>
              ))}
            </nav>
            {tab === 'feedback' && <ExportMenu project={project} comments={comments} />}
            <span className="text-sm text-slate-400 max-lg:hidden">{user?.name}</span>
          </div>
        </header>

        {tab === 'feedback' && (
          <FeedbackBoard project={project} members={members} visible={visible} counts={counts} filters={filters} setFilters={setFilters}
            selected={selected} setSelected={setSelected} thread={thread} updateComment={updateComment} addReply={addReply} deleteComment={deleteComment} />
        )}
        {tab === 'rounds' && <RoundsTab project={project} />}
        {tab === 'settings' && <SettingsTab project={project} reload={load} />}
      </div>
    </Shell>
  );
}

function ExportMenu({ project, comments }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function run(fn) {
    setOpen(false); setBusy(true);
    try { await fn(project, comments); } catch (err) { alert(`Export failed: ${err.message}`); } finally { setBusy(false); }
  }
  function exportJSON() {
    setOpen(false);
    window.open(`/api/projects/${project.id}/export.json`, '_blank');
  }

  const item = 'w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
        {busy ? 'Exporting…' : '⬇ Export'}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
          <button className={item} onClick={() => run(exportExcel)}>📊 Excel (.xlsx)</button>
          <button className={item} onClick={() => run(exportPDF)}>📄 PDF</button>
          <button className={item} onClick={() => run(exportCSV)}>📃 CSV</button>
          <button className={item} onClick={exportJSON}>🤖 JSON (AI-ready)</button>
        </div>
      )}
    </div>
  );
}

function FeedbackBoard({ project, members, visible, counts, filters, setFilters, selected, setSelected, thread, updateComment, addReply, deleteComment }) {
  return (
    <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 flex gap-6 items-start">
      <div className="flex-1 min-w-0">
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2 mb-4">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">All types</option>
            {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">Any priority</option>
            {['critical', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search by ref, title, text…"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm flex-1 min-w-40 outline-none focus:border-indigo-500" />
          <div className="flex gap-1.5 ml-auto items-center text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-1">{counts.total} total</span>
            <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-1">{counts.open} open</span>
            <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-1">{counts.in_progress} active</span>
            <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-1">{counts.resolved} resolved</span>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center text-slate-500">
            <div className="text-3xl mb-2">💬</div>
            No feedback here yet. Open the prototype and pin the first comment — or{' '}
            <a href={`/demo/${project.id}`} target="_blank" rel="noreferrer" className="text-indigo-600 font-semibold hover:underline">open this project on the demo page</a>{' '}
            (the embed script is already injected there).
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((c) => (
              <li key={c.id} onClick={() => setSelected(c.id)}
                className={`bg-white border rounded-xl p-4 cursor-pointer hover:border-indigo-300 ${selected === c.id ? 'border-indigo-500 ring-2 ring-indigo-500/15' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{c.ref}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_CLASS[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_CLASS[c.priority]}`}>{c.priority.toUpperCase()}</span>
                  <span className="text-sm" title={c.type}>{TYPE_ICON[c.type] || '💬'} {c.type?.replace('_', ' ')}</span>
                  {c.category && <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{c.category}</span>}
                  {c.is_internal && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">INTERNAL</span>}
                  {c.external_task_id && <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded" title="Synced to TaskBridge">🔗 {c.external_task_id}</span>}
                  <span className="ml-auto text-xs text-slate-400">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                {c.title && <p className="text-sm font-semibold text-slate-800 mt-2">{c.title}</p>}
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">{c.content}</p>
                {c.screenshot_url && (
                  <img src={c.screenshot_url} alt={`Screenshot for ${c.ref}`} className="mt-2 max-h-40 rounded-lg border border-slate-200" />
                )}
                <p className="text-xs text-slate-400 mt-2 truncate">
                  <code className="bg-slate-100 rounded px-1">{c.element_selector}</code>
                  {c.element_snapshot?.textSnippet ? ` · “${c.element_snapshot.textSnippet}”` : ''}
                  {c.region ? ' · custom region' : ''} · {c.page_path}
                  {c.round_name ? ` · ${c.round_name}` : ''}{c.version_name ? ` (${c.version_name})` : ''}
                </p>
                <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-2">
                  {c.author_name}
                  {c.replies?.length ? ` · ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}` : ''}
                  {c.assignee_name && <span className="text-indigo-600 font-semibold">→ {c.assignee_name}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {thread && (
        <FeedbackThread
          thread={thread} members={members} project={project}
          updateComment={updateComment} addReply={addReply} deleteComment={deleteComment} setSelected={setSelected}
        />
      )}
    </div>
  );
}

function FeedbackThread({ thread, members, project, updateComment, addReply, deleteComment, setSelected }) {
  const [brief, setBrief] = useState(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [tagsInput, setTagsInput] = useState((thread.tags || []).join(', '));

  useEffect(() => { setTagsInput((thread.tags || []).join(', ')); setBrief(null); }, [thread.id]);

  async function generateBrief() {
    setBriefBusy(true);
    try {
      const d = await api(`/api/ai/brief/${thread.id}`);
      setBrief(d);
    } catch (e) { alert(e.message); } finally { setBriefBusy(false); }
  }
  async function sendToTaskBridge() {
    setSendBusy(true);
    try {
      const d = await api(`/api/integrations/send/${thread.id}`, { method: 'POST' });
      alert(`Task created in TaskBridge: ${d.external_task_id}`);
      window.location.reload();
    } catch (e) { alert(e.message); } finally { setSendBusy(false); }
  }

  return (
    <aside className="w-96 shrink-0 bg-white border border-slate-200 rounded-xl sticky top-24 max-h-[calc(100vh-7rem)] flex flex-col">
      <div className="p-4 border-b border-slate-100 flex items-center gap-2">
        <h2 className="font-semibold text-slate-900 flex-1">{thread.ref} · {thread.title || 'Feedback'}</h2>
        <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
      </div>

      <div className="p-4 border-b border-slate-100 space-y-3 overflow-y-auto">
        <div className="flex gap-2">
          <select value={thread.status} onChange={(e) => updateComment(thread.id, { status: e.target.value })} className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={thread.priority} onChange={(e) => updateComment(thread.id, { priority: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            {['critical', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
          <select value={thread.type} onChange={(e) => updateComment(thread.id, { type: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <select value={thread.assignee_id || ''} onChange={(e) => updateComment(thread.id, { assignee_id: e.target.value })} className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={thread.category || ''} onChange={(e) => updateComment(thread.id, { category: e.target.value })} className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            <option value="">No category</option>
            {['layout', 'typography', 'color', 'spacing', 'interaction', 'navigation', 'content', 'responsive', 'accessibility', 'technical'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Tags (comma-separated)"
            className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500" />
          <button onClick={() => updateComment(thread.id, { tags: tagsInput.split(',').map((s) => s.trim()).filter(Boolean) })}
            className="rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Save</button>
        </div>

        {thread.screenshot_url && (
          <img src={thread.screenshot_url} alt="Annotated capture" className="rounded-lg border border-slate-200 w-full" />
        )}

        <div className="text-xs text-slate-400 break-all bg-slate-50 rounded-lg p-2.5 space-y-1">
          <div><code>{thread.element_selector}</code>{thread.region && <span> · region {thread.region.w}×{thread.region.h}px</span>}</div>
          {thread.element_snapshot?.boundingBox && <div>Element box: {thread.element_snapshot.boundingBox.w}×{thread.element_snapshot.boundingBox.h}px</div>}
          <div>{thread.page_url}</div>
        </div>

        <div className="flex gap-2">
          {thread.status !== 'resolved' ? (
            <button onClick={() => updateComment(thread.id, { status: 'resolved' })} className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold hover:bg-emerald-700">✓ Mark resolved</button>
          ) : (
            <button onClick={() => updateComment(thread.id, { status: 'reopened' })} className="flex-1 rounded-lg bg-rose-600 text-white py-2 text-sm font-semibold hover:bg-rose-700">↺ Reopen</button>
          )}
          <button onClick={() => { if (confirm('Delete this feedback and its replies?')) deleteComment(thread.id); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Delete</button>
        </div>
        <div className="flex gap-2">
          <button onClick={generateBrief} disabled={briefBusy} className="flex-1 rounded-lg bg-indigo-600 text-white py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
            {briefBusy ? 'Generating…' : '✨ Generate developer brief'}
          </button>
          <button onClick={sendToTaskBridge} disabled={sendBusy} title="Push to the TaskBridge mock integration"
            className="rounded-lg border border-violet-300 text-violet-700 px-3 py-2 text-sm font-semibold hover:bg-violet-50 disabled:opacity-60">
            🔗 Send to task
          </button>
        </div>
        {thread.external_task_id && (
          <p className="text-xs text-violet-600">Synced with TaskBridge as <b>{thread.external_task_id}</b></p>
        )}
        {brief && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 mb-1">✨ AI-generated developer brief — review before using</p>
            <pre className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap max-h-64 overflow-y-auto">{brief.markdown}</pre>
            <div className="flex gap-2 mt-2">
              <button onClick={() => navigator.clipboard?.writeText(brief.markdown)} className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700">Copy for Claude Code / Cursor</button>
              <button onClick={() => { const blob = new Blob([JSON.stringify(brief.brief, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${thread.ref}.json`; a.click(); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Export JSON</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <Message c={thread} />
        {(thread.replies || []).map((r) => <Message key={r.id} c={r} />)}
      </div>

      <ReplyBox onSend={(text) => addReply(thread.id, text)} />
    </aside>
  );
}

function Message({ c }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
      <div className="flex justify-between gap-2 text-xs">
        <span className="font-bold text-slate-800">{c.author_name}</span>
        <span className="text-slate-400">{new Date(c.created_at).toLocaleString()}</span>
      </div>
      <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{c.content}</p>
    </div>
  );
}

function ReplyBox({ onSend }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await onSend(text.trim()); setText(''); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={send} className="p-4 border-t border-slate-100 flex gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply…"
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15" />
      <button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-indigo-600 text-white px-3.5 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">Send</button>
    </form>
  );
}

function RoundsTab({ project }) {
  const [rounds, setRounds] = useState(null);
  const [form, setForm] = useState({ name: '', deadline: '', requires_approval: true, instructions: '' });
  const [versionForm, setVersionForm] = useState({});
  const [error, setError] = useState('');

  async function load() {
    const d = await api(`/api/projects/${project.id}/rounds`);
    setRounds(d.rounds);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [project.id]);

  async function createRound(e) {
    e.preventDefault();
    await api(`/api/projects/${project.id}/rounds`, { method: 'POST', body: { ...form, deadline: form.deadline || null } });
    setForm({ name: '', deadline: '', requires_approval: true, instructions: '' });
    load();
  }
  async function addVersion(roundId) {
    const name = versionForm[roundId];
    if (!name) return;
    await api(`/api/projects/rounds/${roundId}/versions`, { method: 'POST', body: { name } });
    setVersionForm({ ...versionForm, [roundId]: '' });
    load();
  }
  async function recordApproval(roundId, status) {
    const signed = prompt(`Type your name to confirm ${status === 'approved' ? 'approval' : 'a change request'}:`);
    if (!signed) return;
    const note = status === 'changes_requested' ? prompt('What needs to change?') : prompt('Optional note:') ?? '';
    await api(`/api/projects/rounds/${roundId}/approvals`, { method: 'POST', body: { status, note, signed_name: signed } });
    load();
  }

  if (!rounds) return <div className="max-w-3xl mx-auto px-6 py-8 text-slate-400 text-sm">Loading rounds…</div>;

  return (
    <div className="max-w-3xl w-full mx-auto px-6 py-8 space-y-6">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <form onSubmit={createRound} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-slate-900">New review round</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Visual design review"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Approval deadline</span>
            <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Instructions for reviewers</span>
          <textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.requires_approval} onChange={(e) => setForm({ ...form, requires_approval: e.target.checked })} className="rounded border-slate-300" />
          <span className="text-sm text-slate-700">Client can approve this round from the review panel</span>
        </label>
        <button type="submit" className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700">Create round</button>
      </form>

      {rounds.map((r) => {
        const approved = r.approvals.filter((a) => a.status === 'approved').length;
        const changes = r.approvals.filter((a) => a.status === 'changes_requested').length;
        return (
          <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900">{r.name}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
              {r.requires_approval && <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">CLIENT APPROVAL</span>}
              {r.deadline && <span className="text-xs text-slate-400">due {new Date(r.deadline).toLocaleDateString()}</span>}
              <span className="ml-auto text-xs text-slate-400">{r.open_count} open</span>
            </div>
            {r.instructions && <p className="text-sm text-slate-500">{r.instructions}</p>}
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
              <span className="font-semibold text-slate-600">Versions:</span>
              {r.versions.map((v) => <span key={v.id} className="bg-slate-100 rounded px-1.5 py-0.5 font-mono">{v.name}</span>)}
            </div>
            <div className="flex gap-2">
              <input value={versionForm[r.id] || ''} onChange={(e) => setVersionForm({ ...versionForm, [r.id]: e.target.value })} placeholder="New version label (e.g. v1.1)"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500" />
              <button onClick={() => addVersion(r.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Add version</button>
            </div>
            <div className="text-xs text-slate-500">
              <b>Approvals:</b> {approved} approved{changes ? ` · ${changes} change request${changes > 1 ? 's' : ''}` : ''}
              {r.approvals.length === 0 && ' — none recorded yet'}
            </div>
            {r.approvals.map((a) => (
              <p key={a.id} className="text-xs text-slate-400">
                {new Date(a.created_at).toLocaleString()} — {a.reviewer_name} {a.status === 'approved' ? '✓ approved' : '↺ requested changes'}{a.signed_name ? ` (signed “${a.signed_name}”)` : ''}{a.note ? ` — “${a.note}”` : ''}
              </p>
            ))}
            <div className="flex gap-2">
              <button onClick={() => recordApproval(r.id, 'approved')} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700">✓ Record approval</button>
              <button onClick={() => recordApproval(r.id, 'changes_requested')} className="rounded-lg border border-rose-300 text-rose-700 px-3 py-1.5 text-xs font-semibold hover:bg-rose-50">Request changes</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({ project, reload }) {
  const [form, setForm] = useState({
    name: project.name, description: project.description || '', prototype_url: project.prototype_url || '',
    is_public: project.is_public, allowed_domains: (project.allowed_domains || []).join(', '),
  });
  const [saved, setSaved] = useState(false);
  const [token, setToken] = useState(project.embed_token);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    await api(`/api/projects/${project.id}`, {
      method: 'PATCH',
      body: {
        name: form.name, description: form.description, prototype_url: form.prototype_url, is_public: form.is_public,
        allowed_domains: form.allowed_domains.split(',').map((s) => s.trim()).filter(Boolean),
      },
    });
    setSaved(true); setTimeout(() => setSaved(false), 2000); reload();
  }

  const snippet = `<script src="${location.origin}/embed/v1.js" data-project-id="${project.id}" defer></script>`;

  return (
    <div className="max-w-3xl w-full mx-auto px-6 py-8 space-y-6">
      <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-slate-900">Project settings</h2>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Name</span>
          <input value={form.name} onChange={set('name')} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Description</span>
          <textarea value={form.description} onChange={set('description')} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Prototype URL</span>
          <input value={form.prototype_url} onChange={set('prototype_url')} placeholder="https://staging.example.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_public} onChange={set('is_public')} className="rounded border-slate-300" />
          <span className="text-sm text-slate-700">Public — anyone with the prototype link can leave feedback</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Allowed domains (comma-separated, * for any)</span>
          <input value={form.allowed_domains} onChange={set('allowed_domains')} placeholder="staging.example.com, localhost:3000" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700">Save changes</button>
          {saved && <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>}
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-slate-900">Script snippet</h2>
        <p className="text-sm text-slate-500">Paste this into the <code className="bg-slate-100 px-1 rounded">&lt;head&gt;</code> of your prototype's <code className="bg-slate-100 px-1 rounded">index.html</code>. The panel verifies itself on load — if the token is wrong you'll see a visible error banner.</p>
        <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">{snippet}</pre>
        <button onClick={() => navigator.clipboard?.writeText(snippet)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Copy snippet</button>
        <p className="text-xs text-slate-400">Environment variants: append <code>data-environment="staging"</code> to distinguish builds (informational).</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-slate-900">Danger zone</h2>
        <p className="text-sm text-slate-500">Regenerating the embed token invalidates the old snippet. Any prototype still using it will show a visible error.</p>
        <button onClick={async () => {
          if (!confirm('Regenerate the embed token? Existing embeds will stop working.')) return;
          const data = await api(`/api/projects/${project.id}/regenerate-token`, { method: 'POST' });
          setToken(data.embed_token);
        }} className="rounded-lg border border-rose-300 text-rose-700 px-4 py-2 text-sm font-semibold hover:bg-rose-50">Regenerate embed token</button>
      </div>
    </div>
  );
}
