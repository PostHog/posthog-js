import { addUncaughtExceptionListener, addUnhandledRejectionListener } from './autocapture';
import { uuidv7 } from '@posthog/core/vendor/uuidv7';
import { propertiesFromUnknownInput } from './error-conversion';
const SHUTDOWN_TIMEOUT = 2000;
export default class ErrorTracking {
    static async buildEventMessage(error, hint, distinctId, additionalProperties) {
        const properties = { ...additionalProperties };
        // Given stateless nature of Node SDK we capture exceptions using personless processing when no
        // user can be determined because a distinct_id is not provided e.g. exception autocapture
        if (!distinctId) {
            properties.$process_person_profile = false;
        }
        const exceptionProperties = await propertiesFromUnknownInput(this.stackParser, this.frameModifiers, error, hint);
        return {
            event: '$exception',
            distinctId: distinctId || uuidv7(),
            properties: {
                ...exceptionProperties,
                ...properties,
            },
        };
    }
    constructor(client, options) {
        this.client = client;
        this._exceptionAutocaptureEnabled = options.enableExceptionAutocapture || false;
        this.startAutocaptureIfEnabled();
    }
    startAutocaptureIfEnabled() {
        if (this.isEnabled()) {
            addUncaughtExceptionListener(this.onException.bind(this), this.onFatalError.bind(this));
            addUnhandledRejectionListener(this.onException.bind(this));
        }
    }
    onException(exception, hint) {
        void ErrorTracking.buildEventMessage(exception, hint).then((msg) => {
            this.client.capture(msg);
        });
    }
    async onFatalError() {
        await this.client.shutdown(SHUTDOWN_TIMEOUT);
    }
    isEnabled() {
        return !this.client.isDisabled && this._exceptionAutocaptureEnabled;
    }
}
//# sourceMappingURL=index.js.map