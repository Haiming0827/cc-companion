# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

CC Companion is an Electron desktop app that monitors Claude Code CLI sessions in real time. It shows a "Dynamic Island" overlay at the top of the screen with tiles for each running Claude Code instance — project name, model, status, CPU/memory, token usage, and conversation turns.

Supports macOS and Linux with platform-specific terminal focus (AppleScript on macOS, xdotool/wmctrl on Linux).

## Commands

```bash
npm install          # install dependencies
npm start            # run in dev mode (electron .)
npm test             # run all tests (vitest)
npm run test:watch   # watch mode
npm run build:mac    # package as .dmg → dist/
npm run build:linux  # package as AppImage/deb → dist/
```

Requires Node.js v18+.

## Architecture

**Two-process Electron model:**

- **Main process** (`electron/main.js`): Window creation (frameless, always-on-top, transparent), IPC handlers, terminal focus logic, session history, kill instance.
- **Platform abstraction** (`electron/platform.js`): All platform-specific logic — CWD detection (`/proc/<pid>/cwd` on Linux, `lsof` on macOS), terminal app detection (bare process names on Linux, `.app` bundle paths on macOS), 1M beta detection, terminal focus (xdotool/wmctrl on Linux, AppleScript on macOS), resume session, window icon.
- **Preload** (`electron/preload.js`): Exposes a restricted `window.api` bridge — `onClaudeInstances`, `focusInstance`, `killInstance`, `getSessionHistory`, `resumeSession`, window drag/resize.
- **Renderer** (`src/compact.js` + `compact.html` + `compact.css`): The Dynamic Island UI. Renders instance tiles, handles drag reorder, right-click menu (rename/close), settings panel, session history panel, detail panel.

**Core detection engine** (`electron/watcher.js`):

- `ClaudeWatcher` class extends `EventEmitter`, polls `ps` every 2 seconds.
- Detects Claude CLI processes, resolves CWD (delegates to `platform.getCwd()`), reads `~/.claude/sessions/{pid}.json` and `~/.claude/projects/{key}/{session-id}.jsonl`.
- Activity detection: JSONL last-entry type → staleness threshold → CPU fallback (>=5%) → 3s idle grace period → state transition.
- Emits `claude-instances` event with snapshot array; deduplicates via JSON comparison.

**Data flow:** `watcher.js` → IPC `claude-instances` → `compact.js` renders tiles.

**Tests** (`test/watcher.test.js`): Vitest with mocking of `child_process`, `fs`, `readline`, and `platform.js`. Tests activity detection logic, state transitions, token counting, formatting, and edge cases.

## Key Conventions

- Single-file architecture: all source in `electron/` and `src/` — no bundler, no TypeScript.
- Settings persisted to localStorage in the renderer.
- Session data read from `~/.claude/` directory (sessions JSONL, projects JSONL, history JSONL).
- Context limit denominator adapts to model and 1M beta detection (env sniff via `/proc/<pid>/environ` on Linux, `ps eww` on macOS + runtime observation of >200k usage).
- `app.js` / `index.html` / `styles.css` appear to be older/unused — the active UI is `compact.html`/`compact.js`/`compact.css`.
