import { Toolbar } from '../../extensions/toolbar'
import { isString, isUndefined } from '../../utils/type-utils'
import { PostHog } from '../../posthog-core'
import { PostHogConfig, ToolbarParams } from '../../types'
import { assignableWindow, window } from '../../utils/globals'
import { RequestRouter } from '../../utils/request-router'
import { TOOLBAR_ID } from '../../constants'

jest.mock('../../utils', () => ({
    ...jest.requireActual('../../utils'),
    loadScript: jest.fn((_path: any, callback: any) => callback()),
}))

const makeToolbarParams = (overrides: Partial<ToolbarParams>): ToolbarParams => ({
    token: 'test_token',
    ...overrides,
})

describe('Toolbar', () => {
    let toolbar: Toolbar
    let instance: PostHog
    const toolbarParams = makeToolbarParams({})

    beforeEach(() => {
        instance = {
            config: {
                api_host: 'http://api.example.com',
                token: 'test_token',
            } as unknown as PostHogConfig,
            requestRouter: new RequestRouter(instance),

            set_config: jest.fn(),
        } as unknown as PostHog
        toolbar = new Toolbar(instance)
    })

    beforeEach(() => {
        if (document.getElementById(TOOLBAR_ID)) {
            document.body.removeChild(document.getElementById(TOOLBAR_ID)!)
        }
        assignableWindow.ph_load_toolbar = jest.fn(() => {
            const mockToolbarElement = document.createElement('div')
            mockToolbarElement.setAttribute('id', TOOLBAR_ID)
            document.body.appendChild(mockToolbarElement)
        })
    })

    describe('maybeLoadToolbar', () => {
        const localStorage = {
            getItem: jest.fn(),
            setItem: jest.fn(),
        }
        const storage = localStorage as unknown as Storage
        const history = { replaceState: jest.fn() } as unknown as History

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

        const withHashParamsFrom = (
            hashState: Record<string, any> | string = defaultHashState,
            key: string = 'state'
        ) => ({
            access_token: 'access token',
            [key]: encodeURIComponent(isString(hashState) ? hashState : JSON.stringify(hashState)),
            expires_in: 3600,
        })

        const withHash = (hashParams: Record<string, any>) => {
            return Object.keys(hashParams)
                .map((k) => `${k}=${hashParams[k]}`)
                .join('&')
        }

        const aLocation = (hash?: string): Location => {
            if (isUndefined(hash)) {
                hash = withHash(withHashParamsFrom())
            }

            return {
                hash: `#${hash}`,
                pathname: 'pathname',
                search: '?search',
            } as Location
        }

        beforeEach(() => {
            localStorage.getItem.mockImplementation(() => {})

            jest.spyOn(toolbar, 'loadToolbar')
        })

        it('should initialize the toolbar when the hash state contains action "ph_authorize"', () => {
            // the default hash state in the test setup contains the action "ph_authorize"
            toolbar.maybeLoadToolbar(aLocation(), storage, history)

            expect(toolbar.loadToolbar).toHaveBeenCalledWith({
                ...toolbarParams,
                ...defaultHashState,
                source: 'url',
            })
        })

        it('should initialize the toolbar when there are editor params in the session', () => {
            // if the hash state does not contain ph_authorize then look in storage
            localStorage.getItem.mockImplementation(() => JSON.stringify(toolbarParams))

            const hashState = { ...defaultHashState, action: undefined }
            toolbar.maybeLoadToolbar(aLocation(withHash(withHashParamsFrom(hashState))), storage, history)

            expect(toolbar.loadToolbar).toHaveBeenCalledWith({
                ...toolbarParams,
                source: 'localstorage',
            })
        })

        it('should NOT initialize the toolbar when the activation query param does not exist', () => {
            expect(toolbar.maybeLoadToolbar(aLocation(''), storage, history)).toEqual(false)

            expect(toolbar.loadToolbar).not.toHaveBeenCalled()
        })

        it('should return false when parsing invalid JSON from fragment state', () => {
            expect(
                toolbar.maybeLoadToolbar(aLocation(withHash(withHashParamsFrom('literally'))), storage, history)
            ).toEqual(false)
            expect(toolbar.loadToolbar).not.toHaveBeenCalled()
        })

        it('should work if calling toolbar params `__posthog`', () => {
            toolbar.maybeLoadToolbar(
                aLocation(withHash(withHashParamsFrom(defaultHashState, '__posthog'))),
                storage,
                history
            )
            expect(toolbar.loadToolbar).toHaveBeenCalledWith({ ...toolbarParams, ...defaultHashState, source: 'url' })
        })

        it('should use the apiURL in the hash if available', () => {
            toolbar.maybeLoadToolbar(
                aLocation(withHash(withHashParamsFrom({ ...defaultHashState, apiURL: 'blabla' }))),
                storage,
                history
            )

            expect(toolbar.loadToolbar).toHaveBeenCalledWith({
                ...toolbarParams,
                ...defaultHashState,
                apiURL: 'blabla',
                source: 'url',
            })
        })
    })

    describe('load and close toolbar', () => {
        it('should persist for next time', () => {
            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
            expect(JSON.parse(window.localStorage.getItem('_postHogToolbarParams') ?? '')).toEqual({
                ...toolbarParams,
                apiURL: 'http://api.example.com',
            })
        })

        it('should load if not previously loaded', () => {
            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
            expect(assignableWindow.ph_load_toolbar).toHaveBeenCalledWith(
                { ...toolbarParams, apiURL: 'http://api.example.com' },
                instance
            )
        })

        it('should NOT load if previously loaded', () => {
            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
            expect(toolbar.loadToolbar(toolbarParams)).toBe(false)
        })

        it('should load if previously loaded but closed', () => {
            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
            expect(toolbar.loadToolbar(toolbarParams)).toBe(false)

            document.body.removeChild(document.getElementById(TOOLBAR_ID)!)

            expect(toolbar.loadToolbar(toolbarParams)).toBe(true)
        })
    })

    describe('load and close toolbar with minimal params', () => {
        const minimalToolbarParams: ToolbarParams = {
            token: 'accessToken',
        }

        it('should load if not previously loaded', () => {
            expect(toolbar.loadToolbar(minimalToolbarParams)).toBe(true)
            expect(assignableWindow.ph_load_toolbar).toHaveBeenCalledWith(
                {
                    ...minimalToolbarParams,
                    apiURL: 'http://api.example.com',
                    token: 'accessToken',
                },
                instance
            )
        })

        it('should NOT load if previously loaded', () => {
            expect(toolbar.loadToolbar(minimalToolbarParams)).toBe(true)
            expect(toolbar.loadToolbar(minimalToolbarParams)).toBe(false)
        })
    })
})
