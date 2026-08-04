const HANDLED_CONVERSATIONS_ERROR = '__posthogHandledConversationsError' as const

export type ConversationsErrorKind = 'network' | 'rate_limit' | 'http' | 'invalid_response'

export type ConversationsError = Error & {
    [HANDLED_CONVERSATIONS_ERROR]: true
    kind: ConversationsErrorKind
}

export const createConversationsError = (kind: ConversationsErrorKind, message: string): ConversationsError => {
    const error = new Error(message) as ConversationsError
    error[HANDLED_CONVERSATIONS_ERROR] = true
    error.kind = kind
    return error
}

export const isConversationsError = (error: unknown): error is ConversationsError =>
    !!error && typeof error === 'object' && (error as Partial<ConversationsError>)[HANDLED_CONVERSATIONS_ERROR] === true
