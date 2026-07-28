import { isMultimodalCaptureEnabled, type MultimodalCaptureGate } from './captureAiEvent'
import { BinaryContentRedactor } from './sanitization/binary_content_redactor'

const redactor = new BinaryContentRedactor()

export function redactBase64DataUrl(str: string): string
export function redactBase64DataUrl(str: unknown): unknown
export function redactBase64DataUrl(str: unknown): unknown {
  return redactor.redact(str)
}

// Passthrough must return the input before any processing: media survives only if untouched.
const sanitize = (data: unknown, client?: MultimodalCaptureGate): unknown =>
  isMultimodalCaptureEnabled(client) ? data : redactor.redact(data)

export const sanitizeOpenAI = (data: unknown, client?: MultimodalCaptureGate): unknown => sanitize(data, client)
export const sanitizeOpenAIResponse = (data: unknown, client?: MultimodalCaptureGate): unknown => sanitize(data, client)
export const sanitizeAnthropic = (data: unknown, client?: MultimodalCaptureGate): unknown => sanitize(data, client)
export const sanitizeGemini = (data: unknown, client?: MultimodalCaptureGate): unknown => sanitize(data, client)
export const sanitizeLangChain = (data: unknown, client?: MultimodalCaptureGate): unknown => sanitize(data, client)
