// src/contexts/SurveyContext.tsx
import { createContext, FunctionalComponent } from 'preact'
import { useState } from 'preact/hooks'
import { h } from 'preact'

interface SurveyContextType {
    activeSurveyId: string | null
    setActiveSurveyId: (id: string | null) => void
    isPreviewMode: boolean
    previewPageIndex: number | undefined
    handleCloseSurveyPopup: () => void
}

const SurveyContext = createContext<SurveyContextType>({
    activeSurveyId: null,
    setActiveSurveyId: () => {},
    isPreviewMode: false,
    previewPageIndex: undefined,
    handleCloseSurveyPopup: () => {},
})

export const SurveyProvider: FunctionalComponent = ({ children }) => {
    const [activeSurveyId, setActiveSurveyId] = useState<string | null>(null)

    const handleCloseSurveyPopup = () => {}

    return h(
        SurveyContext.Provider,
        {
            value: {
                activeSurveyId,
                setActiveSurveyId,
                isPreviewMode: false, // TODO could handle these values with hooks instead of setting defaults
                previewPageIndex: 0, // TODO could handle this with hooks instead of setting defaults
                handleCloseSurveyPopup,
            },
        },
        children
    )
}

export default SurveyContext
