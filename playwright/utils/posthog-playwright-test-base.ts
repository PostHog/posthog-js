import * as fs from 'fs'
import { test as base, Page } from '@playwright/test'
import path from 'path'
import { PostHog } from '../../src/posthog-core'
import { CaptureResult } from '../../src/types'

const lazyLoadedJSFiles = [
    'array',
    'array.full',
    'recorder',
    'surveys',
    'exception-autocapture',
    'tracing-headers',
    'web-vitals',
    'dead-clicks-autocapture',
]

export type WindowWithPostHog = typeof globalThis & {
    posthog?: PostHog
    capturedEvents?: CaptureResult[]
}

declare module '@playwright/test' {
    interface Page {
        resetCapturedEvents(): Promise<void>
        capturedEvents(): Promise<CaptureResult[]>
    }
}

export const test = base.extend<{ mockStaticAssets: void; page: Page }>({
    page: async ({ page }, use) => {
        // Add custom methods to the page object
        page.resetCapturedEvents = async function () {
            await this.evaluate(() => {
                ;(window as WindowWithPostHog).capturedEvents = []
            })
        }
        page.capturedEvents = async function () {
            return this.evaluate(() => {
                return (window as WindowWithPostHog).capturedEvents || []
            })
        }

        // Pass the extended page to the test
        await use(page)
    },
    mockStaticAssets: [
        async ({ context }, use) => {
            // also equivalent of cy.intercept('GET', '/surveys/*').as('surveys') ??
            void context.route('**/e/*', (route) => {
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ status: 1 }),
                })
            })

            void context.route('**/ses/*', (route) => {
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ status: 1 }),
                })
            })

            lazyLoadedJSFiles.forEach((key: string) => {
                const jsFilePath = path.resolve(process.cwd(), `dist/${key}.js`)
                const fileBody = fs.readFileSync(jsFilePath, 'utf8')
                void context.route(new RegExp(`^.*/static/${key}\\.js(\\?.*)?$`), (route) => {
                    route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: fileBody,
                    })
                })

                const jsMapFilePath = path.resolve(process.cwd(), `dist/${key}.js.map`)
                const mapFileBody = fs.readFileSync(jsMapFilePath, 'utf8')
                void context.route(`**/static/${key}.js.map`, (route) => {
                    route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: mapFileBody,
                    })
                })
            })

            await use()
            // there's no teardown, so nothing here
        },
        // auto so that tests don't need to remember they need this... every test needs it
        { auto: true },
    ],
})
export { expect } from '@playwright/test'
