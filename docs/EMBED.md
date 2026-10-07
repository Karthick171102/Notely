# Embed guide

## 1. Get your embed token

Create a project in the Contextly dashboard. Each project gets a unique `embed_token` (shown in **Settings → Embed script**, or via the **Copy embed link** button on the project list).

## 2. Paste the script tag

In the `<head>` of your prototype's entry HTML file (`index.html` or equivalent):

```html
<script src="https://your-contextly-host/embed/<embed_token>.js" defer></script>
```

Framework-specific notes:

- **Static HTML / Vite / plain SPA** — paste in `index.html` `<head>`. Done.
- **Next.js (App Router)** — put it in `app/layout.jsx` inside `<head>`, or use `next/script` with `strategy="afterInteractive"` and the full URL as `src`.
- **React / Angular routers with changing `<head>`** — the tag must exist once in the initial server-rendered HTML; the script only reads its own `src` at load time.
- The script is `defer`-safe, CSP-friendly (no inline code, no `eval`), and renders entirely inside a shadow DOM.

## 3. What reviewers see

- A **floating overlay panel**: collapsed by default to a small 💬 button (bottom-right, with an open-count badge) so the prototype stays fully visible; clicking it opens a rounded floating panel. The choice is remembered per visitor.
- **＋ Select** enters selection mode: elements highlight on hover with a tag label; clicking one opens the comment composer (text, type, priority, your name).
- **Pins** appear on annotated elements showing the number of open comments; color reflects status. Clicking a pin opens the thread.
- Threads support replies from the panel. Status changes made in the dashboard appear within ~5 seconds (polling).

## Reference IDs

Every top-level comment is assigned a unique, human-readable **ref** (`NB-0001`, `NB-0002`, … sequential per project). It appears in the embed panel's list and thread view, on the dashboard cards, in the search box (searching `NB-0007` jumps to that comment), and as a column in every export. Replies belong to their parent thread and don't get their own ref.

## Element anchoring

For each comment Contextly stores:

1. **Primary selector** — `#id` when present, otherwise a `tag.class:nth-of-type(...)` path from the root.
2. **Fallback snapshot** — the tag path (`["html","body","main",…]`), the first 40 characters of the element's text, its classes, and its bounding box at comment time.

On load, the script resolves each comment: primary selector first, then a fallback pass matching the tag-path leaf + exact text snippet. Comments whose element can no longer be found stay visible in the panel list (marked with their page path) but don't render a pin.

## Security model

- **Origin allow-listing** — comment read/write endpoints compare the request's `Origin` header against the project's *Allowed domains* setting (`*` allows any). Serving the script itself is unrestricted so the tag works anywhere; the data endpoints are what matter.
- **Public vs. invite-only** — with *Public* disabled, the embed endpoints reject guest writes (403). Only signed-in team members can comment, via the dashboard.
- **Rate limiting** — 30 write requests per minute per IP + project on the embed endpoints.
- **Sanitization** — all user text is stored as plain text, trimmed and length-capped; the embed renders it with `textContent` only (no HTML injection). The dashboard renders it as React text nodes.
- **Token rotation** — *Settings → Regenerate embed token* invalidates the old script URL. Update any prototype that embeds it.
- Internal notes (`is_internal`) created from the dashboard never appear in embed responses.

## Limits & troubleshooting

| Symptom | Cause / fix |
|---|---|
| Panel doesn't appear | Wrong token, or the host removed the script. Check the browser console for `[Contextly] embed disabled`. |
| "This domain is not allowed to submit feedback" | Add the prototype's host (e.g. `staging.example.com`) to the project's allowed domains, or set `*`. |
| Pin missing but comment in the panel | The element selector no longer resolves — the comment is orphaned. Re-pin by selecting the element again, or restore the element's `id`. |
| Comments duplicated on one element | Pins group by selector + page path; two comments on the same element merge into one pin with a count. If selectors differ slightly (e.g. `nth-of-type` changed), they pin separately — expected. |
| Status changes not appearing | The embed polls every 5 s while the tab is visible; background tabs pause polling. |
