import { SurveyActionType, SurveyEventType, SurveyEventWithFilters } from '../posthog-surveys-types'
import { ActionMatcher } from '../extensions/surveys/action-matcher'
import { PostHog } from '../posthog-core'
import { CaptureResult } from '../types'
import { matchPropertyFilters } from '@posthog/browser-common/utils/property-utils'
import { isUndefined } from '@posthog/core'
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
        this._instance?.onSessionId?.((sessionId) => this._onSessionIdChanged(sessionId))
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
        if (isUndefined(this._instance?._addCaptureHook)) {
            return
        }

        this._setupEventBasedItems(items)
        this._setupActionBasedItems(items)
    }

    private _setupActionBasedItems(items: T[]) {
        const actionBasedItems = items.filter(
            (item: T) => item.conditions?.actions && item.conditions?.actions?.values?.length > 0
        )

        if (actionBasedItems.length === 0) {
            return
        }

        if (this._actionMatcher == null) {
            this._actionMatcher = new ActionMatcher(this._instance)
            this._actionMatcher.init()
            // match any actions to its corresponding item.
            const matchActionToItem = (actionName: string) => {
                this.onAction(actionName)
            }

            this._actionMatcher._addActionHook(matchActionToItem)
        }

        actionBasedItems.forEach((item) => {
            if (
                item.conditions &&
                item.conditions?.actions &&
                item.conditions?.actions?.values &&
                item.conditions?.actions?.values?.length > 0
            ) {
                // register the known set of actions with
                // the action-matcher so it can match
                // events to actions
                this._actionMatcher?.register(item.conditions.actions.values)

                // maintain a mapping of (Action1) => [Item1, Item2, Item3]
                // where Items 1-3 are all activated by Action1
                item.conditions?.actions?.values?.forEach((action) => {
                    if (action && action.name) {
                        const knownItems: string[] | undefined = this._actionToItems.get(action.name)
                        if (knownItems) {
                            knownItems.push(item.id)
                        }
                        this._actionToItems.set(action.name, knownItems || [item.id])
                    }
                })
            }
        })
    }

    private _setupEventBasedItems(items: T[]) {
        const eventBasedItems = items.filter(
            (item: T) => item.conditions?.events && item.conditions?.events?.values?.length > 0
        )

        const itemsWithCancelEvents = items.filter(
            (item: T) => item.conditions?.cancelEvents && item.conditions?.cancelEvents?.values?.length > 0
        )

        if (eventBasedItems.length === 0 && itemsWithCancelEvents.length === 0) {
            return
        }

        // match any events to its corresponding item.
        const matchEventToItem = (eventName: string, eventPayload?: CaptureResult) => {
            this.onEvent(eventName, eventPayload)
        }
        this._instance?._addCaptureHook(matchEventToItem)

        this._eventToItems = this._buildEventToItemMap(items, SurveyEventType.Activation)
        this._cancelEventToItems = this._buildEventToItemMap(items, SurveyEventType.Cancellation)
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

    /** Arm items in memory only (not persisted) until they are shown. */
    private _activateItems(itemIds: string[]): void {
        if (itemIds.length === 0) {
            return
        }
        this._pendingActivatedItems = [...new Set([...this._pendingActivatedItems, ...itemIds])]
        this._getLogger().info('updating activated items', { activatedItems: this.getActivatedIds() })
    }

    /**
     * Move an in-memory activation into persistence so it survives a page reload within the
     * triggering session. The set is (re)stamped with the current session id; reading it back
     * via `_getPersistedActivatedIds` discards it once the session rolls over. Because we build
     * on top of the session-scoped read, a stale set left over from a previous session is
     * dropped here rather than accumulated.
     */
    private _persistActivation(itemId: string): void {
        this._pendingActivatedItems = this._pendingActivatedItems.filter((id) => id !== itemId)
        const persisted = this._getPersistedActivatedIds()
        if (!persisted.includes(itemId)) {
            this._setActivatedItems([...persisted, itemId])
            this._stampActivationSession()
        }
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
     * read-only session read on the display path cannot observe.
     */
    private _onSessionIdChanged(sessionId: string): void {
        const stampedSessionId = this._instance?.persistence?.props[this._getActivatedSessionKey()]
        if (stampedSessionId && stampedSessionId !== sessionId) {
            if (this._getRawPersistedActivatedIds().length > 0) {
                this._setActivatedItems([])
            }
            this._clearActivationSession()
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
    reset(): void {
        this._pendingActivatedItems = []
        if (this._getRawPersistedActivatedIds().length > 0) {
            this._setActivatedItems([])
        }
        this._clearActivationSession()
    }

    getEventToItemsMap(): Map<string, string[]> {
        return this._eventToItems
    }

    _getActionMatcher(): ActionMatcher | null | undefined {
        return this._actionMatcher
    }
}
