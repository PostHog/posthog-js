import { isNull } from '@posthog/core'
import type { Trigger, LogFn } from './types'

export interface SampleTriggerOptions {
    readonly log: LogFn
}

export class SampleTrigger implements Trigger {
    readonly name = 'sample'

    private _sampleRate: number | null = null

    init(sampleRate: number | null, _options: SampleTriggerOptions): void {
        this._sampleRate = sampleRate
    }

    shouldCapture(): boolean | null {
        if (isNull(this._sampleRate)) {
            return null
        }
        return Math.random() < this._sampleRate
    }
}
