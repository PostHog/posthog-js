const MIME_HINT_KEYS = ['mediaType', 'media_type', 'mimeType', 'mime_type'] as const

const STRONG_CONTEXT_KEYS = new Set([
  'data',
  'file_data',
  'fileData',
  'image_url',
  'imageUrl',
  'video_url',
  'videoUrl',
  'audio',
  'audio_data',
  'audioData',
  'inline_data',
  'inlineData',
  'source',
  'result',
])

const STRONG_CONTEXT_TYPES = new Set([
  'image',
  'image_url',
  'input_image',
  'audio',
  'input_audio',
  'video',
  'video_url',
  'file',
  'input_file',
  'document',
  'media',
  'file-data',
])

const FILE_FAMILY_TYPES = new Set(['file', 'input_file', 'document', 'media', 'file-data'])

const KNOWN_AUDIO_FORMATS = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'webm'])

export class MediaTypeContext {
  static readonly EMPTY = new MediaTypeContext(undefined, undefined)

  constructor(
    private readonly parent: Record<string, unknown> | undefined,
    private readonly key: string | undefined
  ) {}

  inferMediaType(): string | undefined {
    return (
      this.inferFromSiblingMime() ?? this.inferFromSiblingFormat() ?? this.inferFromParentType() ?? this.inferFromKey()
    )
  }

  inferFromSiblingMime(): string | undefined {
    if (!this.parent) return undefined
    for (const hint of MIME_HINT_KEYS) {
      const v = this.parent[hint]
      if (typeof v === 'string') return v
    }
    return undefined
  }

  inferFromSiblingFormat(): string | undefined {
    if (!this.parent) return undefined
    const fmt = this.parent.format
    if (typeof fmt === 'string' && KNOWN_AUDIO_FORMATS.has(fmt.toLowerCase())) {
      return `audio/${fmt.toLowerCase()}`
    }
    return undefined
  }

  inferFromParentType(): string | undefined {
    if (!this.parent) return undefined
    const t = this.parent.type
    if (typeof t !== 'string') return undefined
    if (t === 'image' || t === 'image_url' || t === 'input_image') return 'image'
    if (t === 'audio' || t === 'input_audio') return 'audio'
    if (t === 'video' || t === 'video_url') return 'video'
    if (FILE_FAMILY_TYPES.has(t)) return 'application/octet-stream'
    return undefined
  }

  inferFromKey(): string | undefined {
    if (!this.key) return undefined
    const key = this.key.toLowerCase()
    if (key.includes('audio')) return 'audio'
    if (key.includes('video')) return 'video'
    if (key.includes('image')) return 'image'
    if (key.includes('file') || key.includes('document')) return 'application/octet-stream'
    return undefined
  }

  signalsBinary(): boolean {
    if (this.parent) {
      for (const hint of MIME_HINT_KEYS) {
        if (typeof this.parent[hint] === 'string') return true
      }
      const fmt = this.parent.format
      if (typeof fmt === 'string' && KNOWN_AUDIO_FORMATS.has(fmt.toLowerCase())) return true
      const t = this.parent.type
      if (typeof t === 'string' && STRONG_CONTEXT_TYPES.has(t)) return true
    }
    if (this.key && STRONG_CONTEXT_KEYS.has(this.key)) return true
    return false
  }
}
