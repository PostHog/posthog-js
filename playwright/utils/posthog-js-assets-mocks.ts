import * as fs from 'fs'
import { test as base } from '@playwright/test'
import path from 'path'

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

export const test = base.extend<{ mockStaticAssets: void }>({
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
