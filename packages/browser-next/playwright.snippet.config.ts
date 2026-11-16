import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './playwright',
    testMatch: 'snippet.spec.ts',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: 'line',
    use: { trace: 'retain-on-failure' },
    webServer: {
        command: 'node scripts/serve-snippet-tests.mjs',
        url: 'http://127.0.0.1:2347',
        reuseExistingServer: false,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
})
