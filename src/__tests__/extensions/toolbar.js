import { Toolbar } from '../../extensions/toolbar'
import { loadScript } from '../../utils'
import { _isUndefined } from '../../utils/type-utils'

jest.mock('../../utils', () => ({
    ...jest.requireActual('../../utils'),
    loadScript: jest.fn((path, callback) => callback()),
}))

const makeToolbarParams = (overrides) => ({
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
    ...overrides,
})

describe('Toolbar', () => {
    let toolbar
    let lib
    let config
    let toolbarParams = makeToolbarParams({})

    beforeEach(() => {
        config = {
            api_host: 'http://api.example.com',
            token: 'test_token',
        }
        lib = {
            config: config,
            set_config: jest.fn(),
        }
        toolbar = new Toolbar(lib)
    })

    beforeEach(() => {
        loadScript.mockImplementation((path, callback) => callback())
        window.ph_load_toolbar = jest.fn()
        delete window['_postHogToolbarLoaded']
    })

    describe('maybeLoadToolbar', () => {
        let localStorage = {
            getItem: jest.fn().mockImplementation(() => jest.fn()),
            setItem: jest.fn(),
        }
        let history = { replaceState: jest.fn() }

        const defaultHashState = {
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
        }

        const withHashParamsFrom = (hashState = defaultHashState) => ({
            access_token: 'access token',
            state: encodeURIComponent(JSON.stringify(hashState)),
            expires_in: 3600,
        })

        const withHash = (hashParams) => {
            return Object.keys(hashParams)
                .map((k) => `${k}=${hashParams[k]}`)
                .join('&')
        }

        const aLocation = (hash) => {
            if (_isUndefined(hash)) {
                hash = withHash(withHashParamsFrom())
            }

            return {
                hash: `#${hash}`,
                pathname: 'pathname',
                search: '?search',
            }
        }

        beforeEach(() => {
            jest.spyOn(toolbar, 'loadToolbar').mockImplementation(() => {})
        })

        it('should initialize the toolbar when the hash state contains action "ph_authorize"', () => {
            toolbarParams = makeToolbarParams({
                action: 'ph_authorize',
            })

            toolbar.maybeLoadToolbar(aLocation(), localStorage, history)

            expect(toolbar.loadToolbar).toHaveBeenCalledWith({
                ...toolbarParams,
                source: 'url',
            })
        })

        it('should initialize the toolbar when there are editor params in the session', () => {
            toolbar.maybeLoadToolbar(aLocation(), localStorage, history)

            expect(toolbar.loadToolbar).toHaveBeenCalledWith({
                ...toolbarParams,
                source: 'url',
            })
        })

        it('should NOT initialize the toolbar when the activation query param does not exist', () => {
            expect(toolbar.maybeLoadToolbar(aLocation(''), localStorage, history)).toEqual(false)

            expect(toolbar.loadToolbar).not.toHaveBeenCalled()
        })

        it('should return false when parsing invalid JSON from fragment state', () => {
            expect(
                toolbar.maybeLoadToolbar(aLocation(withHash(withHashParamsFrom('literally'))), localStorage, history)
            ).toEqual(false)
            expect(toolbar.loadToolbar).not.toHaveBeenCalled()
        })

        it('should work if calling toolbar params `__posthog`', () => {
            toolbar.maybeLoadToolbar(aLocation(withHash(withHashParamsFrom(toolbarParams))), localStorage, history)
            expect(toolbar.loadToolbar).toHaveBeenCalledWith({ ...toolbarParams, source: 'url' })
        })

        it('should use the apiURL in the hash if available', () => {
            toolbar.maybeLoadToolbar(
                aLocation(withHash(withHashParamsFrom({ ...defaultHashState, apiURL: 'blabla' }))),
                localStorage,
                history
            )

            expect(toolbar.loadToolbar).toHaveBeenCalledWith({
                ...toolbarParams,
                apiURL: 'blabla',
                source: 'url',
            })
        })
    })

    describe('load and close toolbar', () => {
        it('should persist for next time', () => {
            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
            expect(JSON.parse(window.localStorage.getItem('_postHogToolbarParams'))).toEqual({
                ...toolbarParams,
                apiURL: 'http://api.example.com',
            })
        })

        it('should load if not previously loaded', () => {
            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
            expect(window.ph_load_toolbar).toHaveBeenCalledWith(
                { ...toolbarParams, apiURL: 'http://api.example.com' },
                lib
            )
        })

        it('should NOT load if previously loaded', () => {
            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
            expect(toolbar.loadToolbar(toolbarParams)).toBe(false)
        })
    })

    describe('load and close toolbar with minimal params', () => {
        const minimalToolbarParams = {
            accessToken: 'accessToken',
        }

        it('should load if not previously loaded', () => {
            expect(toolbar.loadToolbar(minimalToolbarParams)).toBe(true)
            expect(window.ph_load_toolbar).toHaveBeenCalledWith(
                {
                    ...minimalToolbarParams,
                    apiURL: 'http://api.example.com',
                    token: 'test_token',
                },
                lib
            )
        })

        it('should NOT load if previously loaded', () => {
            expect(toolbar.loadToolbar(minimalToolbarParams)).toBe(true)
            expect(toolbar.loadToolbar(minimalToolbarParams)).toBe(false)
        })
    })
})
