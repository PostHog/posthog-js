export interface StartFeedbackRecordingUIProps {
    handleStart?: () => void
    handleCancel?: () => void
}

export function StartFeedbackRecordingUI({ handleStart, handleCancel }: StartFeedbackRecordingUIProps = {}) {
    return (
        <div className="feedback-recording-modal">
            <h2 className="feedback-recording-title">Record your screen</h2>
            <p className="feedback-recording-description">
                Explain your problem with a screen recording and audio capture. Our support team will watch this and get
                back to you soon!
            </p>
            <div className="feedback-recording-buttons">
                <button className="feedback-recording-button feedback-recording-button-start" onClick={handleStart}>
                    Start Recording
                </button>
                <button className="feedback-recording-button feedback-recording-button-cancel" onClick={handleCancel}>
                    Cancel
                </button>
            </div>
        </div>
    )
}
