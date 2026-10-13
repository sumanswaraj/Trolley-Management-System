import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  timeout: 30000,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
          args: ['--no-sandbox', '--disable-gpu', '--no-zygote'],
        }
      : {},
  },
});
