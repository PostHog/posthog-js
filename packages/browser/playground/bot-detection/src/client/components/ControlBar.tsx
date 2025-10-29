import { BotSelector } from './BotSelector'

interface ControlBarProps {
    userAgent: string
    onSendPageview: () => void
    onSendCustomEvent: () => void
    onBotSelect: (botUA: string | null, botName: string | null) => void
}

export function ControlBar({ userAgent, onSendPageview, onSendCustomEvent, onBotSelect }: ControlBarProps) {
    return (
        <div className="control-bar">
            <div className="card compact">
                <h2>Browser UA</h2>
                <div className="ua-display" style={{ fontSize: '11px', padding: '8px' }}>
                    {userAgent}
                </div>
            </div>

            <BotSelector onBotSelect={onBotSelect} />

            <div className="card compact">
                <h2>Actions</h2>
                <div className="button-group" style={{ gap: '8px' }}>
                    <button
                        className="btn-primary"
                        onClick={onSendPageview}
                        style={{ padding: '8px 12px', fontSize: '13px' }}
                    >
                        📄 $pageview
                    </button>
                    <button
                        className="btn-success"
                        onClick={onSendCustomEvent}
                        style={{ padding: '8px 12px', fontSize: '13px' }}
                    >
                        ✨ Custom
                    </button>
                </div>
            </div>

            <div className="card wide">
                <h2>How to Test</h2>
                <div style={{ fontSize: '12px' }}>
                    <strong>1.</strong> Select bot → <strong>2.</strong> Open DevTools (F12) → <strong>3.</strong>{' '}
                    Network conditions (Cmd+Shift+P) → <strong>4.</strong> Set Custom UA → <strong>5.</strong> Refresh →{' '}
                    <strong>6.</strong> Send event
                </div>
            </div>
        </div>
    )
}
