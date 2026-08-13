import { isObject } from '@posthog/core'

import { Autocapture } from './autocapture'
import type { AutocaptureConfig, AutocaptureConfigSource } from './autocapture-config'
import type { PostHog } from './posthog-core'

class BrowserAutocaptureConfigSource implements AutocaptureConfigSource {
    constructor(private readonly _instance: PostHog) {}

    refresh(target: AutocaptureConfig): void {
        const config = this._instance.config
        const autocapture = isObject(config.autocapture) ? config.autocapture : undefined

        target.enabled = !!config.autocapture
        target.rageclick = config.rageclick
        target.maskAllElementAttributes = config.mask_all_element_attributes
        target.maskAllText = config.mask_all_text
        target.disableCaptureUrlHashes = config.disable_capture_url_hashes
        target.getCurrentUrl = config.get_current_url
        target.remoteRequestsDisabled = this._instance._shouldDisableFlags()
        target.url_allowlist = autocapture?.url_allowlist
        target.url_ignorelist = autocapture?.url_ignorelist
        target.dom_event_allowlist = autocapture?.dom_event_allowlist
        target.element_allowlist = autocapture?.element_allowlist
        target.css_selector_allowlist = autocapture?.css_selector_allowlist
        target.css_selector_ignorelist = autocapture?.css_selector_ignorelist
        target.element_attribute_ignorelist = autocapture?.element_attribute_ignorelist
        target.capture_copied_text = autocapture?.capture_copied_text
    }
}

/** Browser-v1 compatibility wrapper for the SDK-neutral autocapture extension. */
export class BrowserAutocapture extends Autocapture {
    constructor(instance: PostHog) {
        super(new BrowserAutocaptureConfigSource(instance))
    }
}
