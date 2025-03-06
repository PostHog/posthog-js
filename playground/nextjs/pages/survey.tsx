import type { Survey } from 'posthog-js'
import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'

export default function SurveyForm() {
    const posthog = usePostHog()
    const [surveys, setSurveys] = useState([] as unknown as Survey[])
    const [selectedSurvey, setSelectedSurvey] = useState('')

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedSurvey(event.target.value)
    }

    useEffect(() => {
        posthog.surveys.getSurveys((surveys: Survey[]) => {
            setSurveys(surveys)
            if (surveys.length > 0) {
                setSelectedSurvey(surveys[0].id)
            }
        })
    }, [])

    const arraySurveyItems = surveys.map((survey) => (
        <option key={survey.id} value={survey.id}>
            {survey.name}
        </option>
    ))

    return (
        <>
            <div className="flex items-center gap-2 flex-wrap">
                <button className="survey-feedback-button">Feedback</button>
                <select value={selectedSurvey} onChange={handleChange}>
                    <option value="">Select a survey</option>
                    {arraySurveyItems}
                </select>
                <button
                    onClick={() => posthog.renderSurvey(selectedSurvey, '#survey-container')}
                    disabled={!selectedSurvey}
                >
                    Render Survey below
                </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                <div id="survey-container">
                    <h1>hello world</h1>
                </div>
            </div>

            {/* Add spacer to push the bottom button down */}
            <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p>Scroll down to see the bottom feedback button</p>
            </div>

            {/* Bottom feedback button */}
            <div style={{ padding: '20px', textAlign: 'center', borderTop: '1px solid #eee' }}>
                <button
                    className="survey-feedback-button"
                    style={{
                        padding: '10px 20px',
                        background: '#1D4AFF',
                        color: 'white',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                    }}
                >
                    Feedback (Bottom)
                </button>
            </div>
        </>
    )
}
