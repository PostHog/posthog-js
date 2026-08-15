import { SurveyActionType, SurveyEventType, SurveyEventWithFilters } from '../posthog-surveys-types'
import { ActionMatcher } from '../extensions/surveys/action-matcher'
import type { PostHog } from '../posthog-core'
import { CaptureResult } from '../types'
import { matchPropertyFilters } from '@posthog/browser-common/utils/property-utils'
import { isEmptyObject, isNumber, isUndefined } from '@posthog/core'
import { createLogger } from '@posthog/browser-common/utils/logger'

/**
 * Interface for items that can be triggered by events/actions.
 * Both Survey and ProductTour implement this interface.
 */
export interface EventTriggerable {
    id: string
    conditions?: {
        events?: { repeatedActivation?: boolean; values: SurveyEventWithFilters[] } | null
        cancelEvents?: { values: SurveyEventWithFilters[] } | null
        actions?: { values: SurveyActionType[] } | null
    } | null
}

/**
 * What a captured lifecycle event (shown / dismissed / sent) does to an already-activated item:
 * - `consume`: it's done — drop it from both the in-memory and persisted sets.
 * - `persist`: it was shown and should survive a reload — move it from memory into persistence.
 * - `ignore`: no transition for this item on this event.
 */
export type ActivationOutcome = 'consume' | 'persist' | 'ignore'

/**
 * Abstract base class for receiving events and matching them to triggerable items.
 * Subclasses implement type-specific behavior for surveys and product tours.
 */
export abstract class EventReceiver<T extends EventTriggerable> {
    // eventToItems is a mapping of event name to all the items that are activated by it
    protected _eventToItems: Map<string, string[]>
    // cancelEventToItems is a mapping of event name to all the items that should be cancelled by it
    protected _cancelEventToItems: Map<string, string[]>
    // actionToItems is a mapping of action name to all the items that are activated by it
    protected readonly _actionToItems: Map<string, string[]>
    // actionMatcher can look at CaptureResult payloads and match an event to its corresponding action.
    protected _actionMatcher?: ActionMatcher | null
    protected readonly _instance?: PostHog
    /**
     * Items armed by an event or action but not yet shown live here, in memory only.
     * They are intentionally NOT persisted, so they do not survive a page reload: an
     * event trigger only displays an item in the session the event fired in. Once an
     * item is shown, surviving items are promoted into persistence (see `onEvent`) so
     * a reload re-reads and re-displays them until the user interacts — but that
     * persisted activation is scoped to the triggering session (see
     * `_getPersistedActivatedIds`), so it does not leak into a brand-new session where
     * the trigger never fired.
     */
    private _pendingActivatedItems: string[] = []
    private _captureHookUnsubscribe?: () => void
    private _sessionIdUnsubscribe?: () => void

    constructor(instance: PostHog) {
        this._instance = instance
        this._eventToItems = new Map<string, string[]>()
        this._cancelEventToItems = new Map<string, string[]>()
        this._actionToItems = new Map<string, string[]>()

        // A persisted activation belongs to the session the item was shown in. When the session
        // rotates (idle timeout, max length, cross-tab adoption) the trigger did not fire in the
        // new session, so the activation is stale and must be dropped. We subscribe to rotations
        // here rather than relying only on reading the session id on the display path: that read
        // is read-only and so cannot observe an idle-expired session (and must not force a
        // rotation, since merely checking whether to show a survey should never keep a session
        // alive). The read-time check in `_getPersistedActivatedIds` remains as a complementary
        // backstop for a session that had already rotated in persistence before this page loaded.
        this._sessionIdUnsubscribe = this._instance?.onSessionId?.((sessionId) => this._onSessionIdChanged(sessionId))
    }

    // Abstract methods for subclasses to implement
    protected abstract _getActivatedKey(): string
    /** Persistence key under which the session id of the persisted activation set is stamped. */
    protected abstract _getActivatedSessionKey(): string
    protected abstract _getShownEventName(): string
    protected abstract _getItems(callback: (items: T[]) => void): void
    protected abstract _cancelPendingItem(itemId: string): void
    protected abstract _getLogger(): ReturnType<typeof createLogger>
    protected abstract _setActivatedItems(eligibleItems: string[]): void
    /** Persist the session id the current activation set belongs to. */
    protected abstract _setActivatedSession(sessionId: string): void
    /** Forget the persisted session stamp. */
    protected abstract _clearActivatedSession(): void
    /** Check if item is permanently ineligible (e.g. completed/dismissed). Skip adding to activated list. */
    protected abstract _isItemPermanentlyIneligible(itemId?: string): boolean

