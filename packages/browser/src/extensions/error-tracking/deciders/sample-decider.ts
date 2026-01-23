import { isNull } from '@posthog/core'
import type { Decider, DeciderContext } from './types'

export class SampleDecider implements Decider {
    readonly name = 'sample'

    private _context: DeciderContext | null = null
    private _sampleRate: number | null = null

    init(context: DeciderContext): void {
        this._context = context
        this._sampleRate = context.config?.sampleRate ?? null
    }

    shouldCapture(): boolean | null {
        if (isNull(this._sampleRate)) {
            return null
        }
        return Math.random() < this._sampleRate
    }
}
