# AGENTS.md

ReadingsTracker - browser-only single-page app for utility meter readings: yearly overlay charts, monthly bars, CSV import/export, PNG chart export. Deploys to GitHub Pages.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Build | `npm run build` (tsc + vite build) |
| Preview build | `npm run preview` |
| Lint check | `npm run lint` (biome check .) |
| Format | `npm run format` |

## Conventions

- TypeScript + Vite + Biome; keep the app fully client-side (browser-only constraint).
- Data persistence must not require a server account; Supabase bits under `supabase/` are auxiliary (keep-alive CI).
- Do not run `npm run build`/`dev` unless asked.
