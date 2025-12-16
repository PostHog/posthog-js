import { useEffect, useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { usePostHog, SurveyModal, Survey } from 'posthog-react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'

const SURVEY_ID = '019b2881-a441-0000-7a7c-81a882c2f87e'

export default function SurveysScreen() {
    const posthog = usePostHog()
    const [surveys, setSurveys] = useState<Survey[]>([])
    const [activeSurvey, setActiveSurvey] = useState<Survey | undefined>()
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        posthog
            .getSurveys()
            .then(setSurveys)
            .finally(() => setLoading(false))
    }, [posthog])

    const targetSurvey = surveys.find((s) => s.id === SURVEY_ID)

    const showSurvey = () => {
        if (targetSurvey) {
            setActiveSurvey(targetSurvey)
            posthog.capture('survey shown', {
                $survey_id: targetSurvey.id,
                $survey_name: targetSurvey.name,
            })
        }
    }

    const handleClose = (submitted: boolean) => {
        if (!submitted && activeSurvey) {
            posthog.capture('survey dismissed', {
                $survey_id: activeSurvey.id,
                $survey_name: activeSurvey.name,
            })
        }
        setActiveSurvey(undefined)
    }

    return (
        <ThemedView style={styles.container}>
            <ThemedText style={styles.title}>Surveys</ThemedText>

            {loading ? (
                <ThemedText style={styles.subtitle}>Loading surveys...</ThemedText>
            ) : targetSurvey ? (
                <>
                    <ThemedText style={styles.subtitle}>{targetSurvey.name}</ThemedText>
                    <Pressable style={styles.button} onPress={showSurvey}>
                        <ThemedText style={styles.buttonText}>Show Survey</ThemedText>
                    </Pressable>
                </>
            ) : (
                <ThemedText style={styles.subtitle}>Survey not found. Found {surveys.length} surveys.</ThemedText>
            )}

            {activeSurvey && (
                <SurveyModal
                    survey={activeSurvey}
                    appearance={
                        {
                            ...activeSurvey.appearance,
                            backgroundColor: '#111',
                            borderColor: 'gray',
                            submitButtonColor: 'white',
                            submitButtonTextColor: 'black',
                            ratingButtonColor: 'white',
                            ratingButtonActiveColor: 'yellow',
                            submitButtonText: 'Submit',
                            displayThankYouMessage: true,
                            thankYouMessageHeader: 'Thank you for your feedback!',
                            thankYouMessageDescription:
                                'We appreciate your feedback and will use it to improve our service.',
                            thankYouMessageCloseButtonText: 'Close',
                        } as any
                    }
                    onShow={() => {}}
                    onClose={handleClose}
                />
            )}
        </ThemedView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: '600',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        opacity: 0.6,
        marginBottom: 16,
        textAlign: 'center',
    },
    button: {
        backgroundColor: '#F54E00',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
})
