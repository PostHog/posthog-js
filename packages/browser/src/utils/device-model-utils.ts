import { isString } from '@posthog/core'

import { navigator } from './globals'
import { logger } from './logger'

/**
 * Reads the hardware model from `navigator.userAgentData.getHighEntropyValues(['model'])`.
 *
 * Only meaningful on Android Chromium — `undefined` on Safari/Firefox and an empty string on desktop
 * (both treated as absent). A Permissions-Policy block rejects with `NotAllowedError`, which we catch
 * and return `undefined`.
 */
export async function getDeviceModel(): Promise<string | undefined> {
    // eslint-disable-next-line compat/compat
    const uaData = navigator?.userAgentData
    if (!uaData?.getHighEntropyValues) {
        return undefined
    }

    try {
        const hints = await uaData.getHighEntropyValues(['model'])
        const model = hints?.model
        return isString(model) && model.length > 0 ? model : undefined
    } catch (e) {
        logger.info('Unable to resolve $device_model from userAgentData.getHighEntropyValues', e)
        return undefined
    }
}
