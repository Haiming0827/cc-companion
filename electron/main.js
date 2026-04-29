const { app, BrowserWindow, screen, ipcMain, nativeImage } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const { ClaudeWatcher } = require('./watcher');
const platform = require('./platform');

let compactWin = null;
let watcher = null;

function createCompactWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const compactW = 440;
  const compactH = 180;

  compactWin = new BrowserWindow({
    width: compactW,
    height: compactH,
    x: Math.floor((screenW - compactW) / 2),
    y: 0,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    icon: platform.windowIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  compactWin.loadFile(path.join(__dirname, '..', 'src', 'compact.html'));
  compactWin.setVisibleOnAllWorkspaces(true);
  return compactWin;
}

// ── Helpers for terminal apps with their own remote-control CLIs ─────────
// On macOS, Electron launched from Finder has a minimal PATH, so we prefer
// the app bundle binary and fall back to $PATH. On Linux, we use $PATH directly.
function runCli(fallbackCmd, args, opts = {}) {
  return new Promise((resolve) => {
    if (platform.isMacos) {
      // macOS: try bundled binary first
      const bundledMap = {
        'wezterm': '/Applications/WezTerm.app/Contents/MacOS/wezterm',
        'kitty': '/Applications/kitty.app/Contents/MacOS/kitty',
      };
      const bundled = bundledMap[fallbackCmd];
      if (bundled) {
        execFile(bundled, args, opts, (err, stdout, stderr) => {
          if (err && err.code === 'ENOENT') {
            execFile(fallbackCmd, args, opts, (e2, o2, s2) => {
              resolve({ err: e2, stdout: o2, stderr: s2 });
            });
          } else {
            resolve({ err, stdout, stderr });
          }
        });
        return;
      }
    }
    execFile(fallbackCmd, args, opts, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

// WezTerm: use `wezterm cli list --format json` + `wezterm cli activate-pane`.
// Works out of the box whenever WezTerm is running (no user config required).
async function focusWezTermByCwd(targetCwd) {
  const list = await runCli('wezterm', ['cli', 'list', '--format', 'json'], { timeout: 3000 });
  let paneId = null;
  if (!list.err && list.stdout) {
    try {
      const panes = JSON.parse(list.stdout);
      for (const p of panes) {
        if (!p.cwd) continue;
        const cwd = String(p.cwd).replace(/^file:\/\/[^/]*/, '');
        if (cwd === targetCwd) {
          paneId = p.pane_id;
          break;
        }
      }
    } catch { /* malformed JSON — fall through to activate */ }
  }
  if (paneId != null) {
    await runCli('wezterm', ['cli', 'activate-pane', '--pane-id', String(paneId)], { timeout: 3000 });
  }
  return platform.activateApp('WezTerm');
}

// kitty: use `kitty @ focus-tab --match cwd:PATH`. This requires the user to
// have enabled remote control (`allow_remote_control yes` and typically a
// `listen_on` socket in kitty.conf). If remote control isn't available we
// silently fall back to just activating the app.
async function focusKittyByCwd(targetCwd) {
  // Try with $KITTY_LISTEN_ON if set, then without --to (in case the socket
  // path is propagated another way). Either may fail silently.
  const attempts = [];
  if (process.env.KITTY_LISTEN_ON) {
    attempts.push(['@', '--to', process.env.KITTY_LISTEN_ON, 'focus-tab', '--match', `cwd:${targetCwd}`]);
  }
  attempts.push(['@', 'focus-tab', '--match', `cwd:${targetCwd}`]);
  for (const args of attempts) {
    const r = await runCli('kitty', args, { timeout: 3000 });
    if (!r.err) break;
  }
  return platform.activateApp('kitty');
}

app.whenReady().then(() => {
  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon_1024.png'));
    app.dock.setIcon(dockIcon);
  }

  compactWin = createCompactWindow();
  platform.setWindowIcon(compactWin);

  // Start Claude Code watcher
  watcher = new ClaudeWatcher();
  watcher.start();

  watcher.on('instance-update', (snapshot) => {
    if (compactWin && !compactWin.isDestroyed()) {
      compactWin.webContents.send('claude-instances', snapshot);
    }
  });

  // Refresh session stats every 5s (detects session changes, token updates)
  setInterval(() => {
    if (!watcher) return;
    for (const [pid] of watcher.instances) {
      watcher.refreshSessionStats(pid).then(() => watcher.emitIfChanged());
    }
  }, 5000);

  ipcMain.on('reset-watcher-stats', () => {
    if (watcher) watcher.resetStats();
  });

  // Hide to dock
  ipcMain.on('hide-compact', () => {
    if (compactWin && !compactWin.isDestroyed()) compactWin.minimize();
  });

  // Quit app
  ipcMain.on('quit-app', () => {
    app.isQuitting = true;
    app.quit();
  });

  // Drag compact window by delta
  ipcMain.on('move-compact-window', (_, { dx, dy }) => {
    if (!compactWin || compactWin.isDestroyed()) return;
    const [x, y] = compactWin.getPosition();
    compactWin.setPosition(x + Math.round(dx), y + Math.round(dy));
  });

  // Snap compact window to top-center of screen
  ipcMain.on('snap-compact-window', () => {
    if (!compactWin || compactWin.isDestroyed()) return;
    const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
    const compactW = 440;
    compactWin.setPosition(Math.floor((screenW - compactW) / 2), 0);
  });

  // Focus a Claude instance by bringing its terminal/IDE window AND tab to front.
  // macOS: AppleScript-based per terminal app. Linux: xdotool/wmctrl by project name.
  ipcMain.handle('focus-instance', async (_, pid) => {
    const inst = watcher ? watcher.getInstance(pid) : null;
    const appName = (watcher ? watcher.getTerminalApp(pid) : null) || 'Terminal';
    const project = inst?.project || '';
    const tty = inst?.tty ? `/dev/${inst.tty}` : '';
    const instCwd = inst?._sessionCwd || inst?.cwd || '';

    // kitty and WezTerm have cross-platform CLIs — handle on both platforms
    if (appName === 'kitty') return focusKittyByCwd(instCwd);
    if (appName === 'WezTerm') return focusWezTermByCwd(instCwd);

    // Linux: use xdotool/wmctrl to focus by project name
    if (platform.isLinux) {
      return platform.focusLinux(project);
    }

    // ── macOS: AppleScript-based terminal focus ──
    // System Events uses CFBundleName as the process name, which can differ from our display name.
    const processNameMap = { 'Visual Studio Code': 'Code' };
    const processName = processNameMap[appName] || appName;

    // Escape a string for safe interpolation into an AppleScript double-quoted literal.
    const asEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    let script;
    if (appName === 'Terminal' && tty) {
      script = `
        tell application "Terminal"
          activate
          set matched to false
          repeat with w in windows
            repeat with t in tabs of w
              if tty of t is "${tty}" then
                set selected of t to true
                set miniaturized of w to false
                set index of w to 1
                set matched to true
                exit repeat
              end if
            end repeat
            if matched then exit repeat
          end repeat
        end tell
      `;
    } else if (appName === 'iTerm2' && tty) {
      script = `
        tell application "iTerm2"
          activate
          set matched to false
          repeat with w in windows
            repeat with t in tabs of w
              repeat with s in sessions of t
                if tty of s is "${tty}" then
                  select t
                  select s
                  set miniaturized of w to false
                  set index of w to 1
                  set matched to true
                  exit repeat
                end if
              end repeat
              if matched then exit repeat
            end repeat
            if matched then exit repeat
          end repeat
        end tell
      `;
    } else if (appName === 'Ghostty') {
      const ghosttyCwd = asEscape(inst?._sessionCwd || inst?.cwd || '');
      script = `
        tell application "Ghostty"
          repeat with term in (every terminal)
            try
              if (working directory of term) is equal to "${ghosttyCwd}" then
                focus term
                return
              end if
            end try
          end repeat
          try
            activate window 1
          end try
        end tell
      `;
    } else {
      script = `
        tell application "System Events"
          if exists process "${processName}" then
            set frontmost of process "${processName}" to true
            tell process "${processName}"
              set allWindows to every window
              set matched to false
              repeat with w in allWindows
                if name of w contains "${project}" then
                  if value of attribute "AXMinimized" of w is true then
                    set value of attribute "AXMinimized" of w to false
                  end if
                  perform action "AXRaise" of w
                  set matched to true
                  exit repeat
                end if
              end repeat
              if not matched and (count of allWindows) > 0 then
                set w to item 1 of allWindows
                if value of attribute "AXMinimized" of w is true then
                  set value of attribute "AXMinimized" of w to false
                end if
                perform action "AXRaise" of w
              end if
            end tell
          end if
        end tell
      `;
    }
    return new Promise((resolve) => {
      execFile('osascript', ['-e', script], () => resolve());
    });
  });

  // Kill a Claude Code instance (SIGTERM to process group)
  ipcMain.handle('kill-instance', async (_, pid) => {
    try {
      // Kill the process group (negative PID) to clean up subagents/children
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        // Fallback: kill just the process if process group fails
        process.kill(pid, 'SIGTERM');
      } catch { /* process already gone */ }
    }
  });

  // Get session history from ~/.claude/history.jsonl
  ipcMain.handle('get-session-history', async () => {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const readline = require('readline');

    const historyFile = path.join(os.homedir(), '.claude', 'history.jsonl');
    if (!fs.existsSync(historyFile)) return [];

    const sessions = new Map(); // sessionId -> { sessionId, project, firstMessage, timestamp, lastTimestamp }

    try {
      const stream = fs.createReadStream(historyFile, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const { sessionId, project, display, timestamp } = entry;
          if (!sessionId) continue;

          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, {
              sessionId,
              project: project || '',
              firstMessage: display || '',
              timestamp,
              lastTimestamp: timestamp,
              messageCount: 1,
            });
          } else {
            const s = sessions.get(sessionId);
            s.lastTimestamp = timestamp;
            s.messageCount++;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { return []; }

    // Return sorted by most recent, limit to 50
    return Array.from(sessions.values())
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
      .slice(0, 50);
  });

  // Resume a Claude Code session in a new Terminal tab
  ipcMain.handle('resume-session', async (_, sessionId, cwd) => {
    return platform.resumeSession(cwd, sessionId);
  });

  // Auto-resize compact window to fit content
  ipcMain.on('resize-compact', (_, { height }) => {
    if (!compactWin || compactWin.isDestroyed()) return;
    const [w] = compactWin.getSize();
    compactWin.setSize(w, Math.max(50, Math.min(400, height)));
  });

  // Make transparent areas click-through
  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    if (!compactWin || compactWin.isDestroyed()) return;
    if (ignore) {
      compactWin.setIgnoreMouseEvents(true, { forward: true });
    } else {
      compactWin.setIgnoreMouseEvents(false);
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (watcher) watcher.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (compactWin) compactWin.show();
});
