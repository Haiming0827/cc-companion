const { app, BrowserWindow, Tray, screen, ipcMain, nativeImage, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const { ClaudeWatcher } = require('./watcher');
const { createTray } = require('./tray');
const RssParser = require('rss-parser');

const sharedWebPrefs = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
};

let win = null;
let compactWin = null;
let tray = null;
let watcher = null;
let isCompactMode = false;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 630,
    height: 816,
    minWidth: 420,
    minHeight: 680,
    maxWidth: 630,
    maxHeight: 816,
    x: screenW - 650,
    y: Math.floor((screenH - 816) / 2),
    frame: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#f6f3ee',
    icon: path.join(__dirname, '..', 'assets', 'icon.icns'),
    webPreferences: sharedWebPrefs
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // Hide to tray on close instead of quitting
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

function createCompactWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const compactW = 420;
  const compactH = 120;

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
    webPreferences: sharedWebPrefs
  });

  compactWin.loadFile(path.join(__dirname, '..', 'src', 'compact.html'));
  compactWin.setVisibleOnAllWorkspaces(true);
  compactWin.hide();

  return compactWin;
}

app.whenReady().then(() => {
  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon_1024.png'));
    app.dock.setIcon(dockIcon);
  }

  win = createWindow();
  compactWin = createCompactWindow();
  tray = createTray(win);

  // Start Claude Code watcher
  watcher = new ClaudeWatcher();
  watcher.start();

  watcher.on('instance-update', (snapshot) => {
    if (win && !win.isDestroyed()) win.webContents.send('claude-instances', snapshot);
    if (compactWin && !compactWin.isDestroyed()) compactWin.webContents.send('claude-instances', snapshot);
  });

  // Refresh session stats (token counts, message counts) every 10s
  setInterval(() => {
    if (!watcher) return;
    for (const [pid] of watcher.instances) {
      watcher.refreshSessionStats(pid).then(() => watcher.emitIfChanged());
    }
  }, 10000);

  ipcMain.on('reset-watcher-stats', () => {
    if (watcher) watcher.resetStats();
  });

  // Toggle between full and compact mode
  ipcMain.on('toggle-compact', () => {
    if (isCompactMode) {
      // Switch to full mode
      compactWin.hide();
      win.show();
      isCompactMode = false;
    } else {
      // Switch to compact mode
      win.hide();
      compactWin.show();
      isCompactMode = true;
    }
  });

  // Focus a Claude instance by opening its project folder in Cursor
  ipcMain.handle('focus-instance', async (_, pid) => {
    // Look up the CWD for this PID from the watcher
    const inst = watcher ? watcher.getInstance(pid) : null;
    const cwd = inst?.cwd;

    if (cwd && cwd !== 'unknown') {
      // Use Cursor CLI to focus the workspace window for this project
      return new Promise((resolve) => {
        execFile('cursor', [cwd], (err) => {
          if (err) {
            // Fallback: just activate Cursor
            execFile('osascript', ['-e', 'tell application "Cursor" to activate'], () => resolve());
          } else {
            resolve();
          }
        });
      });
    } else {
      // Fallback: just bring Cursor to front
      return new Promise((resolve) => {
        execFile('osascript', ['-e', 'tell application "Cursor" to activate'], () => resolve());
      });
    }
  });

  // Resize window (for compact mode)
  ipcMain.on('resize-window', (_, { width, height }) => {
    if (win && !win.isDestroyed()) {
      // Temporarily remove min/max constraints to allow compact size
      win.setMinimumSize(width, height);
      win.setSize(width, height, true);
    }
  });

  ipcMain.on('restore-window', () => {
    if (win && !win.isDestroyed()) {
      win.setMinimumSize(420, 680);
      win.setSize(630, 816, true);
    }
  });

  // Set window opacity
  ipcMain.on('set-opacity', (_, value) => {
    const allowed = [0.25, 0.5, 0.75, 1.0];
    const v = allowed.includes(value) ? value : 1.0;
    if (win && !win.isDestroyed()) win.setOpacity(v);
  });

  // IPC handlers for feed fetching (runs in main process to avoid CORS)
  ipcMain.handle('fetch-reddit', async (_, subreddit, sort = 'hot', limit = 25) => {
    try {
      const res = await fetch(`https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`, {
        headers: { 'User-Agent': 'cc-companion/1.0' }
      });
      const data = await res.json();
      if (!data?.data?.children) return [];
      return data.data.children.map(child => {
        const d = child.data;
        // Resolve video URL
        let video_url = null;
        if (d.is_video && d.media?.reddit_video?.fallback_url) {
          video_url = d.media.reddit_video.fallback_url;
        } else if (d.preview?.reddit_video_preview?.fallback_url) {
          video_url = d.preview.reddit_video_preview.fallback_url;
        }
        // GIF URLs
        const isGif = d.url?.endsWith('.gif') || d.url?.endsWith('.gifv');
        let gif_url = null;
        if (isGif) {
          gif_url = d.url.replace('.gifv', '.mp4'); // gifv → mp4
        }
        return {
          id: d.id,
          title: d.title,
          selftext: d.selftext,
          score: d.score,
          num_comments: d.num_comments,
          thumbnail: d.thumbnail,
          preview: d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&'),
          url: d.url,
          author: d.author,
          subreddit: d.subreddit,
          created_utc: d.created_utc,
          is_video: d.is_video,
          video_url,
          gif_url,
          post_hint: d.post_hint,
          domain: d.domain,
          permalink: `https://reddit.com${d.permalink}`,
        };
      });
    } catch (err) {
      console.error('Reddit fetch error:', err);
      return [];
    }
  });

  ipcMain.handle('fetch-hn', async (_, count = 20) => {
    try {
      const topIds = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json').then(r => r.json());
      const batch = topIds.slice(0, count);
      const stories = await Promise.all(
        batch.map(id =>
          fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
        )
      );
      return stories.filter(Boolean).map(s => ({
        id: String(s.id),
        title: s.title,
        url: s.url,
        score: s.score,
        by: s.by,
        descendants: s.descendants || 0,
        time: s.time,
      }));
    } catch (err) {
      console.error('HN fetch error:', err);
      return [];
    }
  });

  ipcMain.handle('fetch-rss', async (_, url) => {
    try {
      const parser = new RssParser({
        customFields: { item: ['content:encoded'] },
      });
      const res = await fetch(url, { headers: { 'User-Agent': 'cc-companion/1.0' } });
      let xml = await res.text();
      xml = xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
      const feed = await parser.parseString(xml);
      return feed.items.slice(0, 15).map(item => {
        // Extract text preview from content:encoded HTML if available
        let preview = item.contentSnippet || '';
        const fullHtml = item['content:encoded'] || '';
        if (fullHtml && preview.length < 200) {
          // Strip HTML tags, decode entities, get plain text
          const plainText = fullHtml
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&#\d+;/g, ' ')
            .replace(/&[a-z]+;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (plainText.length > preview.length) {
            preview = plainText;
          }
        }
        return {
          id: item.guid || item.link,
          title: item.title,
          link: item.link,
          contentSnippet: preview,
          pubDate: item.pubDate,
          creator: item.creator || item.author || feed.title,
          feedTitle: feed.title,
        };
      });
    } catch (err) {
      console.error('RSS fetch error:', err);
      return [];
    }
  });

  // Fetch subreddit info (subscriber counts)
  ipcMain.handle('fetch-subreddit-info', async (_, subreddit) => {
    try {
      const res = await fetch(`https://www.reddit.com/r/${subreddit}/about.json`, {
        headers: { 'User-Agent': 'cc-companion/1.0' }
      });
      const data = await res.json();
      if (!data?.data) return null;
      return {
        name: data.data.display_name,
        subscribers: data.data.subscribers,
        description: data.data.public_description || data.data.title,
        icon: data.data.icon_img || null,
      };
    } catch (err) {
      console.error('Subreddit info error:', err);
      return null;
    }
  });

  // Dictionary API (Free Dictionary API — no key needed)
  ipcMain.handle('fetch-word', async (_, word) => {
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
        headers: { 'User-Agent': 'cc-companion/1.0' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) return null;
      const entry = data[0];
      return {
        word: entry.word,
        phonetic: entry.phonetic || entry.phonetics?.find(p => p.text)?.text || null,
        audioUrl: entry.phonetics?.find(p => p.audio)?.audio || null,
        meanings: (entry.meanings || []).map(m => ({
          partOfSpeech: m.partOfSpeech,
          definitions: (m.definitions || []).slice(0, 3).map(d => ({
            definition: d.definition,
            example: d.example || null,
            synonyms: (d.synonyms || []).slice(0, 5),
          })),
          synonyms: (m.synonyms || []).slice(0, 5),
          antonyms: (m.antonyms || []).slice(0, 5),
        })),
        sourceUrls: entry.sourceUrls || [],
      };
    } catch (err) {
      console.error('Dictionary fetch error:', err);
      return null;
    }
  });

  // Random word list (curated GRE/SAT-level words for vocab building)
  ipcMain.handle('fetch-random-word', async () => {
    try {
      const res = await fetch('https://random-word-api.herokuapp.com/word', {
        headers: { 'User-Agent': 'cc-companion/1.0' }
      });
      const data = await res.json();
      return data?.[0] || null;
    } catch {
      return null;
    }
  });

  // Open URL in default browser
  ipcMain.handle('open-external', async (_, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
  });

  // Window control IPC
  ipcMain.on('window-minimize', () => win.hide());
  ipcMain.on('window-close', () => win.hide());
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (watcher) watcher.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (win) win.show();
});
