import type { Decider, DeciderContext } from './types'

/**
 * Sample Decider - simple random sampling.
 *
 * Returns false if sampled out, null if no sampling configured.
 */
export class SampleDecider implements Decider {
    readonly name = 'sample'

    private _context: DeciderContext | null = null
    private _sampleRate: number | null = null

    init(context: DeciderContext): void {
        this._context = context
        this._sampleRate = context.config.errorTracking?.sample_rate ?? null

        if (this._sampleRate !== null) {
            this._log('Initialized', { sampleRate: this._sampleRate })
        }
    }

    shouldCapture(): boolean | null {
        if (this._sampleRate === null) {
            return null
        }
        return Math.random() < this._sampleRate
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        this._context?.log(`[${this.name}] ${message}`, data)
    }
}
