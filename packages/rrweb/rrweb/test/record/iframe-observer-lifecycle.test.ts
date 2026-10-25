import * as fs from 'fs'
import * as path from 'path'
import type * as puppeteer from 'puppeteer'
import { vi } from 'vitest'
import type { eventWithTime, listenerHandler, mutationData } from '@posthog/rrweb-types'
import { EventType, IncrementalSource } from '@posthog/rrweb-types'
import type { recordOptions } from '../../src/types'
import { launchPuppeteer, waitForRAF } from '../utils'

interface IWindow extends Window {
    rrweb: {
        record: ((options: recordOptions<eventWithTime>) => listenerHandler | undefined) & {
            takeFullSnapshot: (isCheckout?: boolean) => void
        }
    }
    emit: (event: eventWithTime) => void
    stopRecording?: listenerHandler
    iframeDocument: Document
}

describe('same-origin iframe observer lifecycle', () => {
    vi.setConfig({ testTimeout: 100_000 })

    let browser: puppeteer.Browser
    let page: puppeteer.Page
    let code: string
    let events: eventWithTime[]

    beforeAll(async () => {
        browser = await launchPuppeteer()
        code = fs.readFileSync(path.resolve(__dirname, '../../dist/rrweb.umd.cjs'), 'utf8')
    })

    afterAll(async () => {
        await browser?.close()
    })

    beforeEach(async () => {
        page = await browser.newPage()
        await page.goto('about:blank')
        await page.setContent('<iframe srcdoc="<p>initial</p>"></iframe>')
        await page.evaluate(code)
        events = []
        await page.exposeFunction('emit', (event: eventWithTime) => {
            events.push(event)
        })
        await page.evaluate(() => {
            const win = window as unknown as IWindow
            win.iframeDocument = document.querySelector('iframe')!.contentDocument!
            win.stopRecording = win.rrweb.record({ emit: win.emit })
        })
        await waitForRAF(page)
    })

    afterEach(async () => {
        await page?.close()
    })

    const attributeChanges = () =>
        events
            .filter(
                (event) =>
                    event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation
            )
            .flatMap((event) => (event.data as mutationData).attributes)
            .filter((change) => 'data-observer-check' in change.attributes)

    const changeAttribute = async (currentDocument = false) => {
        events = []
        await page.evaluate((useCurrentDocument) => {
            const win = window as unknown as IWindow
            const doc = useCurrentDocument ? document.querySelector('iframe')!.contentDocument! : win.iframeDocument
            doc.body.setAttribute('data-observer-check', String(Date.now()))
        }, currentDocument)
        await waitForRAF(page)
    }

    it('emits one mutation after three full snapshots of the same document', async () => {
        await page.evaluate(() => {
            const { record } = (window as unknown as IWindow).rrweb
            record.takeFullSnapshot(true)
            record.takeFullSnapshot(true)
            record.takeFullSnapshot(true)
        })
        await waitForRAF(page)

        await changeAttribute()
        expect(attributeChanges()).toHaveLength(1)
    })

    it('stops observing a removed iframe document', async () => {
        await page.evaluate(() => document.querySelector('iframe')!.remove())
        await waitForRAF(page)

        await changeAttribute()
        expect(attributeChanges()).toHaveLength(0)
    })

    it('observes the new document after navigation and releases the old one', async () => {
        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    const iframe = document.querySelector('iframe')!
                    iframe.addEventListener('load', () => resolve(), { once: true })
                    iframe.srcdoc = '<p>navigated</p>'
                })
        )
        await waitForRAF(page)

        await changeAttribute()
        expect(attributeChanges()).toHaveLength(0)

        await changeAttribute(true)
        expect(attributeChanges()).toHaveLength(1)
    })

    it('re-observes the document after recorder stop and restart', async () => {
        await page.evaluate(() => (window as unknown as IWindow).stopRecording?.())
        await changeAttribute()
        expect(attributeChanges()).toHaveLength(0)

        await page.evaluate(() => {
            const win = window as unknown as IWindow
            win.stopRecording = win.rrweb.record({ emit: win.emit })
        })
        await waitForRAF(page)
        await changeAttribute()
        expect(attributeChanges()).toHaveLength(1)
    })
})
