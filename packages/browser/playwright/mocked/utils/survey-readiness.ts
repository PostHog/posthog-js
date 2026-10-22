import { Page } from '@playwright/test'
import { WindowWithPostHog } from './posthog-playwright-test-base'

export async function waitForSurveyDefinitions(page: Page): Promise<void> {
    await page.evaluate(() => {
        let unsubscribe = () => {}
        return new Promise<void>((resolve) => {
            unsubscribe = (window as WindowWithPostHog).posthog!.onSurveysLoaded((surveys, context) => {
                if (surveys.length > 0 && context?.isLoaded !== false) resolve()
            })
        }).finally(() => unsubscribe())
    })
}
