const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

const isMacos = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// ── Paths ──────────────────────────────────────────────────────

const windowIconPath = isMacos
  ? path.join(__dirname, '..', 'assets', 'icon.icns')
  : path.join(__dirname, '..', 'assets', 'icon.png');

// ── CWD detection ──────────────────────────────────────────────

function getCwd(pid) {
  return new Promise((resolve) => {
    if (isLinux) {
      try {
        return resolve(fs.readlinkSync(`/proc/${pid}/cwd`));
      } catch { return resolve(null); }
    }
    exec(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n'`, (err, stdout) => {
      resolve(stdout?.trim() ? stdout.trim().replace(/^n/, '') : null);
    });
  });
}

// ── Terminal app detection ─────────────────────────────────────

const LINUX_TERM_NAMES = {
  'kitty': 'kitty',
  'ghostty': 'Ghostty',
  'wezterm': 'WezTerm',
  'alacritty': 'Alacritty',
  'gnome-terminal': 'Terminal',
  'konsole': 'Konsole',
  'xfce4-terminal': 'Terminal',
  'mate-terminal': 'Terminal',
  'tilix': 'Tilix',
  'foot': 'Foot',
  'xterm': 'xterm',
  'x-terminal-emulator': 'Terminal',
  'code': 'Visual Studio Code',
  'cursor': 'Cursor',
  'warp': 'Warp',
};

function detectTerminalAppFromComm(comm) {
  if (!comm) return null;
  const name = path.basename(comm);

  if (isMacos) {
    if (comm.includes('/Terminal.app/')) return 'Terminal';
    if (comm.includes('/iTerm2.app/') || comm.includes('/iTerm.app/')) return 'iTerm2';
    if (comm.includes('/Warp.app/')) return 'Warp';
    if (comm.includes('/Cursor.app/')) return 'Cursor';
    if (comm.includes('/Visual Studio Code.app/') || comm.includes('/Code.app/')) return 'Visual Studio Code';
    if (comm.includes('/Alacritty.app/')) return 'Alacritty';
    if (comm.includes('/kitty.app/')) return 'kitty';
    if (comm.includes('/Ghostty.app/') || comm.includes('ghostty')) return 'Ghostty';
    if (comm.includes('/Hyper.app/')) return 'Hyper';
    if (comm.includes('/Rio.app/')) return 'Rio';
    if (comm.includes('/WezTerm.app/') || comm.includes('wezterm')) return 'WezTerm';
    if (comm.includes('/Tabby.app/')) return 'Tabby';
  }

  if (isLinux) {
    const lower = name.toLowerCase();
    if (LINUX_TERM_NAMES[lower]) return LINUX_TERM_NAMES[lower];
    if (lower.includes('code') && !lower.includes('node')) return 'Visual Studio Code';
    if (lower.includes('cursor')) return 'Cursor';
  }

  return null;
}

// ── 1M context beta detection ──────────────────────────────────

async function detectOneMBeta(pid) {
  try {
    if (isLinux) {
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      return /\bCLAUDE_CODE_ENABLE_1M_CONTEXT=1\b/.test(env);
    }
    const { stdout } = await execAsync(`ps eww -o command= -p ${pid}`);
    return /\bCLAUDE_CODE_ENABLE_1M_CONTEXT=1\b/.test(stdout);
  } catch { return false; }
}

// ── App activation ─────────────────────────────────────────────

function activateApp(appName) {
  return new Promise((resolve) => {
    if (isMacos) {
      execFile('osascript', ['-e', `tell application "${appName}" to activate`], () => resolve());
    } else {
      execFile('xdotool', ['search', '--name', appName, 'windowactivate'], (err) => {
        if (err) {
          execFile('wmctrl', ['-a', appName], () => resolve());
        } else {
          resolve();
        }
      });
    }
  });
}

// ── kitty focus (cross-platform CLI) ───────────────────────────

function focusKitty(targetCwd) {
  return new Promise((resolve) => {
    const attempts = [];
    if (process.env.KITTY_LISTEN_ON) {
      attempts.push(['@', '--to', process.env.KITTY_LISTEN_ON, 'focus-tab', '--match', `cwd:${targetCwd}`]);
    }
    attempts.push(['@', 'focus-tab', '--match', `cwd:${targetCwd}`]);

    let i = 0;
    const tryNext = () => {
      if (i >= attempts.length) {
        activateApp('kitty').then(resolve);
        return;
      }
      const args = attempts[i++];
      execFile('kitty', args, { timeout: 3000 }, (err) => {
        if (err) tryNext();
        else activateApp('kitty').then(resolve);
      });
    };
    tryNext();
  });
}

// ── WezTerm focus (cross-platform CLI) ─────────────────────────

function focusWezTerm(targetCwd) {
  return new Promise((resolve) => {
    execFile('wezterm', ['cli', 'list', '--format', 'json'], { timeout: 3000 }, (err, stdout) => {
      let paneId = null;
      if (!err && stdout) {
        try {
          const panes = JSON.parse(stdout);
          for (const p of panes) {
            if (!p.cwd) continue;
            const cwd = String(p.cwd).replace(/^file:\/\/[^/]*/, '');
            if (cwd === targetCwd) { paneId = p.pane_id; break; }
          }
        } catch { /* malformed JSON */ }
      }
      const afterActivate = () => activateApp('WezTerm').then(resolve);
      if (paneId != null) {
        execFile('wezterm', ['cli', 'activate-pane', '--pane-id', String(paneId)], { timeout: 3000 }, afterActivate);
      } else {
        afterActivate();
      }
    });
  });
}

// ── Linux-specific terminal focus via xdotool/wmctrl ───────────

function focusByXdotool(searchArg) {
  return new Promise((resolve) => {
    execFile('xdotool', searchArg, (err, stdout) => {
      if (!err && stdout?.trim()) {
        const wid = stdout.trim().split('\n')[0];
        execFile('xdotool', ['windowactivate', wid], () => resolve());
      } else {
        resolve();
      }
    });
  });
}

function focusLinux(project) {
  if (project) return focusByXdotool(['search', '--name', project]);
  return Promise.resolve();
}

// ── Resume session ─────────────────────────────────────────────

function resumeSession(cwd, sessionId) {
  return new Promise((resolve) => {
    const cmd = `cd "${cwd.replace(/"/g, '\\"')}" && claude --resume ${sessionId}`;
    if (isMacos) {
      const script = `
        tell application "Terminal"
          activate
          do script "${cmd}"
        end tell
      `;
      execFile('osascript', ['-e', script], () => resolve());
    } else {
      const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
      let i = 0;
      const tryNext = () => {
        if (i >= terminals.length) { resolve(); return; }
        execFile(terminals[i++], ['--', 'bash', '-c', cmd], (err) => {
          if (err) tryNext(); else resolve();
        });
      };
      tryNext();
    }
  });
}

// ── Set window icon (Linux needs explicit icon) ────────────────

function setWindowIcon(win) {
  if (isLinux) {
    const { nativeImage } = require('electron');
    win.setIcon(nativeImage.createFromPath(
      path.join(__dirname, '..', 'assets', 'icon.png')
    ));
  }
}

module.exports = {
  isMacos, isLinux,
  windowIconPath,
  getCwd,
  detectTerminalAppFromComm,
  detectOneMBeta,
  activateApp,
  focusKitty,
  focusWezTerm,
  focusLinux,
  resumeSession,
  setWindowIcon,
  LINUX_TERM_NAMES,
};
