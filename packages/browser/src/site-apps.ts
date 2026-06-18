import type { Extension } from './extensions/types'
import { PostHog } from './posthog-core'
import { isNull } from '@posthog/core'
import { CaptureResult, Properties, RemoteConfig, SiteApp, SiteAppGlobals, SiteAppLoader } from './types'
import { assignableWindow, document } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'

const logger = createLogger('[SiteApps]')
const APP_INIT_ERROR = 'Error while initializing PostHog app with config id '

export class SiteApps implements Extension {
    apps: Record<string, SiteApp>

    private _stopBuffering?: () => void
    private _bufferedInvocations: SiteAppGlobals[]
    private _siteAppElementPatchCount = 0
    private _restoreSiteAppElementPatches?: () => void

    constructor(private _instance: PostHog) {
        // events captured between loading posthog-js and the site app; up to 1000 events
        this._bufferedInvocations = []
        this.apps = {}
    }

    public get isEnabled(): boolean {
        return !!this._instance.config.opt_in_site_apps
    }

    private _eventCollector(_eventName: string, eventPayload?: CaptureResult | undefined) {
        if (!eventPayload) {
            return
        }
        const globals = this.globalsForEvent(eventPayload)
        this._bufferedInvocations.push(globals)
        if (this._bufferedInvocations.length > 1000) {
            this._bufferedInvocations = this._bufferedInvocations.slice(10)
        }
    }

    get siteAppLoaders(): SiteAppLoader[] | undefined {
        return assignableWindow._POSTHOG_REMOTE_CONFIG?.[this._instance.config.token]?.siteApps
    }

    initialize() {
        if (this.isEnabled) {
            const stop = this._instance._addCaptureHook(this._eventCollector.bind(this))
            this._stopBuffering = () => {
                stop()
                this._bufferedInvocations = []
                this._stopBuffering = undefined
            }
        }
    }

    globalsForEvent(event: CaptureResult): SiteAppGlobals {
        if (!event) {
            throw new Error('Event payload is required')
        }
        const groups: SiteAppGlobals['groups'] = {}
        const groupIds = this._instance.get_property('$groups') || []
        const groupProperties: Record<string, Properties> =
            this._instance.get_property('$stored_group_properties') || {}
        for (const [type, properties] of Object.entries(groupProperties)) {
            groups[type] = { id: groupIds[type], type, properties }
        }
        const { $set_once, $set, ..._event } = event
        const globals = {
            event: {
                ..._event,
                properties: {
                    ...event.properties,
                    ...($set ? { $set: { ...(event.properties?.$set ?? {}), ...$set } } : {}),
                    ...($set_once ? { $set_once: { ...(event.properties?.$set_once ?? {}), ...$set_once } } : {}),
                },
                elements_chain: event.properties?.['$elements_chain'] ?? '',
                // TODO:
                // - elements_chain_href: '',
                // - elements_chain_texts: [] as string[],
                // - elements_chain_ids: [] as string[],
                // - elements_chain_elements: [] as string[],
                distinct_id: event.properties?.['distinct_id'],
            },
            person: {
                properties: this._instance.get_property('$stored_person_properties'),
            },
            groups,
        }
        return globals
    }

    private _prepareElementForSiteApp<T extends Node>(element: T): T | null {
        const tagName = (element as unknown as Element).tagName?.toLowerCase()
        if (tagName === 'style' && this._instance.config.prepare_external_dependency_stylesheet) {
            const prepared = this._instance.config.prepare_external_dependency_stylesheet(
                element as Node as HTMLStyleElement
            )
            if (!prepared) {
                logger.error('prepare_external_dependency_stylesheet returned null')
                return null
            }
            return prepared as Node as T
        }
        if (tagName === 'script' && this._instance.config.prepare_external_dependency_script) {
            const prepared = this._instance.config.prepare_external_dependency_script(
                element as Node as HTMLScriptElement
            )
            if (!prepared) {
                logger.error('prepare_external_dependency_script returned null')
                return null
            }
            return prepared as Node as T
        }
        return element
    }

