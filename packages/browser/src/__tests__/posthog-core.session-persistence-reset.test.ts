import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

// register_for_session/unregister_for_session are documented as being cleared when the
// session ends (see the `sessionPersistence` docstring in posthog-core.ts). Verifies that
// a real $session_id rotation actually clears them, and that the baseline-recording +
// shared-instance guards in _clearSessionPersistenceOnNewSession behave correctly.
describe('session-scoped persistence is cleared on session id rotation', () => {
    it('clears register_for_session properties when the session id rotates', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { persistence: 'localStorage+cookie' })

        // establish the initial session (as page load normally would, e.g. via the first capture)
        // before registering session-scoped properties
        posthog.sessionManager!.checkAndGetSessionAndWindowId()

        posthog.register_for_session({ current_flow: 'checkout' })
        expect(posthog.sessionPersistence!.props.current_flow).toBe('checkout')

        // Force a real session id rotation via the same mechanism used for
        // activity-timeout/max-length rotations, then let the change propagate
        // through onSessionId handlers (including our new one).
        posthog.sessionManager!.resetSessionId()
        posthog.sessionManager!.checkAndGetSessionAndWindowId()

        expect(posthog.sessionPersistence!.props.current_flow).toBeUndefined()
    })

    it('does not clear when register_for_session is called within the same session', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { persistence: 'localStorage+cookie' })

        // establish the current session id as the tracked baseline
        posthog.sessionManager!.checkAndGetSessionAndWindowId()

        posthog.register_for_session({ current_flow: 'checkout' })
        expect(posthog.sessionPersistence!.props.current_flow).toBe('checkout')

        // re-checking without any rotation trigger should not touch session persistence
        posthog.sessionManager!.checkAndGetSessionAndWindowId()

        expect(posthog.sessionPersistence!.props.current_flow).toBe('checkout')
    })

    it('does not clear properties registered before the very first rotation', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { persistence: 'localStorage+cookie' })

        // onSessionId fires immediately on subscription with the current session id,
        // which must only record a baseline — not clear anything already registered.
        posthog.register_for_session({ current_flow: 'checkout' })

        expect(posthog.sessionPersistence!.props.current_flow).toBe('checkout')
    })

    it('does not wipe unrelated persistence when sessionPersistence and persistence share an instance', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { persistence: 'memory' })

        expect(posthog.sessionPersistence).toBe(posthog.persistence)

        posthog.sessionManager!.checkAndGetSessionAndWindowId()

        posthog.register({ some_super_property: 'keep-me' } as unknown as Record<string, unknown>)
        posthog.register_for_session({ current_flow: 'checkout' })

        posthog.sessionManager!.resetSessionId()
        posthog.sessionManager!.checkAndGetSessionAndWindowId()

        // In shared-instance mode we deliberately skip the clear, since it would also
        // wipe distinct_id, super properties, feature flags, etc.
        expect(posthog.persistence!.props.some_super_property).toBe('keep-me')
    })
})
