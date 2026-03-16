# CC Companion — Project Plan & Technical Spec

## What This Is

A desktop companion app for developers using Claude Code. It monitors all running Claude Code instances in real time — tracking which projects are active, CPU/memory usage, working and idle durations, token consumption, and conversation turns — while serving curated content from Reddit and Substack, vocabulary building exercises, and guided breaks during wait times. Built with Electron, vanilla HTML/CSS/JS, no framework.

---

## Architecture Overview

```
cc-companion/
├── package.json
├── electron/
│   ├── main.js              # Electron main process, IPC handlers, window management
│   ├── preload.js           # Context bridge API for renderer
│   ├── tray.js              # System tray icon & menu
│   └── watcher.js           # Claude Code process detection, session analytics
├── src/
│   ├── index.html           # Main window HTML
│   ├── styles.css           # All styles (light + dark mode)
│   ├── app.js               # Main renderer logic (~900 lines)
│   ├── vocab-words.json     # 1,700+ curated vocabulary words
│   ├── compact.html         # Dynamic Island window
│   ├── compact.css          # Dynamic Island styles
│   └── compact.js           # Dynamic Island renderer
├── assets/
│   ├── icon_1024.png        # App icon (1024x1024 source)
│   ├── icon.icns            # macOS app icon (generated from icon_1024.png)
│   ├── iconTemplate.png     # Tray icon
│   └── gen_icon.py          # Icon generation script (Pillow)
└── dist/                    # electron-builder output
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 28 |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Feed parsing | `rss-parser` (npm) — RSS/Atom/Substack feeds |
| Dictionary | Free Dictionary API (`dictionaryapi.dev`) — no key required |
| HTTP requests | Node.js built-in `fetch` |
| Build/package | `electron-builder` — produces .dmg (Mac) |
| Process watching | `ps` + `lsof` polling every 2 seconds |
| Session analytics | Reads `~/.claude/sessions/` and `~/.claude/projects/` JSONL files |

### Dependencies

```json
{
  "dependencies": {
    "rss-parser": "^3.13.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

---

## Data Sources

### Reddit — Public JSON API (zero auth)

```
https://www.reddit.com/r/{subreddit}/hot.json?limit=25
```

- Requires `User-Agent: cc-companion/1.0` header
- Returns title, selftext, score, comments, preview images, video URLs
- Posts filtered to 100+ upvotes
- Direct image URLs (`i.redd.it`) used for image posts
- Video posts use `media.reddit_video.fallback_url` for inline playback

### Substack / RSS — Feed Parsing

```
https://{name}.substack.com/feed
```

- Parsed via `rss-parser` with `content:encoded` custom field
- HTML stripped from `content:encoded` to get plain text previews (up to 500 chars)
- XML sanitized for unescaped `&` characters before parsing
- Articles older than 90 days filtered out
- Previews under 200 chars hidden (too short to be useful)

### Free Dictionary API (zero auth)

```
https://api.dictionaryapi.dev/api/v2/entries/en/{word}
```

- Returns phonetics (text + audio URL), definitions, examples, synonyms, antonyms
- Grouped by part of speech
- Used for the Vocab tab word cards

### Content Categories (15 categories, ~170 subreddits, ~70 Substacks)

Categories sorted by total source count:

| Category | Reddit | Substack | Total |
|---|---|---|---|
| Tech & Dev | 16 | 16 | 32 |
| Investing & Personal Finance | 13 | 10 | 23 |
| Science & Learning | 12 | 10 | 22 |
| Design & Creative | 12 | 6 | 18 |
| AI & Machine Learning | 9 | 7 | 16 |
| Startups & Product | 7 | 8 | 15 |
| Comedy | 14 | 0 | 14 |
| News & World | 7 | 6 | 13 |
| Gaming | 10 | 2 | 12 |
| Self-Help & Growth | 9 | 2 | 11 |
| Visual & Cozy | 11 | 0 | 11 |
| Health & Wellness | 9 | 1 | 10 |
| Business & Economics | 5 | 3 | 8 |
| Crypto & Web3 | 6 | 2 | 8 |
| Productivity & Thinking | 4 | 2 | 6 |

Users can also add custom sources (subreddit names or Substack URLs).

---

## Claude Code Process Watcher

### Detection Strategy

Polls every 2 seconds using `ps` (case-insensitive):

```
ps -eo pid,tty,%cpu,%mem,rss,etime,command | grep -i claude
```

For each detected process:
- **PID, TTY** — unique identifier
- **CPU%** — >3% = actively working, ≤3% = idle
- **Memory** — %mem and RSS (resident set size in KB)
- **Elapsed time** — parsed from `ps` etime format
- **Working directory** — resolved via `lsof -a -p {PID} -d cwd`
- **Project name** — last segment of CWD path

### Session Analytics

For each instance, reads Claude's local data files:

1. **`~/.claude/sessions/{pid}.json`** — maps PID to session ID and start time
2. **`~/.claude/projects/{project-key}/{session-id}.jsonl`** — full conversation log

The project key is derived from the CWD by replacing all non-alphanumeric characters with dashes (e.g., `/Users/john/my project` → `-Users-john-my-project`).

From the JSONL, the watcher extracts:
- **Turn count** — counts user messages that are real prompts (excludes tool-use result messages)
- **Token usage** — input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
- **Model** — the Claude model ID (e.g., `claude-opus-4-6`)
- **Git branch** — current branch from message metadata

Session stats refresh every 10 seconds. Change detection prevents unnecessary IPC emissions.

### State Tracking

- `activeStart` timestamp when instance transitions idle → active
- `idleStart` timestamp when instance transitions active → idle
- Working/idle durations computed live and tick every second in the UI

### Instance Click-to-Focus

Clicking an instance row runs `cursor {project-folder}` to bring that specific Cursor workspace window to the front.

---

## Three View Modes

### 1. Full Mode (default)

- **Window:** 630×816px, resizable down to 420×680, not always-on-top
- **Layout zones (top to bottom):**
  1. Title bar (42px) — close/minimize dots, "CC Companion", draggable
  2. Status bar (38px) — "3 total · 1 working", click to toggle instance dropdown
  3. Instance dropdown (open by default, scrollable if >5) — per-instance stats + session analytics
  4. Session strip (28px) — instance count / active count / longest uptime / reset
  5. Tab bar (46px) — Random, Vocab, Break
  6. Scrollable content area (flex: 1) — feed posts, vocab card, or break timer
  7. Vocab action bar (only on Vocab tab) — fixed "next word" button
  8. Bottom bar (38px) — dark mode toggle, Compact, Island

### 2. Compact Mode

- Hides tabs and feed content
- Shrinks window to 420×320px
- Shows only: title bar, status, instances, session strip, bottom bar
- Click "Expand" to restore

### 3. Dynamic Island

- Small floating bar (420×120px) at top-center of screen
- Always-on-top across all apps
- Shows per-instance rows with project name, working/idle duration, CPU%, memory
- Click anywhere to expand back to full mode

---

## UI Specification

### Window

- **Default size:** 630 × 816 px
- **Min size:** 420 × 680 px
- **Background:** #f6f3ee (light) / #1a1a1a (dark)
- **No native frame** — custom title bar with close/minimize dots (no maximize)
- **App icon:** custom crossed-swords design with orange accent (icon.icns)

### Typography

| Element | Font | Size |
|---------|------|------|
| Display headings | Fraunces (serif) | 15-28px |
| Body text | DM Sans | 11-13px |
| Monospace/data | IBM Plex Mono | 9-12px |

### Color Palette

**Light mode:**
```css
--bg:#f6f3ee; --bgc:#ffffff; --bgw:#f0ece5; --bgi:#f8f6f1;
--bd:#e4ded4; --t1:#1c1815; --t2:#5c554a; --t3:#9c9385;
--acc:#e8590c; --accs:#fff4ed;
```

**Dark mode (toggled via bottom bar button):**
```css
--bg:#1a1a1a; --bgc:#242424; --bgw:#2a2a2a; --bgi:#1e1e1e;
--bd:#3a3a3a; --t1:#e8e4dd; --t2:#a8a29e; --t3:#6b6560;
--acc:#f97316; --accs:#2a1f14;
```

### Tabs

**🎲 Random** — Mixed feed from selected categories. Each post card shows:
- Source avatar + platform label + category badge + platform badge (reddit/substack)
- Post text (truncated to 280 chars)
- Images (auto-sized, max 220px height)
- Inline video player for Reddit videos (click to play/pause)
- Substack cards: bold serif title + 500-char body preview + author + orange left border
- Score, comments, relative time ("2h ago")
- Feed header with category pills, edit button, shuffle button
- Source filter toggle: Both / Substack / Reddit

**📖 Vocab** — Vocabulary builder showing one word at a time:
- Large serif word heading
- Phonetic pronunciation text + audio playback button
- Definitions grouped by part of speech (noun, verb, adjective, etc.)
- Example sentences in italics
- Synonym pills (blue) and antonym pills (orange)
- Fixed "next word" button in a dedicated bar below the scroll area
- 1,700+ curated words loaded from `vocab-words.json`

**🧘 Break** — Break timer with 5 types:
- Neck Roll (30s), Wrist Stretch (30s), 20-20-20 Eyes (20s), Stand & Stretch (40s), Box Breathing (60s)
- Start → shows Stop + Start Over
- Stop → shows Resume + Start Over
- Done → shows Done — Start Over

### Bottom Bar Controls

- **🌙 / ☀️** — Dark mode toggle
- **Compact** — Switch to stats-only view (shrinks window)
- **Island** — Switch to Dynamic Island mode

---

## Content Caching

- In-memory cache keyed by source URL
- 5-minute staleness threshold
- `clearCache()` clears all cached entries
- Feed posts capped at 200 items to prevent unbounded memory growth
- Reddit posts filtered to 100+ upvotes
- Substack articles filtered to last 90 days

---

## Custom Sources

Users can add their own sources via the Edit panel:
- Type `r/subredditname` or just `subredditname` → adds a Reddit source
- Type `name.substack.com` → adds a Substack feed
- Any URL → tries as RSS feed
- Custom sources appear as orange pills with × to remove
- Included in every feed load alongside selected categories

---

## Build & Distribution

```bash
# Run from source
npm install && npm start

# Build macOS .dmg
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac
```

Output: `dist/CC Companion-1.0.0-arm64.dmg` (~90MB)

Since the app is unsigned, macOS users need to right-click → Open → Open to bypass Gatekeeper on first launch.

---

## Key Implementation Details

- **No framework** — vanilla JS with template literals and `insertAdjacentHTML`
- **IPC architecture** — all network requests (Reddit JSON, RSS parsing, Dictionary API) happen in the main process to avoid CORS. Renderer communicates via `ipcRenderer.invoke()`
- **Process detection** — macOS-specific (`ps`, `lsof`, `cursor` CLI, `osascript`)
- **Session file reading** — reads Claude's `~/.claude/` directory structure for session metadata and conversation JSONL logs
- **RSS sanitization** — XML is pre-processed to fix unescaped `&` characters before parsing
- **Video support** — Reddit `fallback_url` MP4s, `.gifv` → `.mp4` conversion
- **Event delegation** — global click handlers for dynamically rendered content (posts, categories, instances)
- **Change detection** — watcher only emits IPC updates when snapshot data actually changes
- **Vocab word source** — bundled JSON file (not API) for reliability; dictionary definitions fetched on demand
