import { Toolbar } from '../../extensions/toolbar'
import { loadScript } from '../../autocapture-utils'

jest.mock('../../autocapture-utils')

describe('Toolbar', () => {
    given('toolbar', () => new Toolbar(given.lib))

    given('lib', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        set_config: jest.fn(),
    }))

    given('config', () => ({
        api_host: 'example.com',
        token: 'test_token',
    }))

    beforeEach(() => {
        loadScript.mockImplementation((path, callback) => callback())
        window.ph_load_editor = jest.fn()
        delete window['_postHogToolbarLoaded']
    })

    describe('maybeLoadEditor', () => {
        given('subject', () => () => given.toolbar.maybeLoadEditor(given.location, given.localStorage, given.history))

        given('location', () => ({
            hash: `#${given.hash}`,
            pathname: 'pathname',
            search: '?search',
        }))

        given('localStorage', () => ({
            getItem: jest.fn().mockImplementation(() => given.storedEditorParams),
            setItem: jest.fn(),
        }))

        given('history', () => ({ replaceState: jest.fn() }))

        given('hash', () =>
            Object.keys(given.hashParams)
                .map((k) => `${k}=${given.hashParams[k]}`)
                .join('&')
        )

        given('hashParams', () => ({
            access_token: given.accessToken,
            state: encodeURIComponent(JSON.stringify(given.editorParams)),
            expires_in: 3600,
        }))

        given('editorParams', () => ({
            action: 'ph_authorize',
            desiredHash: '#myhash',
            projectId: 3,
            projectOwnerId: 722725,
            readOnly: false,
            token: 'test_token',
            userFlags: {
                flag_1: 0,
                flag_2: 1,
            },
            userId: 12345,
            apiURL: given.config.api_host,
            ...given.editorParamsOverrides,
        }))

        beforeEach(() => {
            jest.spyOn(given.toolbar, '_loadEditor').mockImplementation(() => {})
        })

        it('should initialize the visual editor when the hash state contains action "mpeditor"', () => {
            given.subject()

            expect(given.toolbar._loadEditor).toHaveBeenCalledWith(given.editorParams)
            expect(given.localStorage.setItem).toHaveBeenCalledWith(
                '_postHogEditorParams',
                JSON.stringify(given.editorParams)
            )
        })

        it('should initialize the visual editor when the hash state contains action "ph_authorize"', () => {
            given('editorParamsOverrides', () => ({
                action: 'ph_authorize',
            }))

            given.subject()
            expect(given.toolbar._loadEditor).toHaveBeenCalledWith(given.editorParams)
            expect(given.localStorage.setItem).toHaveBeenCalledWith(
                '_postHogEditorParams',
                JSON.stringify(given.editorParams)
            )
        })

        it('should initialize the visual editor when there are editor params in the session', () => {
            given('storedEditorParams', () => JSON.stringify(editorParams))

            given.subject()
            expect(given.toolbar._loadEditor).toHaveBeenCalledWith(given.editorParams)
            expect(given.localStorage.setItem).toHaveBeenCalledWith(
                '_postHogEditorParams',
                JSON.stringify(given.editorParams)
            )
        })

        it('should NOT initialize the visual editor when the activation query param does not exist', () => {
            given('hash', () => '')

            expect(given.subject()).toEqual(false)
            expect(given.toolbar._loadEditor).not.toHaveBeenCalled()
        })

        it('should return false when parsing invalid JSON from fragment state', () => {
            given('hashParams', () => ({
                access_token: 'test_access_token',
                state: 'literally',
                expires_in: 3600,
            }))

            expect(given.subject()).toEqual(false)
            expect(given.toolbar._loadEditor).not.toHaveBeenCalled()
        })

        it('should work if calling editor params `__posthog`', () => {
            given('hashParams', () => ({
                access_token: given.accessToken,
                __posthog: encodeURIComponent(JSON.stringify(given.editorParams)),
                expires_in: 3600,
            }))

            given.subject()
            expect(given.toolbar._loadEditor).toHaveBeenCalledWith(given.editorParams)
            expect(given.localStorage.setItem).toHaveBeenCalledWith(
                '_postHogEditorParams',
                JSON.stringify(given.editorParams)
            )
        })
    })

    describe('load and close editor', () => {
        given('subject', () => () => given.toolbar._loadEditor(given.editorParams))

        given('editorParams', () => ({
            accessToken: 'accessToken',
            expiresAt: 'expiresAt',
            apiKey: 'apiKey',
            apiURL: 'http://localhost:8000',
        }))

        it('should load if not previously loaded', () => {
            expect(given.subject()).toBe(true)
            expect(window.ph_load_editor).toHaveBeenCalledWith(given.editorParams)
        })

        it('should NOT load if previously loaded', () => {
            expect(given.subject()).toBe(true)
            expect(given.subject()).toBe(false)
        })
    })
})
