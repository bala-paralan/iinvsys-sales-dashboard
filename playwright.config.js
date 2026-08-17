'use strict';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${__dirname}/.playwright-browsers`;
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/ui',
  timeout: 20000,
  fullyParallel: true,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3456',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx serve -p 3456 -s .',
    url: 'http://localhost:3456',
    reuseExistingServer: true,
    timeout: 15000,
  },
  projects: [
    {
      name: 'mobile-s',
      use: { viewport: { width: 375, height: 812 } },
    },
    {
      name: 'mobile-l',
      use: { viewport: { width: 430, height: 932 } },
    },
    {
      name: 'tablet',
      use: { viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
