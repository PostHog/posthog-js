import { resolve } from 'node:path'
import { typeContractDiagnostics } from './helpers/type-contract'

it.each([
    { sdk: 'browser', module: '../types', eventType: 'CaptureResult', configType: 'PostHogConfig' },
    { sdk: 'core', module: '../../../core/src/types', eventType: 'CaptureEvent', configType: 'PostHogCoreOptions' },
    { sdk: 'node', module: '../../../node/src/types', eventType: 'EventMessage', configType: 'PostHogOptions' },
])('$sdk before_send accepts non-null events and can return null', ({ module, eventType, configType }) => {
    const fixture = resolve(__dirname, 'before-send.fixture.ts')
    const source = `
        import type { BeforeSendFn, ${eventType}, ${configType} } from '${module}'

        const filter: BeforeSendFn = (event) => event.event === '$pageview' ? null : event
        const annotated: BeforeSendFn = (event: ${eventType}) => event
        const single: Pick<${configType}, 'before_send'> = {
            before_send: (event) => event.event === '$pageview' ? null : event,
        }
        const chained: Pick<${configType}, 'before_send'> = {
            before_send: [filter, annotated, (event) => event.event === '$pageview' ? null : event],
        }

        declare const event: ${eventType}
        const result: ${eventType} | null = filter(event)
        // @ts-expect-error A hook can drop the event.
        const accepted: ${eventType} = filter(event)
        // @ts-expect-error The SDK never invokes a hook with null.
        filter(null)
    `

    expect(typeContractDiagnostics(fixture, source)).toEqual([])
})
