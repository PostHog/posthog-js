import { uuidv7 } from '@posthog/core/vendor/uuidv7';
import ErrorTracking from './error-tracking';
export function setupExpressErrorHandler(_posthog, app) {
    app.use((error, _, __, next) => {
        const hint = { mechanism: { type: 'middleware', handled: false } };
        // Given stateless nature of Node SDK we capture exceptions using personless processing
        // when no user can be determined e.g. in the case of exception autocapture
        ErrorTracking.buildEventMessage(error, hint, uuidv7(), { $process_person_profile: false }).then((msg) => _posthog.capture(msg));
        next(error);
    });
}
//# sourceMappingURL=express.js.map