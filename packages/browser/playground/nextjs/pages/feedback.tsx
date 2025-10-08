import { usePostHog } from 'posthog-js/react'

export default function SurveyForm() {
    const posthog = usePostHog()

    return (
        <div className="space-y-2">
            <div>
                <button id="feedback-button">Open dialog</button>
            </div>
            <div style={{ width: '100%', height: 1, background: 'rgba(0,0,0,.1)' }}></div>
            <form
                style={{ width: '500px', display: 'flex', flexDirection: 'column', gap: '10px' }}
                onSubmit={(event) => {
                    event.preventDefault()
                    const form = event.target as HTMLFormElement
                    const message = form.elements.namedItem('message') as HTMLTextAreaElement
                    const category = form.elements.namedItem('category') as HTMLSelectElement
                    const attachment = form.elements.namedItem('attachment') as HTMLInputElement
                    if (message && category && attachment) {
                        posthog.captureFeedback(category.value, message.value, {
                            topic: undefined,
                            attachments: attachment && attachment.files?.[0] ? [attachment.files[0]] : [],
                            onComplete: () => {
                                message.value = ''
                                category.value = ''
                                if (attachment) {
                                    attachment.value = ''
                                }
                            },
                        })
                    }
                }}
            >
                <div>
                    <textarea
                        id="message"
                        name="message"
                        rows={4}
                        cols={50}
                        placeholder="Enter your message here..."
                        required
                        style={{
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            padding: '10px',
                            width: '100%',
                        }}
                    />
                </div>

                <div>
                    <select
                        id="category"
                        name="category"
                        required
                        style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%' }}
                    >
                        <option value="">Select a category</option>
                        <option value="feedback">Feedback</option>
                        <option value="bug">Bug</option>
                        <option value="feature_request">Feature request</option>
                    </select>
                </div>

                <div>
                    <label
                        htmlFor="attachment"
                        style={{
                            display: 'block',
                            width: '100%',
                            cursor: 'pointer',
                            border: '1px solid #ccc',
                            padding: '8px',
                            borderRadius: '4px',
                            textAlign: 'center',
                        }}
                    >
                        + Add a file
                    </label>
                    <input
                        type="file"
                        id="attachment"
                        name="attachment"
                        accept="image/*"
                        style={{
                            display: 'none',
                        }}
                    />
                </div>

                <button type="submit">Submit Form</button>
            </form>
        </div>
    )
}
