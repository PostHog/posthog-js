import type { Action, WorkflowDefinition } from '../definition.js'
import type { SecretInput } from '../emit.js'

type Json = Record<string, unknown>

type FieldRule =
    | 'identity'
    | 'exact'
    | 'text'
    | 'optional text'
    | 'optional'
    | 'filters'
    | 'when authored'
    | 'config'
    | 'variables'
    | 'actions'
    | 'edges'

type KeysOf<T> = T extends unknown ? keyof T : never

const DEFINITION_FIELDS = {
    key: 'identity',
    name: 'text',
    description: 'optional text',
    exit_condition: 'exact',
    status: 'when authored',
    variables: 'variables',
    actions: 'actions',
    edges: 'edges',
} as const satisfies { readonly [K in keyof WorkflowDefinition]-?: FieldRule }

const ACTION_FIELDS = {
    id: 'identity',
    type: 'exact',
    name: 'text',
    description: 'optional text',
    filters: 'filters',
    on_error: 'optional',
    output_variable: 'optional',
    config: 'config',
} as const satisfies { readonly [K in KeysOf<Action>]-?: FieldRule }

export const DERIVED_ACTION_KEYS: ReadonlySet<string> = new Set(['created_at', 'updated_at'])

export const COMPILED_CONFIG_KEYS: ReadonlySet<string> = new Set(['bytecode', 'bytecode_error', 'transpiled'])

export const DERIVED_FILTER_KEYS: ReadonlySet<string> = new Set([...COMPILED_CONFIG_KEYS, 'source'])

export const DERIVED_INPUT_KEYS: ReadonlySet<string> = new Set([...COMPILED_CONFIG_KEYS, 'order', 'secret'])

export const INPUT_DEFAULTS: Readonly<Record<string, unknown>> = { templating: 'hog' }

export const CONFIG_DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    function_email: { template_id: 'template-email' },
    function_sms: { template_id: 'template-twilio' },
    function_push: { template_id: 'template-native-push' },
    wait_until_condition: { condition: { filters: null }, events: [] },
}

export type ContentField = 'name' | 'description' | 'exit_condition' | 'status' | 'variables'

export interface ActionChange {
    readonly id: string
    readonly kind: 'added' | 'removed' | 'changed'
}

export interface Comparison {
    readonly fields: readonly ContentField[]
    readonly actions: readonly ActionChange[]
    readonly edgesChanged: boolean
}

export interface SecretRules {
    readonly inputs: readonly SecretInput[]
    readonly comparable: readonly SecretInput[]
}

type Side = 'local' | 'stored'

class Secret {
    constructor(readonly value: string | undefined) {}
}

interface Context {
    readonly side: Side
    readonly secrets: ReadonlyMap<string, ReadonlySet<string>>
    readonly comparable: ReadonlyMap<string, ReadonlySet<string>>
}

function isObject(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Secret)
}

function isEmpty(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (isObject(value) && Object.keys(value).length === 0)
    )
}

function without(value: Json, keys: ReadonlySet<string>): Json {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)))
}

function same(mine: unknown, theirs: unknown): boolean {
    if (mine instanceof Secret || theirs instanceof Secret) {
        return (
            mine instanceof Secret &&
            theirs instanceof Secret &&
            (mine.value === undefined || theirs.value === undefined || mine.value === theirs.value)
        )
    }
    if (Array.isArray(mine) || Array.isArray(theirs)) {
        return (
            Array.isArray(mine) &&
            Array.isArray(theirs) &&
            mine.length === theirs.length &&
            mine.every((entry, index) => same(entry, theirs[index]))
        )
    }
    if (isObject(mine) && isObject(theirs)) {
        const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)])
        return [...keys].every((key) => same(mine[key], theirs[key]))
    }
    return mine === theirs
}

function withoutCompiled(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => withoutCompiled(entry))
    }
    if (!isObject(value)) {
        return value
    }
    const drop = key === 'filters' ? DERIVED_FILTER_KEYS : COMPILED_CONFIG_KEYS
    return Object.fromEntries(
        Object.entries(without(value, drop)).map(([name, entry]) => [name, withoutCompiled(entry, name)])
    )
}

function withoutDefaults(value: Json, defaults: Readonly<Record<string, unknown>>): Json {
    return Object.fromEntries(
        Object.entries(value).filter(([key, entry]) => !(key in defaults && same(entry, defaults[key])))
    )
}

function secretInput(input: unknown, inputKey: string, actionId: string, context: Context): Secret | undefined {
    const value = isObject(input) ? input.value : undefined
    if (context.side === 'local') {
        const known = context.comparable.get(actionId)?.has(inputKey) === true && typeof value === 'string'
        return new Secret(known ? value : undefined)
    }
    if (!isObject(input) || (input.secret !== true && isEmpty(value))) {
        return undefined
    }
    return new Secret(typeof value === 'string' && value !== '' ? value : undefined)
}

