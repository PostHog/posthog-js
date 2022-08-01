import sinon from 'sinon'

import * as gdpr from '../gdpr-utils'

const TOKENS = [
    `test-token`,
    `y^0M0RJnZq#9WE!Si*1tPZmtdcODB$%c`, // randomly-generated string
    `Ƭ Ө K Σ П`, // unicode string with whitespace
]
const DEFAULT_PERSISTENCE_PREFIX = `__ph_opt_in_out_`
const CUSTOM_PERSISTENCE_PREFIX = `𝓶𝓶𝓶𝓬𝓸𝓸𝓴𝓲𝓮𝓼`

function forPersistenceTypes(runTests) {
    ;[`cookie`, `localStorage`, `localStorage+cookie`].forEach(function (persistenceType) {
        describe(persistenceType, runTests.bind(null, persistenceType))
    })
}

function assertPersistenceValue(persistenceType, token, value, persistencePrefix = DEFAULT_PERSISTENCE_PREFIX) {
    if (persistenceType === `cookie`) {
        if (value === null) {
            expect(document.cookie).not.toContain(token)
        } else {
            expect(document.cookie).toContain(token + `=${value}`)
        }
    } else {
        if (value === null) {
            expect(window.localStorage.getItem(persistencePrefix + token)).toBeNull()
        } else {
            expect(window.localStorage.getItem(persistencePrefix + token)).toBe(`${value}`)
        }
    }
}
function deleteAllCookies() {
    var cookies = document.cookie.split(';')

    for (var i = 0; i < cookies.length; i++) {
        var cookie = cookies[i]
        var eqPos = cookie.indexOf('=')
        var name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT'
    }
}
describe(`GDPR utils`, () => {
    // these imports must be re-required before each test
    // so that they reference the correct jsdom document

    afterEach(() => {
        document.getElementsByTagName('html')[0].innerHTML = ''
        window.localStorage.clear()
        deleteAllCookies()
    })

    describe(`optIn`, () => {
        forPersistenceTypes(function (persistenceType) {
            it(`should set a cookie marking the user as opted-in for a given token`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    // console.log(token, persistenceType)
                    assertPersistenceValue(persistenceType, token, 1)
                })
            })

            it(`shouldn't set cookies for any other tokens`, () => {
                const token = TOKENS[0]
                gdpr.optIn(token, { persistenceType })

                TOKENS.filter((otherToken) => otherToken !== token).forEach((otherToken) => {
                    assertPersistenceValue(persistenceType, otherToken, null)
                })
            })

            it(`should capture an event recording the opt-in action`, () => {
                let capture

                TOKENS.forEach((token) => {
                    capture = sinon.spy()
                    gdpr.optIn(token, { capture, persistenceType })
                    expect(capture.calledOnceWith(`$opt_in`)).toBe(true)

                    capture = sinon.spy()
                    const captureEventName = `єνєηт`
                    const captureProperties = { '𝖕𝖗𝖔𝖕𝖊𝖗𝖙𝖞': `𝓿𝓪𝓵𝓾𝓮` }
                    gdpr.optIn(token, { capture, captureEventName, captureProperties, persistenceType })
                    expect(capture.calledOnceWith(captureEventName, captureProperties)).toBe(true)
                })
            })

            it(`shouldn't capture an event if the user has opted out`, () => {
                TOKENS.forEach((token) => {
                    let capture = sinon.spy()
                    gdpr.optOut(token, { persistenceType })
                    gdpr.optOut(token, { capture, persistenceType })
                    expect(capture.notCalled).toBe(true)
                })
            })

            it(`should capture an event if the user has opted in`, () => {
                TOKENS.forEach((token) => {
                    let capture = sinon.spy()
                    gdpr.optOut(token, { persistenceType })
                    gdpr.optIn(token, { persistenceType })
                    gdpr.optIn(token, { capture, persistenceType })
                    expect(capture.calledOnce).toBe(true)
                })
            })

            it(`should capture an event if the user is switching opt from out to in`, () => {
                TOKENS.forEach((token) => {
                    let capture = sinon.spy()
                    gdpr.optOut(token, { persistenceType })
                    gdpr.optIn(token, { capture, persistenceType })
                    expect(capture.calledOnce).toBe(true)
                })
            })

            it(`should allow use of a custom "persistence prefix" string (with correct default behavior)`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    gdpr.optIn(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })

                    assertPersistenceValue(persistenceType, token, 0)
                    assertPersistenceValue(persistenceType, token, 1, CUSTOM_PERSISTENCE_PREFIX)

                    gdpr.optIn(token, { persistenceType })

                    assertPersistenceValue(persistenceType, token, 1)
                    assertPersistenceValue(persistenceType, token, 1, CUSTOM_PERSISTENCE_PREFIX)

                    gdpr.optOut(token, { persistenceType })

                    assertPersistenceValue(persistenceType, token, 0)
                    assertPersistenceValue(persistenceType, token, 1, CUSTOM_PERSISTENCE_PREFIX)
                })
            })
        })
    })

    describe(`optOut`, () => {
        forPersistenceTypes(function (persistenceType) {
            it(`should set a cookie marking the user as opted-out for a given token`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    assertPersistenceValue(persistenceType, token, 0)
                })
            })

            it(`shouldn't set cookies for any other tokens`, () => {
                const token = TOKENS[0]
                gdpr.optOut(token, { persistenceType })

                TOKENS.filter((otherToken) => otherToken !== token).forEach((otherToken) => {
                    assertPersistenceValue(persistenceType, otherToken, null)
                })
            })

            it(`shouldn't capture an event recording the opt-out action`, () => {
                TOKENS.forEach((token) => {
                    const capture = sinon.spy()
                    gdpr.optOut(token, { capture, persistenceType })
                    expect(capture.notCalled).toBe(true)
                })
            })

            it(`shouldn't capture an event if the user is switching opt from in to out`, () => {
                TOKENS.forEach((token) => {
                    let capture = sinon.spy()
                    gdpr.optIn(token)
                    gdpr.optOut(token, { capture, persistenceType })
                    expect(capture.calledOnce).toBe(false)
                })
            })

            it(`should allow use of a custom "persistence prefix" string (with correct default behavior)`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    gdpr.optOut(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })

                    assertPersistenceValue(persistenceType, token, 1)
                    assertPersistenceValue(persistenceType, token, 0, CUSTOM_PERSISTENCE_PREFIX)

                    gdpr.optOut(token, { persistenceType })

                    assertPersistenceValue(persistenceType, token, 0)
                    assertPersistenceValue(persistenceType, token, 0, CUSTOM_PERSISTENCE_PREFIX)

                    gdpr.optIn(token, { persistenceType })

                    assertPersistenceValue(persistenceType, token, 1)
                    assertPersistenceValue(persistenceType, token, 0, CUSTOM_PERSISTENCE_PREFIX)
                })
            })
        })
    })

    describe(`hasOptedIn`, () => {
        forPersistenceTypes(function (persistenceType) {
            it(`should return 'false' if the user hasn't opted in for a given token`, () => {
                TOKENS.forEach((token) => {
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'true' if the user opts in for a given token`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(true)
                })
            })

            it(`should return 'false' if the user opts in for any other token`, () => {
                const token = TOKENS[0]
                gdpr.optIn(token)

                TOKENS.filter((otherToken) => otherToken !== token).forEach((otherToken) => {
                    expect(gdpr.hasOptedIn(otherToken, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'false' if the user opts out`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'true' if the user opts out then opts in`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    gdpr.optIn(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(true)
                })
            })

            it(`should return 'false' if the user opts in then opts out`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    gdpr.optOut(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'false' if the user opts in then clears their opt status`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    gdpr.clearOptInOut(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'true' if the user clears their opt status then opts in`, () => {
                TOKENS.forEach((token) => {
                    gdpr.clearOptInOut(token, { persistenceType })
                    gdpr.optIn(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(true)
                })
            })

            it(`should allow use of a custom "persistence prefix" string`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(false)
                    expect(
                        gdpr.hasOptedIn(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    ).toBe(true)
                    gdpr.optOut(token)
                    expect(
                        gdpr.hasOptedIn(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    ).toBe(true)
                    gdpr.optOut(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    expect(
                        gdpr.hasOptedIn(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    ).toBe(false)
                })
            })
        })
    })

    describe(`hasOptedOut`, () => {
        forPersistenceTypes(function (persistenceType) {
            it(`should return 'false' if the user hasn't opted out for a given token`, () => {
                TOKENS.forEach((token) => {
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'true' if the user opts out for a given token`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(true)
                })
            })

            it(`should return 'false' if the user opts out for any other token`, () => {
                const token = TOKENS[0]
                gdpr.optIn(token, { persistenceType })

                TOKENS.filter((otherToken) => otherToken !== token).forEach((otherToken) => {
                    expect(gdpr.hasOptedIn(otherToken, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'false' if the user opts in`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'true' if the user opts in then opts out`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    gdpr.optOut(token, { persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(true)
                })
            })

            it(`should return 'false' if the user opts out then opts in`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    gdpr.optIn(token, { persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'false' if the user opts out then clears their opt status`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    gdpr.clearOptInOut(token, { persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(false)
                })
            })

            it(`should return 'true' if the user clears their opt status then opts out`, () => {
                TOKENS.forEach((token) => {
                    gdpr.clearOptInOut(token, { persistenceType })
                    gdpr.optOut(token, { persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(true)
                })
            })

            it(`should allow use of a custom "persistence prefix" string`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(false)
                    expect(
                        gdpr.hasOptedOut(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    ).toBe(true)
                    gdpr.optIn(token, { persistenceType })
                    expect(
                        gdpr.hasOptedOut(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    ).toBe(true)
                    gdpr.optIn(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    expect(
                        gdpr.hasOptedOut(token, { persistencePrefix: CUSTOM_PERSISTENCE_PREFIX, persistenceType })
                    ).toBe(false)
                })
            })
        })
    })

    describe(`clearOptInOut`, () => {
        forPersistenceTypes(function (persistenceType) {
            it(`should delete any opt cookies for a given token`, () => {
                ;[gdpr.optIn, gdpr.optOut].forEach((optFunc) => {
                    TOKENS.forEach((token) => {
                        optFunc(token, { persistenceType })
                        assertPersistenceValue(persistenceType, token, optFunc === gdpr.optIn ? 1 : 0)
                    })

                    TOKENS.forEach((token) => {
                        gdpr.clearOptInOut(token, { persistenceType })
                        assertPersistenceValue(persistenceType, token, null)
                    })
                })
            })

            it(`shouldn't delete opt cookies for any other token`, () => {
                const token = TOKENS[0]

                ;[gdpr.optIn, gdpr.optOut].forEach((optFunc) => {
                    optFunc(token, { persistenceType })
                    assertPersistenceValue(persistenceType, token, optFunc === gdpr.optIn ? 1 : 0)

                    TOKENS.filter((otherToken) => otherToken !== token).forEach((otherToken) => {
                        gdpr.clearOptInOut(otherToken, { persistenceType })
                        assertPersistenceValue(persistenceType, token, optFunc === gdpr.optIn ? 1 : 0)
                    })
                })
            })

            it(`should cause hasOptedIn to switch from returning 'true' to returning 'false'`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(true)
                    gdpr.clearOptInOut(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(false)
                })
            })

            it(`should cause hasOptedOut to switch from returning 'true' to returning 'false'`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optOut(token, { persistenceType })
                    expect(gdpr.hasOptedOut(token, { persistenceType })).toBe(true)
                    gdpr.clearOptInOut(token, { persistenceType })
                    expect(gdpr.hasOptedIn(token, { persistenceType })).toBe(false)
                })
            })

            it(`should allow use of a custom "persistence prefix" string`, () => {
                TOKENS.forEach((token) => {
                    gdpr.optIn(token, {
                        persistenceType,
                        persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                    })
                    expect(
                        gdpr.hasOptedIn(token, {
                            persistenceType,
                            persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                        })
                    ).toBe(true)
                    gdpr.clearOptInOut(token, { persistenceType })
                    expect(
                        gdpr.hasOptedIn(token, {
                            persistenceType,
                            persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                        })
                    ).toBe(true)
                    gdpr.clearOptInOut(token, {
                        persistenceType,
                        persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                    })
                    expect(
                        gdpr.hasOptedIn(token, {
                            persistenceType,
                            persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                        })
                    ).toBe(false)
                    gdpr.optOut(token, {
                        persistenceType,
                        persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                    })
                    expect(
                        gdpr.hasOptedOut(token, {
                            persistenceType,
                            persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                        })
                    ).toBe(true)
                    gdpr.clearOptInOut(token)
                    expect(
                        gdpr.hasOptedOut(token, {
                            persistenceType,
                            persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                        })
                    ).toBe(true)
                    gdpr.clearOptInOut(token, {
                        persistenceType,
                        persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                    })
                    expect(
                        gdpr.hasOptedOut(token, {
                            persistenceType,
                            persistencePrefix: CUSTOM_PERSISTENCE_PREFIX,
                        })
                    ).toBe(false)
                })
            })
        })
    })

    describe(`addOptOutCheckPostHogLib`, () => {
        const captureEventName = `єνєηт`
        const captureProperties = { '𝖕𝖗𝖔𝖕𝖊𝖗𝖙𝖞': `𝓿𝓪𝓵𝓾𝓮` }
        let getConfig, capture, postHogLib

        function setupMocks(getConfigFunc, silenceErrors = false) {
            getConfig = sinon.spy((name) => getConfigFunc()[name])
            capture = sinon.spy()
            postHogLib = {
                get_config: getConfig,
                capture: undefined,
            }
            postHogLib.capture = gdpr.addOptOutCheck(postHogLib, capture, silenceErrors)
        }

        forPersistenceTypes(function (persistenceType) {
            it(`should call the wrapped method if the user is neither opted in or opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))

                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.calledOnceWith(captureEventName, captureProperties)).toBe(true)
                })
            })

            it(`should call the wrapped method if the user is opted in`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))

                    gdpr.optIn(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.calledOnceWith(captureEventName, captureProperties)).toBe(true)
                })
            })

            it(`should not call the wrapped method if the user is opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))

                    gdpr.optOut(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.notCalled).toBe(true)
                })
            })

            it(`should not invoke the callback directly if the user is neither opted in or opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))
                    const callback = sinon.spy()

                    postHogLib.capture(captureEventName, captureProperties, callback)

                    expect(callback.notCalled).toBe(true)
                })
            })

            it(`should not invoke the callback directly if the user is opted in`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))
                    const callback = sinon.spy()

                    gdpr.optIn(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties, callback)

                    expect(callback.notCalled).toBe(true)
                })
            })

            it(`should invoke the callback directly if the user is opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))
                    const callback = sinon.spy()

                    gdpr.optOut(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties, callback)

                    expect(callback.calledOnceWith(0)).toBe(true)
                })
            })

            it(`should call the wrapped method if there is no token available`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token: null, opt_out_capturing_persistence_type: persistenceType }))

                    gdpr.optIn(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.calledOnceWith(captureEventName, captureProperties)).toBe(true)
                })
            })

            it(`should call the wrapped method if an unexpected error occurs`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => {
                        throw new Error(`Unexpected error!`)
                    }, true)

                    gdpr.optIn(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.calledOnceWith(captureEventName, captureProperties)).toBe(true)
                })
            })

            it(`should call the wrapped method if config is undefined`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => undefined, false)
                    console.error = jest.fn()

                    gdpr.optIn(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.calledOnceWith(captureEventName, captureProperties)).toBe(true)
                    // :KLUDGE: Exact error message may vary between runtimes
                    expect(console.error).toHaveBeenCalled()
                })
            })

            it(`should allow use of a custom "persistence prefix" string`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({
                        token,
                        opt_out_capturing_persistence_type: persistenceType,
                        opt_out_capturing_cookie_prefix: CUSTOM_PERSISTENCE_PREFIX,
                    }))

                    gdpr.optOut(token, { persistenceType, persistencePrefix: CUSTOM_PERSISTENCE_PREFIX })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.notCalled).toBe(true)

                    gdpr.optIn(token, { persistenceType })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.notCalled).toBe(true)

                    gdpr.optIn(token, { persistenceType, persistencePrefix: CUSTOM_PERSISTENCE_PREFIX })
                    postHogLib.capture(captureEventName, captureProperties)

                    expect(capture.calledOnceWith(captureEventName, captureProperties)).toBe(true)
                })
            })
        })
    })

    describe(`addOptOutCheckPostHogPeople`, () => {
        const setPropertyName = '𝖕𝖗𝖔𝖕𝖊𝖗𝖙𝖞'
        const setPropertyValue = `𝓿𝓪𝓵𝓾𝓮`
        let getConfig, set, postHogPeople, postHogLib

        function setupMocks(getConfigFunc, silenceErrors = false) {
            getConfig = sinon.spy((name) => getConfigFunc()[name])
            set = sinon.spy()
            postHogPeople = {
                _get_config: getConfig,
                set: undefined,
            }
            postHogLib = {
                get_config: getConfig,
            }
            postHogPeople.set = gdpr.addOptOutCheck(postHogLib, set, silenceErrors)
        }

        forPersistenceTypes(function (persistenceType) {
            it(`should call the wrapped method if the user is neither opted in or opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))

                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.calledOnceWith(setPropertyName, setPropertyValue)).toBe(true)
                })
            })

            it(`should call the wrapped method if the user is opted in`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))

                    gdpr.optIn(token, { persistenceType })
                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.calledOnceWith(setPropertyName, setPropertyValue)).toBe(true)
                })
            })

            it(`should not call the wrapped method if the user is opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))

                    gdpr.optOut(token, { persistenceType })
                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.notCalled).toBe(true)
                })
            })

            it(`should not invoke the callback directly if the user is neither opted in or opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))
                    const callback = sinon.spy()

                    postHogPeople.set(setPropertyName, setPropertyValue, callback)

                    expect(callback.notCalled).toBe(true)
                })
            })

            it(`should not invoke the callback directly if the user is opted in`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))
                    const callback = sinon.spy()

                    gdpr.optIn(token, { persistenceType })
                    postHogPeople.set(setPropertyName, setPropertyValue, callback)

                    expect(callback.notCalled).toBe(true)
                })
            })

            it(`should invoke the callback directly if the user is opted out`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token, opt_out_capturing_persistence_type: persistenceType }))
                    const callback = sinon.spy()

                    gdpr.optOut(token, { persistenceType })
                    postHogPeople.set(setPropertyName, setPropertyValue, callback)

                    expect(callback.calledOnceWith(0)).toBe(true)
                })
            })

            it(`should call the wrapped method if there is no token available`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({ token: null, opt_out_capturing_persistence_type: persistenceType }))

                    gdpr.optIn(token, { persistenceType })
                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.calledOnceWith(setPropertyName, setPropertyValue)).toBe(true)
                })
            })

            it(`should call the wrapped method if an unexpected error occurs`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => {
                        throw new Error(`Unexpected error!`)
                    }, true)

                    gdpr.optIn(token, { persistenceType })
                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.calledOnceWith(setPropertyName, setPropertyValue)).toBe(true)
                })
            })

            it(`should allow use of a custom "persistence prefix" string`, () => {
                TOKENS.forEach((token) => {
                    setupMocks(() => ({
                        token,
                        opt_out_capturing_persistence_type: persistenceType,
                        opt_out_capturing_cookie_prefix: CUSTOM_PERSISTENCE_PREFIX,
                    }))

                    gdpr.optOut(token, { persistenceType, persistencePrefix: CUSTOM_PERSISTENCE_PREFIX })
                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.notCalled).toBe(true)

                    gdpr.optIn(token, { persistenceType })
                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.notCalled).toBe(true)

                    gdpr.optIn(token, { persistenceType, persistencePrefix: CUSTOM_PERSISTENCE_PREFIX })
                    postHogPeople.set(setPropertyName, setPropertyValue)

                    expect(set.calledOnceWith(setPropertyName, setPropertyValue)).toBe(true)
                })
            })
        })
    })
})
