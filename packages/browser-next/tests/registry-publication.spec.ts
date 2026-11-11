import type { Client } from '@posthog/browser-common'
import { ExtensionRegistry } from '../src/core/extensions/registry'

const logger = { error: vi.fn() } as unknown as Client['logger']
const create = () => new ExtensionRegistry(() => ({}) as Client, logger)

it('publishes installed owners to a new view once and removes its own getters on disposal', async () => {
    const registry = create()
    const first = { name: 'first', setup() {} }
    const second = { name: 'second', setup() {} }
    await registry.install(first)
    await registry.install(second)
    const view: { first?: typeof first; second?: typeof second } = {}
    registry.expose(view)
    const descriptor = Object.getOwnPropertyDescriptor(view, 'first')
    registry.expose(view)
    expect(Object.getOwnPropertyDescriptor(view, 'first')?.get).toBe(descriptor?.get)
    expect(view.first).toBe(first)
    expect(view.second).toBe(second)
    expect(Object.keys(view)).toEqual(['first', 'second'])
    await registry.dispose()
    expect('first' in view).toBe(false)
    expect('second' in view).toBe(false)
    const late = {}
    registry.expose(late)
    expect(Object.keys(late)).toEqual([])
})

it('removes partial publications when a new view conflicts and permits a later retry', async () => {
    const registry = create()
    const first = { name: 'first', setup() {} }
    const second = { name: 'second', setup() {} }
    await registry.install(first)
    await registry.install(second)
    const view: { first?: typeof first; second?: unknown } = { second: 'host capability' }
    expect(() => registry.expose(view)).toThrow('conflicts with a client capability')
    expect('first' in view).toBe(false)
    expect(view.second).toBe('host capability')
    expect(registry.get('first')).toBe(first)
    delete view.second
    registry.expose(view)
    expect(view.first).toBe(first)
    expect(view.second).toBe(second)
    await registry.dispose()
    expect(Object.keys(view)).toEqual([])
})
