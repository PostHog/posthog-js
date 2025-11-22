export interface StartFeedbackRecordingUIProps {
    handleStart?: () => void
    handleCancel?: () => void
}

export function StartFeedbackRecordingUI({ handleStart, handleCancel }: StartFeedbackRecordingUIProps = {}) {
    return (
        <div className="feedback-recording-modal">
            <h2 className="feedback-recording-title">Record your screen</h2>
            <p className="feedback-recording-description">
                Record your screen to explain more about the issue you are facing. PostHog support will be able to watch
                this back and listen to audio - so feel free to talk us through the problem as you go!
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
