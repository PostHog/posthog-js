import { startSnippet } from './runtime'

// currentScript is only available during synchronous classic-script evaluation.
const scriptUrl = (document.currentScript as HTMLScriptElement | null)?.src
if (scriptUrl) void startSnippet(scriptUrl, window)
