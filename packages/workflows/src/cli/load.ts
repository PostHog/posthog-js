import { createJiti } from 'jiti'
import { isAbsolute, relative, resolve } from 'node:path'

import type { EmitResult } from '../emit.js'
import { WorkflowError } from '../errors.js'
import type { Workflow } from '../workflow.js'

export interface LoadedWorkflow {
    readonly exportName: string
    readonly key: string
    readonly emitted: EmitResult
}

export interface LoadedFile {
    readonly path: string
    readonly workflows: readonly LoadedWorkflow[]
}

const PLACEHOLDER_KEY = /^replace[-_]me/i

const STEP_KINDS = new Set(['delay', 'function', 'email', 'branch'])

function isWorkflow(value: unknown): value is Workflow {
    const candidate = value as Workflow | null
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof candidate?.key === 'string' &&
        typeof candidate.emit === 'function'
    )
}

function isStep(value: unknown): boolean {
    const kind = (value as { kind?: unknown } | null)?.kind
    return typeof value === 'object' && value !== null && typeof kind === 'string' && STEP_KINDS.has(kind)
}

function isLooseGraph(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.length > 0 && value.every(isStep)
    }
    return isStep(value)
}

export interface LoadOptions {
    readonly env: Readonly<Record<string, string | undefined>>
}

export async function loadWorkflowFile(path: string, options: LoadOptions): Promise<LoadedFile> {
    const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path)
    const inside = relative(process.cwd(), absolute)
    const shown = inside === '' || inside.startsWith('..') ? path : inside
    const jiti = createJiti(import.meta.url, { interopDefault: false })

    let namespace: Record<string, unknown>
    try {
        namespace = (await jiti.import(absolute)) as Record<string, unknown>
    } catch (error) {
        throw new WorkflowError({
            status: 'load_failed',
            message: `Could not load ${shown}.`,
            why: error instanceof Error ? error.message : String(error),
            fix: `Check that ${shown} exists and that your own tsc runs clean over it. The loader evaluates the file, so anything the file throws at module level arrives here.`,
        })
    }

    const workflows: LoadedWorkflow[] = []
    const loose: string[] = []

    for (const [exportName, value] of Object.entries(namespace)) {
        if (isWorkflow(value)) {
            workflows.push({ exportName, key: value.key, emitted: value.emit({ env: options.env }) })
            continue
        }
        if (isLooseGraph(value)) {
            loose.push(exportName)
        }
    }

    if (loose.length > 0) {
        const names = loose.map((name) => `"${name}"`).join(', ')
        throw new WorkflowError({
            status: 'not_a_workflow',
            message: `${shown} exports ${names}, which is a step rather than a workflow.`,
            why: 'A step is a value with no trigger, no exit and no key, so there is nothing to push. Only what workflow() returns can reach PostHog.',
            fix: `Either put ${loose[0]!} in the steps of a workflow({ ... }) that ${shown} exports, or stop exporting it.`,
        })
    }

    if (workflows.length === 0) {
        throw new WorkflowError({
            status: 'no_workflows',
            message: `${shown} exports no workflow.`,
            why: 'The CLI reads the file for exported workflows and found none. A const that is not exported is invisible, and so is a workflow built inside a function that nothing calls.',
            fix: `Export the workflow from ${shown}: export const myWorkflow = workflow({ ... }).`,
        })
    }

    const byKey = new Map<string, string>()
    for (const loaded of workflows) {
        if (PLACEHOLDER_KEY.test(loaded.key)) {
            throw new WorkflowError({
                status: 'placeholder_key',
                message: `"${loaded.exportName}" still carries the example key "${loaded.key}".`,
                why: 'That key comes from the documentation. It is the identity of the workflow in your project, so leaving it means two unrelated workflows claim one row.',
                fix: `Give "${loaded.exportName}" a key of your own in ${shown}, for example the name of the file.`,
            })
        }
        const clash = byKey.get(loaded.key)
        if (clash !== undefined) {
            throw new WorkflowError({
                status: 'duplicate_workflow_key',
                message: `${shown} exports two workflows with the key "${loaded.key}".`,
                why: `The key is the identity of a workflow in a project, so "${clash}" and "${loaded.exportName}" both claim one row and the second push overwrites the first.`,
                fix: `Give "${loaded.exportName}" its own key in ${shown}.`,
            })
        }
        byKey.set(loaded.key, loaded.exportName)
    }

    return { path: shown, workflows }
}

export function previewEnv(
    env: Readonly<Record<string, string | undefined>>
): Readonly<Record<string, string | undefined>> {
    return new Proxy(
        {},
        {
            get: (_target, name: string) =>
                env[name] === undefined || env[name] === '' ? '(resolved at push)' : env[name],
        }
    ) as Readonly<Record<string, string | undefined>>
}
