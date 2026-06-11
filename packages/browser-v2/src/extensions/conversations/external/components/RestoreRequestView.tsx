// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h } from 'preact'
import { getStyles } from './styles'

interface RestoreRequestViewProps {
    styles: ReturnType<typeof getStyles>
    restoreEmail: string
    restoreEmailError: string | null
    restoreRequestLoading: boolean
    restoreRequestSuccess: boolean
    onEmailChange: (e: Event) => void
    onSubmit: (e: Event) => void
}

export function RestoreRequestView({
    styles,
    restoreEmail,
    restoreEmailError,
    restoreRequestLoading,
    restoreRequestSuccess,
    onEmailChange,
    onSubmit,
}: RestoreRequestViewProps) {
    return (
        <div style={styles.identificationForm}>
            <div style={styles.formTitle}>Restore conversations</div>
            <div style={styles.formDescription}>
                Don't see your previous conversations? Maybe you use another browser or computer. Enter your email and
                we will send a secure restore link if matching conversations exist.
            </div>

            <form onSubmit={onSubmit}>
                <div style={styles.formField}>
                    <label style={styles.formLabel}>Email</label>
                    <input
                        type="email"
                        style={{
                            ...styles.formInput,
                            ...(restoreEmailError ? styles.formInputError : {}),
                        }}
                        value={restoreEmail}
                        onInput={onEmailChange}
                        placeholder="you@example.com"
                        autoComplete="email"
                        disabled={restoreRequestLoading}
                    />
                    {restoreEmailError && <div style={styles.formError}>{restoreEmailError}</div>}
                </div>

                <button type="submit" style={styles.formSubmitButton} disabled={restoreRequestLoading}>
                    {restoreRequestLoading ? 'Sending...' : 'Send restore link'}
                </button>
            </form>

            {restoreRequestSuccess && (
                <div style={styles.restoreRequestSuccess}>
                    Check your email for a secure restore link. If an account is found, we sent it.
                </div>
            )}
        </div>
    )
}
