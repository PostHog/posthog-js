import { startSnippet } from './runtime'

declare let __webpack_nonce__: string

// currentScript is only available during synchronous classic-script evaluation.
const script = document.currentScript as HTMLScriptElement | null
if (script?.nonce) __webpack_nonce__ = script.nonce
if (script?.src) void startSnippet(script.src, window)
