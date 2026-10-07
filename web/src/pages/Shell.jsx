import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api, getUser, clearSession } from '../api.js';

export default function Shell({ active, children }) {
  const navigate = useNavigate();
  const user = getUser();
  const [workspace, setWorkspace] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState({ notifications: [], unread: 0 });

  useEffect(() => {
    api('/api/workspace').then((d) => setWorkspace(d.workspace)).catch(() => {});
    loadNotifications();
  }, []);

  async function loadNotifications() {
    try {
      const d = await api('/api/notifications');
      setNotifications(d);
    } catch { /* ignore */ }
  }

  async function openBell() {
    setNotifOpen(!notifOpen);
    if (!notifOpen && notifications.unread > 0) {
      await api('/api/notifications/mark-read', { method: 'POST' }).catch(() => {});
      loadNotifications();
    }
  }

  const nav = [
    ['Projects', '/'],
    ['Inbox', '/inbox'],
    ['Integrations', '/integrations'],
  ];

  return (
    <div className="min-h-full bg-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col max-md:hidden">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-slate-200">
          <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-extrabold flex items-center justify-center text-sm">C</span>
          <span className="font-bold text-slate-900">Contextly</span>
        </div>
        <nav className="p-3 space-y-1 flex-1">
          {nav.map(([label, to]) => (
            <NavLink
              key={to}
              to={to}
              className={() =>
                `block px-3 py-2 rounded-lg text-sm font-semibold ${active === label ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`
              }
            >
              {label}
            </NavLink>
          ))}
          <span className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 cursor-default" title="Coming soon">Rounds</span>
          <span className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-300 cursor-default" title="Coming soon">Reports</span>
        </nav>
        <div className="p-4 border-t border-slate-200 text-xs text-slate-400">
          {workspace ? workspace.name : 'Workspace'}
          <div className="text-slate-300 mt-0.5 capitalize">{workspace?.plan ?? 'free'} plan</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
          <div className="h-16 px-6 flex items-center gap-3">
            <div className="flex items-center gap-2 md:hidden">
              <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-extrabold flex items-center justify-center text-xs">C</span>
            </div>
            <span className="text-sm font-semibold text-slate-700 truncate">{workspace?.name ?? ''}</span>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <button onClick={openBell} className="relative w-9 h-9 rounded-lg hover:bg-slate-100 text-lg" title="Notifications">
                  🔔
                  {notifications.unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-bold min-w-4 h-4 px-1 rounded-full flex items-center justify-center">
                      {notifications.unread}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-30 max-h-96 overflow-y-auto">
                    {notifications.notifications.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-6">No notifications yet</p>
                    ) : (
                      notifications.notifications.map((n) => (
                        <div key={n.id} className="px-4 py-2.5 text-sm border-b border-slate-50 last:border-0">
                          <p className="text-slate-700">{n.message}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <span className="text-sm text-slate-600 max-sm:hidden">{user?.name}</span>
              <button onClick={() => { clearSession(); navigate('/login'); }} className="text-sm text-slate-500 hover:text-slate-800">
                Log out
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
