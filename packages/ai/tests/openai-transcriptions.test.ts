import { PostHog } from 'posthog-node'
import PostHogOpenAI from '../src/openai'
import openaiModule from 'openai'
import { flushPromises } from './test-utils'
import { version } from '../package.json'
import type { Transcription, TranscriptionVerbose } from 'openai/resources/audio/transcriptions'

let mockTranscriptionResponse: Transcription = {} as Transcription
let mockTranscriptionVerboseResponse: TranscriptionVerbose = {} as TranscriptionVerbose

jest.mock('posthog-node', () => {
  return {
    PostHog: jest.fn().mockImplementation(() => {
      return {
        capture: jest.fn(),
        captureImmediate: jest.fn(),
        privacy_mode: false,
      }
    }),
  }
})

jest.mock('openai', () => {
  // Mock Completions class
  class MockCompletions {
    constructor() {}
    create(..._args: any[]): any {
      return undefined
    }
  }

  // Mock Chat class
  class MockChat {
    constructor() {}
    static Completions = MockCompletions
  }

  // Mock Responses class
  class MockResponses {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
    parse() {
      return Promise.resolve({})
    }
  }

  // Mock Embeddings class
  class MockEmbeddings {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
  }

  // Mock Transcriptions class
  class MockTranscriptions {
    constructor() {}
    create() {
      return Promise.resolve({})
    }
  }

  // Mock Audio class
  class MockAudio {
    constructor() {}
    static Transcriptions = MockTranscriptions
  }

  // Mock OpenAI class
  class MockOpenAI {
    chat: any
    embeddings: any
    responses: any
    audio: any
    constructor() {
      this.chat = {
        completions: {
          create: jest.fn(),
        },
      }
      this.embeddings = {
        create: jest.fn(),
      }
      this.responses = {
        create: jest.fn(),
      }
      this.audio = {
        transcriptions: {
          create: jest.fn(),
        },
      }
    }
    static Chat = MockChat
    static Responses = MockResponses
    static Embeddings = MockEmbeddings
    static Audio = MockAudio
  }

  return {
    __esModule: true,
    default: MockOpenAI,
    OpenAI: MockOpenAI,
    Chat: MockChat,
    Responses: MockResponses,
    Embeddings: MockEmbeddings,
    Audio: MockAudio,
  }
})

