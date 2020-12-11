import { _ } from './utils'
import {
    getClassName,
    getSafeText,
    isElementNode,
    isSensitiveElement,
    isTag,
    isTextNode,
    shouldCaptureDomEvent,
    shouldCaptureElement,
    shouldCaptureValue,
    usefulElements,
} from './autocapture-utils'

var autocapture = {
    _initializedTokens: [],

    _previousElementSibling: function (el) {
        if (el.previousElementSibling) {
            return el.previousElementSibling
        } else {
            do {
                el = el.previousSibling
            } while (el && !isElementNode(el))
            return el
        }
    },

    _getPropertiesFromElement: function (elem) {
        var tag_name = elem.tagName.toLowerCase()
        var props = {
            tag_name: tag_name,
        }
        if (usefulElements.indexOf(tag_name) > -1) props['$el_text'] = getSafeText(elem)

        var classes = getClassName(elem)
        if (classes.length > 0)
            props['classes'] = classes.split(' ').filter(function (c) {
                return c !== ''
            })

        _.each(elem.attributes, function (attr) {
            // Only capture attributes we know are safe
            if (isSensitiveElement(elem) && ['name', 'id', 'class'].indexOf(attr.name) === -1) return
            if (shouldCaptureValue(attr.value)) {
                props['attr__' + attr.name] = attr.value
            }
        })

        var nthChild = 1
        var nthOfType = 1
        var currentElem = elem
        while ((currentElem = this._previousElementSibling(currentElem))) {
            // eslint-disable-line no-cond-assign
            nthChild++
            if (currentElem.tagName === elem.tagName) {
                nthOfType++
            }
        }
        props['nth_child'] = nthChild
        props['nth_of_type'] = nthOfType

        return props
    },

    _getDefaultProperties: function (eventType) {
        return {
            $event_type: eventType,
            $ce_version: 1,
        }
    },

    _extractCustomPropertyValue: function (customProperty) {
        var propValues = []
        _.each(document.querySelectorAll(customProperty['css_selector']), function (matchedElem) {
            var value

            if (['input', 'select'].indexOf(matchedElem.tagName.toLowerCase()) > -1) {
                value = matchedElem['value']
            } else if (matchedElem['textContent']) {
                value = matchedElem['textContent']
            }

            if (shouldCaptureValue(value)) {
                propValues.push(value)
            }
        })
        return propValues.join(', ')
    },

    _getCustomProperties: function (targetElementList) {
        var props = {}
        _.each(
            this._customProperties,
            function (customProperty) {
                _.each(
                    customProperty['event_selectors'],
                    function (eventSelector) {
                        var eventElements = document.querySelectorAll(eventSelector)
                        _.each(
                            eventElements,
                            function (eventElement) {
                                if (_.includes(targetElementList, eventElement) && shouldCaptureElement(eventElement)) {
                                    props[customProperty['name']] = this._extractCustomPropertyValue(customProperty)
                                }
                            },
                            this
                        )
                    },
                    this
                )
            },
            this
        )
        return props
    },

    _getEventTarget: function (e) {
        // https://developer.mozilla.org/en-US/docs/Web/API/Event/target#Compatibility_notes
        if (typeof e.target === 'undefined') {
            return e.srcElement
        } else {
            if (e.target.shadowRoot) {
                return e.composedPath()[0]
            }
            return e.target
        }
    },

    _captureEvent: function (e, instance) {
        /*** Don't mess with this code without running IE8 tests on it ***/
        var target = this._getEventTarget(e)
        if (isTextNode(target)) {
            // defeat Safari bug (see: http://www.quirksmode.org/js/events_properties.html)
            target = target.parentNode
        }

        if (shouldCaptureDomEvent(target, e)) {
            var targetElementList = [target]
            var curEl = target
            while (curEl.parentNode && !isTag(curEl, 'body')) {
                if (curEl.parentNode.nodeType === 11) {
                    targetElementList.push(curEl.parentNode.host)
                    curEl = curEl.parentNode.host
                    continue
                }
                targetElementList.push(curEl.parentNode)
                curEl = curEl.parentNode
            }

            var elementsJson = []
            var href,
                explicitNoCapture = false
            _.each(
                targetElementList,
                function (el) {
                    var shouldCaptureEl = shouldCaptureElement(el)

                    // if the element or a parent element is an anchor tag
                    // include the href as a property
                    if (el.tagName.toLowerCase() === 'a') {
                        href = el.getAttribute('href')
                        href = shouldCaptureEl && shouldCaptureValue(href) && href
                    }

                    // allow users to programmatically prevent capturing of elements by adding class 'ph-no-capture'
                    var classes = getClassName(el).split(' ')
                    if (_.includes(classes, 'ph-no-capture')) {
                        explicitNoCapture = true
                    }

                    elementsJson.push(this._getPropertiesFromElement(el))
                },
                this
            )

            elementsJson[0]['$el_text'] = getSafeText(target)

            if (href) {
                elementsJson[0]['attr__href'] = href
            }

            if (explicitNoCapture) {
                return false
            }

            var props = _.extend(
                this._getDefaultProperties(e.type),
                {
                    $elements: elementsJson,
                },
                this._getCustomProperties(targetElementList)
            )

            instance.capture('$autocapture', props)
            return true
        }
    },

    // only reason is to stub for unit tests
    // since you can't override window.location props
    _navigate: function (href) {
        window.location.href = href
    },

    _addDomEventHandlers: function (instance) {
        var handler = _.bind(function (e) {
            e = e || window.event
            this._captureEvent(e, instance)
        }, this)
        document.addEventListener('submit', handler, true)
        document.addEventListener('change', handler, true)
        document.addEventListener('click', handler, true)
    },

    _customProperties: {},
    init: function (instance) {
        instance.toolbar.maybeLoadEditor()

        var token = instance.get_config('token')
        if (this._initializedTokens.indexOf(token) > -1) {
            console.log('autocapture already initialized for token "' + token + '"')
            return
        }
        this._initializedTokens.push(token)

        var parseDecideResponse = _.bind(function (response) {
            if (!(document && document.body)) {
                console.log('document not ready yet, trying again in 500 milliseconds...')
                setTimeout(function () {
                    parseDecideResponse(response)
                }, 500)
                return
            }

            instance.toolbar.afterDecideResponse(response)
            instance.sessionRecording.afterDecideResponse(response)

            if (response && response['config'] && response['config']['enable_collect_everything'] === true) {
                if (response['custom_properties']) {
                    this._customProperties = response['custom_properties']
                }
                this._addDomEventHandlers(instance)
            } else {
                instance['__autocapture_enabled'] = false
            }

            if (response['featureFlags']) {
                instance.persistence &&
                    instance.persistence.register({ $active_feature_flags: response['featureFlags'] })
            } else {
                instance.persistence && instance.persistence.unregister('$active_feature_flags')
            }

            if (response['supportedCompression']) {
                let compression = {}
                for (const method of response['supportedCompression']) {
                    compression[method] = true
                }
                instance['compression'] = compression
            } else {
                instance['compression'] = {}
            }
        }, this)

        var json_data = JSON.stringify({
            token: token,
            distinct_id: instance.get_distinct_id(),
        })
        var encoded_data = _.base64Encode(json_data)
        instance._send_request(
            instance.get_config('api_host') + '/decide/',
            { data: encoded_data },
            { method: 'POST' },
            instance._prepare_callback(parseDecideResponse)
        )
    },

    // this is a mechanism to ramp up CE with no server-side interaction.
    // when CE is active, every page load results in a decide request. we
    // need to gently ramp this up so we don't overload decide. this decides
    // deterministically if CE is enabled for this project by modding the char
    // value of the project token.
    enabledForProject: function (token, numBuckets, numEnabledBuckets) {
        numBuckets = !_.isUndefined(numBuckets) ? numBuckets : 10
        numEnabledBuckets = !_.isUndefined(numEnabledBuckets) ? numEnabledBuckets : 10
        var charCodeSum = 0
        for (var i = 0; i < token.length; i++) {
            charCodeSum += token.charCodeAt(i)
        }
        return charCodeSum % numBuckets < numEnabledBuckets
    },

    isBrowserSupported: function () {
        return _.isFunction(document.querySelectorAll)
    },
}

_.bind_instance_methods(autocapture)
_.safewrap_instance_methods(autocapture)

export { autocapture }
