const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Feed fetching
  fetchReddit: (subreddit, sort, limit) => ipcRenderer.invoke('fetch-reddit', subreddit, sort, limit),
  fetchHN: (count) => ipcRenderer.invoke('fetch-hn', count),
  fetchRSS: (url) => ipcRenderer.invoke('fetch-rss', url),
  fetchSubredditInfo: (subreddit) => ipcRenderer.invoke('fetch-subreddit-info', subreddit),
  fetchWord: (word) => ipcRenderer.invoke('fetch-word', word),
  fetchRandomWord: () => ipcRenderer.invoke('fetch-random-word'),

  // Open URL in default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Claude Code instance tracking
  onClaudeInstances: (callback) => ipcRenderer.on('claude-instances', (_, data) => callback(data)),
  resetWatcherStats: () => ipcRenderer.send('reset-watcher-stats'),

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),

  // Dynamic Island
  toggleCompact: () => ipcRenderer.send('toggle-compact'),
  // Window resize for compact view
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', { width, height }),
  restoreWindow: () => ipcRenderer.send('restore-window'),
  focusInstance: (pid) => ipcRenderer.invoke('focus-instance', pid),
  setOpacity: (value) => ipcRenderer.send('set-opacity', value),
});
