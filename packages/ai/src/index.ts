import { wrapVercelLanguageModel } from './vercel/middleware'
import { Prompts } from './prompts'
import { captureAiGeneration } from './captureAiGeneration'
import { AIEvent } from './utils'

export { wrapVercelLanguageModel as withTracing }
export { Prompts }
export { captureAiGeneration, AIEvent }
export { captureAiEvent, captureAiEventImmediate, isMultimodalCaptureEnabled } from './captureAiEvent'
export type { CaptureAiGenerationOptions } from './captureAiGeneration'
export type { MultimodalCaptureGate, AiLaneCapableClient } from './captureAiEvent'
export type { PromptResult, PromptRemoteResult, PromptCodeFallbackResult } from './types'
