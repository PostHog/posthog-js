import {
    createContext,
    createElement,
    useContext,
    useEffect,
    useMemo,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode,
} from 'react'
// Keep the renderer class external so separately bundled declarations share its private-member identity.
import type { PostHog, State, FeatureFlagValue, JsonType } from '@posthog/electron/renderer'

interface PostHogContextValue {
    client: PostHog
    state: State
}

const PostHogContext = createContext<PostHogContextValue | undefined>(undefined)

export interface PostHogProviderProps {
    client: PostHog
    children?: ReactNode
}

/** Uses an initialized renderer client; the caller retains ownership of its lifetime. */
export function PostHogProvider({ client, children }: PostHogProviderProps): ReactElement {
    const store = useMemo(() => {
        let snapshot = client.getState()
        return {
            getSnapshot: (): State => {
                const next = client.getState()
                // Renderer snapshots are clones: React needs the same object until the revision changes.
                if (next.revision !== snapshot.revision) {
                    // Unrelated SDK updates must not change object/array payload identities.
                    if (
                        next.generation === snapshot.generation &&
                        next.flagRevision === snapshot.flagRevision &&
                        next.flagsLoaded === snapshot.flagsLoaded
                    ) {
                        next.featureFlagPayloads = snapshot.featureFlagPayloads
                    }
                    snapshot = next
                }
                return snapshot
            },
            subscribe: (notify: () => void): (() => void) => client.onStateChange(() => notify()),
        }
    }, [client])
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    const value = useMemo(() => ({ client, state }), [client, state])
    return createElement(PostHogContext.Provider, { value }, children)
}

function usePostHogContext(): PostHogContextValue {
    const context = useContext(PostHogContext)
    if (!context) throw new Error('PostHog hooks require an @posthog/electron/react PostHogProvider')
    return context
}

export function usePostHog(): PostHog {
    return usePostHogContext().client
}

function useFlagValue(key: string): FeatureFlagValue | undefined {
    const { client, state } = usePostHogContext()
    const { generation, flagRevision, optedOut, featureFlags } = state
    useEffect(() => {
        const current = client.getState()
        // A layout effect may replace flags or identity before this committed render's passive effect.
        if (
            current.generation !== generation ||
            current.flagRevision !== flagRevision ||
            current.optedOut !== optedOut
        ) {
            return
        }
        // Main owns consent, exposure provenance and deduplication. Never emit during render.
        client.getFeatureFlag(key)
    }, [client, key, generation, flagRevision, optedOut])
    return Object.prototype.hasOwnProperty.call(featureFlags, key)
        ? featureFlags[key]
        : Object.keys(featureFlags).length > 0
          ? false
          : undefined
}

export function useFeatureFlagEnabled(key: string): boolean | undefined {
    const value = useFlagValue(key)
    return value === undefined ? undefined : Boolean(value)
}

export function useFeatureFlagVariantKey(key: string): FeatureFlagValue | undefined {
    return useFlagValue(key)
}

/** Payload-only reads do not report exposure. */
export function useFeatureFlagPayload(key: string): JsonType | undefined {
    const { state } = usePostHogContext()
    const payload = Object.prototype.hasOwnProperty.call(state.featureFlagPayloads, key)
        ? state.featureFlagPayloads[key]
        : undefined
    return payload === undefined ? (state.flagsLoaded ? null : undefined) : payload
}
