import { expect } from 'chai';
import jsdom from 'jsdom-global';
import sinon from 'sinon';

import { _ } from '../../src/utils';
import { autocapture } from '../../src/autocapture';

import jsdomSetup from './jsdom-setup';

const triggerMouseEvent = function(node, eventType) {
  node.dispatchEvent(new MouseEvent(eventType, {
    bubbles: true,
    cancelable: true,
  }));
}

const simulateClick = function(el) {
  triggerMouseEvent(el, "click");
}


describe('Autocapture system', function() {
  jsdomSetup({
    url: 'https://example.com/about/?query=param',
  });

  describe('_getPropertiesFromElement', function() {
    let div, div2, input, sensitiveInput, hidden, password;
    beforeEach(function() {
      div = document.createElement('div');
      div.className = 'class1 class2 class3'
      div.innerHTML = 'my <span>sweet <i>inner</i></span> text';

      input = document.createElement('input');
      input.value = 'test val';

      sensitiveInput = document.createElement('input');
      sensitiveInput.value = 'test val';
      sensitiveInput.className = 'ph-sensitive';

      hidden = document.createElement('div');
      hidden.setAttribute('type', 'hidden');
      hidden.value = 'hidden val';

      password = document.createElement('div');
      password.setAttribute('type', 'password');
      password.value = 'password val';

      const divSibling = document.createElement('div');
      const divSibling2 = document.createElement('span');

      div2 = document.createElement('div');
      div2.className = 'parent';
      div2.appendChild(divSibling);
      div2.appendChild(divSibling2);
      div2.appendChild(div);
      div2.appendChild(input);
      div2.appendChild(sensitiveInput);
      div2.appendChild(hidden);
      div2.appendChild(password);
    });

    it('should contain the proper tag name', function() {
      const props = autocapture._getPropertiesFromElement(div);
      expect(props['tag_name']).to.equal('div');
    });

    it('should contain class list', function() {
      const props = autocapture._getPropertiesFromElement(div);
      expect(props['classes']).to.deep.equal(['class1', 'class2', 'class3']);
    });

    it('should not collect input value', function() {
      const props = autocapture._getPropertiesFromElement(input);
      expect(props['value']).to.equal(undefined);
    });

    it('should strip element value with class "ph-sensitive"', function() {
      const props = autocapture._getPropertiesFromElement(sensitiveInput);
      expect(props['value']).to.equal(undefined);
    });

    it('should strip hidden element value', function() {
      const props = autocapture._getPropertiesFromElement(hidden);
      expect(props['value']).to.equal(undefined);
    });

    it('should strip password element value', function() {
      const props = autocapture._getPropertiesFromElement(password);
      expect(props['value']).to.equal(undefined);
    });

    it('should contain nth-of-type', function() {
      const props = autocapture._getPropertiesFromElement(div);
      expect(props['nth_of_type']).to.equal(2);
    });

    it('should contain nth-child', function() {
      const props = autocapture._getPropertiesFromElement(password);
      expect(props['nth_child']).to.equal(7);
    });
  });

  describe('isBrowserSupported', function() {
    let orig;
    beforeEach(function() {
      orig = document.querySelectorAll;
    });

    afterEach(function() {
      document.querySelectorAll = orig;
    });

    it('should return true if document.querySelectorAll is a function', function() {
      document.querySelectorAll = function() {};
      expect(autocapture.isBrowserSupported()).to.equal(true);
    });

    it('should return false if document.querySelectorAll is not a function', function() {
      document.querySelectorAll = undefined;
      expect(autocapture.isBrowserSupported()).to.equal(false);
    });
  });

  describe('enabledForProject', function() {
    it('should enable ce for the project with token "d" when 5 buckets are enabled out of 10', function() {
      expect(autocapture.enabledForProject('d', 10, 5)).to.equal(true);
    });
    it('should NOT enable ce for the project with token "a" when 5 buckets are enabled out of 10', function() {
      expect(autocapture.enabledForProject('a', 10, 5)).to.equal(false);
    });
  });

  describe('_previousElementSibling', function() {
    it('should return the adjacent sibling', function() {
      const div = document.createElement('div');
      const sibling = document.createElement('div');
      const child = document.createElement('div');
      div.appendChild(sibling);
      div.appendChild(child);
      expect(autocapture._previousElementSibling(child)).to.equal(sibling);
    });

    it('should return the first child and not the immediately previous sibling (text)', function() {
      const div = document.createElement('div');
      const sibling = document.createElement('div');
      const child = document.createElement('div');
      div.appendChild(sibling);
      div.appendChild(document.createTextNode('some text'));
      div.appendChild(child);
      expect(autocapture._previousElementSibling(child)).to.equal(sibling);
    });

    it('should return null when the previous sibling is a text node', function() {
      const div = document.createElement('div');
      const child = document.createElement('div');
      div.appendChild(document.createTextNode('some text'));
      div.appendChild(child);
      expect(autocapture._previousElementSibling(child)).to.equal(null);
    });
  });

  describe('_loadScript', function() {
    it('should insert the given script before the one already on the page', function() {
      document.body.appendChild(document.createElement('script'));
      const callback = _ => _;
      autocapture._loadScript('https://fake_url', callback);
      const scripts = document.getElementsByTagName('script');
      const new_script = scripts[0];

      expect(scripts.length).to.equal(2);
      expect(new_script.type).to.equal('text/javascript');
      expect(new_script.src).to.equal('https://fake_url/');
      expect(new_script.onload).to.equal(callback);
    });

    it('should add the script to the page when there aren\'t any preexisting scripts on the page', function() {
      const callback = _ => _;
      autocapture._loadScript('https://fake_url', callback);
      const scripts = document.getElementsByTagName('script');
      const new_script = scripts[0];

      expect(scripts.length).to.equal(1);
      expect(new_script.type).to.equal('text/javascript');
      expect(new_script.src).to.equal('https://fake_url/');
      expect(new_script.onload).to.equal(callback);
    });
  });

  describe('_getDefaultProperties', function() {

    it('should return the default properties', function() {
      expect(autocapture._getDefaultProperties('test')).to.deep.equal({
        '$event_type': 'test',
        '$ce_version': 1,
        '$host': 'example.com',
        '$pathname': '/about/',
      });
    });
  });


  describe('_getCustomProperties', function() {
    let customProps;
    let noCustomProps;
    let capturedElem;
    let capturedElemChild;
    let uncapturedElem;
    let sensitiveInput;
    let sensitiveDiv;
    let prop1;
    let prop2;
    let prop3;

    beforeEach(function() {
      capturedElem = document.createElement('div');
      capturedElem.className = 'ce_event';

      capturedElemChild = document.createElement('span');
      capturedElem.appendChild(capturedElemChild);

      uncapturedElem = document.createElement('div');
      uncapturedElem.className = 'uncaptured_event';

      sensitiveInput = document.createElement('input');
      sensitiveInput.className = 'sensitive_event';

      sensitiveDiv = document.createElement('div');
      sensitiveDiv.className = 'sensitive_event';

      prop1 = document.createElement('div');
      prop1.className = '_mp_test_property_1';
      prop1.innerHTML = 'Test prop 1';

      prop2 = document.createElement('div');
      prop2.className = '_mp_test_property_2';
      prop2.innerHTML = 'Test prop 2';

      prop3 = document.createElement('div');
      prop3.className = '_mp_test_property_3';
      prop3.innerHTML = 'Test prop 3';

      document.body.appendChild(uncapturedElem);
      document.body.appendChild(capturedElem);
      document.body.appendChild(sensitiveInput);
      document.body.appendChild(sensitiveDiv);
      document.body.appendChild(prop1);
      document.body.appendChild(prop2);
      document.body.appendChild(prop3);

      autocapture._customProperties = [
        {
          name: 'Custom Property 1',
          css_selector: 'div._mp_test_property_1',
          event_selectors: ['.ce_event'],
        },
        {
          name: 'Custom Property 2',
          css_selector: 'div._mp_test_property_2',
          event_selectors: ['.event_with_no_element'],
        },
        {
          name: 'Custom Property 3',
          css_selector: 'div._mp_test_property_3',
          event_selectors: ['.sensitive_event'],
        },
      ];
    });

    it('should return custom properties for only matching element selectors', function() {
      customProps = autocapture._getCustomProperties([capturedElem]);
      expect(customProps).to.deep.equal({
        'Custom Property 1': 'Test prop 1'
      });
    });

    it('should return no custom properties for elements that do not match an event selector', function() {
      noCustomProps = autocapture._getCustomProperties([uncapturedElem]);
      expect(noCustomProps).to.deep.equal({});
    });

    it('should return no custom properties for sensitive elements', function() {
      // test password field
      sensitiveInput.setAttribute('type', 'password');
      noCustomProps = autocapture._getCustomProperties([sensitiveInput]);
      expect(noCustomProps).to.deep.equal({});
      // verify that capturing the sensitive element along with another element only collects
      // the non-sensitive element's custom properties
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput]);
      expect(customProps).to.deep.equal({'Custom Property 1': 'Test prop 1'});

      // test hidden field
      sensitiveInput.setAttribute('type', 'hidden');
      noCustomProps = autocapture._getCustomProperties([sensitiveInput]);
      expect(noCustomProps).to.deep.equal({});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput]);
      expect(customProps).to.deep.equal({'Custom Property 1': 'Test prop 1'});

      // test field with sensitive-looking name
      sensitiveInput.setAttribute('type', '');
      sensitiveInput.setAttribute('name', 'cc'); // cc assumed to indicate credit card field
      noCustomProps = autocapture._getCustomProperties([sensitiveInput]);
      expect(noCustomProps).to.deep.equal({});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput]);
      expect(customProps).to.deep.equal({'Custom Property 1': 'Test prop 1'});

      // test field with sensitive-looking id
      sensitiveInput.setAttribute('name', '');
      sensitiveInput.setAttribute('id', 'cc'); // cc assumed to indicate credit card field
      noCustomProps = autocapture._getCustomProperties([sensitiveInput]);
      expect(noCustomProps).to.deep.equal({});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveInput]);
      expect(customProps).to.deep.equal({'Custom Property 1': 'Test prop 1'});

      // clean up
      sensitiveInput.setAttribute('type', '');
      sensitiveInput.setAttribute('name', '');
      sensitiveInput.setAttribute('id', '');
    });

    it('should return no custom properties for element with sensitive values', function() {
      // verify the base case DOES capture the custom property
      customProps = autocapture._getCustomProperties([sensitiveDiv]);
      expect(customProps).to.deep.equal({'Custom Property 3': 'Test prop 3'});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv]);
      expect(customProps).to.deep.equal({
        'Custom Property 1': 'Test prop 1',
        'Custom Property 3': 'Test prop 3',
      });

      // test values that look like credit card numbers
      prop3.innerHTML = '4111111111111111'; // valid credit card number
      noCustomProps = autocapture._getCustomProperties([sensitiveDiv]);
      expect(noCustomProps).to.deep.equal({'Custom Property 3': ''});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv]);
      expect(customProps).to.deep.equal({
        'Custom Property 1': 'Test prop 1',
        'Custom Property 3': '',
      });
      prop3.innerHTML = '5105-1051-0510-5100'; // valid credit card number
      noCustomProps = autocapture._getCustomProperties([sensitiveDiv]);
      expect(noCustomProps).to.deep.equal({'Custom Property 3': ''});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv]);
      expect(customProps).to.deep.equal({
        'Custom Property 1': 'Test prop 1',
        'Custom Property 3': '',
      });
      prop3.innerHTML = '1235-8132-1345-5891'; // invalid credit card number
      noCustomProps = autocapture._getCustomProperties([sensitiveDiv]);
      expect(noCustomProps).to.deep.equal({'Custom Property 3': '1235-8132-1345-5891'});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv]);
      expect(customProps).to.deep.equal({
        'Custom Property 1': 'Test prop 1',
        'Custom Property 3': '1235-8132-1345-5891',
      });

      // test values that look like social-security numbers
      prop3.innerHTML = '123-58-1321'; // valid SSN
      noCustomProps = autocapture._getCustomProperties([sensitiveDiv]);
      expect(noCustomProps).to.deep.equal({'Custom Property 3': ''});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv]);
      expect(customProps).to.deep.equal({
        'Custom Property 1': 'Test prop 1',
        'Custom Property 3': '',
      });
      prop3.innerHTML = '1235-81-321'; // invalid SSN
      noCustomProps = autocapture._getCustomProperties([sensitiveDiv]);
      expect(noCustomProps).to.deep.equal({'Custom Property 3': '1235-81-321'});
      customProps = autocapture._getCustomProperties([capturedElem, sensitiveDiv]);
      expect(customProps).to.deep.equal({
        'Custom Property 1': 'Test prop 1',
        'Custom Property 3': '1235-81-321',
      });

      // clean up
      prop3.innerHTML = 'Test prop 3';
    });
  });

  describe('_captureEvent', function() {
    let lib, sandbox;

    const getCapturedProps = function(captureSpy) {
      const captureArgs = captureSpy.args[0];
      const event = captureArgs[0];
      const props = captureArgs[1];
      return props;
    };

    beforeEach(function() {
      sandbox = sinon.createSandbox();
      lib = {
        _ceElementTextProperties: [],
        capture: sandbox.spy(),
      };
    });

    afterEach(function() {
      sandbox.restore();
    });

    it('should add the custom property when an element matching any of the event selectors is clicked', function() {
      lib = {
        _send_request: sandbox.spy((url, params, options, callback) => callback({
          config: {
            enable_collect_everything: true
          },
          custom_properties: [{event_selectors: ['.event-element-1', '.event-element-2'], css_selector: '.property-element', name: 'my property name'}]
        })),
        _prepare_callback: sandbox.spy(callback => callback),
        get_config: sandbox.spy(function(key) {
          switch (key) {
            case 'api_host':
              return 'https://test.com';
            case 'token':
              return 'testtoken';
          }
        }),
        token: 'testtoken',
        capture: sandbox.spy()
      };
      autocapture.init(lib);

      const eventElement1 = document.createElement('div');
      const eventElement2 = document.createElement('div');
      const propertyElement = document.createElement('div');
      eventElement1.className = 'event-element-1';
      eventElement1.style.cursor = 'pointer'
      eventElement2.className = 'event-element-2';
      eventElement2.style.cursor = 'pointer'
      propertyElement.className = 'property-element';
      propertyElement.textContent = 'my property value';
      document.body.appendChild(eventElement1);
      document.body.appendChild(eventElement2);
      document.body.appendChild(propertyElement);

      expect(lib.capture.callCount).to.equal(0);
      simulateClick(eventElement1);
      simulateClick(eventElement2);
      expect(lib.capture.callCount).to.equal(2);
      const captureArgs1 = lib.capture.args[0];
      const captureArgs2 = lib.capture.args[1];
      const eventType1 = captureArgs1[1]['my property name'];
      const eventType2 = captureArgs2[1]['my property name'];
      expect(eventType1).to.equal('my property value');
      expect(eventType2).to.equal('my property value');
      lib.capture.resetHistory();
    });

    it('includes necessary metadata as properties when capturing an event', function() {
      const elTarget = document.createElement('a');
      elTarget.setAttribute('href', 'http://test.com');
      const elParent = document.createElement('span');
      elParent.appendChild(elTarget);
      const elGrandparent = document.createElement('div');
      elGrandparent.appendChild(elParent);
      const elGreatGrandparent = document.createElement('table');
      elGreatGrandparent.appendChild(elGrandparent);
      document.body.appendChild(elGreatGrandparent);
      const e = {
        target: elTarget,
        type: 'click',
      }
      autocapture._captureEvent(e, lib);
      expect(lib.capture.calledOnce).to.equal(true);
      const captureArgs = lib.capture.args[0];
      const event = captureArgs[0];
      const props = captureArgs[1];
      expect(event).to.equal('$autocapture');
      expect(props['$event_type']).to.equal('click');
      expect(props).to.have.property('$host', 'example.com');
      expect(props['$elements'][0]).to.have.property('attr__href', 'http://test.com');
      expect(props['$elements'][1]).to.have.property('tag_name', 'span');
      expect(props['$elements'][2]).to.have.property('tag_name', 'div');
      expect(props['$elements'][props['$elements'].length - 1]).to.have.property('tag_name', 'body');
    });

    it('gets the href attribute from parent anchor tags', function() {
      const elTarget = document.createElement('img');
      const elParent = document.createElement('span');
      elParent.appendChild(elTarget);
      const elGrandparent = document.createElement('a');
      elGrandparent.setAttribute('href', 'http://test.com');
      elGrandparent.appendChild(elParent);
      autocapture._captureEvent({
        target: elTarget,
        type: 'click',
      }, lib);
      expect(getCapturedProps(lib.capture)['$elements'][0]).to.have.property('attr__href', 'http://test.com');
    });

    it('does not capture href attribute values from password elements', function() {
      const elTarget = document.createElement('span');
      const elParent = document.createElement('span');
      elParent.appendChild(elTarget);
      const elGrandparent = document.createElement('input');
      elGrandparent.appendChild(elParent);
      elGrandparent.setAttribute('type', 'password');
      autocapture._captureEvent({
        target: elTarget,
        type: 'click',
      }, lib);
      expect(getCapturedProps(lib.capture)).not.to.have.property('attr__href');
    });

    it('does not capture href attribute values from hidden elements', function() {
      const elTarget = document.createElement('span');
      const elParent = document.createElement('span');
      elParent.appendChild(elTarget);
      const elGrandparent = document.createElement('a');
      elGrandparent.appendChild(elParent);
      elGrandparent.setAttribute('type', 'hidden');
      autocapture._captureEvent({
        target: elTarget,
        type: 'click',
      }, lib);
      expect(getCapturedProps(lib.capture)['$elements'][0]).not.to.have.property('attr__href');
    });

    it('does not capture href attribute values that look like credit card numbers', function() {
      const elTarget = document.createElement('span');
      const elParent = document.createElement('span');
      elParent.appendChild(elTarget);
      const elGrandparent = document.createElement('a');
      elGrandparent.appendChild(elParent);
      elGrandparent.setAttribute('href', '4111111111111111');
      autocapture._captureEvent({
        target: elTarget,
        type: 'click',
      }, lib);
      expect(getCapturedProps(lib.capture)['$elements'][0]).not.to.have.property('attr__href');
    });

    it('does not capture href attribute values that look like social-security numbers', function() {
      const elTarget = document.createElement('span');
      const elParent = document.createElement('span');
      elParent.appendChild(elTarget);
      const elGrandparent = document.createElement('a');
      elGrandparent.appendChild(elParent);
      elGrandparent.setAttribute('href', '123-58-1321');
      autocapture._captureEvent({
        target: elTarget,
        type: 'click',
      }, lib);
      expect(getCapturedProps(lib.capture)['$elements'][0]).not.to.have.property('attr__href');
    });

    it('correctly identifies and formats text content', function() {
      const dom = `
      <div>
        <button id='span1'>Some text</button>
        <div>
          <div>
            <div>
              <img src='' id='img1'/>
              <button>
                <img src='' id='img2'/>
              </button>
            </div>
          </div>
        </div>
      </div>
      <button id='span2'>
        Some super duper really long
        Text with new lines that we'll strip out
        and also we will want to make this text
        shorter since it's not likely people really care
        about text content that's super long and it
        also takes up more space and bandwidth.
        Some super duper really long
        Text with new lines that we'll strip out
        and also we will want to make this text
        shorter since it's not likely people really care
        about text content that's super long and it
        also takes up more space and bandwidth.
      </button>

      `;
      document.body.innerHTML = dom;
      const span1 = document.getElementById('span1');
      const span2 = document.getElementById('span2');
      const img1 = document.getElementById('img1');
      const img2 = document.getElementById('img2');

      const e1 = {
        target: span2,
        type: 'click',
      }
      autocapture._captureEvent(e1, lib);

      const props1 = getCapturedProps(lib.capture);
      expect(props1['$elements'][0]).to.have.property('$el_text', 'Some super duper really long Text with new lines that we\'ll strip out and also we will want to make this text shorter since it\'s not likely people really care about text content that\'s super long and it also takes up more space and bandwidth. Some super d');
      lib.capture.resetHistory();

      const e2 = {
        target: span1,
        type: 'click',
      }
      autocapture._captureEvent(e2, lib);
      const props2 = getCapturedProps(lib.capture);
      expect(props2['$elements'][0]).to.have.property('$el_text', 'Some text');
      lib.capture.resetHistory();

      const e3 = {
        target: img2,
        type: 'click',
      }
      autocapture._captureEvent(e3, lib);
      const props3 = getCapturedProps(lib.capture);
      expect(props3['$elements'][0]).to.have.property('$el_text', '');
    });

    it('does not capture sensitive text content', function() {
      const dom = `
      <div>
        <button id='button1'> Why 123-58-1321 hello there</button>
      </div>
      <button id='button2'>
        4111111111111111
        Why hello there
      </button>
      <button id='button3'>
        Why hello there
        5105-1051-0510-5100
      </button>
      `; // ^ valid credit card and social security numbers

      document.body.innerHTML = dom;
      const button1 = document.getElementById('button1');
      const button2 = document.getElementById('button2');
      const button3 = document.getElementById('button3');

      const e1 = {
        target: button1,
        type: 'click',
      }
      autocapture._captureEvent(e1, lib);
      const props1 = getCapturedProps(lib.capture);
      expect(props1['$elements'][0]).to.have.property('$el_text');
      expect(props1['$elements'][0]['$el_text']).to.match(/Why\s+hello\s+there/);
      lib.capture.resetHistory();

      const e2 = {
        target: button2,
        type: 'click',
      }
      autocapture._captureEvent(e2, lib);
      const props2 = getCapturedProps(lib.capture);
      expect(props2['$elements'][0]).to.have.property('$el_text');
      expect(props2['$elements'][0]['$el_text']).to.match(/Why\s+hello\s+there/);
      lib.capture.resetHistory();

      const e3 = {
        target: button3,
        type: 'click',
      }
      autocapture._captureEvent(e3, lib);
      const props3 = getCapturedProps(lib.capture);
      expect(props3['$elements'][0]).to.have.property('$el_text');
      expect(props3['$elements'][0]['$el_text']).to.match(/Why\s+hello\s+there/);
    });

    it('should capture a submit event with form field props', function() {
      const e = {
        target: document.createElement('form'),
        type: 'submit',
      }
      autocapture._captureEvent(e, lib);
      expect(lib.capture.calledOnce).to.equal(true);
      const props = getCapturedProps(lib.capture);
      expect(props['$event_type']).to.equal('submit');
    });

    it('should capture a click event inside a form with form field props', function() {
      var form = document.createElement('form');
      var link = document.createElement('a');
      var input = document.createElement('input');
      input.name = 'test input';
      input.value = 'test val';
      form.appendChild(link);
      form.appendChild(input);
      const e = {
        target: link,
        type: 'click',
      }
      autocapture._captureEvent(e, lib);
      expect(lib.capture.calledOnce).to.equal(true);
      const props = getCapturedProps(lib.capture);
      expect(props['$event_type']).to.equal('click');
    });

    it('should never capture an element with `ph-no-capture` class', function() {
      const a = document.createElement('a');
      const span = document.createElement('span');
      a.appendChild(span);
      autocapture._captureEvent({target: a, type: 'click'}, lib);
      expect(lib.capture.calledOnce).to.equal(true);
      lib.capture.resetHistory();

      autocapture._captureEvent({target: span, type: 'click'}, lib);
      expect(lib.capture.calledOnce).to.equal(true);
      lib.capture.resetHistory();

      a.className = 'test1 ph-no-capture test2';
      autocapture._captureEvent({target: a, type: 'click'}, lib);
      expect(lib.capture.callCount).to.equal(0);

      autocapture._captureEvent({target: span, type: 'click'}, lib);
      expect(lib.capture.callCount).to.equal(0);
    });
  });

  describe('_addDomEventHandlers', function() {
    const lib = {
      capture: sinon.spy()
    };

    let navigateSpy;

    beforeEach(function() {
      document.title = 'test page';
      autocapture._addDomEventHandlers(lib);
      navigateSpy = sinon.spy(autocapture, '_navigate');
      lib.capture.resetHistory();
    });

    after(function() {
      navigateSpy.restore();
    });

    it('should capture click events', function() {
      const button = document.createElement('button');
      document.body.appendChild(button);
      simulateClick(button);
      simulateClick(button);
      expect(true).to.equal(lib.capture.calledTwice);
      const captureArgs1 = lib.capture.args[0];
      const captureArgs2 = lib.capture.args[1];
      const eventType1 = captureArgs1[1]['$event_type'];
      const eventType2 = captureArgs2[1]['$event_type'];
      expect(eventType1).to.equal('click');
      expect(eventType2).to.equal('click');
      lib.capture.resetHistory();
    });

  });

  describe('init', function() {
    let lib, sandbox, _maybeLoadEditorStub;

    beforeEach(function() {
      document.title = 'test page';
      sandbox = sinon.createSandbox();
      sandbox.spy(autocapture, '_addDomEventHandlers');
      autocapture._initializedTokens = [];
      _maybeLoadEditorStub = sandbox.stub(autocapture, '_maybeLoadEditor').returns(false);
      lib = {
        _prepare_callback: sandbox.spy(callback => callback),
        _send_request: sandbox.spy((url, params, options, callback) => callback({config: {enable_collect_everything: true}})),
        get_config: sandbox.spy(function(key) {
          switch (key) {
            case 'api_host':
              return 'https://test.com';
            case 'token':
              return 'testtoken';
          }
        }),
        token: 'testtoken',
        capture: sandbox.spy(),
      };
    });

    afterEach(function() {
      sandbox.restore();
    });

    it('should call _addDomEventHandlders', function() {
      autocapture.init(lib);
      expect(autocapture._addDomEventHandlers.calledOnce).to.equal(true);
    });

    it('should NOT call _addDomEventHandlders if the decide request fails', function() {
      lib._send_request = sandbox.spy((url, params, options, callback) => callback({status: 0, error: "Bad HTTP status: 400 Bad Request"}));
      autocapture.init(lib);
      expect(autocapture._addDomEventHandlers.called).to.equal(false);
    });

    it('should NOT call _addDomEventHandlders when loading editor', function() {
      _maybeLoadEditorStub.returns(true);
      autocapture.init(lib);
      expect(autocapture._addDomEventHandlers.calledOnce).to.equal(false);
    });

    it('should NOT call _addDomEventHandlders when enable_collect_everything is "false"', function() {
      lib._send_request = sandbox.spy((url, params, callback) => callback({config: {enable_collect_everything: false}}));
      autocapture.init(lib);
      expect(autocapture._addDomEventHandlers.calledOnce).to.equal(false);
    });

    it('should NOT call _addDomEventHandlders when the token has already been initialized', function() {
      var lib2 = Object.assign({}, lib);
      var lib3 = Object.assign({token: 'anotherproject'}, lib);
      lib3.get_config = sandbox.spy(function(key) {
          switch (key) {
            case 'api_host':
              return 'https://test.com';
            case 'token':
              return 'anotherproject';
          }
        });
      autocapture.init(lib);
      expect(autocapture._addDomEventHandlers.callCount).to.equal(1);
      autocapture.init(lib2);
      expect(autocapture._addDomEventHandlers.callCount).to.equal(1);
      autocapture.init(lib3);
      expect(autocapture._addDomEventHandlers.callCount).to.equal(2);
    });

    it('should call instance._send_request', function() {
      autocapture.init(lib);
      expect(lib._send_request.calledOnce).to.equal(true);
      expect(lib._send_request.calledWith('https://test.com/decide/', {
        'verbose': true,
        'version': '1',
        'lib': 'web',
        'token': 'testtoken',
      })).to.equal(true);
    });

    it('should check whether to load the editor', function() {
      autocapture.init(lib);
      expect(autocapture._maybeLoadEditor.calledOnce).to.equal(true);
      expect(autocapture._maybeLoadEditor.calledWith(lib)).to.equal(true);
    });
  });

  describe('_maybeLoadEditor', function() {
    let hash, editorParams, sandbox, lib = {};

    beforeEach(function() {
      window.sessionStorage.clear();

      this.clock = sinon.useFakeTimers();

      sandbox = sinon.createSandbox();
      sandbox.stub(autocapture, '_loadEditor');
      lib.get_config = sandbox.stub();
      lib.get_config.withArgs('token').returns('test_token');
      lib.get_config.withArgs('app_host').returns('test_app_host');

      const userFlags = {
        flag_1: 0,
        flag_2: 1,
      }
      const state = {
        action: 'mpeditor',
        desiredHash: '#myhash',
        projectId: 3,
        projectOwnerId: 722725,
        readOnly: false,
        token: 'test_token',
        userFlags,
        userId: 12345,
      };
      const hashParams = {
        access_token: 'test_access_token',
        state: encodeURIComponent(JSON.stringify(state)),
        expires_in: 3600,
      };
      editorParams = {
        action: 'mpeditor',
        desiredHash: '#myhash',
        projectId: 3,
        projectOwnerId: 722725,
        readOnly: false,
        token: 'test_token',
        userFlags,
        userId: 12345,
        accessToken: 'test_access_token',
        accessTokenExpiresAt: 3600000,
      };

      hash = Object.keys(hashParams).map(k => `${k}=${hashParams[k]}`).join('&');
    });

    afterEach(function() {
      sandbox.restore();
      this.clock.restore();
    });

    it('should initialize the visual editor when the hash state contains action "mpeditor"', function() {
      window.location.hash = `#${hash}`;
      autocapture._maybeLoadEditor(lib);
      expect(autocapture._loadEditor.calledOnce).to.equal(true);
      expect(autocapture._loadEditor.calledWith(lib, editorParams)).to.equal(true);
      expect(JSON.parse(window.sessionStorage.getItem('editorParams'))).to.deep.equal(editorParams);
    });

    it('should initialize the visual editor when the hash was parsed by the snippet', function() {
      window.sessionStorage.setItem('_mpcehash', `#${hash}`);
      autocapture._maybeLoadEditor(lib);
      expect(autocapture._loadEditor.calledOnce).to.equal(true);
      expect(autocapture._loadEditor.calledWith(lib, editorParams)).to.equal(true);
      expect(JSON.parse(window.sessionStorage.getItem('editorParams'))).to.deep.equal(editorParams);
    });

    it('should NOT initialize the visual editor when the activation query param does not exist', function() {
      autocapture._maybeLoadEditor(lib);
      expect(autocapture._loadEditor.calledOnce).to.equal(false);
    });

    it('should return false when parsing invalid JSON from fragment state', function() {
      const hashParams = {
        access_token: 'test_access_token',
        state: "literally",
        expires_in: 3600,
      };
      hash = Object.keys(hashParams).map(k => `${k}=${hashParams[k]}`).join('&');
      window.location.hash = `#${hash}`;
      var spy = sinon.spy(autocapture, "_maybeLoadEditor");
      spy(lib);
      expect(spy.returned(false)).to.equal(true);
    });
  });

  describe('load and close editor', function() {
    const lib = {};
    let sandbox;

    beforeEach(function() {
      autocapture._editorLoaded = false;
      sandbox = sinon.createSandbox();
      sandbox.stub(autocapture, '_loadScript').callsFake((path, callback) => callback());
      lib.get_config = sandbox.stub();
      lib.get_config.withArgs('app_host').returns('example.com');
      lib.get_config.withArgs('token').returns('token');
      window.ph_load_editor = sandbox.spy();
    });

    afterEach(function() {
      sandbox.restore();
    });

    it('should load if not previously loaded', function() {
      const editorParams = {
        accessToken: 'accessToken',
        expiresAt: 'expiresAt',
        apiKey: 'apiKey',
        apiURL: 'http://localhost:8000',
      };
      const loaded = autocapture._loadEditor(lib, editorParams);
      expect(window.ph_load_editor.calledOnce).to.equal(true);
      expect(window.ph_load_editor.calledWithExactly(editorParams)).to.equal(true);
      expect(loaded).to.equal(true);
    });

    it('should NOT load if previously loaded', function() {
      autocapture._loadEditor(lib, 'accessToken');
      const loaded = autocapture._loadEditor(lib, 'accessToken');
      expect(loaded).to.equal(false);
    });
  });
});
