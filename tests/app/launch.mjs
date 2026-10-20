// Starts the Study Notebook desktop app (Electron) with a throwaway test profile and exposes helpers.
// Needs once: npm install --no-save playwright-core   (on Linux without a screen, run tests under xvfb-run)
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../..');
export const OUT = path.join(here, 'shots');
export const CFG = process.env.SN_PROFILE || path.join(os.tmpdir(), 'sn-test-profile');
fs.mkdirSync(OUT, { recursive: true });
const ELECTRON = createRequire(path.join(REPO, 'package.json'))('electron');   // path to the Electron executable

export async function launch({ fresh = false } = {}) {
  if (fresh) fs.rmSync(CFG, { recursive: true, force: true });
  fs.mkdirSync(CFG, { recursive: true });
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [REPO, '--no-sandbox'],
    cwd: REPO,
    // XDG_CONFIG_HOME keeps the test profile away from your real notes (Linux); on Windows/Mac set SN_PROFILE.
    env: { ...process.env, XDG_CONFIG_HOME: CFG, APPDATA: CFG, SN_SITE: 'http://127.0.0.1:8787', SN_OPEN_LOG: path.join(OUT, 'opened-urls.txt'), LANG: 'en_US.UTF-8' },
    timeout: 60000
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await win.waitForLoadState('domcontentloaded');
  const logs = [];
  win.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  win.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  return { app, win, logs };
}

export async function shot(win, name) {
  const f = path.join(OUT, name + '.png');
  await win.screenshot({ path: f });
  return f;
}
