// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h } from 'preact'
import { ConversationsRemoteConfig } from '../../../../posthog-conversations-types'
import { getStyles } from './styles'

interface IdentificationFormViewProps {
    config: ConversationsRemoteConfig
    styles: ReturnType<typeof getStyles>
    formName: string
    formEmail: string
    formEmailError: string | null
    onNameChange: (e: Event) => void
    onEmailChange: (e: Event) => void
    onSubmit: (e: Event) => void
}

export function IdentificationFormView({
    config,
    styles,
    formName,
    formEmail,
    formEmailError,
    onNameChange,
    onEmailChange,
    onSubmit,
}: IdentificationFormViewProps) {
    const title = config.identificationFormTitle || 'Before we start...'
    const description = config.identificationFormDescription || 'Please provide your details so we can help you better.'
    const showNameField = config.collectName !== false

    return (
        <div style={styles.identificationForm}>
            <div style={styles.formTitle}>{title}</div>
            <div style={styles.formDescription}>{description}</div>

            <form onSubmit={onSubmit}>
                {showNameField && (
                    <div style={styles.formField}>
                        <label style={styles.formLabel}>
                            Name <span style={styles.formOptional}>(optional)</span>
                        </label>
                        <input
                            type="text"
                            style={styles.formInput}
                            value={formName}
                            onInput={onNameChange}
                            placeholder="Your name"
                            autoComplete="name"
                        />
                    </div>
                )}

                <div style={styles.formField}>
                    <label style={styles.formLabel}>
                        Email {!config.requireEmail && <span style={styles.formOptional}>(optional)</span>}
                    </label>
                    <input
                        type="email"
                        style={{
                            ...styles.formInput,
                            ...(formEmailError ? styles.formInputError : {}),
                        }}
                        value={formEmail}
                        onInput={onEmailChange}
                        placeholder="you@example.com"
                        autoComplete="email"
                    />
                    {formEmailError && <div style={styles.formError}>{formEmailError}</div>}
                </div>

                <button
                    type="submit"
                    style={styles.formSubmitButton}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.9'
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1'
                    }}
                >
                    Start Chat
                </button>
            </form>
        </div>
    )
}
