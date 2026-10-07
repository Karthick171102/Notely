# Contextly

**Visual feedback, in context.** — An AI-assisted visual feedback and review platform for UX teams, frontend developers, QA, agencies, and their clients. Embed one script tag into any prototype, and reviewers select elements or draw regions, leave pinned feedback with screenshots, and drive every item to resolution and client approval.

This repository contains the full working MVP:

```
server/              Node.js + Express API (SQLite via node:sqlite, JWT auth)
  src/db.js            schema + migrations (workspaces, rounds, versions, approvals, integrations…)
  src/routes/          auth, workspace, projects, rounds, dashboard, embed, ai, notifications, integrations
  public/embed.js      the embeddable review panel (zero dependencies, shadow DOM)
  public/demo.html     sample prototype used by GET /demo
  src/seed.js          sample workspace "Northstar Product Studio" + 3 projects + spec feedback
web/                 Dashboard SPA — React 19 + Vite + Tailwind CSS v4
  src/pages/           Login, Shell (sidebar + notifications), Projects, ProjectDetail,
                       Inbox (cross-project), Integrations (TaskBridge mock)
docs/                EMBED.md (installation, security), DEPLOYMENT.md
```

## Run it locally

Requirements: Node 24+ (uses the built-in `node:sqlite`).

```bash
npm install
npm run seed          # sample data: dana@contextly.test / password123
npm run dev:server    # API on http://localhost:4000
npm run dev:web       # dashboard on http://localhost:5173 (proxies /api)
# or: npm run build && npm start  → everything on http://localhost:4000
```

## The 60-second tour

1. Log in at `http://localhost:4000` (`dana@contextly.test` / `password123`) — workspace **Northstar Product Studio**.
2. Open a project → **Feedback / Rounds / Settings** tabs. Every item has a reference ID (`CF-0001`…), status, priority, type, category, assignee, tags, round, and version.
3. Click **Try on demo page** (or open [`/demo`](http://localhost:4000/demo)) — the prototype has the Contextly script already injected.
4. In the prototype: open the 💬 panel → **＋ Feedback** → switch between **Element** and **Region** mode → hover/click or drag a rectangle → the composer opens in the panel.
5. Type something vague like "fix this" and press **✨ Improve with AI** — a suggestion card appears (title, clarified text, detected type/priority). Accept, edit, or ignore; the original comment is never silently changed.
6. Submit — a screenshot is captured automatically, technical metadata (browser, OS, viewport, DPR, locale, console errors) is attached, and a **numbered pin** appears on the element/region.
7. In the dashboard: open the item → change status, assign, tag, **✨ Generate developer brief** (structured markdown for Claude Code/Cursor, copyable, with JSON export), or **🔗 Send to task** (TaskBridge mock integration — external task ID + two-way status sync).
8. **Rounds tab**: create review rounds with deadlines and instructions, add version labels (v1.0, v1.1…), record approvals/change requests — clients can also approve directly from the embed panel (typed-name signature required).
9. **Export** menu: Excel (.xlsx), PDF, CSV, and **AI-ready JSON**. The **Inbox** aggregates feedback across all projects with filters and bulk resolve. The **bell** shows notifications for new feedback, assignments, resolutions, and approvals.

## Embedding in your own prototype

Paste into the `<head>` of your prototype's `index.html` (snippet also available per project in the dashboard):

```html
<script src="http://localhost:4000/embed/v1.js" data-project-id="<project_id>" defer></script>
```

Optional attributes: `data-round-id`, `data-environment`. Legacy `/embed/<token>.js` URLs still work. The panel is a non-intrusive floating overlay (collapsed to a 💬 button by default). See [docs/EMBED.md](docs/EMBED.md) for security, anchoring behavior, and troubleshooting; [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup.

## MVP scope (per spec §24)

✅ Auth + workspace · projects · review-link/script generation · embedded collapsible panel · element **and region** selection · screenshot capture · numbered pins · status workflow · assignment · tags · comment threads · guest access · review rounds · version labels · client approval · AI comment rewriting · AI developer brief · JSON export · TaskBridge integration · in-app notifications · responsive dashboard.

**Honest placeholders:** the "AI" features are deterministic rule-based assistants (no external LLM key needed) — always labeled, always shown before applying. Billing, deep analytics, video recording, real third-party integrations, and the browser extension are extension points, not built. WebSockets are replaced by 5-second polling.
