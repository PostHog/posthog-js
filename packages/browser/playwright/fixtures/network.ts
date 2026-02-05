import { expect, Page, Response } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { Compression, FlagsResponse } from '@/types'
import { testPage } from './page'

// read directory ../../dist and get all files
const files = fs.readdirSync(path.join(__dirname, '../../dist'))

export const testNetwork = testPage.extend<{
    network: NetworkPage
    mockIngestion: boolean
    flagsOverrides: Partial<FlagsResponse>
    staticOverrides: Record<string, string>
}>({
    staticOverrides: [{}, { option: true }],
    flagsOverrides: [
        {
            sessionRecording: undefined,
            isAuthenticated: false,
            capturePerformance: true,
        },
        { option: true },
    ],
    mockIngestion: true,
    network: [
        async ({ page, flagsOverrides, mockIngestion, staticOverrides }, use) => {
            const networkPage = new NetworkPage(page)
            await networkPage.mockStatic(staticOverrides)
            if (flagsOverrides) {
                await networkPage.mockFlags(flagsOverrides)
            }
            if (mockIngestion) {
                await networkPage.mockIngestion()
            }
            await use(networkPage)
            networkPage.expectNoFailed()
        },
        { auto: true },
    ],
})

export class NetworkPage {
    responses: Response[] = []

    constructor(private page: Page) {
        page.on('response', (res: Response) => {
            this.responses.push(res)
        })
    }

    async mockFlags(flagsOverrides: Partial<FlagsResponse>) {
        // Prepare the mocked Flags API response
        const flagsResponse: FlagsResponse = {
            editorParams: {},
            flags: {
                'session-recording-player': {
                    key: '7569-insight-cohorts',
                    enabled: true,
                    variant: undefined,
                    reason: {
                        code: 'condition_match',
                        condition_index: 0,
                        description: 'Matched condition set 1',
                    },
                    metadata: {
                        id: 1421,
                        version: 1,
                        description: undefined,
                        payload: undefined,
                    },
                },
            },
            featureFlags: { 'session-recording-player': true },
            featureFlagPayloads: {},
            errorsWhileComputingFlags: false,
            toolbarParams: {},
            toolbarVersion: 'toolbar',
            isAuthenticated: false,
            siteApps: [],
            supportedCompression: [Compression.GZipJS],
            autocaptureExceptions: false,
            ...flagsOverrides,
        }

        await this.page.route('**/flags/*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(flagsResponse),
            })
        })
    }

    async mockSurveys(surveysResponse: any[]) {
        await this.page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: surveysResponse,
                },
            })
        })
    }

    async mockIngestion() {
        await this.page.route('**/e/**', async (route) => {
            await route.fulfill({
                headers: { loaded: 'mock captured' },
            })
        })
    }

    async waitForSurveys() {
        await this.page.waitForResponse('**/surveys/**')
    }

    async mockStatic(staticOverrides: Record<string, string | undefined>) {
        await Promise.all(
            files.map((file) => {
                return this.page.route(`**/static/${file}*`, async (route) => {
                    const source = staticOverrides[file] ?? file
                    await route.fulfill({
                        headers: { loaded: 'using relative path by playwright', source: source },
                        path: `./dist/${source}`,
                    })
                })
            })
        )
    }

    expectNoFailed(): void {
        expect(this.responses.filter((response) => !response.ok)).toHaveLength(0)
    }

    /**
     * Runs the provided action, waiting for the network requests matching the provided url patterns to complete.
     * Intended when running an action causes network requests that need to complete before we should continue.
     */
    async waitingForNetworkCausedBy(options: {
        urlPatternsToWaitFor: (string | RegExp)[]
        action: () => Promise<void>
    }): Promise<void> {
        const responsePromises = options.urlPatternsToWaitFor.map((urlPattern) => {
            return this.page.waitForResponse(urlPattern)
        })
        await options.action()
        // eslint-disable-next-line compat/compat
        await Promise.allSettled(responsePromises)
    }

    async waitForFlags() {
        await this.page.waitForResponse(/flags/)
    }
}
