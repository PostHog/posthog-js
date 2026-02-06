export interface PersistenceHelper {
    /**
     * Check if the trigger was already matched for this session.
     */
    sessionMatchesTrigger(sessionId: string): boolean

    /**
     * Mark the trigger as matched for the given session.
     */
    matchTriggerInSession(sessionId: string): void
}

export interface PersistenceHelperFactory {
    /**
     * Create a PersistenceHelper for a specific trigger.
     * @param triggerKey Unique key for this trigger (e.g., 'url', 'event', 'flag', 'sample')
     */
    create(triggerKey: string): PersistenceHelper
}

export type GetProperty = (key: string) => string | null
export type SetProperty = (key: string, value: string) => void

/**
 * Creates a PersistenceHelperFactory that uses the provided get/set functions.
 */
export function createPersistenceHelperFactory(
    getProperty: GetProperty,
    setProperty: SetProperty,
    storagePrefix: string = '$error_tracking_'
): PersistenceHelperFactory {
    return {
        create(triggerKey: string): PersistenceHelper {
            const storageKey = `${storagePrefix}${triggerKey}_session`

            return {
                sessionMatchesTrigger(sessionId: string): boolean {
                    const storedSessionId = getProperty(storageKey)
                    return storedSessionId === sessionId
                },

                matchTriggerInSession(sessionId: string): void {
                    setProperty(storageKey, sessionId)
                },
            }
        },
    }
}
