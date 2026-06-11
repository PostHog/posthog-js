import { expect } from '@jest/globals'
import { NetworkRecordOptions } from '../../../../types'
import { isHostOnDenyList } from '../../../../extensions/replay/external/denylist'

describe('network host denylist', () => {
    const testCases = [
        { url: 'https://www.google.com', denyList: ['.google.com'], isDenied: true, expectedHost: 'www.google.com' },
        {
            url: 'https://www.google.com',
            denyList: ['.ask.jeeves.com'],
            isDenied: false,
            expectedHost: 'www.google.com',
        },
        { url: 'google.com', denyList: ['.google.com'], isDenied: false, expectedHost: null },
    ]
    it.each(testCases)(
        '$url when denylist is $denyList should have denied as $isDenied',
        ({ url, denyList, isDenied, expectedHost }) => {
            const { hostname, isHostDenied } = isHostOnDenyList(url, {
                payloadHostDenyList: denyList,
            } as unknown as NetworkRecordOptions)
            expect(hostname).toBe(expectedHost)
            expect(isHostDenied).toBe(isDenied)
        }
    )
})
