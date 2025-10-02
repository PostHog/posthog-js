import { PostHog } from './posthog-core'
import { FeedbackItemAttachResponse, FeedbackItemResponse } from './types'

export default class PostHogFeedback {
    constructor(private readonly _instance: PostHog) {}

    submit(
        category: string,
        value: string,
        topic?: string,
        attachment?: File,
        onComplete?: (feedbackItemId: string, eventId: string | undefined) => void
    ): void {
        this._uploadAttachment(attachment, (presignedAttachmentUrls: string[]) => {
            this._createFeedbackItem(category, value, topic, presignedAttachmentUrls, ({ id }) => {
                const event = this._instance.capture('$feedback_report', {
                    $feedback_item_id: id,
                    $feedback_item_category: category,
                    $feedback_item_topic: topic,
                    $feedback_item_value: value,
                })
                if (onComplete) {
                    onComplete(id, event?.uuid)
                }
            })
        })
    }

    _uploadAttachment(attachment: File | undefined, callback: (presignedUrls: string[]) => void): void {
        if (attachment) {
            this._sendRequest(
                this._posthogApiUrl('attach'),
                {},
                ({ presigned_url: { url, fields } }: FeedbackItemAttachResponse) => {
                    const data = new FormData()

                    Object.entries(fields).forEach(([key, value]) => {
                        data.append(key, value)
                    })

                    data.append('file', attachment)

                    this._sendRequest(url, data, () => {
                        callback([url])
                    })
                }
            )
        } else {
            callback([])
        }
    }

    _createFeedbackItem(
        category: string,
        value: string,
        topic: string | null = null,
        attachmentUrls: string[] | null = null,
        callback: (json: FeedbackItemResponse) => void
    ): void {
        this._sendRequest(this._posthogApiUrl(), { category, value, topic, attachment_urls: attachmentUrls }, callback)
    }

    _posthogApiUrl(endpoint: string = ''): string {
        return this._instance.requestRouter.endpointFor(
            'api',
            `/api/feedback_items/${endpoint}?token=${this._instance.config.token}`
        )
    }

    _sendRequest(url: string, data: Record<string, any>, callback: (json: any) => void): void {
        this._instance._send_request({
            url: url,
            method: 'POST',
            data: data,
            callback: (response) => {
                if (response.json) {
                    callback(response.json)
                } else if (response.text) {
                    callback(JSON.parse(response.text))
                }
            },
        })
    }
}
