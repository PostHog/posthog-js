import { isRecord } from './protocol'

export interface AutocaptureRemoteConfig {
    autocapture_opt_out?: boolean
    elementsChainAsString?: boolean
}

export interface AutocaptureState extends AutocaptureRemoteConfig {
    status: 'pending' | 'loaded' | 'failed' | 'disabled'
}

/** Only these project settings may cross the bridge or enter Electron's config cache. */
export function sanitizeAutocaptureConfig(value: unknown): AutocaptureRemoteConfig {
    if (!isRecord(value)) return {}
    return {
        ...(typeof value.autocapture_opt_out === 'boolean' ? { autocapture_opt_out: value.autocapture_opt_out } : {}),
        ...(typeof value.elementsChainAsString === 'boolean'
            ? { elementsChainAsString: value.elementsChainAsString }
            : {}),
    }
}
