import { gzipSync, strFromU8, strToU8 } from 'fflate'
import { isArray } from '@posthog/core'

import { EventType, IncrementalSource, type eventWithTime, type fullSnapshotEvent } from './rrweb-types'
import { circularReferenceReplacer, estimateCompressedEventSize, estimateSize } from './sessionrecording-utils'
import { createLogger } from '../utils/logger'

const logger = createLogger('[SessionRecording]')

export type compressedFullSnapshotEvent = {
    type: typeof EventType.FullSnapshot
    data: string
}

export type compressedIncrementalSnapshotEvent = {
    type: typeof EventType.IncrementalSnapshot
    data: {
        source: IncrementalSource
        texts: string
        attributes: string
        removes: string
        adds: string
    }
}

export type compressedIncrementalStyleSnapshotEvent = {
    type: typeof EventType.IncrementalSnapshot
    data: {
        source: typeof IncrementalSource.StyleSheetRule
        id?: number
        styleId?: number
        replace?: string
        replaceSync?: string
        adds?: string
        removes?: string
    }
}

export type compressedEvent =
    | compressedIncrementalStyleSnapshotEvent
    | compressedFullSnapshotEvent
    | compressedIncrementalSnapshotEvent
export type compressedEventWithTime = compressedEvent & {
    timestamp: number
    delay?: number
    // marker for compression version
    cv: '2024-10'
}

/** Gzips text for a request body, without a modification time so equal bodies compress identically. */
export function gzipText(text: string): Uint8Array {
    return gzipSync(strToU8(text), { mtime: 0 })
}

export function gzipStringToString(serializedData: string): string {
    return strFromU8(gzipSync(strToU8(serializedData)), true)
}

export function serializeForCompression(data: unknown): string {
    try {
        // fast path: plain native stringify, since a replacer callback is expensive on
        // large snapshots and circular event data is rare
        return JSON.stringify(data)
    } catch (e) {
        // data past the engine's maximum string length is not something the replacer can
        // shorten, and the retry would build the string up to that limit all over again
        // before failing the same way - on unload that stall is paid before the final flush
        if (e instanceof RangeError) {
            throw e
        }
        // circular event data (e.g. a leaked instance graph) degrades gracefully to
        // '[Circular]' markers instead of throwing, the same two-step approach as jsonStringify
        return JSON.stringify(data, circularReferenceReplacer())
    }
}

export function gzipToString(data: unknown): string {
    return gzipStringToString(serializeForCompression(data))
}

let _gzippedEmptyArray: string | undefined

export function gzipField(data: unknown): string {
    if (isArray(data) && data.length === 0) {
        _gzippedEmptyArray = _gzippedEmptyArray ?? gzipToString([])
        return _gzippedEmptyArray
    }
    return gzipToString(data)
}

export function shouldCompressEvent(event: eventWithTime): boolean {
    return (
        event.type === EventType.FullSnapshot ||
        (event.type === EventType.IncrementalSnapshot &&
            (event.data.source === IncrementalSource.Mutation ||
                event.data.source === IncrementalSource.StyleSheetRule))
    )
}

export type CompressedEventResult = { event: eventWithTime | compressedEventWithTime; size: number }

export type CompressedMutationFields = Pick<
    compressedIncrementalSnapshotEvent['data'],
    'texts' | 'attributes' | 'removes' | 'adds'
>
export type CompressedStyleFields = Pick<compressedIncrementalStyleSnapshotEvent['data'], 'adds' | 'removes'>

export function compressedResult(event: compressedEventWithTime): CompressedEventResult {
    return { event, size: estimateCompressedEventSize(event) }
}

export function buildCompressedFullSnapshotEvent(
    event: fullSnapshotEvent & { timestamp: number; delay?: number },
    data: string
): compressedEventWithTime {
    return {
        ...event,
        data,
        cv: '2024-10',
    }
}

export function buildCompressedIncrementalEvent(
    event: eventWithTime,
    fields: CompressedMutationFields | CompressedStyleFields
): compressedEventWithTime {
    // reshapes rrweb incremental `data` into its compressed string-field variant — the
    // compiler cannot relate the incoming union member to the matching compressed member
    // oxlint-disable-next-line typescript/consistent-type-assertions
    return {
        ...event,
        cv: '2024-10' as const,
        data: {
            ...(event.data as Record<string, unknown>),
            ...fields,
        },
    } as compressedEventWithTime
}

/**
 * rrweb's packer takes an event and returns a string or the reverse on `unpack`.
 * but we want to be able to inspect metadata during ingestion.
 * and don't want to compress the entire event,
 * so we have a custom packer that only compresses part of some events
 *
 * returns the compressed event and its estimated JSON size,
 * avoiding a redundant JSON.stringify for size estimation
 */
export function compressEventSync(event: eventWithTime): CompressedEventResult {
    try {
        if (event.type === EventType.FullSnapshot) {
            return compressedResult(buildCompressedFullSnapshotEvent(event, gzipToString(event.data)))
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation) {
            return compressedResult(
                buildCompressedIncrementalEvent(event, {
                    texts: gzipField(event.data.texts),
                    attributes: gzipField(event.data.attributes),
                    removes: gzipField(event.data.removes),
                    adds: gzipField(event.data.adds),
                })
            )
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.StyleSheetRule) {
            return compressedResult(
                // absent fields stay present as undefined, as posthog-js has always sent them
                // oxlint-disable-next-line typescript/consistent-type-assertions
                buildCompressedIncrementalEvent(event, {
                    adds: event.data.adds ? gzipToString(event.data.adds) : undefined,
                    removes: event.data.removes ? gzipToString(event.data.removes) : undefined,
                } as CompressedStyleFields)
            )
        }
    } catch (e) {
        logger.warn('could not compress event - will use uncompressed event', e)
    }
    return { event, size: estimateSize(event) }
}
