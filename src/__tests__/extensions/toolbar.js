import { Toolbar } from '../../extensions/toolbar'
import { loadScript } from '../../utils'

jest.mock('../../utils', () => ({
    ...jest.requireActual('../../utils'),
    loadScript: jest.fn((path, callback) => callback()),
}))

describe('Toolbar', () => {
    given('toolbar', () => new Toolbar(given.lib))

    given('lib', () => ({
        get_config: jest.fn().mockImplementation((key) => given.config[key]),
        set_config: jest.fn(),
    }))

    given('config', () => ({
        api_host: 'http://api.example.com',
        token: 'test_token',
    }))

    beforeEach(() => {
        loadScript.mockImplementation((path, callback) => callback())
        window.ph_load_toolbar = jest.fn()
        delete window['_postHogToolbarLoaded']
    })

    describe('maybeLoadToolbar', () => {
        given('subject', () => () => given.toolbar.maybeLoadToolbar(given.location, given.localStorage, given.history))

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

        given('hashState', () => ({
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
        }))
        given('hashParams', () => ({
            access_token: given.accessToken,
            state: encodeURIComponent(JSON.stringify(given.hashState)),
            expires_in: 3600,
        }))

        given('toolbarParams', () => ({
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
            ...given.toolbarParamsOverrides,
        }))

        beforeEach(() => {
            jest.spyOn(given.toolbar, 'loadToolbar').mockImplementation(() => {})
        })

        it('should initialize the toolbar when the hash state contains action "ph_authorize"', () => {
            given('toolbarParamsOverrides', () => ({
                action: 'ph_authorize',
            }))

            given.subject()
            expect(given.toolbar.loadToolbar).toHaveBeenCalledWith({
                ...given.toolbarParams,
                source: 'url',
            })
        })

        it('should initialize the toolbar when there are editor params in the session', () => {
            given('storedEditorParams', () => JSON.stringify(toolbarParams))

            given.subject()
            expect(given.toolbar.loadToolbar).toHaveBeenCalledWith({
                ...given.toolbarParams,
                source: 'url',
            })
        })

        it('should NOT initialize the toolbar when the activation query param does not exist', () => {
            given('hash', () => '')

            expect(given.subject()).toEqual(false)
            expect(given.toolbar.loadToolbar).not.toHaveBeenCalled()
        })

        it('should return false when parsing invalid JSON from fragment state', () => {
            given('hashParams', () => ({
                access_token: 'test_access_token',
                state: 'literally',
                expires_in: 3600,
            }))

            expect(given.subject()).toEqual(false)
            expect(given.toolbar.loadToolbar).not.toHaveBeenCalled()
        })

        it('should work if calling toolbar params `__posthog`', () => {
            given('hashParams', () => ({
                access_token: given.accessToken,
                __posthog: encodeURIComponent(JSON.stringify(given.toolbarParams)),
                expires_in: 3600,
            }))

            given.subject()
            expect(given.toolbar.loadToolbar).toHaveBeenCalledWith({ ...given.toolbarParams, source: 'url' })
        })

        it('should use the apiURL in the hash if available', () => {
            given.hashState.apiURL = 'blabla'

            given.toolbar.maybeLoadToolbar(given.location, given.localStorage, given.history)

            expect(given.toolbar.loadToolbar).toHaveBeenCalledWith({
                ...given.toolbarParams,
                apiURL: 'blabla',
                source: 'url',
            })
        })
    })

    describe('load and close toolbar', () => {
        given('subject', () => () => given.toolbar.loadToolbar(given.toolbarParams))

        given('toolbarParams', () => ({
            accessToken: 'accessToken',
            token: 'public_token',
            expiresAt: 'expiresAt',
            apiKey: 'apiKey',
        }))

        it('should persist for next time', () => {
            expect(given.subject()).toBe(true)
            expect(JSON.parse(window.localStorage.getItem('_postHogToolbarParams'))).toEqual({
                ...given.toolbarParams,
                apiURL: 'http://api.example.com',
            })
        })

        it('should load if not previously loaded', () => {
            expect(given.subject()).toBe(true)
            expect(window.ph_load_toolbar).toHaveBeenCalledWith(
                { ...given.toolbarParams, apiURL: 'http://api.example.com' },
                given.lib
            )
        })

        it('should NOT load if previously loaded', () => {
            expect(given.subject()).toBe(true)
            expect(given.subject()).toBe(false)
        })
    })

    describe('load and close toolbar with minimal params', () => {
        given('subject', () => () => given.toolbar.loadToolbar(given.toolbarParams))

        given('toolbarParams', () => ({
            accessToken: 'accessToken',
        }))

        it('should load if not previously loaded', () => {
            expect(given.subject()).toBe(true)
            expect(window.ph_load_toolbar).toHaveBeenCalledWith(
                {
                    ...given.toolbarParams,
                    apiURL: 'http://api.example.com',
                    token: 'test_token',
                },
                given.lib
            )
        })

        it('should NOT load if previously loaded', () => {
            expect(given.subject()).toBe(true)
            expect(given.subject()).toBe(false)
        })
    })
})