    private _patchSiteAppElementInsertionMethods(): () => void {
        if (
            !this._instance.config.prepare_external_dependency_stylesheet &&
            !this._instance.config.prepare_external_dependency_script
        ) {
            return () => {}
        }

        const win = document?.defaultView
        const nodePrototype = win?.Node?.prototype
        if (!win || !nodePrototype) {
            return () => {}
        }

        this._siteAppElementPatchCount++

        if (this._restoreSiteAppElementPatches) {
            return this._releaseSiteAppElementPatches()
        }

        const restore: (() => void)[] = []
        const siteApps = this
        const preparedNodes = new WeakSet<Node>()
        const patch = (
            prototype: Record<string, any> | undefined,
            method: string,
            replacement: (original: (...args: any[]) => any) => (...args: any[]) => any
        ) => {
            if (!prototype?.[method]) {
                return
            }
            const original = prototype[method]
            prototype[method] = replacement(original)
            restore.push(() => {
                prototype[method] = original
            })
        }
        const prepareNode = <N extends Node>(node: N): N | null => {
            if (preparedNodes.has(node)) {
                return node
            }
            const prepared = siteApps._prepareElementForSiteApp(node)
            if (prepared) {
                preparedNodes.add(prepared)
            }
            return prepared
        }
        const prepareNodes = (nodes: (Node | string)[]): (Node | string)[] =>
            nodes
                .map((node) => (typeof node === 'string' ? node : prepareNode(node)))
                .filter((node): node is Node | string => !isNull(node))

        patch(
            nodePrototype,
            'appendChild',
            (original) =>
                function (this: Node, child: Node) {
                    const prepared = prepareNode(child)
                    return prepared ? original.call(this, prepared) : child
                }
        )
        patch(
            nodePrototype,
            'insertBefore',
            (original) =>
                function (this: Node, newChild: Node, refChild: Node | null) {
                    const prepared = prepareNode(newChild)
                    return prepared ? original.call(this, prepared, refChild) : newChild
                }
        )
        patch(
            nodePrototype,
            'replaceChild',
            (original) =>
                function (this: Node, newChild: Node, oldChild: Node) {
                    const prepared = prepareNode(newChild)
                    return prepared ? original.call(this, prepared, oldChild) : oldChild
                }
        )
        ;[win.Element?.prototype, win.Document?.prototype, win.DocumentFragment?.prototype].forEach((prototype) => {
            patch(
                prototype,
                'append',
                (original) =>
                    function (this: ParentNode, ...nodes: (Node | string)[]) {
                        return original.apply(this, prepareNodes(nodes))
                    }
            )
            patch(
                prototype,
                'prepend',
                (original) =>
                    function (this: ParentNode, ...nodes: (Node | string)[]) {
                        return original.apply(this, prepareNodes(nodes))
                    }
            )
        })
        ;[win.Element?.prototype, win.CharacterData?.prototype, win.DocumentType?.prototype].forEach((prototype) => {
            patch(
                prototype,
                'before',
                (original) =>
                    function (this: ChildNode, ...nodes: (Node | string)[]) {
                        return original.apply(this, prepareNodes(nodes))
                    }
            )
            patch(
                prototype,
                'after',
                (original) =>
                    function (this: ChildNode, ...nodes: (Node | string)[]) {
                        return original.apply(this, prepareNodes(nodes))
                    }
            )
            patch(
                prototype,
                'replaceWith',
                (original) =>
                    function (this: ChildNode, ...nodes: (Node | string)[]) {
                        const prepared = prepareNodes(nodes)
                        return nodes.length && !prepared.length ? undefined : original.apply(this, prepared)
                    }
            )
        })
        patch(
            win.Element?.prototype,
            'insertAdjacentElement',
            (original) =>
                function (this: Element, position: InsertPosition, insertedElement: Element) {
                    const prepared = prepareNode(insertedElement)
                    return prepared ? original.call(this, position, prepared) : null
                }
        )

        this._restoreSiteAppElementPatches = () => {
            restore.forEach((restore) => restore())
            this._restoreSiteAppElementPatches = undefined
        }

        return this._releaseSiteAppElementPatches()
    }

    private _releaseSiteAppElementPatches(): () => void {
        let released = false
        return () => {
            if (released) {
                return
            }
            released = true
            this._siteAppElementPatchCount--
            if (this._siteAppElementPatchCount === 0) {
                this._restoreSiteAppElementPatches?.()
            }
        }
    }

