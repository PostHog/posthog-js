import type { BrowserProducts } from '../../core/context/browser-client'
import { Autocapture } from '@posthog/browser-common/autocapture'
import type { AutocaptureConfig } from '@posthog/browser-common/autocapture-config'
import { DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS } from '@posthog/browser-common/utils/autocapture-utils'
import { snapshotAutocaptureOptions, type AutocaptureOptions } from './autocapture-options'

export type { AutocaptureOptions, RageclickOptions } from './autocapture-options'

/** Include DOM autocapture statically instead of loading it during initialization. */
export const autocapture = (options: AutocaptureOptions = {}): BrowserProducts['autocapture'] => {
    const snapshot = snapshotAutocaptureOptions(options)
    const rageclick = typeof snapshot.rageclick === 'object' ? snapshot.rageclick : {}
    const config: AutocaptureConfig = {
        enabled: true,
        remoteRequestsDisabled: false,
        maskAllElementAttributes: snapshot.maskAllElementAttributes ?? false,
        maskAllText: snapshot.maskAllText ?? false,
        disableCaptureUrlHashes: snapshot.disableCaptureUrlHashes ?? true,
        rageclick:
            snapshot.rageclick === false
                ? false
                : {
                      ...(rageclick.cssSelectorIgnorelist === undefined
                          ? {}
                          : { css_selector_ignorelist: rageclick.cssSelectorIgnorelist }),
                      content_ignorelist: rageclick.contentIgnorelist ?? [...DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS],
                      ignore_text_selection: rageclick.ignoreTextSelection ?? true,
                      ...(rageclick.thresholdPx === undefined ? {} : { threshold_px: rageclick.thresholdPx }),
                      ...(rageclick.clickCount === undefined ? {} : { click_count: rageclick.clickCount }),
                      ...(rageclick.timeoutMs === undefined ? {} : { timeout_ms: rageclick.timeoutMs }),
                  },
        ...(snapshot.getCurrentUrl ? { getCurrentUrl: snapshot.getCurrentUrl } : {}),
        ...(snapshot.urlAllowlist ? { url_allowlist: snapshot.urlAllowlist } : {}),
        ...(snapshot.urlIgnorelist ? { url_ignorelist: snapshot.urlIgnorelist } : {}),
        ...(snapshot.domEventAllowlist ? { dom_event_allowlist: snapshot.domEventAllowlist } : {}),
        ...(snapshot.elementAllowlist ? { element_allowlist: snapshot.elementAllowlist } : {}),
        ...(snapshot.cssSelectorAllowlist ? { css_selector_allowlist: snapshot.cssSelectorAllowlist } : {}),
        ...(snapshot.cssSelectorIgnorelist ? { css_selector_ignorelist: snapshot.cssSelectorIgnorelist } : {}),
        ...(snapshot.elementAttributeIgnorelist
            ? { element_attribute_ignorelist: snapshot.elementAttributeIgnorelist }
            : {}),
        capture_copied_text: snapshot.captureCopiedText ?? false,
    }
    let disposed = false
    const shared = new Autocapture({ refresh: (target) => Object.assign(target, config) })
    const extension: BrowserProducts['autocapture'] = {
        name: 'autocapture',
        bindings: { autocapture: shared },
        async setup(client) {
            await client.resolveExtension('analytics')
            if (disposed) return
            const selectors = client.surveys?.getElementSelectors?.()
            if (selectors) extension.setElementSelectors(selectors)
            shared.setup(client.sharedClient)
        },
        setElementSelectors: (selectors) => shared.setElementSelectors(new Set(selectors)),
        dispose: () => {
            disposed = true
            shared.dispose()
        },
    }
    return extension
}
