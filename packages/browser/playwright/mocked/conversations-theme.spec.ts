import { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { PostHogConfig } from '../../src/types'

const LAUNCHER = '#ph-conversations-widget-container button[aria-label^="Open chat"]'
const WINDOW_HEADER = '#ph-conversations-widget-container button[aria-label="Close"]'

async function startWithConversations(page: Page, context: BrowserContext, options: Partial<PostHogConfig> = {}) {
    await start({ options, url: './playground/cypress/index.html' }, page, context)
    await page.evaluate(() => {
        ;(window as any).posthog.conversations.onRemoteConfig({
            ok: true,
            config: {
                conversations: { enabled: true, token: 'test-token', widgetEnabled: true, color: '#1d4ed8' },
            },
        })
    })
    await expect(page.locator(LAUNCHER)).toBeVisible()
}

const launcherColors = (page: Page) =>
    page.locator(LAUNCHER).evaluate((el) => {
        const style = getComputedStyle(el)
        return { background: style.backgroundColor, color: style.color, filter: style.filter }
    })

// Close button > header actions > header > window
const windowBackground = (page: Page) =>
    page
        .locator(WINDOW_HEADER)
        .evaluate((el) => getComputedStyle(el.parentElement!.parentElement!.parentElement!).backgroundColor)

test.describe('conversations theme', () => {
    test('uses the project color by default', async ({ page, context }) => {
        await startWithConversations(page, context)

        expect(await launcherColors(page)).toMatchObject({
            background: 'rgb(29, 78, 216)',
            color: 'rgb(255, 255, 255)',
        })
    })

    test('keeps the project color when the theme stylesheet is blocked', async ({ page, context }) => {
        await startWithConversations(page, context, { conversations: { theme: { primary: '#fde047' } } })

        // Stands in for a style-src CSP that blocks the stylesheet: inline styles still apply.
        const background = await page.evaluate(() => {
            document.querySelector('style[data-ph-conversations-theme]')?.remove()
            const launcher = document.querySelector('#ph-conversations-widget-container button')!
            return getComputedStyle(launcher).backgroundColor
        })

        expect(background).toBe('rgb(29, 78, 216)')
    })

    test('applies the init theme and switches to dark colors', async ({ page, context }) => {
        await startWithConversations(page, context, {
            conversations: { theme: { primary: '#fde047', launcherShadow: 'none', colorScheme: 'dark' } },
        })

        expect(await launcherColors(page)).toEqual({
            background: 'rgb(253, 224, 71)',
            color: 'rgb(2, 6, 23)',
            filter: 'none',
        })

        await page.evaluate(() => (window as any).posthog.conversations.open())
        await expect(page.locator(WINDOW_HEADER)).toBeVisible()
        expect(await windowBackground(page)).toBe('rgb(24, 24, 27)')
    })

    test('follows prefers-color-scheme with the auto scheme', async ({ page, context }) => {
        await page.emulateMedia({ colorScheme: 'dark' })
        await startWithConversations(page, context, {
            conversations: { theme: { colorScheme: 'auto', dark: { background: '#101010' } } },
        })

        await page.evaluate(() => (window as any).posthog.conversations.open())
        await expect(page.locator(WINDOW_HEADER)).toBeVisible()
        expect(await windowBackground(page)).toBe('rgb(16, 16, 16)')

        await page.emulateMedia({ colorScheme: 'light' })
        // The window transitions its background, so wait for it to settle.
        await expect.poll(() => windowBackground(page)).toBe('rgb(255, 255, 255)')
    })

    test('restyles the widget when setTheme() is called', async ({ page, context }) => {
        await startWithConversations(page, context)

        await page.evaluate(() => (window as any).posthog.conversations.setTheme({ primary: '#fde047' }))

        expect(await launcherColors(page)).toMatchObject({ background: 'rgb(253, 224, 71)', color: 'rgb(2, 6, 23)' })
    })

    test('lets custom properties in the page stylesheet override the SDK theme', async ({ page, context }) => {
        await startWithConversations(page, context, { conversations: { theme: { primary: '#fde047' } } })

        await page.addStyleTag({
            content: '#ph-conversations-widget-container { --ph-conv-primary: rgb(1, 2, 3); }',
        })

        expect(await launcherColors(page)).toMatchObject({ background: 'rgb(1, 2, 3)' })
    })
})