    private _runWithPreparedSiteAppElements<T>(callback: (restore: () => void) => T, restoreSynchronously = true): T {
        const restore = this._patchSiteAppElementInsertionMethods()
        try {
            const result = callback(restore)
            if (restoreSynchronously) {
                restore()
            }
            return result
        } catch (e) {
            restore()
            throw e
        }
    }

    setupSiteApp(loader: SiteAppLoader) {
        const app = this.apps[loader.id]
        const processBufferedEvents = () => {
            if (!app.errored && this._bufferedInvocations.length) {
                logger.info(`Processing ${this._bufferedInvocations.length} events for site app with id ${loader.id}`)
                this._bufferedInvocations.forEach((globals) =>
                    this._runWithPreparedSiteAppElements(() => app.processEvent?.(globals))
                )
                app.processedBuffer = true
            }

            if (Object.values(this.apps).every((app) => app.processedBuffer || app.errored)) {
                this._stopBuffering?.()
            }
        }

        let hasInitReturned = false
        const onLoaded = (success: boolean) => {
            app.errored = !success
            app.loaded = true
            logger.info(`Site app with id ${loader.id} ${success ? 'loaded' : 'errored'}`)
            // ensure that we don't call processBufferedEvents until after init() returns and we've set up processEvent
            if (hasInitReturned) {
                processBufferedEvents()
            }
        }

        try {
            const { processEvent } = this._runWithPreparedSiteAppElements(
                (restore) =>
                    loader.init({
                        posthog: this._instance,
                        callback: (success) => {
                            restore()
                            onLoaded(success)
                        },
                    }),
                false
            )
            if (processEvent) {
                app.processEvent = processEvent
            }
            hasInitReturned = true
        } catch (e) {
            logger.error(APP_INIT_ERROR + loader.id, e)
            onLoaded(false)
        }

        // if the app loaded synchronously, process the events now
        if (hasInitReturned && app.loaded) {
            try {
                processBufferedEvents()
            } catch (e) {
                logger.error(`Error while processing buffered events PostHog app with config id ${loader.id}`, e)
                app.errored = true
            }
        }
    }

    private _setupSiteApps() {
        const siteAppLoaders = this.siteAppLoaders || []

        // do this in 2 passes, so that this.apps is populated before we call init
        for (const loader of siteAppLoaders) {
            this.apps[loader.id] = {
                id: loader.id,
                loaded: false,
                errored: false,
                processedBuffer: false,
            }
        }
        for (const loader of siteAppLoaders) {
            this.setupSiteApp(loader)
        }
    }

    private _onCapturedEvent(event: CaptureResult) {
        if (Object.keys(this.apps).length === 0) {
            return
        }

        const globals = this.globalsForEvent(event)

        for (const app of Object.values(this.apps)) {
            try {
                this._runWithPreparedSiteAppElements(() => app.processEvent?.(globals))
            } catch (e) {
                logger.error(`Error while processing event ${event.event} for site app ${app.id}`, e)
            }
        }
    }

    onRemoteConfig(response: RemoteConfig): void {
        if (this.siteAppLoaders?.length) {
            if (!this.isEnabled) {
                logger.error(`PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.`)
                return
            }

            this._setupSiteApps()

            // NOTE: We could improve this to only fire if we actually have listeners for the event
            this._instance.on('eventCaptured', (event) => this._onCapturedEvent(event))

            return
        }

        // NOTE: Below this is now only the fallback for legacy site app support. Once we have fully removed to the remote config loader we can get rid of this

        this._stopBuffering?.()

        if (!response['siteApps']?.length) {
            return
        }

        if (!this.isEnabled) {
            logger.error(`PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.`)
            return
        }

        for (const { id, url } of response['siteApps']) {
            assignableWindow[`__$$ph_site_app_${id}`] = this._instance
            assignableWindow.__PosthogExtensions__?.loadSiteApp?.(this._instance, url, (err) => {
                if (err) {
                    return logger.error(APP_INIT_ERROR + id, err)
                }
            })
        }
    }
}
