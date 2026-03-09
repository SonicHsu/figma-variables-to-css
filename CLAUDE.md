# CLAUDE.md — Agent Collaboration Guide

## Project Overview

Figma plugin that extracts Figma Variables, converts them to CSS custom properties / utility classes, and commits the output to a GitLab repository branch via the GitLab Commits API. Built with Create Figma Plugin + Preact + Tailwind CSS v4.

## Tech Stack

- **Runtime**: Figma Plugin API (dual-context: sandbox + iframe UI)
- **UI**: Preact + Tailwind CSS v4
- **Build**: `@create-figma-plugin/build` (esbuild-based)
- **Package manager**: pnpm
- **Language**: TypeScript (strict, ES2021 target)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Figma Plugin Sandbox (main.ts)                 │
│  - Reads Variables via Figma Plugin API          │
│  - Calls GitLab Commits API (fetch)             │
│  - Persists settings via figma.clientStorage    │
│  - Communicates with UI via postMessage          │
├─────────────────────────────────────────────────┤
│  Plugin UI / iframe (ui.tsx)                     │
│  - Preact SPA, two tabs: Preview / Settings     │
│  - CSS generation runs here (css-generator.ts)  │
│  - Emits events to sandbox via emit()           │
├─────────────────────────────────────────────────┤
│  Proxy Server (proxy/server.js)  [optional]     │
│  - HTTP→HTTP reverse proxy for self-hosted      │
│    GitLab instances (avoids Mixed Content)       │
│  - Runs on localhost:9801                        │
└─────────────────────────────────────────────────┘
```

### Key Message Flow

```
UI                          Sandbox (main.ts)
 ├─ emit("GET_VARIABLES") ──►  reads Figma API
 │                          ◄── postMessage("VARIABLES_RESULT")
 ├─ emit("GITLAB_COMMIT")  ──►  calls GitLab API
 │                          ◄── postMessage("COMMIT_RESULT")
 ├─ emit("SAVE_SETTINGS")  ──►  figma.clientStorage.setAsync
 └─ emit("LOAD_SETTINGS")  ──►  figma.clientStorage.getAsync
                            ◄── postMessage("SETTINGS_LOADED")
```

## File Map

| File | Role |
|------|------|
| `src/main.ts` | Plugin sandbox entry. Reads variables, handles GitLab commit, persists settings. |
| `src/ui.tsx` | Plugin UI (Preact). Preview tab shows variables + CSS output. Settings tab for GitLab config. |
| `src/css-generator.ts` | Pure function: `FigmaVariable[] → CSS string`. Handles kebab-case, alias resolution, typography grouping. |
| `src/gitlab.ts` | **Dead code** — duplicated in main.ts. Should be removed or made the single source. |
| `proxy/server.js` | Optional HTTP proxy for self-hosted HTTP GitLab. Hardcoded to `10.2.11.139`. |
| `src/input.css` | Tailwind CSS v4 entry file. |
| `src/output.css` | Tailwind build output (committed, used by UI). |

## CSS Generation Logic (css-generator.ts)

1. **detectGroups()** — splits variables into two buckets:
   - **grouped**: variables whose parent path has 2+ siblings with leaf names in `PROPERTY_MAP` → output as `.class-name { ... }`
   - **ungrouped**: everything else → output as `:root { --var-name: value; }`
2. **Alias handling** — alias variables output `var(--referenced-name)` instead of raw value
3. **Typography PROPERTY_MAP** — `font`, `weight`, `size`, `line-height`, `leading`, `letter-spacing`, `tracking`

### Fixed Issues

- **Duplicate CSS properties in typography groups** — When multiple leaf names map to the same CSS property (e.g. `size` and `font-size` both → `font-size`), `detectGroups()` now deduplicates by `cssProp`, keeping the first match.
- **Duplicate variables across collections** — `main.ts` deduplicates by `variable.name` using a `Set` to prevent the same variable from appearing twice in the output.

## Commands

```bash
pnpm install          # install deps
pnpm run build        # build CSS + JS (production)
pnpm run watch        # dev mode with hot reload
pnpm run proxy        # start GitLab proxy server (port 9801)
```

## Development Notes

- **Figma Plugin has two contexts**: sandbox (main.ts, has access to Figma API and network) and UI iframe (ui.tsx, standard browser context). They communicate via `postMessage` / `emit`.
- **Sandbox CAN make fetch calls** without Mixed Content restrictions (unlike the UI iframe), which is why GitLab API calls are in main.ts.
- **Settings are stored per-user** via `figma.clientStorage` (keyed by `"gitlab-settings"`).
- **The proxy server** is only needed when the GitLab instance uses HTTP (not HTTPS). The plugin auto-detects `http://` hosts and routes through `localhost:9801`.
- **Tailwind CSS v4** is used — config is in `tailwind.config.js`, but v4 also reads `@theme` directives from `input.css`.

## Code Style

- TypeScript strict mode
- Preact JSX (h function, not React)
- Functional components with hooks
- Tailwind utility classes for styling (with inline styles only when dynamic)
- Chinese (繁體中文) for user-facing UI labels
- English for code, comments, and commit messages
