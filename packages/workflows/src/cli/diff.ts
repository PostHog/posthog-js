import type { WorkflowDefinition } from '../definition.js'
import type { SecretInput } from '../emit.js'
import { compareDefinitions } from './normalize.js'

export interface Change {
    readonly kind: 'added' | 'removed' | 'changed'
    readonly what: string
    readonly before?: string
    readonly after?: string
}

export interface Diff {
    readonly changed: boolean
    readonly changes: readonly Change[]
}

export interface DiffOptions {
    readonly compareSecretInputs?: readonly SecretInput[]
}

function short(value: unknown): string {
    if (value === undefined || value === null) {
        return 'nothing'
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (text === undefined || text === '') {
        return 'empty'
    }
    return text.length > 70 ? `${text.slice(0, 67)}...` : text
}

export function diffWorkflow(
    local: WorkflowDefinition,
    remote: Readonly<Record<string, unknown>>,
    secretInputs: readonly SecretInput[],
    options: DiffOptions = {}
): Diff {
    const comparison = compareDefinitions(local, remote, {
        inputs: secretInputs,
        comparable: options.compareSecretInputs ?? secretInputs,
    })
    const changes: Change[] = comparison.fields.map((field) =>
        field === 'variables'
            ? { kind: 'changed', what: field }
            : { kind: 'changed', what: field, before: short(remote[field]), after: short(local[field]) }
    )

    const names = new Map<string, unknown>(
        (Array.isArray(remote.actions) ? (remote.actions as unknown[]) : []).map((action) => {
            const stored = action as { id?: unknown; name?: unknown } | null
            return [String(stored?.id), stored?.name]
        })
    )
    for (const action of local.actions) {
        names.set(action.id, action.name)
    }
    for (const { id, kind } of comparison.actions) {
        changes.push({ kind, what: `step "${String(names.get(id) ?? id)}"` })
    }

    if (comparison.edgesChanged) {
        changes.push({ kind: 'changed', what: 'the connections between steps' })
    }

    return { changed: changes.length > 0, changes }
}
