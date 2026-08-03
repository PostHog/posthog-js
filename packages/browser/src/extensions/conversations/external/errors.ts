const HANDLED_CONVERSATIONS_SEND_ERROR = '__posthogHandledConversationsSendError' as const

export type ConversationsSendErrorKind = 'network' | 'rate_limit' | 'http' | 'invalid_response'

export type ConversationsSendError = Error & {
    [HANDLED_CONVERSATIONS_SEND_ERROR]: true
    kind: ConversationsSendErrorKind
}

export const createConversationsSendError = (
    kind: ConversationsSendErrorKind,
    message: string
): ConversationsSendError => {
    const error = new Error(message) as ConversationsSendError
    error[HANDLED_CONVERSATIONS_SEND_ERROR] = true
    error.kind = kind
    return error
}

export const isConversationsSendError = (error: unknown): error is ConversationsSendError =>
    !!error &&
    typeof error === 'object' &&
    (error as Partial<ConversationsSendError>)[HANDLED_CONVERSATIONS_SEND_ERROR] === true