    /**
     * Decide what a captured lifecycle `event` does to an already-activated `itemId`. Most items are
     * consumed when shown (so they only reappear when their trigger fires again). Surveys keep
     * non-repeatable ones activated — promoting them to session-scoped persistence on shown — until the
     * user dismisses or answers them, so an event-triggered survey survives a reload within the
     * triggering session (but not a brand-new session) until it's actually interacted with.
     */
    protected abstract _activationOutcome(event: string, itemId: string): ActivationOutcome

    /**
     * Whether an item armed by a trigger should be persisted immediately (session-scoped)
     * instead of kept in memory until it is shown. Overridden by receivers whose items carry a
     * display delay that must survive a navigation, so the delay can resume from where it left
     * off on the next page. Default: keep in memory, so the arming is page-scoped and an
     * exit-intent-style trigger cannot leak an armed item onto a later page load.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected _shouldPersistArmedActivation(_itemId: string): boolean {
        return false
    }

    /**
     * Persistence key under which per-item activation timestamps are read from, or null for
     * receivers that don't track them. Used to resume a display delay across navigations. Writes
     * go through `_writeActivationTimestamps` / `_clearActivationTimestampsStore` so the register
     * sink always resolves to a literal key constant.
     */
    protected _getActivationTimestampsKey(): string | null {
        return null
    }

    /** Persist the activation timestamp map. Overridden by receivers that track timestamps. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected _writeActivationTimestamps(_timestamps: Record<string, number>): void {}

    /** Forget the whole activation timestamp map. Overridden by receivers that track timestamps. */
    protected _clearActivationTimestampsStore(): void {}

    private _doesEventMatchFilter(
        eventConfig: SurveyEventWithFilters | undefined,
        eventPayload?: CaptureResult
    ): boolean {
        if (!eventConfig) {
            return false
        }

        return matchPropertyFilters(eventConfig.propertyFilters, eventPayload?.properties)
    }

    private _buildEventToItemMap(items: T[], conditionField: SurveyEventType): Map<string, string[]> {
        const map = new Map<string, string[]>()
        items.forEach((item) => {
            item.conditions?.[conditionField]?.values?.forEach((event) => {
                if (event?.name) {
                    const existing = map.get(event.name) || []
                    existing.push(item.id)
                    map.set(event.name, existing)
                }
            })
        })
        return map
    }

    /**
     * build a map of (Event1) => [Item1, Item2, Item3]
     * used for items that should be [activated|cancelled] by Event1
     */
    private _getMatchingItems(
        eventName: string,
        eventPayload: CaptureResult | undefined,
        conditionField: SurveyEventType
    ): T[] {
        const itemIdMap = conditionField === SurveyEventType.Activation ? this._eventToItems : this._cancelEventToItems
        const itemIds = itemIdMap.get(eventName)

        let items: T[] = []
        this._getItems((allItems) => {
            items = allItems.filter((item) => itemIds?.includes(item.id))
        })

        return items.filter((item) => {
            const eventConfig = item.conditions?.[conditionField]?.values?.find((e) => e.name === eventName)
            return this._doesEventMatchFilter(eventConfig, eventPayload)
        })
    }

    register(items: T[]): void {
        this._register(items, false)
    }

    replace(items: T[]): void {
        this._register(items, true)
    }

    private _register(items: T[], replace: boolean): void {
        if (isUndefined(this._instance?._addCaptureHook)) {
            return
        }

        this._setupEventBasedItems(items, replace)
        this._setupActionBasedItems(items, replace)
    }

    private _setupActionBasedItems(items: T[], replace: boolean): void {
        const actionBasedItems = items.filter((item) => item.conditions?.actions?.values?.length)
        if (replace) {
            this._actionToItems.clear()
        }

        if (actionBasedItems.length === 0) {
            if (replace) {
                this._actionMatcher?.replace([])
            }
            return
        }

        if (!this._actionMatcher) {
            this._actionMatcher = new ActionMatcher(this._instance)
            this._actionMatcher.init()
            this._actionMatcher._addActionHook((actionName) => this.onAction(actionName))
        }

        const actions: SurveyActionType[] = []
        actionBasedItems.forEach((item) => {
            item.conditions?.actions?.values.forEach((action) => {
                actions.push(action)
                if (action.name) {
                    const matchingItems = this._actionToItems.get(action.name) ?? []
                    if (!matchingItems.includes(item.id)) {
                        matchingItems.push(item.id)
                    }
                    this._actionToItems.set(action.name, matchingItems)
                }
            })
        })
        if (replace) {
            this._actionMatcher.replace(actions)
        } else {
            this._actionMatcher.register(actions)
        }
    }

