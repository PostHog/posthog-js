import { PostHog as Facade, type RendererOptions } from '../renderer'
import { createUtilityBridge } from './bridge'

export type { State, Properties, FeatureFlagValue, JsonType } from '../shared/protocol'
export type UtilityOptions = Pick<RendererOptions, 'onError'>

/** A trusted utility facade. Identity, consent, storage and delivery belong to main. */
export class PostHog extends Facade {
    constructor(options: UtilityOptions = {}) {
        if (!process.parentPort) throw new Error('PostHog utility requires Electron utilityProcess.parentPort')
        super(createUtilityBridge(process.parentPort), { onError: options.onError })
    }

    override dispose(): void {
        super.dispose()
        if (singleton === this) singleton = undefined
    }
}

let singleton: PostHog | undefined
let initializing: Promise<PostHog> | undefined

export function init(options: UtilityOptions = {}): Promise<PostHog> {
    if (initializing) return initializing
    if (singleton) return Promise.resolve(singleton)
    const client = new PostHog(options)
    initializing = client
        .ready()
        .then(() => {
            singleton = client
            return client
        })
        .catch((error: unknown) => {
            client.dispose()
            throw error
        })
        .finally(() => {
            initializing = undefined
        })
    return initializing
}
