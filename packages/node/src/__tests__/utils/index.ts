import { PostHogV2FlagsResponse } from '@posthog/core'
import util from 'util'

type ErrorResponse = {
  status: number
  json: () => Promise<any>
}

export const apiImplementationV4 = (flagsResponse: PostHogV2FlagsResponse | ErrorResponse) => {
  return (url: any): Promise<any> => {
    if ((url as any).includes('/flags/?v=2&config=true')) {
      // Check if the response is a flags response or an error response
      return 'flags' in flagsResponse
        ? Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve(flagsResponse),
          })
        : Promise.resolve({
            status: flagsResponse.status,
            text: () => Promise.resolve('not-ok'),
            json: flagsResponse.json,
          })
    }

    return Promise.resolve({
      status: 400,
      text: () => Promise.resolve('ok'),
      json: () =>
        Promise.resolve({
          status: 'ok',
        }),
    }) as any
  }
}

/**
 * Creates a mock headers object for testing
 */
export const createMockHeaders = (headers: Record<string, string> = {}) => ({
  get: (name: string) => headers[name] ?? null,
})

export const apiImplementation = ({
  localFlags,
  decideFlags: flags,
  flagsPayloads,
  flagsStatus = 200,
  localFlagsStatus = 200,
  errorsWhileComputingFlags = false,
  localFlagsEtag,
}: {
  localFlags?: any
  decideFlags?: any
  flagsPayloads?: any
  flagsStatus?: number
  localFlagsStatus?: number
  errorsWhileComputingFlags?: boolean
  localFlagsEtag?: string
}) => {
  return (url: any): Promise<any> => {
    if ((url as any).includes('/flags/')) {
      return Promise.resolve({
        status: flagsStatus,
        text: () => Promise.resolve('ok'),
        json: () => {
          if (flagsStatus !== 200) {
            return Promise.resolve(flags)
          } else {
            return Promise.resolve({
              featureFlags: flags,
              featureFlagPayloads: Object.fromEntries(
                Object.entries(flagsPayloads || {}).map(([k, v]) => [k, JSON.stringify(v)])
              ),
              errorsWhileComputingFlags,
            })
          }
        },
      }) as any
    }

    if ((url as any).includes('api/feature_flag/local_evaluation?token=TEST_API_KEY&send_cohorts')) {
      const headers = localFlagsEtag ? createMockHeaders({ ETag: localFlagsEtag }) : createMockHeaders()
      return Promise.resolve({
        status: localFlagsStatus,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve(localFlags),
        headers,
      }) as any
    }

    if ((url as any).includes('batch/')) {
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () =>
          Promise.resolve({
            status: 'ok',
          }),
      }) as any
    }

    return Promise.resolve({
      status: 400,
      text: () => Promise.resolve('ok'),
      json: () =>
        Promise.resolve({
          status: 'ok',
        }),
    }) as any
  }
}

export const anyLocalEvalCall = [
  'http://example.com/api/feature_flag/local_evaluation?token=TEST_API_KEY&send_cohorts',
  expect.any(Object),
]
export const anyFlagsCall = ['http://example.com/flags/?v=2&config=true', expect.any(Object)]

export const isPending = (promise: Promise<any>): boolean => {
  return util.inspect(promise).includes('pending')
}

export const waitForPromises = async (): Promise<void> => {
  await new Promise((resolve) => {
    // IMPORTANT: Only enable real timers for this promise - allows us to pass a short amount of ticks
    // whilst keeping any timers made during other promises as fake timers
    jest.useRealTimers()
    setTimeout(resolve, 10)
    jest.useFakeTimers()
  })
}

export const wait = async (t: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, t))
}
