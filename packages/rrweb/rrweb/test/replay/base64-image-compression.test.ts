import * as fs from 'fs'
import * as path from 'path'
import { vi } from 'vitest'
import { startServer, getServerURL, launchPuppeteer, waitForRAF } from '../utils'
import { toMatchImageSnapshot } from 'jest-image-snapshot'
import type * as puppeteer from 'puppeteer'
import type * as http from 'http'

interface ISuite {
    code: string
    styles: string
    browser: puppeteer.Browser
    page: puppeteer.Page
    server: http.Server
    serverURL: string
}

expect.extend({ toMatchImageSnapshot })

describe('base64 image compression visual tests', function () {
    vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

    let code: ISuite['code']
    let styles: ISuite['styles']
    let browser: ISuite['browser']
    let page: ISuite['page']
    let server: ISuite['server']
    let serverURL: ISuite['serverURL']

    beforeAll(async () => {
        server = await startServer()
        serverURL = getServerURL(server)
        browser = await launchPuppeteer()

        const bundlePath = path.resolve(__dirname, '../../dist/rrweb.umd.cjs')
        const stylePath = path.resolve(__dirname, '../../src/replay/styles/style.css')
        code = fs.readFileSync(bundlePath, 'utf8')
        styles = fs.readFileSync(stylePath, 'utf8')
    })

    beforeEach(async () => {
        page = await browser.newPage()
        await page.setViewport({ width: 1920, height: 1080 })
    })

    afterEach(async () => {
        await page.close()
    })

    afterAll(async () => {
        await browser?.close()
        await server?.close()
    })

    it('should record, mutate with large image, replay, and visually snapshot', async () => {
        await page.goto(`${serverURL}/html/base64-image-compression.html`, {
            waitUntil: 'load',
        })

        await page.evaluate(code)

        const events = await page.evaluate(`
      const { record } = rrweb;
      const events = [];

      record({
        emit(event) {
          events.push(event);
        },
        dataURLOptions: {
          type: 'image/webp',
          quality: 0.4,
          maxBase64ImageLength: 1048576
        }
      });

      events;
    `)

        await waitForRAF(page)
        await waitForRAF(page)

        await page.evaluate(`window.addLargeImage()`)

        await waitForRAF(page)
        await waitForRAF(page)

        const recordedEvents = await page.evaluate(`events`)

        const replayPage = await browser.newPage()
        await replayPage.setViewport({ width: 1920, height: 1080 })
        await replayPage.goto('about:blank')
        await replayPage.addStyleTag({ content: styles })
        await replayPage.evaluate(code)

        await replayPage.evaluate(`
      const events = ${JSON.stringify(recordedEvents)};
      const { Replayer } = rrweb;
      const replayer = new Replayer(events, {
        skipInactive: true,
        speed: 100
      });
      replayer.play();
    `)

        await waitForRAF(replayPage)
        await waitForRAF(replayPage)
        await replayPage.waitForTimeout(1000)

        const image = await replayPage.screenshot({ fullPage: true })
        expect(image).toMatchImageSnapshot({
            failureThreshold: 1.5,
            failureThresholdType: 'percent',
            customSnapshotIdentifier: 'base64-image-compression-replay',
        })

        await replayPage.close()
    })

    it('should replace oversized images with striped placeholder in replay', async () => {
        await page.goto(`${serverURL}/html/base64-image-compression.html`, {
            waitUntil: 'load',
        })

        await page.evaluate(code)

        const events = await page.evaluate(`
      const { record } = rrweb;
      const events = [];

      record({
        emit(event) {
          events.push(event);
        },
        dataURLOptions: {
          type: 'image/webp',
          quality: 0.4,
          maxBase64ImageLength: 5000
        }
      });

      events;
    `)

        await waitForRAF(page)

        await page.evaluate(`window.addHugeImage()`)

        await waitForRAF(page)
        await waitForRAF(page)

        const recordedEvents = await page.evaluate(`events`)

        const replayPage = await browser.newPage()
        await replayPage.setViewport({ width: 1920, height: 1080 })
        await replayPage.goto('about:blank')
        await replayPage.addStyleTag({ content: styles })
        await replayPage.evaluate(code)

        await replayPage.evaluate(`
      const events = ${JSON.stringify(recordedEvents)};
      const { Replayer } = rrweb;
      const replayer = new Replayer(events, {
        skipInactive: true,
        speed: 100
      });
      replayer.play();
    `)

        await waitForRAF(replayPage)
        await waitForRAF(replayPage)
        await replayPage.waitForTimeout(2000)

        const image = await replayPage.screenshot({ fullPage: true })
        expect(image).toMatchImageSnapshot({
            failureThreshold: 0.02,
            failureThresholdType: 'percent',
            customSnapshotIdentifier: 'base64-image-replacement-with-stripes',
        })

        await replayPage.close()
    })
})
