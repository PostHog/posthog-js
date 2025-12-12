import { isString, isObject } from './typeGuards'

const REDACTED_IMAGE_PLACEHOLDER = '[base64 image redacted]'

// ============================================
// Multimodal Feature Toggle
// ============================================

const isMultimodalEnabled = (): boolean => {
  const val = process.env._INTERNAL_LLMA_MULTIMODAL || ''
  return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes'
}

// ============================================
// Base64 Detection Helpers
// ============================================

const isBase64DataUrl = (str: string): boolean => {
  return /^data:([^;]+);base64,/.test(str)
}

const isValidUrl = (str: string): boolean => {
  try {
    new URL(str)
    return true
  } catch {
    // Not an absolute URL, check if it's a relative URL or path
    return str.startsWith('/') || str.startsWith('./') || str.startsWith('../')
  }
}

const isRawBase64 = (str: string): boolean => {
  // Skip if it's a valid URL or path
  if (isValidUrl(str)) {
    return false
  }

  // Check if it's a valid base64 string
  // Base64 images are typically at least a few hundred chars, but we'll be conservative
  return str.length > 20 && /^[A-Za-z0-9+/]+=*$/.test(str)
}

export function redactBase64DataUrl(str: string): string
export function redactBase64DataUrl(str: unknown): unknown
export function redactBase64DataUrl(str: unknown): unknown {
  if (isMultimodalEnabled()) return str
  if (!isString(str)) return str

  // Check for data URL format
  if (isBase64DataUrl(str)) {
    return REDACTED_IMAGE_PLACEHOLDER
  }

  // Check for raw base64 (Vercel sends raw base64 for inline images)
  if (isRawBase64(str)) {
    return REDACTED_IMAGE_PLACEHOLDER
  }

  return str
}

// ============================================
// Common Message Processing
// ============================================

type ContentTransformer = (item: unknown) => unknown

const processMessages = (messages: unknown, transformContent: ContentTransformer): unknown => {
  if (!messages) return messages

  const processContent = (content: unknown): unknown => {
    if (typeof content === 'string') return content

    if (!content) return content

    if (Array.isArray(content)) {
      return content.map(transformContent)
    }

    // Handle single object content
    return transformContent(content)
  }

  const processMessage = (msg: unknown): unknown => {
    if (!isObject(msg) || !('content' in msg)) return msg
    return { ...msg, content: processContent(msg.content) }
  }

  // Handle both arrays and single messages
  if (Array.isArray(messages)) {
    return messages.map(processMessage)
  }

  return processMessage(messages)
}

// ============================================
// Provider-Specific Image Sanitizers
// ============================================

const sanitizeOpenAIImage = (item: unknown): unknown => {
  if (!isObject(item)) return item

  // Handle image_url format
  if (item.type === 'image_url' && 'image_url' in item && isObject(item.image_url) && 'url' in item.image_url) {
    return {
      ...item,
      image_url: {
        ...item.image_url,
        url: redactBase64DataUrl(item.image_url.url),
      },
    }
  }

  // Handle audio format
  if (item.type === 'audio' && 'data' in item) {
    if (isMultimodalEnabled()) return item
    return { ...item, data: REDACTED_IMAGE_PLACEHOLDER }
  }

  return item
}

const sanitizeOpenAIResponseImage = (item: unknown): unknown => {
  if (!isObject(item)) return item

  // Handle input_image format
  if (item.type === 'input_image' && 'image_url' in item) {
    return {
      ...item,
      image_url: redactBase64DataUrl(item.image_url),
    }
  }

  return item
}

const sanitizeAnthropicImage = (item: unknown): unknown => {
  if (isMultimodalEnabled()) return item
  if (!isObject(item)) return item

  // Handle Anthropic's image and document formats (same structure, different type field)
  if (
    (item.type === 'image' || item.type === 'document') &&
    'source' in item &&
    isObject(item.source) &&
    item.source.type === 'base64' &&
    'data' in item.source
  ) {
    return {
      ...item,
      source: {
        ...item.source,
        data: REDACTED_IMAGE_PLACEHOLDER,
      },
    }
  }

  return item
}

const sanitizeGeminiPart = (part: unknown): unknown => {
  if (isMultimodalEnabled()) return part
  if (!isObject(part)) return part

  // Handle Gemini's inline data format (images, audio, PDFs all use inlineData)
  if ('inlineData' in part && isObject(part.inlineData) && 'data' in part.inlineData) {
    return {
      ...part,
      inlineData: {
        ...part.inlineData,
        data: REDACTED_IMAGE_PLACEHOLDER,
      },
    }
  }

  return part
}

const processGeminiItem = (item: unknown): unknown => {
  if (!isObject(item)) return item

  // If it has parts, process them
  if ('parts' in item && item.parts) {
    const parts = Array.isArray(item.parts) ? item.parts.map(sanitizeGeminiPart) : sanitizeGeminiPart(item.parts)

    return { ...item, parts }
  }

  return item
}

const sanitizeLangChainImage = (item: unknown): unknown => {
  if (!isObject(item)) return item

  // OpenAI style
  if (item.type === 'image_url' && 'image_url' in item && isObject(item.image_url) && 'url' in item.image_url) {
    return {
      ...item,
      image_url: {
        ...item.image_url,
        url: redactBase64DataUrl(item.image_url.url),
      },
    }
  }

  // Direct image with data field
  if (item.type === 'image' && 'data' in item) {
    return { ...item, data: redactBase64DataUrl(item.data) }
  }

  // Anthropic style
  if (item.type === 'image' && 'source' in item && isObject(item.source) && 'data' in item.source) {
    if (isMultimodalEnabled()) return item
    return {
      ...item,
      source: {
        ...item.source,
        data: redactBase64DataUrl(item.source.data),
      },
    }
  }

  // Google style
  if (item.type === 'media' && 'data' in item) {
    return { ...item, data: redactBase64DataUrl(item.data) }
  }

  return item
}

// Export individual sanitizers for tree-shaking
export const sanitizeOpenAI = (data: unknown): unknown => {
  return processMessages(data, sanitizeOpenAIImage)
}

export const sanitizeOpenAIResponse = (data: unknown): unknown => {
  return processMessages(data, sanitizeOpenAIResponseImage)
}

export const sanitizeAnthropic = (data: unknown): unknown => {
  return processMessages(data, sanitizeAnthropicImage)
}

export const sanitizeGemini = (data: unknown): unknown => {
  // Gemini has a different structure with 'parts' directly on items instead of 'content'
  // So we need custom processing instead of using processMessages
  if (!data) return data

  if (Array.isArray(data)) {
    return data.map(processGeminiItem)
  }

  return processGeminiItem(data)
}

export const sanitizeLangChain = (data: unknown): unknown => {
  return processMessages(data, sanitizeLangChainImage)
}
