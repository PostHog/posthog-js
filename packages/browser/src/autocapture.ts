import { Autocapture as SharedAutocapture } from '@posthog/browser-common/autocapture'
import { AutocaptureExtension } from './extension-tokens'

export {
    getAugmentPropertiesFromElement,
    previousElementSibling,
    getDefaultProperties,
    getPropertiesFromElement,
    autocapturePropertiesForElement,
} from '@posthog/browser-common/autocapture'

/** Legacy token typing for the shared autocapture extension. */
export class Autocapture extends SharedAutocapture {
    override readonly name = AutocaptureExtension
}