function normalizeInputs(inputs: Json, actionId: string, context: Context): Json {
    const secretKeys = context.secrets.get(actionId)
    return Object.fromEntries(
        Object.entries(inputs).map(([key, input]) => {
            if (secretKeys?.has(key) === true) {
                return [key, secretInput(input, key, actionId, context)]
            }
            return [key, isObject(input) ? withoutDefaults(without(input, DERIVED_INPUT_KEYS), INPUT_DEFAULTS) : input]
        })
    )
}

function normalizeConfig(config: unknown, action: Json, context: Context): unknown {
    if (!isObject(config)) {
        return config
    }
    const { inputs, ...rest } = config
    const normalized = withoutDefaults(withoutCompiled(rest) as Json, CONFIG_DEFAULTS[String(action.type)] ?? {})
    if (inputs === undefined) {
        return normalized
    }
    return { ...normalized, inputs: isObject(inputs) ? normalizeInputs(inputs, String(action.id), context) : inputs }
}

function trimmed(value: unknown): unknown {
    return typeof value === 'string' ? value.trim() : value
}

function normalizeField(rule: FieldRule, value: unknown): unknown {
    switch (rule) {
        case 'text':
            return trimmed(value)
        case 'optional text':
        case 'optional': {
            const normal = trimmed(value)
            return isEmpty(normal) ? undefined : normal
        }
        case 'filters': {
            const normal = withoutCompiled(value, 'filters')
            return isEmpty(normal) ? undefined : normal
        }
        case 'variables':
            return Array.isArray(value)
                ? value.map((entry) =>
                      isObject(entry)
                          ? Object.fromEntries(Object.entries(entry).map(([key, text]) => [key, trimmed(text)]))
                          : entry
                  )
                : (value ?? [])
        default:
            return value
    }
}

function normalizeAction(action: Json, context: Context): Json {
    const normalized: Json = {}
    for (const [key, value] of Object.entries(action)) {
        const rule: FieldRule | undefined = (ACTION_FIELDS as Readonly<Record<string, FieldRule>>)[key]
        if (rule === 'identity' || DERIVED_ACTION_KEYS.has(key)) {
            continue
        }
        normalized[key] =
            rule === undefined
                ? value
                : rule === 'config'
                  ? normalizeConfig(value, action, context)
                  : normalizeField(rule, value)
    }
    return normalized
}

function actionsById(actions: unknown, context: Context): Map<string, Json> {
    const list = Array.isArray(actions) ? actions.filter(isObject) : []
    return new Map(list.map((action) => [String(action.id), normalizeAction(action, context)]))
}

function edgeSet(edges: unknown): string[] {
    const list: unknown[] = Array.isArray(edges) ? edges : []
    return list
        .map((edge) =>
            JSON.stringify(isObject(edge) ? [edge.from, edge.to, edge.type, edge.index ?? null] : (edge ?? null))
        )
        .sort()
}

function byAction(inputs: readonly SecretInput[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>()
    for (const input of inputs) {
        const keys = map.get(input.actionId) ?? new Set<string>()
        keys.add(input.inputKey)
        map.set(input.actionId, keys)
    }
    return map
}

export function compareDefinitions(
    local: WorkflowDefinition,
    stored: Readonly<Record<string, unknown>>,
    secrets: SecretRules
): Comparison {
    const secretKeys = byAction(secrets.inputs)
    const comparable = byAction(secrets.comparable)
    const mineContext: Context = { side: 'local', secrets: secretKeys, comparable }
    const theirContext: Context = { side: 'stored', secrets: secretKeys, comparable }
    const authored = local as unknown as Readonly<Record<string, unknown>>

    const fields: ContentField[] = []
    for (const [field, rule] of Object.entries(DEFINITION_FIELDS) as [keyof WorkflowDefinition, FieldRule][]) {
        if (rule === 'identity' || rule === 'actions' || rule === 'edges') {
            continue
        }
        if (rule === 'when authored' && authored[field] === undefined) {
            continue
        }
        if (!same(normalizeField(rule, authored[field]), normalizeField(rule, stored[field]))) {
            fields.push(field as ContentField)
        }
    }

    const mine = actionsById(local.actions, mineContext)
    const theirs = actionsById(stored.actions, theirContext)
    const actions: ActionChange[] = []
    for (const [id, action] of mine) {
        const other = theirs.get(id)
        if (other === undefined) {
            actions.push({ id, kind: 'added' })
        } else if (!same(action, other)) {
            actions.push({ id, kind: 'changed' })
        }
    }
    for (const id of theirs.keys()) {
        if (!mine.has(id)) {
            actions.push({ id, kind: 'removed' })
        }
    }

    return { fields, actions, edgesChanged: !same(edgeSet(local.edges), edgeSet(stored.edges)) }
}
