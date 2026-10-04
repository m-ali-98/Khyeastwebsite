/* ==========================================================================
   Real-browser test configuration.

     npm run test:e2e            headless chromium
     npm run test:e2e -- --ui    interactive runner
     npm run test:e2e:update     re-bake the visual baselines

   Why this exists: `npm test` executes the built bundle against linkedom.
   That catches render crashes but it is not a browser — lazy route chunks
   never resolve there, CSS is never applied, and nothing can be clicked. So
   three classes of bug were invisible to it:

     1. a page that only breaks once its lazy chunk actually loads,
     2. an admin screen whose API is fine but whose UI cannot save,
     3. anything visual — a collapsed layout, an unreadable contrast pair.

   The server is started against a THROWAWAY data directory, prepared by
   e2e/prepare-data.js as the first step of the webServer command. Nothing
   here can touch server/data.
   ========================================================================== */
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 8799);
const DATA_DIR = path.join(HERE, '.e2e-data');

export const E2E = {
  port: PORT,
  baseURL: `http://127.0.0.1:${PORT}`,
  dataDir: DATA_DIR,
  user: 'admin',
  pass: 'khyeast-e2e-password',
  secret: 'khyeast-e2e-secret-0123456789abcdef0123456789abcdef',
};

export default defineConfig({
  testDir: './e2e',
  /* Serial by default: the admin specs mutate shared server state, and a
     parallel worker editing the same catalogue produces failures that look
     like product bugs but are only the test fighting itself. */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    /* A couple of antialiased pixels must not fail a build; a shifted section
       must. 1.5% of the frame is the line between those two. */
    toHaveScreenshot: { maxDiffPixelRatio: 0.015, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: E2E.baseURL,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      /* The mobile project exists to prove the layouts render at 412px,
         which is where most Iranian traffic arrives. It deliberately runs
         only the tests tagged @mobile: the rest click desktop-only affordances
         (the nav links live behind the burger here) and the visual baselines
         are desktop-sized, so running them on a phone would fail for reasons
         that are not defects. */
      grep: /@mobile/,
    },
  ],
  webServer: {
    /* prepare-data must run before the server opens the database — hence it
       is part of this command rather than a globalSetup, which Playwright
       runs *after* starting the web server. */
    command: 'node e2e/prepare-data.js && npm run build && node server/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    /* Never reuse: a leftover server from a previous run is pointed at the
       old database, holds a lock on it under Windows, and would silently
       invalidate the clean-slate guarantee. */
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      DATA_DIR,
      UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
      DB_FILE: path.join(DATA_DIR, 'e2e.db'),
      ADMIN_USER: E2E.user,
      ADMIN_PASS: E2E.pass,
      ADMIN_SECRET: E2E.secret,
      NODE_ENV: 'development',
      /* Every request in the run comes from 127.0.0.1, so the public
         rate limits (5 messages / 5 comments / 12 orders per 10 min) would
         start answering 429 halfway through. The limiter itself is covered
         by scripts/test/behaviour.mjs against its real defaults. */
      RL_MAX_MESSAGE: '500',
      RL_MAX_COMMENT: '500',
      RL_MAX_ORDER: '500',
    },
  },
});
