export type LogFn = (message: string, data?: Record<string, unknown>) => void

export type GetPersistedSessionId = () => string | null
export type SetPersistedSessionId = (sessionId: string) => void

export interface Trigger {
    readonly name: string
    matches(sessionId: string): boolean | null
}
