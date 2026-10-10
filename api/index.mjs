// Vercel serverless entry: wraps the Express app (api/ directory convention).
// Dynamic import is required because the server is ESM while this wrapper may
// be compiled as CommonJS by the serverless builder.
let notelyExpressApp = null;

export default async function vercelEntry(req, res) {
  if (!notelyExpressApp) {
    const mod = await import('../server/src/index.js');
    notelyExpressApp = mod.default;
  }
  return notelyExpressApp(req, res);
}
