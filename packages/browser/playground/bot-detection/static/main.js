// Event storage
window.capturedEvents = []
let autoScroll = true
let eventIdCounter = 0

// Selected bot info for display only (doesn't affect events)
let selectedBotUA = null

// PostHog initialization will be done via inline script with config

function displayEventInLog(eventData) {
    const logContent = document.getElementById('event-log-content')
    const emptyState = document.getElementById('empty-state')

    if (emptyState) {
        emptyState.remove()
    }

    // Determine event type for styling
    let eventType = 'custom'
    let eventClass = 'custom'
    if (eventData.event === '$pageview') {
        eventType = 'pageview'
        eventClass = 'pageview'
    } else if (eventData.event === '$bot_pageview') {
        eventType = 'bot-pageview'
        eventClass = 'bot-pageview'
    }

    // Format timestamp
    const time = eventData.timestamp.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
    })

    // Build full event JSON with bot properties highlighted
    const botProps = ['$bot_detection_method', '$bot_type', '$browser_type', '$raw_user_agent']

    // Sort all properties alphabetically
    const sortedKeys = Object.keys(eventData.properties).sort()
    const orderedProps = {}
    sortedKeys.forEach((key) => {
        orderedProps[key] = eventData.properties[key]
    })

    // Build full event object JSON
    let eventJSON = '{\n'
    eventJSON += '  "id": ' + eventData.id + ',\n'
    eventJSON += '  "timestamp": "' + eventData.timestamp.toISOString() + '",\n'
    eventJSON += '  "event": "' + eventData.event + '",\n'
    eventJSON += '  "properties": {\n'

    const propKeys = Object.keys(orderedProps)
    propKeys.forEach((key, idx) => {
        const value = JSON.stringify(orderedProps[key])
        const isBotProp = botProps.includes(key)
        const comma = idx < propKeys.length - 1 ? ',' : ''

        if (isBotProp) {
            eventJSON += '    <strong style="color: #e53e3e;">"' + key + '"</strong>: ' + value + comma + '\n'
        } else {
            eventJSON += '    "' + key + '": ' + value + comma + '\n'
        }
    })

    eventJSON += '  }'
    if (Object.keys(eventData.options || {}).length > 0) {
        eventJSON += ',\n  "options": ' + JSON.stringify(eventData.options, null, 2).replace(/\n/g, '\n  ')
    }
    eventJSON += '\n}'

    // Create event icon/badge
    let eventIcon = '📄'
    if (eventClass === 'bot-pageview') eventIcon = '🤖'
    else if (eventClass === 'custom') eventIcon = '✨'

    const eventCard = document.createElement('div')
    eventCard.className = 'event-card ' + eventClass
    eventCard.innerHTML =
        '<div class="event-header" onclick="toggleEventDetails(' +
        eventData.id +
        ')" style="cursor: pointer;">' +
        '<div style="display: flex; align-items: center; gap: 8px;">' +
        '<span class="event-expand-icon" id="expand-icon-' +
        eventData.id +
        '">▶</span>' +
        '<span class="event-icon">' +
        eventIcon +
        '</span>' +
        '<span class="event-name ' +
        eventClass +
        '">' +
        eventData.event +
        '</span>' +
        '</div>' +
        '<div style="display: flex; align-items: center; gap: 10px;">' +
        '<span class="event-timestamp">' +
        time +
        '</span>' +
        '<button class="btn-copy" onclick="event.stopPropagation(); copyEventJSON(' +
        eventData.id +
        ')" title="Copy JSON">📋</button>' +
        '</div>' +
        '</div>' +
        '<div class="event-details" id="event-details-' +
        eventData.id +
        '" style="display: none;">' +
        '<pre style="margin: 0; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e2e8f0;">' +
        eventJSON +
        '</pre>' +
        '</div>'

    logContent.appendChild(eventCard)
    updateEventCount()

    if (autoScroll) {
        logContent.scrollTop = logContent.scrollHeight
    }
}

function updateEventCount() {
    document.getElementById('event-count').textContent = window.capturedEvents.length
}

