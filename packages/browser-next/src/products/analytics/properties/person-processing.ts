import type { PersonProfileMode } from '../analytics-options'

export const snapshotPersonProfileMode = (read: () => unknown): PersonProfileMode => {
    try {
        const value = read()
        if (value === 'always' || value === 'never') return value
    } catch {
        // Unavailable configuration retains the default policy.
    }
    return 'identified_only'
}

export const shouldProcessPerson = (
    mode: PersonProfileMode,
    identified: boolean,
    grouped: boolean,
    explicitlyEnabled: boolean
): boolean => mode === 'always' || (mode !== 'never' && (identified || grouped || explicitlyEnabled))

export interface PersonProperties {
    readonly signature: string
    readonly set: Record<string, unknown>
    readonly setOnce: Record<string, unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

/** Snapshot caller-controlled values before local flag state or analytics state consumes them. */
export const snapshotPersonProperties = (
    distinctId: string,
    set: Record<string, unknown> | undefined,
    setOnce: Record<string, unknown> | undefined
): PersonProperties | undefined => {
    try {
        const signature = JSON.stringify([distinctId, set ?? {}, setOnce ?? {}])
        const values: unknown = JSON.parse(signature)
        if (!Array.isArray(values) || !isRecord(values[1]) || !isRecord(values[2])) return undefined
        return { signature, set: values[1], setOnce: values[2] }
    } catch {
        return undefined
    }
}

export const personPropertyNames = (value: string | readonly string[]): string[] => {
    try {
        return (Array.isArray(value) ? value : [value]).filter(
            (name): name is string => typeof name === 'string' && name.length > 0
        )
    } catch {
        return []
    }
}
