import { BinaryContentRedactor } from './sanitization/binary_content_redactor'

const redactor = new BinaryContentRedactor()

export function redactBase64DataUrl(str: string): string
export function redactBase64DataUrl(str: unknown): unknown
export function redactBase64DataUrl(str: unknown): unknown {
  return redactor.redact(str)
}

export const sanitizeOpenAI = (data: unknown): unknown => redactor.redact(data)
export const sanitizeOpenAIResponse = (data: unknown): unknown => redactor.redact(data)
export const sanitizeAnthropic = (data: unknown): unknown => redactor.redact(data)
export const sanitizeGemini = (data: unknown): unknown => redactor.redact(data)
export const sanitizeLangChain = (data: unknown): unknown => redactor.redact(data)
