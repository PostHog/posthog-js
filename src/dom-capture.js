/* eslint camelcase: "off" */

import { _, console } from './utils';

/**
 * DomCapture Object
 * @constructor
 */
var DomCapture = function() {};


// interface
DomCapture.prototype.create_properties = function() {};
DomCapture.prototype.event_handler = function() {};
DomCapture.prototype.after_capture_handler = function() {};

DomCapture.prototype.init = function(posthog_instance) {
    this.mp = posthog_instance;
    return this;
};

/**
 * @param {Object|string} query
 * @param {string} event_name
 * @param {Object=} properties
 * @param {function=} user_callback
 */
DomCapture.prototype.capture = function(query, event_name, properties, user_callback) {
    var that = this;
    var elements = _.dom_query(query);

    if (elements.length === 0) {
        console.error('The DOM query (' + query + ') returned 0 elements');
        return;
    }

    _.each(elements, function(element) {
        _.register_event(element, this.override_event, function(e) {
            var options = {};
            var props = that.create_properties(properties, this);
            var timeout = that.mp.get_config('capture_links_timeout');

            that.event_handler(e, this, options);

            // in case the posthog servers don't get back to us in time
            window.setTimeout(that.capture_callback(user_callback, props, options, true), timeout);

            // fire the captureing event
            that.mp.capture(event_name, props, that.capture_callback(user_callback, props, options));
        });
    }, this);

    return true;
};

/**
 * @param {function} user_callback
 * @param {Object} props
 * @param {boolean=} timeout_occured
 */
DomCapture.prototype.capture_callback = function(user_callback, props, options, timeout_occured) {
    timeout_occured = timeout_occured || false;
    var that = this;

    return function() {
        // options is referenced from both callbacks, so we can have
        // a 'lock' of sorts to ensure only one fires
        if (options.callback_fired) { return; }
        options.callback_fired = true;

        if (user_callback && user_callback(timeout_occured, props) === false) {
            // user can prevent the default functionality by
            // returning false from their callback
            return;
        }

        that.after_capture_handler(props, options, timeout_occured);
    };
};

DomCapture.prototype.create_properties = function(properties, element) {
    var props;

    if (typeof(properties) === 'function') {
        props = properties(element);
    } else {
        props = _.extend({}, properties);
    }

    return props;
};

/**
 * LinkCapture Object
 * @constructor
 * @extends DomCapture
 */
var LinkCapture = function() {
    this.override_event = 'click';
};
_.inherit(LinkCapture, DomCapture);

LinkCapture.prototype.create_properties = function(properties, element) {
    var props = LinkCapture.superclass.create_properties.apply(this, arguments);

    if (element.href) { props['url'] = element.href; }

    return props;
};

LinkCapture.prototype.event_handler = function(evt, element, options) {
    options.new_tab = (
        evt.which === 2 ||
        evt.metaKey ||
        evt.ctrlKey ||
        element.target === '_blank'
    );
    options.href = element.href;

    if (!options.new_tab) {
        evt.preventDefault();
    }
};

LinkCapture.prototype.after_capture_handler = function(props, options) {
    if (options.new_tab) { return; }

    setTimeout(function() {
        window.location = options.href;
    }, 0);
};

/**
 * FormCapture Object
 * @constructor
 * @extends DomCapture
 */
var FormCapture = function() {
    this.override_event = 'submit';
};
_.inherit(FormCapture, DomCapture);

FormCapture.prototype.event_handler = function(evt, element, options) {
    options.element = element;
    evt.preventDefault();
};

FormCapture.prototype.after_capture_handler = function(props, options) {
    setTimeout(function() {
        options.element.submit();
    }, 0);
};


export {
    FormCapture,
    LinkCapture
};
