import { useState } from 'react'
import { BotCategories } from '../types'

interface BotSelectorProps {
    onBotSelect: (botUA: string | null, botName: string | null) => void
}

export function BotSelector({ onBotSelect }: BotSelectorProps) {
    const [selectedBotUA, setSelectedBotUA] = useState<string | null>(null)

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value

        if (!value) {
            setSelectedBotUA(null)
            onBotSelect(null, null)
            return
        }

        if (value === 'custom') {
            const customUA = prompt('Enter custom User Agent:')
            if (customUA) {
                setSelectedBotUA(customUA)
                onBotSelect(customUA, 'Custom Bot')
            }
        } else {
            const selectedOption = e.target.options[e.target.selectedIndex]
            setSelectedBotUA(value)
            onBotSelect(value, selectedOption.text)
        }
    }

    const botCategories: BotCategories = window.BOT_CATEGORIES || {}

    return (
        <>
            <div className="card compact">
                <h2>Bot Selector</h2>
                <select onChange={handleChange} style={{ fontSize: '13px' }}>
                    <option value="">-- Select a Bot --</option>
                    {Object.entries(botCategories).map(([category, bots]) => (
                        <optgroup key={category} label={category}>
                            {bots.map((bot) => (
                                <option key={bot.name} value={bot.example} data-pattern={bot.pattern}>
                                    {bot.name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                    <option value="custom">✏️ Custom User Agent...</option>
                </select>
                <div style={{ fontSize: '11px', color: '#718096', marginTop: '6px' }}>💡 For reference only</div>
            </div>

            {selectedBotUA && (
                <div className="card compact">
                    <h2>Selected Bot UA</h2>
                    <div
                        className="ua-display"
                        style={{ fontSize: '11px', padding: '8px', borderLeftColor: '#f56565' }}
                    >
                        {selectedBotUA}
                    </div>
                    <div style={{ fontSize: '11px', color: '#718096', marginTop: '6px' }}>
                        📋 Copy to use in DevTools
                    </div>
                </div>
            )}
        </>
    )
}
