// The Chromium that Playwright cached, unless CHROME names another. Shared by
// ux-journeys.mjs and ui-lint.mjs.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const builds = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
    : [];
  for (const build of builds.reverse()) {
    for (const app of ['chrome-mac-arm64', 'chrome-mac']) {
      for (const bundle of [
        'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'Chromium.app/Contents/MacOS/Chromium',
      ]) {
        const path = join(cache, build, app, bundle);
        if (existsSync(path)) return path;
      }
    }
    const linux = join(cache, build, 'chrome-linux/chrome');
    if (existsSync(linux)) return linux;
  }
  throw new Error('No Chromium found. Set CHROME, or run `npx playwright install chromium`.');
}
