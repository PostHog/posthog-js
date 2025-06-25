import { by, element, waitFor } from 'detox'
import jestExpect from 'expect'
import { createMockServer, MockRequest } from './mock-server'
const { reloadApp } = require('detox-expo-helpers')
const { objectContaining, arrayContaining } = jestExpect
const wait = (t: number) => new Promise((r) => setTimeout(r, t))

// Weird typescript issue
const toMatchSnapshot = (e: any) => (jestExpect(e) as any).toMatchSnapshot()

const commonProperties = {
  $app_build: '1',
  $app_name: 'Expo Go',
  $app_namespace: 'host.exp.Exponent',
  $app_version: '2.24.3',
  $device_manufacturer: 'Apple',
  $device_name: 'iPhone 12 Pro',
  $lib: 'posthog-react-native',
  $lib_version: jestExpect.any(String),
  $locale: jestExpect.any(String),
  $os_name: 'iOS',
  $os_version: '15.5',
  $screen_height: 844,
  $screen_width: 390,
  $timezone: jestExpect.any(String),
}
describe('PostHog React Native E2E', () => {
  let server: any
  let httpMock: jest.Mock<MockRequest, any>

  beforeAll(async () => {
    ;[server, httpMock] = createMockServer()
  })

  beforeEach(async () => {
    await reloadApp()
    httpMock.mockReset()

    await waitFor(element(by.id('title-TabOne')))
      .toBeVisible()
      .withTimeout(5000)
  })

  afterAll(async () => {
    await server.close()
  })

  it('should track $screen', async () => {
    await wait(1500)

    const calls = httpMock.mock.calls
    const eventCall = calls.find((x) => x[0].path === '/e/')

    jestExpect(eventCall[0]).toMatchObject({
      body: {
        api_key: 'phc_FzKQvNvps9ZUTxF5KJR9jIKdGb4bq4HNBa9SRyAHi0C',
        batch: arrayContaining([
          objectContaining({
            distinct_id: jestExpect.any(String),
            event: 'Application Opened',
            library: 'posthog-react-native',
            properties: {
              ...commonProperties,
            },
            timestamp: jestExpect.any(String),
            type: 'capture',
          }),
          objectContaining({
            distinct_id: jestExpect.any(String),
            event: '$screen',
            library: 'posthog-react-native',
            properties: {
              ...commonProperties,
              $screen_name: 'TabOne',
            },
            timestamp: jestExpect.any(String),
            type: 'capture',
          }),
        ]),
        sent_at: jestExpect.any(String),
      },
      method: 'POST',
      path: '/e/',
    })
  })

  it('should automatically track $screen on navigation', async () => {
    await wait(1500)
    httpMock.mockReset()

    await element(by.id('modal-button')).tap()
    await waitFor(element(by.id('title-Modal')))
      .toHaveLabel('Modal')
      .withTimeout(5000)

    await wait(1500)

    jestExpect(httpMock).toHaveBeenCalledWith(
      objectContaining({
        path: '/e/',
        body: objectContaining({
          batch: arrayContaining([
            objectContaining({
              event: '$screen',
              properties: objectContaining({
                $screen_name: 'Modal',
              }),
            }),
          ]),
        }),
      })
    )
  })

  it('should autocapture taps', async () => {
    await wait(1500)

    httpMock.mockReset()

    await element(by.id('example-ph-label')).tap()

    await wait(5000)

    const lastCall = httpMock.mock.lastCall
    jestExpect(lastCall[0]).toMatchObject({
      path: '/e/',
      body: objectContaining({
        batch: arrayContaining([
          objectContaining({
            event: '$autocapture',
            properties: objectContaining({
              $event_type: 'touch',
              $lib: 'posthog-react-native',
              $screen_height: 844,
              $screen_width: 390,
              $touch_x: jestExpect.any(Number),
              $touch_y: jestExpect.any(Number),
            }),
          }),
        ]),
      }),
    })
    toMatchSnapshot(lastCall[0].body.batch[0].properties.$elements)
  })

  it('should ignore autocapture for ph-no-capture', async () => {
    await wait(1500)
    httpMock.mockReset()

    await element(by.id('example-ph-no-capture')).tap()
    await wait(1000)

    jestExpect(httpMock).toHaveBeenCalledTimes(0)
  })
})
