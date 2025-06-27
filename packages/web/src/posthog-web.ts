import { version } from '../package.json'

import { PostHogCore, getFetch } from 'posthog-core'
import type {
  PostHogEventProperties,
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogPersistedProperty,
} from 'posthog-core'

import { getContext } from './context'
import { PostHogStorage, getStorage } from './storage'
import { PostHogOptions } from './types'
import { patch } from './patch'

export class PostHog extends PostHogCore {
  private _storage: PostHogStorage
  private _storageCache: any
  private _storageKey: string
  private _lastPathname: string = ''

  constructor(apiKey: string, options?: PostHogOptions) {
    super(apiKey, options)

    // posthog-js stores options in one object on
    this._storageKey = options?.persistence_name ? `ph_${options.persistence_name}` : `ph_${apiKey}_posthog`

    this._storage = getStorage(options?.persistence || 'localStorage', this.getWindow())
    this.setupBootstrap(options)

    if (options?.preloadFeatureFlags !== false) {
      this.reloadFeatureFlags()
    }

    if (options?.captureHistoryEvents && typeof window !== 'undefined') {
      this._lastPathname = window?.location?.pathname || ''
      this.setupHistoryEventTracking()
    }
  }

  private getWindow(): Window | undefined {
    return typeof window !== 'undefined' ? window : undefined
  }

  getPersistedProperty<T>(key: PostHogPersistedProperty): T | undefined {
    if (!this._storageCache) {
      this._storageCache = JSON.parse(this._storage.getItem(this._storageKey) || '{}') || {}
    }

    return this._storageCache[key]
  }

  setPersistedProperty<T>(key: PostHogPersistedProperty, value: T | null): void {
    if (!this._storageCache) {
      this._storageCache = JSON.parse(this._storage.getItem(this._storageKey) || '{}') || {}
    }

    if (value === null) {
      delete this._storageCache[key]
    } else {
      this._storageCache[key] = value
    }

    this._storage.setItem(this._storageKey, JSON.stringify(this._storageCache))
  }

  fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
    const fetchFn = getFetch()

    if (!fetchFn) {
      // error will be handled by the caller (fetchWithRetry)
      return Promise.reject(new Error('Fetch API is not available in this environment.'))
    }

    return fetchFn(url, options)
  }

  getLibraryId(): string {
    return 'posthog-js-lite'
  }

  getLibraryVersion(): string {
    return version
  }

  getCustomUserAgent(): void {
    return
  }

  getCommonEventProperties(): PostHogEventProperties {
    return {
      ...super.getCommonEventProperties(),
      ...getContext(this.getWindow()),
    }
  }

  private setupHistoryEventTracking(): void {
    const window = this.getWindow()
    if (!window) {
      return
    }

    // Old fashioned, we could also use arrow functions but I think the closure for a patch is more reliable
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this

    patch(window.history, 'pushState', (originalPushState) => {
      return function patchedPushState(this: History, state: any, title: string, url?: string | URL | null): void {
        ;(originalPushState as History['pushState']).call(this, state, title, url)
        self.captureNavigationEvent('pushState')
      }
    })

    patch(window.history, 'replaceState', (originalReplaceState) => {
      return function patchedReplaceState(this: History, state: any, title: string, url?: string | URL | null): void {
        ;(originalReplaceState as History['replaceState']).call(this, state, title, url)
        self.captureNavigationEvent('replaceState')
      }
    })

    // For popstate we need to listen to the event instead of overriding a method
    window.addEventListener('popstate', () => {
      this.captureNavigationEvent('popstate')
    })
  }

  private captureNavigationEvent(navigationType: 'pushState' | 'replaceState' | 'popstate'): void {
    const window = this.getWindow()
    if (!window) {
      return
    }

    const currentPathname = window.location.pathname

    // Only capture pageview if the pathname has changed
    if (currentPathname !== this._lastPathname) {
      this.capture('$pageview', { navigation_type: navigationType })
      this._lastPathname = currentPathname
    }
  }
}
