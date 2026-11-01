import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(clientDir, '../server');
const apiUrl = 'http://127.0.0.1:5017';
const clientUrl = 'http://127.0.0.1:5174';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: clientUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['iPhone 13'], browserName: 'chromium' }
    }
  ],
  webServer: [
    {
      command: 'node index.js',
      cwd: serverDir,
      url: `${apiUrl}/`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        PORT: '5017',
        CLIENT_URL: clientUrl,
        JWT_SECRET: 'e2e-only-secret-that-is-long-enough-for-local-tests',
        MONGO_URI: ''
      }
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
      cwd: clientDir,
      url: clientUrl,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { VITE_SERVER_URL: apiUrl }
    }
  ]
});
