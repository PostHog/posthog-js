export type LogFn = (message: string, data?: Record<string, unknown>) => void

export interface Trigger {
    readonly name: string
    shouldCapture(): boolean | null
}
