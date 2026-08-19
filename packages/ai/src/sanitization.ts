import { isFullAiCaptureEnabled, type FullAiCaptureGate } from './captureAiEvent'
import { BinaryContentRedactor } from './sanitization/binary_content_redactor'

const redactor = new BinaryContentRedactor()

export function redactBase64DataUrl(str: string, mediaType?: string): string
export function redactBase64DataUrl(str: unknown, mediaType?: string): unknown
export function redactBase64DataUrl(str: unknown, mediaType?: string): unknown {
  return redactor.redact(str, mediaType)
}

const sanitize = (data: unknown, client?: FullAiCaptureGate): unknown =>
  isFullAiCaptureEnabled(client) ? data : redactor.redact(data)

export const sanitizeOpenAI = (data: unknown, client?: FullAiCaptureGate): unknown => sanitize(data, client)
export const sanitizeOpenAIResponse = (data: unknown, client?: FullAiCaptureGate): unknown => sanitize(data, client)
export const sanitizeAnthropic = (data: unknown, client?: FullAiCaptureGate): unknown => sanitize(data, client)
export const sanitizeGemini = (data: unknown, client?: FullAiCaptureGate): unknown => sanitize(data, client)
export const sanitizeLangChain = (data: unknown, client?: FullAiCaptureGate): unknown => sanitize(data, client)
export const sanitizeVercel = (data: unknown, client?: FullAiCaptureGate): unknown => sanitize(data, client)
