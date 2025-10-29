import { useState } from 'react'
import { CapturedEvent } from '../types'

interface EventCardProps {
    event: CapturedEvent
}

export function EventCard({ event }: EventCardProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')

    const eventClass =
        event.event === '$pageview' ? 'pageview' : event.event === '$bot_pageview' ? 'bot-pageview' : 'custom'

    const icon = eventClass === 'bot-pageview' ? '🤖' : eventClass === 'custom' ? '✨' : '📄'

    const time =
        event.timestamp.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }) +
        '.' +
        event.timestamp.getMilliseconds().toString().padStart(3, '0')

    const handleCopy = async () => {
        try {
            // eslint-disable-next-line compat/compat
            await navigator.clipboard.writeText(JSON.stringify(event, null, 2))
            setCopyStatus('copied')
            setTimeout(() => setCopyStatus('idle'), 1000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    const botProps = ['$bot_detection_method', '$bot_type', '$browser_type', '$raw_user_agent']

    const sortedKeys = Object.keys(event.properties).sort()
    const orderedProps: Record<string, any> = {}
    sortedKeys.forEach((key) => {
        orderedProps[key] = event.properties[key]
    })

    let eventJSON = '{\n'
    eventJSON += `  "id": ${event.id},\n`
    eventJSON += `  "timestamp": "${event.timestamp.toISOString()}",\n`
    eventJSON += `  "event": "${event.event}",\n`
    eventJSON += '  "properties": {\n'

    const propKeys = Object.keys(orderedProps)
    propKeys.forEach((key, idx) => {
        const value = JSON.stringify(orderedProps[key])
        const isBotProp = botProps.includes(key)
        const comma = idx < propKeys.length - 1 ? ',' : ''

        if (isBotProp) {
            eventJSON += `    <strong style="color: #e53e3e;">"${key}"</strong>: ${value}${comma}\n`
        } else {
            eventJSON += `    "${key}": ${value}${comma}\n`
        }
    })

    eventJSON += '  }'
    if (Object.keys(event.options || {}).length > 0) {
        eventJSON += ',\n  "options": ' + JSON.stringify(event.options, null, 2).replace(/\n/g, '\n  ')
    }
    eventJSON += '\n}'

    return (
        <div className={`event-card ${eventClass}`}>
            <div className="event-header" onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="event-expand-icon">{isExpanded ? '▼' : '▶'}</span>
                    <span className="event-icon">{icon}</span>
                    <span className={`event-name ${eventClass}`}>{event.event}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className="event-timestamp">{time}</span>
                    <button
                        className="btn-copy"
                        onClick={(e) => {
                            e.stopPropagation()
                            handleCopy()
                        }}
                        title="Copy JSON"
                    >
                        {copyStatus === 'copied' ? '✓' : '📋'}
                    </button>
                </div>
            </div>
            {isExpanded && (
                <div className="event-details">
                    <pre
                        style={{
                            margin: 0,
                            fontFamily: 'monospace',
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            marginTop: '8px',
                            paddingTop: '8px',
                            borderTop: '1px solid #e2e8f0',
                        }}
                        dangerouslySetInnerHTML={{ __html: eventJSON }}
                    />
                </div>
            )}
        </div>
    )
}
