import type { RemoteConfig } from '../../../types'
import type { Decider, DeciderContext, DeciderResult } from './types'

/**
 * Sample Decider - handles sampling based ingestion control.
 *
 * Logic:
 * - If no sample rate configured → no opinion
 * - Uses session ID to deterministically decide sampling
 * - Same session always gets same result (consistent experience)
 */
export class SampleDecider implements Decider {
    readonly name = 'sample'

    private _context: DeciderContext | null = null
    private _sampleRate: number | null = null
    private _cachedResult: boolean | null = null
    private _cachedSessionId: string | null = null

    init(context: DeciderContext, config: RemoteConfig): void {
        this._context = context
        this._sampleRate = config.errorTracking?.sample_rate ?? null

        // Reset cache on init
        this._cachedResult = null
        this._cachedSessionId = null

        if (this._sampleRate !== null) {
            this._log('Initialized', { sampleRate: this._sampleRate })
        }
    }

    evaluate(): DeciderResult | null {
        // No sample rate = no opinion
        if (this._sampleRate === null) {
            return null
        }

        const sampled = this._isSampled()

        return {
            shouldCapture: sampled,
            reason: sampled
                ? `Sampled in (rate: ${this._sampleRate})`
                : `Sampled out (rate: ${this._sampleRate})`,
        }
    }

    shutdown(): void {
        this._cachedResult = null
        this._cachedSessionId = null
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        this._context?.log(`[${this.name}] ${message}`, data)
    }

    private _isSampled(): boolean {
        if (this._sampleRate === null) {
            return true
        }

        const sessionId = this._context?.posthog?.get_session_id?.() ?? null
        if (!sessionId) {
            // No session = allow capture (fail open)
            return true
        }

        // Return cached result if session hasn't changed
        if (this._cachedSessionId === sessionId && this._cachedResult !== null) {
            return this._cachedResult
        }

        // Compute deterministic sample based on session ID
        const hash = this._hashString(sessionId)
        const normalizedHash = Math.abs(hash) / 2147483647 // Normalize to 0-1
        const sampled = normalizedHash < this._sampleRate

        // Cache result for this session
        this._cachedSessionId = sessionId
        this._cachedResult = sampled

        this._log('Sampling computed', {
            sessionId: sessionId.substring(0, 8) + '...', // Truncate for logging
            hash: normalizedHash.toFixed(4),
            sampleRate: this._sampleRate,
            sampled,
        })

        return sampled
    }

    /**
     * Simple string hash function.
     * Produces consistent results for the same input.
     */
    private _hashString(str: string): number {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i)
            hash = (hash << 5) - hash + char
            hash = hash & hash // Convert to 32-bit integer
        }
        return hash
    }
}
