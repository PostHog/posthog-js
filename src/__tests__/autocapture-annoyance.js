import sinon from 'sinon'

import { autocapture } from '../autocapture'
import { getNestedSpanText } from '../autocapture-utils'

jest.mock('../autocapture-utils', () => {
    const actualModule = jest.requireActual('../autocapture-utils')

    return {
        __esModule: true,
        ...actualModule,
        getNestedSpanText: jest.fn(() => 'mocked foo'),
    }
})

describe('Autocapture system', () => {
    let lib, sandbox

    const getCapturedProps = function (captureSpy) {
        const captureArgs = captureSpy.args[0]
        return captureArgs[1]
    }

    beforeEach(() => {
        console.error = () => {}
        jest.spyOn(window.console, 'log').mockImplementation()
        sandbox = sinon.createSandbox()
        lib = {
            _ceElementTextProperties: [],
            get_distinct_id() {
                return 'distinctid'
            },
            capture: sandbox.spy(),
            get_config: sandbox.spy(function (key) {
                switch (key) {
                    case 'mask_all_element_attributes':
                        return false
                    case 'rageclick':
                        return true
                }
            }),
        }
    })

    afterEach(() => {
        sandbox.restore()

        document.getElementsByTagName('html')[0].innerHTML = ''
    })

    it('is annoying', () => {
        const dom = `
      <div>
        <label>
          <label>
            <label>
              <button id="button">
                <span id='inside-span'>the span text</span>
              </button>
            </label>
          </label>
        </label>
      </div>
      `
        document.body.innerHTML = dom
        const btn = document.getElementById('button')

        const e1 = {
            target: btn,
            type: 'click',
        }

        getNestedSpanText
            .mockImplementationOnce(() => 'mocked foo')
            .mockImplementationOnce(() => {
                throw Error('wat')
            })

        autocapture._captureEvent(e1, lib)

        expect(getNestedSpanText).toHaveBeenCalled()

        sinon.assert.notCalled(lib.capture)
    })
})
