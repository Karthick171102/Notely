# Notely

**Pin feedback on any prototype.** Notely is an embeddable visual feedback and review platform for UX teams, frontend developers, QA teams, agencies, and their clients.

Drop **one script tag** into any prototype's `<head>` — reviewers open the page, a feedback panel appears on the right with every comment, tagged elements are highlighted on the page, and every item can be driven to resolution and client approval.

---

## 📊 Business Context

### The Problem
Design and development teams lose hours every week collecting feedback through:
- Screenshot-annotated email threads
- Scattered comments in Slack, Notion, and Figma
- "What exactly is broken?" clarification loops
- No single source of truth for what's resolved and what's not

### The Solution
Notely puts feedback **in context**:

| Without Notely | With Notely |
|---|---|
| Screenshots pasted into email threads | Numbered pins placed directly on live page elements |
| Feedback spread across 4+ tools | One right-side panel listing every comment |
| Vague feedback ("this looks wrong") | AI-assisted clarification with type, category, and priority |
| Manual version tracking over email | Review rounds with version labels and client approvals |
| No record of who signed off | Typed-name approval signatures, fully audited |

### Who It's For
- **Agencies** — collect client sign-off with a typed signature on each review round
- **Product teams** — run internal QA on staging builds before release
- **Freelancers** — share prototypes and collect structured, actionable feedback
- **Developers** — export AI-ready JSON briefs to paste into Claude Code or Cursor

### How It Makes Money (Planned)
- **Free plan** — 1 workspace, limited projects (default)
- **Paid plans** — unlimited projects, real third-party integrations (Jira, Linear, Slack), analytics, video recording (extension points, not yet built)

---

