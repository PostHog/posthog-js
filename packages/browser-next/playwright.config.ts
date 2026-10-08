import { defineConfig, devices } from '@playwright/test'

const port = 2346

export default defineConfig({
    testDir: './playwright',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    ...(process.env.CI ? { workers: 2 } : {}),
    reporter: 'line',
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    webServer: {
        command:
            'pnpm exec esbuild playwright/fixture.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=.playwright/fixture.js && node scripts/serve-browser-tests.mjs',
        env: { POSTHOG_BROWSER_NEXT_TEST_PORT: String(port) },
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: !process.env.CI,
    },
})
