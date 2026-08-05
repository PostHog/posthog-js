import {
    maskAttributeValue,
    resetStylesheetLoadTracking,
    stringifyRule,
    stringifyStylesheet,
} from '@posthog/rrweb-snapshot'
import type { MaskAttributeFn } from '@posthog/rrweb-snapshot'
import type {
    elementNode,
    serializedNodeWithId,
    adoptedStyleSheetCallback,
    adoptedStyleSheetParam,
    attributeMutation,
    mutationCallBack,
} from '@posthog/rrweb-types'
import { StyleSheetMirror } from '../utils'

export class StylesheetManager {
    private trackedLinkElements: WeakSet<HTMLLinkElement> = new WeakSet()
    private mutationCb: mutationCallBack
    private adoptedStyleSheetCb: adoptedStyleSheetCallback
    private maskAllElementAttributes: boolean
    private maskAttributeFn: MaskAttributeFn | undefined
    public styleMirror = new StyleSheetMirror()

    constructor(options: {
        mutationCb: mutationCallBack
        adoptedStyleSheetCb: adoptedStyleSheetCallback
        maskAllElementAttributes?: boolean
        maskAttributeFn?: MaskAttributeFn
    }) {
        this.mutationCb = options.mutationCb
        this.adoptedStyleSheetCb = options.adoptedStyleSheetCb
        this.maskAllElementAttributes = options.maskAllElementAttributes ?? false
        this.maskAttributeFn = options.maskAttributeFn
    }

    public attachLinkElement(linkEl: HTMLLinkElement, childSn: serializedNodeWithId) {
        if ('_cssText' in (childSn as elementNode).attributes)
            this.mutationCb({
                adds: [],
                removes: [],
                texts: [],
                attributes: [
                    {
                        id: childSn.id,
                        attributes: (childSn as elementNode).attributes as attributeMutation['attributes'],
                    },
                ],
            })

        this.trackLinkElement(linkEl)
    }

    /**
     * Inline a `<link rel=stylesheet>` that the full snapshot skipped because it
     * ran out of stylesheet budget, emitting the CSS as an attribute mutation.
     * Same shape as {@link attachLinkElement}, which already does this for sheets
     * that finish loading after the snapshot - the replayer swaps the link for a
     * `<style>` carrying `_cssText`.
     */
    public inlineDeferredLinkElement(linkEl: HTMLLinkElement, id: number) {
        if (id === -1 || !linkEl.isConnected) {
            // never made it into the mirror (slimDOM dropped it), or detached while we
            // were queued - either way a mutation for it would only make the replayer warn
            return
        }
        let cssText: string | null = null
        try {
            const sheet = linkEl.sheet
            if (sheet) {
                cssText = stringifyStylesheet(sheet)
            }
        } catch (e) {
            //
        }
        if (!cssText) {
            // nothing we can add; the link kept its href so replay still loads it remotely
            return
        }
        // The snapshot path masks _cssText inside serializeElementNode; this path
        // builds the value itself, so it has to mask it too.
        this.mutationCb({
            adds: [],
            removes: [],
            texts: [],
            attributes: [
                {
                    id,
                    attributes: {
                        _cssText: maskAttributeValue({
                            element: linkEl,
                            name: '_cssText',
                            value: cssText,
                            maskAllElementAttributes: this.maskAllElementAttributes,
                            maskAttributeFn: this.maskAttributeFn,
                        }),
                    },
                },
            ],
        })
    }

    public trackLinkElement(linkEl: HTMLLinkElement) {
        if (this.trackedLinkElements.has(linkEl)) return

        this.trackedLinkElements.add(linkEl)
        this.trackStylesheetInLinkElement(linkEl)
    }

    public adoptStyleSheets(sheets: CSSStyleSheet[] | readonly CSSStyleSheet[], hostId: number) {
        if (sheets.length === 0) return
        const adoptedStyleSheetData: adoptedStyleSheetParam = {
            id: hostId,
            styleIds: [] as number[],
        }
        const styles: NonNullable<adoptedStyleSheetParam['styles']> = []
        for (const sheet of sheets) {
            let styleId
            if (!this.styleMirror.has(sheet)) {
                styleId = this.styleMirror.add(sheet)
                styles.push({
                    styleId,
                    rules: Array.from(sheet.rules || CSSRule, (r, index) => ({
                        rule: stringifyRule(r, sheet.href),
                        index,
                    })),
                })
            } else styleId = this.styleMirror.getId(sheet)
            adoptedStyleSheetData.styleIds.push(styleId)
        }
        if (styles.length > 0) adoptedStyleSheetData.styles = styles
        this.adoptedStyleSheetCb(adoptedStyleSheetData)
    }

    public reset() {
        this.styleMirror.reset()
        this.trackedLinkElements = new WeakSet()
        resetStylesheetLoadTracking()
    }

    // TODO: take snapshot on stylesheet reload by applying event listener
    private trackStylesheetInLinkElement(_linkEl: HTMLLinkElement) {
        // linkEl.addEventListener('load', () => {
        //   // re-loaded, maybe take another snapshot?
        // });
    }
}
