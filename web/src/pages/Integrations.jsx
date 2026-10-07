import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Shell from './Shell.jsx';

export default function Integrations() {
  const [data, setData] = useState(null);
  const [config, setConfig] = useState({ workspace_name: 'Northstar PM', project: 'ACME', task_type: 'Task' });
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api('/api/integrations');
    setData(d);
    const tb = d.integrations.find((i) => i.provider === 'taskbridge');
    if (tb?.configuration) {
      const cfg = JSON.parse(tb.configuration);
      setConfig({ workspace_name: cfg.workspace_name || '', project: cfg.project || '', task_type: cfg.task_type || 'Task' });
    }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function connect() {
    setBusy(true);
    try {
      await api('/api/integrations/taskbridge/connect', { method: 'POST', body: config });
      await load();
    } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await api('/api/integrations/taskbridge/disconnect', { method: 'POST' });
      await load();
    } finally { setBusy(false); }
  }

  const tb = data?.integrations.find((i) => i.provider === 'taskbridge');
  const connected = tb?.connection_status === 'connected';

  return (
    <Shell active="Integrations">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">Push feedback into your project-management tools. More providers coming soon.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {['Jira', 'Linear', 'GitHub Issues', 'Slack', 'Notion', 'Zapier'].map((name) => (
            <div key={name} className="bg-white border border-slate-200 rounded-xl p-4 opacity-60">
              <div className="font-semibold text-slate-700">{name}</div>
              <p className="text-xs text-slate-400 mt-1">Coming soon</p>
            </div>
          ))}
        </div>

        <div className="bg-white border-2 border-indigo-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg bg-violet-600 text-white font-extrabold flex items-center justify-center">T</span>
            <div className="flex-1">
              <h2 className="font-semibold text-slate-900">TaskBridge <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded align-middle">MOCK · 2-WAY SYNC</span></h2>
              <p className="text-xs text-slate-500">Simulated project-management integration for testing the full sync flow.</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded-full ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {!connected ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">PM workspace name</span>
                <input value={config.workspace_name} onChange={(e) => setConfig({ ...config, workspace_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Destination project key</span>
                <input value={config.project} onChange={(e) => setConfig({ ...config, project: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Task type</span>
                <select value={config.task_type} onChange={(e) => setConfig({ ...config, task_type: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
                  <option>Task</option><option>Bug</option><option>Story</option>
                </select>
              </label>
              <div className="md:col-span-3">
                <button onClick={connect} disabled={busy} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                  {busy ? 'Connecting…' : 'Connect TaskBridge'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={disconnect} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Disconnect</button>
              <span className="text-xs text-slate-400 self-center">Push feedback from any project's detail page with “🔗 Send to task”. Status sync can be simulated per item.</span>
            </div>
          )}
        </div>

        <h2 className="font-semibold text-slate-900 mt-8 mb-3">Sync activity</h2>
        {!data?.events.length ? (
          <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">No sync events yet.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {data.events.map((e) => (
              <div key={e.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${e.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{e.event_type}</span>
                <span className="text-slate-600 font-mono text-xs">{(() => { try { return JSON.stringify(JSON.parse(e.payload)); } catch { return e.payload; } })()}</span>
                <span className="ml-auto text-xs text-slate-400">{new Date(e.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
