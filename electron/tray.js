const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');

function createTray(win) {
  // Create a simple tray icon (16x16 for macOS menu bar)
  const iconPath = path.join(__dirname, '..', 'assets', 'iconTemplate.png');
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch {
    // Fallback: create a simple colored icon
    trayIcon = nativeImage.createEmpty();
  }

  const tray = new Tray(trayIcon);
  tray.setToolTip('CC Companion');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        win.isVisible() ? win.hide() : win.show();
      }
    },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: true,
      click: (menuItem) => {
        win.setAlwaysOnTop(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    win.isVisible() ? win.hide() : win.show();
  });

  return tray;
}

module.exports = { createTray };