window.toggleEventDetails = function (id) {
    const details = document.getElementById('event-details-' + id)
    const icon = document.getElementById('expand-icon-' + id)

    if (details.style.display === 'none') {
        details.style.display = 'block'
        icon.textContent = '▼'
    } else {
        details.style.display = 'none'
        icon.textContent = '▶'
    }
}

window.copyEventJSON = function (id) {
    const event = window.capturedEvents.find((e) => e.id === id)
    if (!event) return

    const jsonText = JSON.stringify(event, null, 2)
    navigator.clipboard
        .writeText(jsonText)
        .then(() => {
            // Show feedback
            const btn = event.target || document.querySelector('[onclick*="copyEventJSON(' + id + ')"]')
            const originalText = btn ? btn.textContent : ''
            if (btn) {
                btn.textContent = '✓'
                btn.style.background = '#48bb78'
                setTimeout(() => {
                    btn.textContent = '📋'
                    btn.style.background = ''
                }, 1000)
            }
        })
        .catch((err) => {
            console.error('Failed to copy:', err)
        })
}

window.clearEventLog = function () {
    window.capturedEvents = []
    const logContent = document.getElementById('event-log-content')
    logContent.innerHTML =
        '<div class="event-log-empty" id="empty-state">' +
        '<div class="event-log-empty-icon">📭</div>' +
        '<div>No events captured yet</div>' +
        '<div style="font-size: 12px; margin-top: 5px;">Click a button to send an event</div>' +
        '</div>'
    updateEventCount()
}

window.toggleAutoScroll = function () {
    autoScroll = !autoScroll
    const btn = document.getElementById('autoscroll-btn')
    btn.classList.toggle('active')
    btn.textContent = autoScroll ? '✓ Auto-scroll' : 'Auto-scroll'
}

// Expose functions globally for onclick handlers
window.sendPageview = function () {
    posthog.capture('$pageview', {
        $current_url: window.location.href,
    })
}

window.sendCustomEvent = function () {
    posthog.capture('custom_event', {
        test: 'data',
        timestamp: new Date().toISOString(),
        random: Math.random().toString(36).substring(7),
    })
}

window.onBotSelect = function (select) {
    const value = select.value
    const selectedOption = select.options[select.selectedIndex]

    if (!value) {
        // Hide bot UA card
        selectedBotUA = null
        selectedBotName = null
        updateBotUADisplay()
        return
    }

    if (value === 'custom') {
        const customUA = prompt('Enter custom User Agent:')
        if (customUA) {
            selectedBotUA = customUA
            selectedBotName = 'Custom Bot'
            updateBotUADisplay()
        }
    } else {
        selectedBotUA = value
        selectedBotName = selectedOption.text
        updateBotUADisplay()
    }
}

function updateBotUADisplay() {
    const botCard = document.getElementById('bot-ua-card')
    const botDisplay = document.getElementById('bot-ua-display')

    if (selectedBotUA) {
        botDisplay.textContent = selectedBotUA
        botCard.style.display = 'block'
        console.log('Selected Bot UA (for reference):', selectedBotUA)
    } else {
        botCard.style.display = 'none'
        console.log('No bot selected')
    }
}

window.initPostHog = function (token, apiHost, uiHost) {
    posthog.init(token, {
        api_host: apiHost,
        ui_host: uiHost,
        __preview_send_bot_pageviews: true,
        autocapture: false,
        before_send: function (event) {
            // Capture the full event with all properties for display
            const eventData = {
                id: ++eventIdCounter,
                timestamp: new Date(),
                event: event.event,
                properties: event.properties || {},
                options: {},
            }

            window.capturedEvents.push(eventData)
            if (window.capturedEvents.length > 100) {
                window.capturedEvents.shift()
            }

            displayEventInLog(eventData)
            return event
        },
        loaded: function (ph) {
            console.log('PostHog loaded successfully!')
            ph.debug()
        },
    })
}

// Initialize on load
window.addEventListener('DOMContentLoaded', function () {
    console.log('Current User Agent:', navigator.userAgent)
    updateEventCount()
})
