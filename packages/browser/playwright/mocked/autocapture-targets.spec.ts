import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

test.describe('autocapture click targets', () => {
    test.beforeEach(async ({ page, context }) => {
        await start(
            {
                options: { capture_pageview: false, capture_dead_clicks: false, disable_session_recording: true },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )
        await page.evaluate(() => {
            document.body.innerHTML = '<button id="trigger"><span>Actions</span></button>'
        })
        await page.resetCapturedEvents()
    })

    test('captures a dropdown trigger when pointerdown disables body hit testing', async ({ page }) => {
        await page.evaluate(() => {
            // Radix modal dropdowns disable outside pointer events when they open on pointerdown.
            document.querySelector('button')!.onpointerdown = () => {
                document.body.style.pointerEvents = 'none'
            }
            document.onclick = (event) => {
                document.documentElement.dataset.clickTarget = (event.target as Element).tagName
            }
        })

        await page.locator('#trigger').click()

        await expect(page.locator('html')).toHaveAttribute('data-click-target', 'HTML')
        await page.expectCapturedEventsToBe(['$autocapture'])
        const [event] = await page.capturedEvents()
        expect(event.properties.$event_type).toBe('click')
        expect(event.properties.$el_text).toBe('Actions')
    })

    for (const root of ['html', 'body']) {
        test(`does not recover a dropdown click through a private ${root} root`, async ({ page }) => {
            await page.evaluate((tag) => {
                document.querySelector(tag)!.classList.add('ph-no-capture')
                document.querySelector('button')!.onpointerdown = () => {
                    document.body.style.pointerEvents = 'none'
                }
            }, root)

            await page.locator('#trigger').click()

            await page.expectCapturedEventsToBe([])
        })
    }

    test('attributes nested SVG clicks to the button without duplicating keyboard clicks', async ({ page }) => {
        await page.evaluate(() => {
            document.querySelector('button')!.innerHTML =
                '<svg width="30" height="30"><g><path d="M0 0h30v30H0z" /></g></svg><span>Toggle Theme</span>'
        })

        await page.locator('path').click()
        await page.locator('#trigger').press('Enter')
        await page.locator('#trigger').press('Space')

        await page.expectCapturedEventsToBe(['$autocapture', '$autocapture', '$autocapture'])
        for (const event of await page.capturedEvents()) {
            expect(event.properties.$elements_chain).toMatch(/^button:/)
            expect(event.properties.$el_text).toBe('Toggle Theme')
        }
    })
})