describe('PostHogOpenAI - Transcriptions', () => {
  let mockPostHogClient: PostHog
  let client: PostHogOpenAI

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️ Skipping OpenAI transcription tests: No OPENAI_API_KEY environment variable set')
    }
  })

  beforeEach(() => {
    // Skip all tests if no API key is present
    if (!process.env.OPENAI_API_KEY) {
      return
    }

    jest.clearAllMocks()

    mockPostHogClient = new (PostHog as any)()
    client = new PostHogOpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
      posthog: mockPostHogClient as any,
    })

    // Default transcription response (JSON format)
    mockTranscriptionResponse = {
      text: 'Hello, this is a test transcription.',
    }

    // Default verbose transcription response
    mockTranscriptionVerboseResponse = {
      language: 'english',
      duration: 2.5,
      text: 'Hello, this is a test transcription.',
      words: [
        {
          word: 'Hello',
          start: 0.0,
          end: 0.5,
        },
        {
          word: 'this',
          start: 0.5,
          end: 0.8,
        },
      ],
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0.0,
          end: 2.5,
          text: 'Hello, this is a test transcription.',
          tokens: [1, 2, 3, 4, 5],
          temperature: 0.0,
          avg_logprob: -0.5,
          compression_ratio: 1.0,
          no_speech_prob: 0.01,
        },
      ],
    }

    // Mock the Audio.Transcriptions.prototype.create method
    const AudioMock: any = openaiModule.Audio
    const TranscriptionsMock = AudioMock.Transcriptions
    TranscriptionsMock.prototype.create = jest.fn().mockResolvedValue(mockTranscriptionResponse)
  })

  const conditionalTest = process.env.OPENAI_API_KEY ? test : test.skip

  conditionalTest('basic transcription', async () => {
    // Create a mock file object
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    const response = await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      posthogDistinctId: 'test-transcription-user',
      posthogProperties: { test: 'transcription' },
    })

    expect(response).toEqual(mockTranscriptionResponse)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, event, properties } = captureArgs[0]

    expect(distinctId).toBe('test-transcription-user')
    expect(event).toBe('$ai_generation')
    expect(properties['$ai_lib']).toBe('posthog-ai')
    expect(properties['$ai_lib_version']).toBe(version)
    expect(properties['$ai_provider']).toBe('openai')
    expect(properties['$ai_model']).toBe('whisper-1')
    expect(properties['$ai_output_choices']).toBe('Hello, this is a test transcription.')
    expect(properties['$ai_http_status']).toBe(200)
    expect(properties['test']).toBe('transcription')
    expect(typeof properties['$ai_latency']).toBe('number')
    expect(properties['$ai_input_tokens']).toBe(0)
    expect(properties['$ai_output_tokens']).toBe(0)
  })

  conditionalTest('transcription with prompt', async () => {
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      prompt: 'This is a test prompt to guide transcription.',
      posthogDistinctId: 'test-user',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_input']).toBe('This is a test prompt to guide transcription.')
  })

  conditionalTest('transcription with language parameter', async () => {
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      language: 'en',
      posthogDistinctId: 'test-user',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_model_parameters']).toMatchObject({
      language: 'en',
    })
  })

  conditionalTest('transcription verbose json format', async () => {
    // Update mock to return verbose response
    const AudioMock: any = openaiModule.Audio
    const TranscriptionsMock = AudioMock.Transcriptions
    TranscriptionsMock.prototype.create = jest.fn().mockResolvedValue(mockTranscriptionVerboseResponse)

    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    const response = await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      posthogDistinctId: 'test-verbose-user',
    })

    expect(response).toEqual(mockTranscriptionVerboseResponse)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)

    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_output_choices']).toBe('Hello, this is a test transcription.')
    expect(properties['$ai_model_parameters']).toMatchObject({
      response_format: 'verbose_json',
    })
  })

  conditionalTest('transcription privacy mode', async () => {
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      prompt: 'Sensitive prompt',
      posthogDistinctId: 'test-user',
      posthogPrivacyMode: true,
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_input']).toBeNull()
    expect(properties['$ai_output_choices']).toBeNull()
  })

  conditionalTest('transcription with usage tokens', async () => {
    // Mock response with usage information
    const responseWithUsage = {
      text: 'Hello, this is a test transcription.',
      usage: {
        type: 'tokens' as const,
        input_tokens: 150,
        output_tokens: 50,
      },
    }

    const AudioMock: any = openaiModule.Audio
    const TranscriptionsMock = AudioMock.Transcriptions
    TranscriptionsMock.prototype.create = jest.fn().mockResolvedValue(responseWithUsage)

    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      posthogDistinctId: 'test-user',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_input_tokens']).toBe(150)
    expect(properties['$ai_output_tokens']).toBe(50)
  })

  conditionalTest('transcription error handling', async () => {
    const AudioMock: any = openaiModule.Audio
    const TranscriptionsMock = AudioMock.Transcriptions
    const testError = new Error('API Error') as Error & { status: number }
    testError.status = 400
    TranscriptionsMock.prototype.create = jest.fn().mockRejectedValue(testError)

    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await expect(
      client.audio.transcriptions.create({
        file: mockFile,
        model: 'whisper-1',
        posthogDistinctId: 'error-user',
      })
    ).rejects.toThrow('API Error')

    // Verify error was captured
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { properties } = captureArgs[0]

    expect(properties['$ai_http_status']).toBe(400)
    expect(properties['$ai_is_error']).toBe(true)
    expect(properties['$ai_error']).toContain('400')
  })

  conditionalTest('transcription captureImmediate flag', async () => {
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      posthogDistinctId: 'test-user',
      posthogCaptureImmediate: true,
    })

    // captureImmediate should be called once, and capture should not be called
    expect(mockPostHogClient.captureImmediate).toHaveBeenCalledTimes(1)
    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(0)
  })

  conditionalTest('transcription groups', async () => {
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      posthogDistinctId: 'test-user',
      posthogGroups: { company: 'test_company' },
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { groups } = captureArgs[0]
    expect(groups).toEqual({ company: 'test_company' })
  })

  conditionalTest('posthogProperties are not sent to OpenAI', async () => {
    const AudioMock: any = openaiModule.Audio
    const TranscriptionsMock = AudioMock.Transcriptions
    const mockCreate = jest.fn().mockResolvedValue(mockTranscriptionResponse)
    const originalCreate = TranscriptionsMock.prototype.create
    TranscriptionsMock.prototype.create = mockCreate

    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      posthogDistinctId: 'test-user',
      posthogProperties: { key: 'value' },
      posthogGroups: { team: 'test' },
      posthogPrivacyMode: true,
      posthogCaptureImmediate: true,
      posthogTraceId: 'trace-123',
    })

    const [actualParams] = mockCreate.mock.calls[0]
    const posthogParams = Object.keys(actualParams).filter((key) => key.startsWith('posthog'))
    expect(posthogParams).toEqual([])
    TranscriptionsMock.prototype.create = originalCreate
  })

  conditionalTest('anonymous user - $process_person_profile set to false', async () => {
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      posthogTraceId: 'trace-123',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('trace-123')
    expect(properties['$process_person_profile']).toBe(false)
  })

  conditionalTest('identified user - $process_person_profile not set', async () => {
    const mockFile = new Blob(['mock audio data'], { type: 'audio/mpeg' }) as any
    mockFile.name = 'test.mp3'

    await client.audio.transcriptions.create({
      file: mockFile,
      model: 'whisper-1',
      posthogDistinctId: 'user-456',
      posthogTraceId: 'trace-123',
    })

    expect(mockPostHogClient.capture).toHaveBeenCalledTimes(1)
    const [captureArgs] = (mockPostHogClient.capture as jest.Mock).mock.calls
    const { distinctId, properties } = captureArgs[0]

    expect(distinctId).toBe('user-456')
    expect(properties['$process_person_profile']).toBeUndefined()
  })
})
