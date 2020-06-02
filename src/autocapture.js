import { _ } from './utils';
import {
    getClassName,
    getSafeText,
    isElementNode,
    isTag,
    isTextNode,
    shouldCaptureDomEvent,
    shouldCaptureElement,
    shouldCaptureValue,
    usefulElements
} from './autocapture-utils';

var autocapture = {
    _initializedTokens: [],

    _previousElementSibling: function(el) {
        if (el.previousElementSibling) {
            return el.previousElementSibling;
        } else {
            do {
                el = el.previousSibling;
            } while (el && !isElementNode(el));
            return el;
        }
    },

    _loadScript: function(scriptUrlToLoad, callback) {
        var scriptTag = document.createElement('script');
        scriptTag.type = 'text/javascript';
        scriptTag.src = scriptUrlToLoad;
        scriptTag.onload = callback;

        var scripts = document.getElementsByTagName('script');
        if (scripts.length > 0) {
            scripts[0].parentNode.insertBefore(scriptTag, scripts[0]);
        } else {
            document.body.appendChild(scriptTag);
        }
    },

    _getPropertiesFromElement: function(elem) {
        var tag_name = elem.tagName.toLowerCase();
        var props = {
            'tag_name': tag_name
        };
        if(usefulElements.indexOf(tag_name) > -1) props['$el_text'] = getSafeText(elem);

        var classes = getClassName(elem);
        if(classes.length > 0) props['classes'] = classes.split(' ');

        if (shouldCaptureElement(elem)) {
            _.each(elem.attributes, function(attr) {
                if (shouldCaptureValue(attr.value)) {
                    props['attr__' + attr.name] = attr.value;
                }
            });
        }

        var nthChild = 1;
        var nthOfType = 1;
        var currentElem = elem;
        while (currentElem = this._previousElementSibling(currentElem)) { // eslint-disable-line no-cond-assign
            nthChild++;
            if (currentElem.tagName === elem.tagName) {
                nthOfType++;
            }
        }
        props['nth_child'] = nthChild;
        props['nth_of_type'] = nthOfType;

        return props;
    },

    _getDefaultProperties: function(eventType) {
        return {
            '$event_type': eventType,
            '$ce_version': 1,
            '$host': window.location.host,
            '$pathname': window.location.pathname
        };
    },

    _extractCustomPropertyValue: function(customProperty) {
        var propValues = [];
        _.each(document.querySelectorAll(customProperty['css_selector']), function(matchedElem) {
            var value;

            if (['input', 'select'].indexOf(matchedElem.tagName.toLowerCase()) > -1) {
                value = matchedElem['value'];
            } else if (matchedElem['textContent']) {
                value = matchedElem['textContent'];
            }

            if (shouldCaptureValue(value)) {
                propValues.push(value);
            }
        });
        return propValues.join(', ');
    },

    _getCustomProperties: function(targetElementList) {
        var props = {};
        _.each(this._customProperties, function(customProperty) {
            _.each(customProperty['event_selectors'], function(eventSelector) {
                var eventElements = document.querySelectorAll(eventSelector);
                _.each(eventElements, function(eventElement) {
                    if (_.includes(targetElementList, eventElement) && shouldCaptureElement(eventElement)) {
                        props[customProperty['name']] = this._extractCustomPropertyValue(customProperty);
                    }
                }, this);
            }, this);
        }, this);
        return props;
    },

    _getEventTarget: function(e) {
        // https://developer.mozilla.org/en-US/docs/Web/API/Event/target#Compatibility_notes
        if (typeof e.target === 'undefined') {
            return e.srcElement;
        } else {
            return e.target;
        }
    },

    _captureEvent: function(e, instance) {
        /*** Don't mess with this code without running IE8 tests on it ***/
        var target = this._getEventTarget(e);
        if (isTextNode(target)) { // defeat Safari bug (see: http://www.quirksmode.org/js/events_properties.html)
            target = target.parentNode;
        }

        if (shouldCaptureDomEvent(target, e)) {
            var targetElementList = [target];
            var curEl = target;
            while (curEl.parentNode && !isTag(curEl, 'body')) {
                targetElementList.push(curEl.parentNode);
                curEl = curEl.parentNode;
            }

            var elementsJson = [];
            var href, explicitNoCapture = false;
            _.each(targetElementList, function(el) {
                var shouldCaptureEl = shouldCaptureElement(el);

                // if the element or a parent element is an anchor tag
                // include the href as a property
                if (el.tagName.toLowerCase() === 'a') {
                    href = el.getAttribute('href');
                    href = shouldCaptureEl && shouldCaptureValue(href) && href;
                }

                // allow users to programatically prevent captureing of elements by adding class 'ph-no-capture'
                var classes = getClassName(el).split(' ');
                if (_.includes(classes, 'ph-no-capture')) {
                    explicitNoCapture = true;
                }

                elementsJson.push(this._getPropertiesFromElement(el));
            }, this);

            elementsJson[0]['$el_text'] = getSafeText(target);

            if (explicitNoCapture) {
                return false;
            }

            // only populate text content from target element (not parents)
            // to prevent text within a sensitive element from being collected
            // as part of a parent's el.textContent
            var elementText;
            var safeElementText = getSafeText(target);
            if (safeElementText && safeElementText.length) {
                elementText = safeElementText;
            }

            var props = _.extend(
                this._getDefaultProperties(e.type),
                {
                    '$elements':  elementsJson
                },
                this._getCustomProperties(targetElementList)
            );

            instance.capture('$autocapture', props);
            return true;
        }
    },

    // only reason is to stub for unit tests
    // since you can't override window.location props
    _navigate: function(href) {
        window.location.href = href;
    },

    _addDomEventHandlers: function(instance) {
        var handler = _.bind(function(e) {
            e = e || window.event;
            this._captureEvent(e, instance);
        }, this);
        _.register_event(document, 'submit', handler, false, true);
        _.register_event(document, 'change', handler, false, true);
        _.register_event(document, 'click', handler, false, true);
    },

    _customProperties: {},
    init: function(instance) {
        if (!(document && document.body)) {
            console.log('document not ready yet, trying again in 500 milliseconds...');
            var that = this;
            setTimeout(function() { that.init(instance); }, 500);
            return;
        }

        var token = instance.get_config('token');
        if (this._initializedTokens.indexOf(token) > -1) {
            console.log('autocapture already initialized for token "' + token + '"');
            return;
        }
        this._initializedTokens.push(token);

        if (!this._maybeLoadEditor(instance)) { // don't autocapture actions when the editor is enabled
            var parseDecideResponse = _.bind(function(response) {
                if(response['is_authenticated']) {
                    this._loadEditor(instance, {apiURL: instance.get_config('api_host'), jsURL: response['jsURL'] || instance.get_config('api_host')})
                    instance.set_config({debug: true})
                }
                if (response && response['config'] && response['config']['enable_collect_everything'] === true) {

                    if (response['custom_properties']) {
                        this._customProperties = response['custom_properties'];
                    }

                    this._addDomEventHandlers(instance);

                } else {
                    instance['__autocapture_enabled'] = false;
                }
            }, this);

            instance._send_request(
                instance.get_config('api_host') + '/decide/', {
                    'verbose': true,
                    'version': '1',
                    'lib': 'web',
                    'token': token
                },
                {method: 'GET'},
                instance._prepare_callback(parseDecideResponse)
            );
        }
    },

    _editorParamsFromHash: function(instance, hash) {
        var editorParams;
        try {
            var state = _.getHashParam(hash, 'state');
            state = JSON.parse(decodeURIComponent(state));
            var expiresInSeconds = _.getHashParam(hash, 'expires_in');
            editorParams = {
                'accessToken': _.getHashParam(hash, 'access_token'),
                'accessTokenExpiresAt': (new Date()).getTime() + (Number(expiresInSeconds) * 1000),
                'actionId': state['actionId'],
                'projectToken': state['token'],
                'apiURL': state['apiURL'],
                'jsURL': state['jsURL'] || state['apiURL'],
                'temporaryToken': state['temporaryToken']
            };
            window.sessionStorage.setItem('editorParams', JSON.stringify(editorParams));
            window.sessionStorage.setItem('editorActionId', editorParams['actionId']);

            if (state['desiredHash']) {
                window.location.hash = state['desiredHash'];
            } else if (window.history) {
                history.replaceState('', document.title, window.location.pathname + window.location.search); // completely remove hash
            } else {
                window.location.hash = ''; // clear hash (but leaves # unfortunately)
            }
        } catch (e) {
            console.error('Unable to parse data from hash', e);
        }
        return editorParams;
    },

    /**
     * To load the visual editor, we need an access token and other state. That state comes from one of three places:
     * 1. In the URL hash params if the customer is using an old snippet
     * 2. From session storage under the key `_mpcehash` if the snippet already parsed the hash
     * 3. From session storage under the key `editorParams` if the editor was initialized on a previous page
     */
    _maybeLoadEditor: function(instance) {
        try {
            var parseFromUrl = false;
            if (_.getHashParam(window.location.hash, 'state')) {
                var state = _.getHashParam(window.location.hash, 'state');
                state = JSON.parse(decodeURIComponent(state));
                parseFromUrl = state['action'] === 'mpeditor';
            }
            var parseFromStorage = !!window.sessionStorage.getItem('_mpcehash');
            var editorParams;

            if (parseFromUrl) { // happens if they are initializing the editor using an old snippet
                editorParams = this._editorParamsFromHash(instance, window.location.hash);
            } else if (parseFromStorage) { // happens if they are initialized the editor and using the new snippet
                editorParams = this._editorParamsFromHash(instance, window.sessionStorage.getItem('_mpcehash'));
                window.sessionStorage.removeItem('_mpcehash');
            } else { // get credentials from sessionStorage from a previous initialzation
                editorParams = JSON.parse(window.sessionStorage.getItem('editorParams') || '{}');
            }

            if (editorParams['projectToken'] && instance.get_config('token') === editorParams['projectToken']) {
                this._loadEditor(instance, editorParams);
                return true;
            } else {
                return false;
            }
        } catch (e) {
            return false;
        }
    },

    _loadEditor: function(instance, editorParams) {
        var _this = this;
        if (!window['_mpEditorLoaded']) { // only load the codeless event editor once, even if there are multiple instances of PostHogLib
            window['_mpEditorLoaded'] = true;
            var host = (editorParams['jsURL'] || editorParams['apiURL'] || instance.get_config('api_host'))
            var editorUrl = host + (host.endsWith('/') ? '' : '/')
              + 'static/editor.js?_ts='
              + (new Date()).getTime();
            this._loadScript(editorUrl, function() {
                window['ph_load_editor'](editorParams);
            });
            // Turbolinks doesn't fire an onload event but does replace the entire page, including the toolbar
            _.register_event(window, 'turbolinks:load', function() {
                window['_mpEditorLoaded'] = false;
                _this._loadEditor(instance, editorParams);
            });
            return true;
        }
        return false;
    },

    // this is a mechanism to ramp up CE with no server-side interaction.
    // when CE is active, every page load results in a decide request. we
    // need to gently ramp this up so we don't overload decide. this decides
    // deterministically if CE is enabled for this project by modding the char
    // value of the project token.
    enabledForProject: function(token, numBuckets, numEnabledBuckets) {
        numBuckets = !_.isUndefined(numBuckets) ? numBuckets : 10;
        numEnabledBuckets = !_.isUndefined(numEnabledBuckets) ? numEnabledBuckets : 10;
        var charCodeSum = 0;
        for (var i = 0; i < token.length; i++) {
            charCodeSum += token.charCodeAt(i);
        }
        return (charCodeSum % numBuckets) < numEnabledBuckets;
    },

    isBrowserSupported: function() {
        return _.isFunction(document.querySelectorAll);
    }
};

_.bind_instance_methods(autocapture);
_.safewrap_instance_methods(autocapture);

export { autocapture };
