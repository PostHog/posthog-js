import { PostHogV2FlagsResponse } from 'posthog-core/src/types'
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

export const apiImplementation = ({
  localFlags,
  decideFlags: flags,
  flagsPayloads,
  flagsStatus = 200,
  localFlagsStatus = 200,
  errorsWhileComputingFlags = false,
}: {
  localFlags?: any
  decideFlags?: any
  flagsPayloads?: any
  flagsStatus?: number
  localFlagsStatus?: number
  errorsWhileComputingFlags?: boolean
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
      return Promise.resolve({
        status: localFlagsStatus,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve(localFlags),
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
