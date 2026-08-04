import { BinaryContentRedactor } from './sanitization/binary_content_redactor'

const redactor = new BinaryContentRedactor()

export function redactBase64DataUrl(str: string, mediaType?: string): string
export function redactBase64DataUrl(str: unknown, mediaType?: string): unknown
export function redactBase64DataUrl(str: unknown, mediaType?: string): unknown {
  return redactor.redact(str, mediaType)
}

export const sanitizeOpenAI = (data: unknown): unknown => redactor.redact(data)
export const sanitizeOpenAIResponse = (data: unknown): unknown => redactor.redact(data)
export const sanitizeAnthropic = (data: unknown): unknown => redactor.redact(data)
export const sanitizeGemini = (data: unknown): unknown => redactor.redact(data)
export const sanitizeLangChain = (data: unknown): unknown => redactor.redact(data)
export const sanitizeVercel = (data: unknown): unknown => redactor.redact(data)