    private _mergeItemMaps(target: Map<string, string[]>, source: Map<string, string[]>): void {
        source.forEach((itemIds, eventName) => {
            const matchingItems = target.get(eventName) ?? []
            itemIds.forEach((itemId) => {
                if (!matchingItems.includes(itemId)) {
                    matchingItems.push(itemId)
                }
            })
            target.set(eventName, matchingItems)
        })
    }

    private _setupEventBasedItems(items: T[], replace: boolean): void {
        const eventBasedItems = items.filter(
            (item: T) => item.conditions?.events && item.conditions?.events?.values?.length > 0
        )

        const itemsWithCancelEvents = items.filter(
            (item: T) => item.conditions?.cancelEvents && item.conditions?.cancelEvents?.values?.length > 0
        )

        const eventToItems = this._buildEventToItemMap(items, SurveyEventType.Activation)
        const cancelEventToItems = this._buildEventToItemMap(items, SurveyEventType.Cancellation)
        if (replace) {
            this._eventToItems = eventToItems
            this._cancelEventToItems = cancelEventToItems
        } else {
            this._mergeItemMaps(this._eventToItems, eventToItems)
            this._mergeItemMaps(this._cancelEventToItems, cancelEventToItems)
        }
        if (eventBasedItems.length === 0 && itemsWithCancelEvents.length === 0) {
            return
        }

        // match any events to its corresponding item.
        const matchEventToItem = (eventName: string, eventPayload?: CaptureResult) => {
            this.onEvent(eventName, eventPayload)
        }
        this._captureHookUnsubscribe ??= this._instance?._addCaptureHook(matchEventToItem)
    }

    onEvent(event: string, eventPayload?: CaptureResult): void {
        const logger = this._getLogger()

        // An item reacting to one of its own lifecycle events (shown / dismissed / sent).
        const itemId = eventPayload?.properties?.$survey_id || eventPayload?.properties?.$product_tour_id
        if (itemId && this.getActivatedIds().includes(itemId)) {
            const outcome = this._activationOutcome(event, itemId)
            if (outcome === 'consume') {
                logger.info('event consumed activated item, removing it', { event, itemId })
                this._deactivateItems([itemId])
                return
            }
            if (outcome === 'persist') {
                logger.info('shown item promoted to persisted activation', { event, itemId })
                this._persistActivation(itemId)
                // The display delay has served its purpose once the item was shown, so drop the
                // activation time: a later page load in this session waits the full delay again
                // instead of re-rendering the item instantly on every navigation.
                this._clearActivationTimestamps([itemId])
                return
            }
            // 'ignore': no activation transition for this item on this event — fall through.
        }

        // check if this event should cancel any pending items
        if (this._cancelEventToItems.has(event)) {
            const itemsToCancel = this._getMatchingItems(event, eventPayload, SurveyEventType.Cancellation)

            if (itemsToCancel.length > 0) {
                logger.info('cancel event matched, cancelling items', {
                    event,
                    itemsToCancel: itemsToCancel.map((s) => s.id),
                })

                this._deactivateItems(itemsToCancel.map((item) => item.id))
                // cancel any pending timeout for these items
                itemsToCancel.forEach((item) => this._cancelPendingItem(item.id))
            }
        }

        // if the event is not in the eventToItems map, nothing else to do
        if (!this._eventToItems.has(event)) {
            return
        }

        logger.info('event name matched', {
            event,
            eventPayload,
            items: this._eventToItems.get(event),
        })

        const matchedItems = this._getMatchingItems(event, eventPayload, SurveyEventType.Activation)
        this._activateItems(matchedItems.map((item) => item.id))
    }

    onAction(actionName: string): void {
        if (this._actionToItems.has(actionName)) {
            this._activateItems(this._actionToItems.get(actionName) || [])
        }
    }

