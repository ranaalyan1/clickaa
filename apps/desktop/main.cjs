/**
 * Clickaa desktop overlay (Electron shell) — the Clicky-style floating panel.
 *
 * Runs apps/server (the agent + UI) and shows the panel as a frameless,
 * always-on-top window that can be dragged anywhere.
 *
 *   cd apps/desktop && npm install && npm start
 *   (needs CLICKAA_MODEL_KEY and CLICKAA_MODEL set in the environment)
 */

const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = process.env.CLICKAA_PORT || 4747;
let serverProcess = null;
let win = null;

function startServer() {
  const root = path.join(__dirname, '..', '..');
  serverProcess = spawn(process.execPath, [path.join(root, 'apps', 'server', 'dist', 'src', 'main.js')], {
    env: process.env,
    stdio: 'inherit',
    cwd: root,
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 396,
    height: 620,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the system browser, never inside the overlay.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const load = () => win.loadURL(`http://localhost:${PORT}/`);
  const poll = setInterval(() => {
    fetch(`http://localhost:${PORT}/api/capabilities`)
      .then(() => {
        clearInterval(poll);
        load();
      })
      .catch(() => {});
  }, 400);
  setTimeout(() => {
    clearInterval(poll);
    load();
  }, 15000);
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
