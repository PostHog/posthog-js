import { defineConfig, devices } from '@playwright/test'

/**
 * Backward compatibility tests.
 *
 * These tests validate that newly built lazy-loaded extensions (web-vitals, surveys, etc.)
 * work correctly with the currently published NPM version of array.js (posthog core).
 *
 * This catches breaking changes where a new extension would fail when loaded by
 * users who have an older cached version of the core library.
 */
export default defineConfig({
    globalSetup: './playwright/global-setup-compat.ts',
    testDir: './playwright/mocked',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:2345',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium-compat',
            use: {
                ...devices['Desktop Chrome'],
                staticOverrides: {
                    'array.js': 'array.npm-latest.js',
                    'array.full.js': 'array.full.npm-latest.js',
                },
            },
        },
    ],
    webServer: {
        command: 'pnpm run playwright-webserver',
        url: 'http://localhost:2345',
        reuseExistingServer: !process.env.CI,
    },
})