## 🛠️ Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **API server** | Node.js 24 + Express 5 | ESM modules, deployed as Vercel serverless function |
| **Database** | Supabase PostgreSQL | Migrated from SQLite; schema in `server/supabase_schema.sql` |
| **Auth** | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) | 7-day token TTL, bcrypt cost 10 |
| **Dashboard** | React 19 + Vite 7 + Tailwind CSS v4 | SPA with `react-router-dom` v7 |
| **Exports** | `xlsx`, `jspdf`, `jspdf-autotable` | Client-side Excel, PDF, and CSV generation |
| **Embed panel** | Vanilla JS, zero dependencies | Shadow DOM isolation, `html2canvas` screenshots |
| **AI assist** | Deterministic rule-based heuristics | No external LLM key needed; always labeled, never silent |
| **Hosting** | Vercel (services) + Supabase | Config in `vercel.json`, multi-service deployment |
| **Real-time** | 5-second polling | WebSockets are a future extension point |

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Prototype (any website, any domain)                │
│  <script src=".../embed/v1.js" data-project-id>     │
│    └── embed.js — shadow DOM panel                  │
│        pins · highlighting · composer · approvals   │
└──────────────────────┬──────────────────────────────┘
                       │ /api/embed/* (token + origin checked)
┌──────────────────────▼──────────────────────────────┐
│  Vercel                                             │
│  ┌───────────────────┐    ┌──────────────────────┐  │
│  │ server service    │    │ web service          │  │
│  │ (Express API)     │    │ (React SPA, static)  │  │
│  └─────────┬─────────┘    └──────────────────────┘  │
└────────────┼────────────────────────────────────────┘
             │ @supabase/supabase-js
┌────────────▼────────────────────────────────────────┐
│  Supabase PostgreSQL                                │
│  13 tables · FKs · indexes · optional RLS           │
└─────────────────────────────────────────────────────┘
```

---

## 🗄️ Database

### Connection

Notely connects to **Supabase PostgreSQL** via the official JS SDK. Credentials come from environment variables (never hardcoded):

| Variable | Where set | Used by |
|---|---|---|
| `SUPABASE_URL` | Vercel env vars / `.env` | `server/src/index.js` (server-side client) |
| `SUPABASE_ANON_KEY` | Vercel env vars / `.env` | `server/src/index.js`, injected into `server/src/db.js` |

```js
// server/src/index.js
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
db.setSupabaseClient(supa);
```

All data access goes through the helper layer in `server/src/db.js` (`getUserByEmail`, `createProject`, `listCommentsByProject`, …) — routes never call the Supabase client directly.

### Schema

Apply `server/supabase_schema.sql` in the Supabase SQL Editor. It creates **13 tables**:

| Table | Purpose |
|---|---|
| `users` | Accounts (email, name, bcrypt password hash) |
| `workspaces` | Team spaces (name, slug, brand color, plan) |
| `workspace_members` | Workspace membership with roles (owner/admin/member/viewer) |
| `projects` | Projects (embed token, prototype URL, allowed domains, type, client) |
| `project_members` | Per-project membership with roles |
| `comments` | Feedback threads (ref `CF-0001`, status, priority, type, tags, screenshots, tech metadata, round/version binding) |
| `review_rounds` | Review rounds (deadline, requires_approval, instructions) |
| `versions` | Version labels per round (v1.0, v1.1…) |
| `approvals` | Approval/change-request records with typed-name signatures |
| `notifications` | Per-user notifications (new feedback, assignment, resolution, approval) |
| `activity_log` | Audit trail of all actions per project |
| `integrations` | Integration connections (TaskBridge mock) |
| `integration_events` | Integration sync event log |

**Row Level Security (RLS)** is recommended for production — see the policy examples in `server/supabase_schema.sql`.

---

## 🔌 API Reference

Base URL (local): `http://localhost:4000` · Base URL (production): `https://your-app.vercel.app`

All authenticated routes require `Authorization: Bearer <token>` (JWT from login). Embed routes are authenticated by **embed token + Origin check** instead.

### Health
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check → `{ ok: true }` |

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account (name, email, password ≥ 8). Auto-creates a personal workspace. |
| POST | `/api/auth/login` | Login (email + password) → `{ token, user }` |
| GET | `/api/auth/me` | Current user (JWT) |

### Projects
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | Projects for current user, with open/total counts + last activity |
| POST | `/api/projects` | Create project (name required; type, client_name optional). Generates embed token. |
| GET | `/api/projects/:id` | Project detail + members |
| PATCH | `/api/projects/:id` | Update settings (owner only) |
| DELETE | `/api/projects/:id` | Delete project (owner only) |
| POST | `/api/projects/:id/regenerate-token` | Rotate embed token (invalidates old snippet) |

### Feedback (dashboard)
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:projectId/comments` | Threaded comments, filterable by status/type/priority/page/search |
| POST | `/api/projects/:projectId/comments` | Create top-level comment or reply |
| PATCH | `/api/projects/comments/:id` | Update status, priority, type, assignee, tags, title, category |
| DELETE | `/api/projects/comments/:id` | Delete comment + replies |
| GET | `/api/projects/:id/assignees` | Workspace members for assignee pickers |
| GET | `/api/projects/:id/pages` | Distinct pages touched by feedback (sidebar list) |
| GET | `/api/projects/:id/export.json` | Machine-readable JSON export (AI-coding-agent ready) |

### Review Rounds
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:projectId/rounds` | Rounds with versions, approvals, open counts |
| POST | `/api/projects/:projectId/rounds` | Create round (name required) |
| PATCH | `/api/projects/rounds/:roundId` | Update name/status/de deadline/approval flag/instructions |
| POST | `/api/projects/rounds/:roundId/versions` | Add version label (v1.1…) |
| POST | `/api/projects/rounds/:roundId/approvals` | Record approval / change request (typed-name signature required) |

### Embed (public, token + origin checked)
| Method | Path | Description |
|---|---|---|
| GET | `/embed/v1.js` | The embed script (also `/embed/:token.js` legacy) |
| GET | `/api/embed/:token/meta` | Project/round/version meta for the panel header |
| GET | `/api/embed/:token/comments` | Public comments (internal notes excluded) |
| POST | `/api/embed/:token/comments` | Submit feedback (element or region target, screenshot, tech metadata). Rate-limited: 30/min per IP+project. |
| POST | `/api/embed/:token/comments/:id/replies` | Reply to a comment |
| POST | `/api/embed/:token/approvals` | Client approval / change request from the panel |
| POST | `/api/embed/:token/ai-refine` | Rule-based AI assist for the composer |

### AI
| Method | Path | Description |
|---|---|---|
| POST | `/api/ai/refine` | Detect type/category/priority, clarify vague text, acceptance criteria |
| GET | `/api/ai/brief/:feedbackId` | Structured developer brief (markdown + JSON) for Claude Code / Cursor |

### Notifications
| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications` | Latest 50 + unread count |
| POST | `/api/notifications/mark-read` | Mark all read |

### Workspace
| Method | Path | Description |
|---|---|---|
| GET | `/api/workspace` | Current user's workspace + members |
| POST | `/api/workspace` | Create workspace (one per user) |
| POST | `/api/workspace/:id/members` | Invite member by email (owner only; creates pending user with temp password) |

### Integrations
| Method | Path | Description |
|---|---|---|
| GET | `/api/integrations` | Connections + sync event log |
| POST | `/api/integrations/taskbridge/connect` | Connect the TaskBridge mock |
| POST | `/api/integrations/taskbridge/disconnect` | Disconnect |
| POST | `/api/integrations/send/:feedbackId` | Push feedback to TaskBridge (returns external task ID) |

---

## 🚀 Run It Locally

Requirements: **Node 24+** and a **Supabase project** (free tier works).

```bash
# 1. Install dependencies
npm install

# 2. Apply the schema (paste server/supabase_schema.sql into the Supabase SQL Editor)

# 3. Configure credentials — copy .env.example to server/.env and fill in:
#    SUPABASE_URL=https://your-project.supabase.co
#    SUPABASE_ANON_KEY=eyJ...

# 4. Start both processes
npm run dev:server    # API on http://localhost:4000
npm run dev:web       # dashboard on http://localhost:5173 (proxies /api)

# Or run everything on one port (production mode):
npm run build && npm start
```

---

## 🌐 Deploy to Production (Vercel + Supabase)

1. **Supabase** — create a project, run `server/supabase_schema.sql`, copy the URL + anon key
2. **Vercel** — import the GitHub repo; the `vercel.json` at the root defines two services:
   - `server` (Express API) — receives `/api/*` traffic
   - `web` (Vite SPA) — receives everything else
3. **Environment variables** — in Vercel → Settings → Environment Variables, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Production and Preview)
4. **Deploy** — then verify `https://your-app.vercel.app/api/health` returns `{"ok":true}`

---

## 📌 Embedding in Your Own Prototype

Paste into the `<head>` of your prototype's `index.html` (the snippet is also available per project in the dashboard):

```html
<script src="https://your-app.vercel.app/embed/v1.js" data-project-id="<project_id>" defer></script>
```

Optional attributes: `data-round-id`, `data-environment`. Legacy `/embed/<token>.js` URLs still work.

**Behavior:**
- On page load the panel appears on the **right side** with all comments for the current project
- Tagged elements are **highlighted** on the page (numbered pins per feedback item)
- Hiding the panel (the `—` button) also **removes all highlights**; reopening restores them
- Reviewers pick **elements** (hover + click) or **regions** (drag a rectangle) to leave feedback
- Screenshots, browser/OS/viewport metadata, and console errors are captured automatically

See [docs/EMBED.md](docs/EMBED.md) for security details and troubleshooting; [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup.

---

## 🗂️ Repository Structure

```
server/                 Node.js + Express API (Supabase PostgreSQL, JWT auth)
  src/index.js            entry point — Express app + Supabase client init
  src/db.js               Supabase data-access layer (13 tables)
  src/auth.js             JWT signing, requireAuth middleware
  src/routes/             auth, projects, dashboard, rounds, embed, ai,
                          notifications, workspace, integrations
  src/seed.js             optional sample-data seeder
  supabase_schema.sql     full PostgreSQL schema (run in Supabase SQL Editor)
  public/embed.js         the embeddable review panel (zero dependencies, shadow DOM)
web/                    Dashboard SPA — React 19 + Vite + Tailwind CSS v4
  src/api.js              fetch client + session management (localStorage)
  src/export.js           CSV / Excel / PDF export builders
  src/pages/              Login, Shell, Projects, ProjectDetail, Inbox, Integrations
docs/
  EMBED.md                embed installation, security, anchoring, troubleshooting
  DEPLOYMENT.md           production deployment guide
vercel.json             Vercel services config (server + web, /api rewrites)
.env.example            required environment variables
```

---

## ✅ Feature Scope

✅ Auth + workspace · projects · embed script generation · collapsible right panel · element **and** region selection · screenshot capture · numbered pins · highlighting · status workflow (open → in progress → resolved / reopened) · assignment · tags · comment threads · guest access · review rounds · version labels · client approval with typed signature · AI comment refinement · AI developer brief · JSON/CSV/Excel/PDF export · TaskBridge mock integration · in-app notifications · responsive dashboard · Vercel + Supabase deployment.

**Honest placeholders:** the "AI" features are deterministic rule-based assistants (no external LLM key needed) — always labeled, always shown before applying, never silently overwriting reviewer text. Billing, deep analytics, video recording, real third-party integrations (Jira, Linear, Slack), and the browser extension are extension points, not built. WebSockets are replaced by 5-second polling.

---

## 🔒 Security Notes

- Passwords: bcrypt (cost 10), never stored or logged in plain text
- Sessions: JWT with 7-day expiry; 401 responses auto-clear the session client-side
- Embed API: origin-checked against each project's `allowed_domains`; `*` permits any domain
- Guest feedback: rate-limited (30 writes/min per IP + project), text sanitized and truncated, screenshots capped at 4 MB
- Internal notes (`is_internal`) are excluded from all public embed responses
- Recommended: enable Row Level Security on all Supabase tables before production traffic