    /**
     * Arm items. Most are held in memory only (not persisted) until they are shown, so their
     * arming is page-scoped. Items that opt in via `_shouldPersistArmedActivation` (those with a
     * display delay) are persisted right away and stamped with the activation time, so the delay
     * survives a navigation and resumes from the elapsed time on the next page.
     */
    private _activateItems(itemIds: string[]): void {
        if (itemIds.length === 0) {
            return
        }
        // A persisted activation is scoped to the current session, so it can only be persisted
        // when a session id is resolvable. With none (e.g. cookieless mode) we keep the in-memory
        // arming — a reload can't be scoped anyway, so persisting would make it unreadable.
        const canPersist = !!this._instance?.get_session_id?.()
        const armedInMemory: string[] = []
        for (const itemId of itemIds) {
            if (canPersist && this._shouldPersistArmedActivation(itemId)) {
                if (this._persistActivation(itemId)) {
                    this._recordActivationTimestamp(itemId)
                }
            } else {
                armedInMemory.push(itemId)
            }
        }
        if (armedInMemory.length > 0) {
            this._pendingActivatedItems = [...new Set([...this._pendingActivatedItems, ...armedInMemory])]
        }
        this._getLogger().info('updating activated items', { activatedItems: this.getActivatedIds() })
    }

    /**
     * Move an in-memory activation into persistence so it survives a page reload within the
     * triggering session. The set is (re)stamped with the current session id; reading it back
     * via `_getPersistedActivatedIds` discards it once the session rolls over. Because we build
     * on top of the session-scoped read, a stale set left over from a previous session is
     * dropped here rather than accumulated.
     */
    private _persistActivation(itemId: string): boolean {
        this._pendingActivatedItems = this._pendingActivatedItems.filter((id) => id !== itemId)
        const persisted = this._getPersistedActivatedIds()
        if (persisted.includes(itemId)) {
            return false
        }
        this._setActivatedItems([...persisted, itemId])
        this._stampActivationSession()
        return true
    }

    /** Drop items from both the in-memory and persisted activation sets. */
    private _deactivateItems(itemIds: string[]): void {
        const remove = new Set(itemIds)
        this._pendingActivatedItems = this._pendingActivatedItems.filter((id) => !remove.has(id))
        const persisted = this._getRawPersistedActivatedIds()
        const nextPersisted = persisted.filter((id) => !remove.has(id))
        if (nextPersisted.length !== persisted.length) {
            this._setActivatedItems(nextPersisted)
            if (nextPersisted.length === 0) {
                this._clearActivationSession()
            }
        }
        this._clearActivationTimestamps(itemIds)
    }

    /** The raw persisted activation timestamps as stored, ignoring session scoping. */
    private _getRawActivationTimestamps(): Record<string, number> {
        const key = this._getActivationTimestampsKey()
        if (!key) {
            return {}
        }
        const stored = this._instance?.persistence?.props[key]
        return stored && typeof stored === 'object' ? (stored as Record<string, number>) : {}
    }

    /**
     * Stamp when an item enters persisted activation, so a resumed display delay can be computed
     * from the elapsed time on a later page load. Repeated triggers do not call this method because
     * `_persistActivation` returns false while the current activation is still live.
     */
    private _recordActivationTimestamp(itemId: string): void {
        const key = this._getActivationTimestampsKey()
        if (!key) {
            return
        }
        const timestamps = this._getRawActivationTimestamps()
        this._writeActivationTimestamps({ ...timestamps, [itemId]: Date.now() })
    }

    /** Drop the activation timestamps for the given items. */
    private _clearActivationTimestamps(itemIds: string[]): void {
        const key = this._getActivationTimestampsKey()
        if (!key) {
            return
        }
        const timestamps = this._getRawActivationTimestamps()
        const next: Record<string, number> = {}
        let changed = false
        for (const [id, ts] of Object.entries(timestamps)) {
            if (itemIds.includes(id)) {
                changed = true
            } else {
                next[id] = ts
            }
        }
        if (!changed) {
            return
        }
        if (isEmptyObject(next)) {
            this._clearActivationTimestampsStore()
            return
        }
        this._writeActivationTimestamps(next)
    }

    /** Forget all activation timestamps (e.g. on reset or a session rollover). */
    private _clearAllActivationTimestamps(): void {
        if (this._getActivationTimestampsKey()) {
            this._clearActivationTimestampsStore()
        }
    }

    /**
     * The time (epoch ms) an item was armed by its trigger, or undefined if none is recorded.
     * Session-scoped: a timestamp is only honored while its activation is still live for the
     * current session, so a stale entry left in persistence cannot resurrect an expired delay.
     */
    getActivationTimestamp(itemId: string): number | undefined {
        if (!this._getPersistedActivatedIds().includes(itemId)) {
            return undefined
        }
        const ts = this._getRawActivationTimestamps()[itemId]
        return isNumber(ts) ? ts : undefined
    }

