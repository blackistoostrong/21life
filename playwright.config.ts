import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.E2E_BASE_URL;
const port = Number(process.env.E2E_PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid E2E_PORT');
const localBaseUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  snapshotPathTemplate: '{testDir}/snapshots/{testFilePath}/{projectName}/{arg}{ext}',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: externalBaseUrl || localBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run start:standalone',
    url: localBaseUrl,
    env: {
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DEMO_MODE_ENABLED: 'false',
      NEXT_PUBLIC_DEMO_MODE: 'false',
    },
    reuseExistingServer: !process.env.CI && !process.env.E2E_PORT,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