    /** The raw persisted set as stored, ignoring session scoping. */
    private _getRawPersistedActivatedIds(): string[] {
        const activatedKey = this._getActivatedKey()
        const existingActivatedItems = this._instance?.persistence?.props[activatedKey]
        return existingActivatedItems ? existingActivatedItems : []
    }

    /**
     * The persisted activations that still belong to the current session. A persisted activation
     * is scoped to the session the item was shown in: an event/action trigger only earns a display
     * in the session it fired in, so once the session rolls over the activation is stale and must
     * not silently re-display the item in a brand-new session where the trigger never fired.
     */
    private _getPersistedActivatedIds(): string[] {
        const ids = this._getRawPersistedActivatedIds()
        if (ids.length === 0) {
            return []
        }
        const stampedSessionId = this._instance?.persistence?.props[this._getActivatedSessionKey()]
        // Read-only: this catches a session that had already rotated in persistence before this
        // page loaded (the stamped id no longer matches the current one). It intentionally does
        // NOT force a rotation of an idle-expired session — that case is handled by the
        // `onSessionId` subscription in the constructor, which clears the activation when the
        // session actually rotates on the next real event.
        const currentSessionId = this._instance?.get_session_id?.()
        // No resolvable session (e.g. cookieless mode) → treat the activation as un-scopable and
        // do not carry it across a reload.
        if (!currentSessionId || stampedSessionId !== currentSessionId) {
            return []
        }
        return ids
    }

    /** Stamp the persisted activation set with the current session id. */
    private _stampActivationSession(): void {
        const currentSessionId = this._instance?.get_session_id?.()
        if (currentSessionId) {
            this._setActivatedSession(currentSessionId)
        }
    }

    /** Forget the session stamp once nothing is persisted under it. */
    private _clearActivationSession(): void {
        this._clearActivatedSession()
    }

    /**
     * Drop a persisted activation once the session it was stamped under is no longer current.
     * Fired on session rotation (idle timeout, max length, cross-tab adoption) — the cases the
     * read-only session read on the display path cannot observe. Pending timers must also be
     * cancelled so a fresh trigger in the new session starts its full delay from the new timestamp.
     */
    private _onSessionIdChanged(sessionId: string): void {
        const stampedSessionId = this._instance?.persistence?.props[this._getActivatedSessionKey()]
        if (stampedSessionId && stampedSessionId !== sessionId) {
            const activatedItemIds = this._getRawPersistedActivatedIds()
            const activationTimestamps = this._getRawActivationTimestamps()
            if (activatedItemIds.length > 0) {
                this._setActivatedItems([])
                activatedItemIds
                    .filter((itemId) => isNumber(activationTimestamps[itemId]))
                    .forEach((itemId) => this._cancelPendingItem(itemId))
            }
            this._clearActivationSession()
            this._clearAllActivationTimestamps()
        }
    }

    getActivatedIds(): string[] {
        // The activated set is the union of in-memory (armed, not yet shown) and persisted
        // (shown and surviving) items. In-memory ones do not survive a reload by design.
        const all = [...new Set([...this._getPersistedActivatedIds(), ...this._pendingActivatedItems])]
        return all.filter((itemId) => !this._isItemPermanentlyIneligible(itemId))
    }

    /**
     * Clear all activations. Called on `posthog.reset()` so a logout or account switch
     * (without a full page reload) does not leave an event-armed item live for the next
     * user — the in-memory set would otherwise survive `persistence.clear()`.
     */
    dispose(): void {
        this._sessionIdUnsubscribe?.()
        this._sessionIdUnsubscribe = undefined
        this._captureHookUnsubscribe?.()
        this._captureHookUnsubscribe = undefined
        this._actionMatcher?.dispose()
        this._actionMatcher = undefined
    }

    reset(): void {
        this._pendingActivatedItems = []
        if (this._getRawPersistedActivatedIds().length > 0) {
            this._setActivatedItems([])
        }
        this._clearActivationSession()
        this._clearAllActivationTimestamps()
    }

    getEventToItemsMap(): Map<string, string[]> {
        return this._eventToItems
    }

    _getActionMatcher(): ActionMatcher | null | undefined {
        return this._actionMatcher
    }
}
