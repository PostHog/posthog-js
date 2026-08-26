import { autocaptureFromTouchEvent } from '../src/autocapture'

import goodEvent from './data/autocapture-event.json'
import ignoreEvent from './data/autocapture-event-no-capture.json'

describe('PostHog React Native', () => {
  jest.useRealTimers()
  describe('autocapture', () => {
    const nativeEvent = { pageX: 1, pageY: 2 }
    const localeProviderFiber = {
      elementType: { name: 'LocaleProvider' },
      memoizedProps: {},
      return: {
        elementType: { name: 'Text' },
        memoizedProps: { children: 'Fire 100 events' },
        return: null,
      },
    }
    it('should capture a valid event', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      autocaptureFromTouchEvent({ _targetInst: goodEvent, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      expect(mockPostHog.autocapture.mock.calls[0]).toMatchSnapshot()
    })

    it('should capture a valid event via the target fiber fallback when _targetInst is absent', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      const fallbackEvent = { target: { ['__reactFiber$abc123']: goodEvent }, nativeEvent }
      autocaptureFromTouchEvent(fallbackEvent, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      expect(mockPostHog.autocapture.mock.calls[0]).toMatchSnapshot()
    })

    it('should skip framework-internal components so the touched component heads the chain', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      autocaptureFromTouchEvent({ target: { ['__reactFiber$abc123']: localeProviderFiber }, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const elements = mockPostHog.autocapture.mock.calls[0][1]
      expect(elements.map((el: any) => el.tag_name)).toEqual(['Text'])
    })

    it('should keep an app component named LocaleProvider on the native _targetInst path', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      autocaptureFromTouchEvent({ _targetInst: localeProviderFiber, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const elements = mockPostHog.autocapture.mock.calls[0][1]
      expect(elements.map((el: any) => el.tag_name)).toEqual(['LocaleProvider', 'Text'])
    })

    it('should not throw when nativeEvent is missing', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      const fallbackEvent = { target: { ['__reactFiber$abc123']: goodEvent } }
      expect(() => autocaptureFromTouchEvent(fallbackEvent, mockPostHog)).not.toThrow()
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
    })

    it('should walk up to an ancestor that carries the fiber key', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      const parent = { ['__reactFiber$abc123']: goodEvent, parentNode: null }
      autocaptureFromTouchEvent({ target: { parentNode: parent }, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
    })

    it('should give up rather than loop when no ancestor carries the fiber key', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      const cyclic: any = {}
      cyclic.parentNode = cyclic
      expect(() => autocaptureFromTouchEvent({ target: cyclic, nativeEvent }, mockPostHog)).not.toThrow()
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(0)
    })

    it('should keep a user-set ph-label that collides with a framework-internal name', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      const labelledFiber = {
        elementType: { name: 'Pressable' },
        memoizedProps: { 'ph-label': 'LocaleProvider' },
        return: null,
      }
      autocaptureFromTouchEvent({ target: { ['__reactFiber$abc123']: labelledFiber }, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const elements = mockPostHog.autocapture.mock.calls[0][1]
      expect(elements.map((el: any) => el.tag_name)).toEqual(['LocaleProvider'])
    })

    it('should keep an app component named LocaleProvider above the touched node on web', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      const appLocaleProvider = {
        elementType: { name: 'Pressable' },
        memoizedProps: {},
        return: localeProviderFiber,
      }
      autocaptureFromTouchEvent({ target: { ['__reactFiber$abc123']: appLocaleProvider }, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const elements = mockPostHog.autocapture.mock.calls[0][1]
      expect(elements.map((el: any) => el.tag_name)).toEqual(['Pressable', 'LocaleProvider', 'Text'])
    })

    it('should resolve a fiber more than ten plain-DOM ancestors above the target', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      let node: any = { ['__reactFiber$abc123']: goodEvent }
      for (let i = 0; i < 25; i++) {
        node = { parentNode: node }
      }
      autocaptureFromTouchEvent({ target: node, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
    })

    it('should capture via the legacy __reactInternalInstance$ fallback key', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      const fallbackEvent = { target: { ['__reactInternalInstance$xyz789']: goodEvent }, nativeEvent }
      autocaptureFromTouchEvent(fallbackEvent, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
    })

    it.each([
      [
        'the fallback fiber resolves to a no-capture element',
        () => ({ target: { ['__reactFiber$abc123']: ignoreEvent }, nativeEvent }),
      ],
      ['the target has no fiber key', () => ({ target: {}, nativeEvent })],
      ['the event has no target', () => ({ nativeEvent })],
      [
        'target key enumeration throws',
        () => ({
          target: new Proxy(
            {},
            {
              ownKeys: () => {
                throw new Error('boom')
              },
            }
          ),
          nativeEvent,
        }),
      ],
    ])('should not capture or throw when %s', (_, makeEvent) => {
      // the throwing-target case warns once; setup.ts turns an unhandled console.warn into a failure
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const mockPostHog = { autocapture: jest.fn() } as any
      expect(() => autocaptureFromTouchEvent(makeEvent(), mockPostHog)).not.toThrow()
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(0)
      warn.mockRestore()
    })

    it('should warn once when reading the target fiber throws', async () => {
      // fresh module: the warn-once flag is module state, already tripped by the cases above
      jest.resetModules()
      const { autocaptureFromTouchEvent: freshAutocapture } = await import('../src/autocapture')
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const throwingEvent = (): any => ({
        target: new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('boom')
            },
          }
        ),
        nativeEvent,
      })
      const mockPostHog = { autocapture: jest.fn() } as any

      freshAutocapture(throwingEvent(), mockPostHog)
      freshAutocapture(throwingEvent(), mockPostHog)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(0)
      warn.mockRestore()
    })

    it('should ignore an invalid event', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      autocaptureFromTouchEvent({ _targetInst: ignoreEvent, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(0)
    })

    it('should handle animated styles without errors', () => {
      const mockPostHog = { autocapture: jest.fn() } as any

      // Mock a Reanimated animated style
      const animatedStyle = {
        _isReanimatedSharedValue: true,
        _value: { opacity: 1 },
        __reanimatedHostObjectRef: {},
      }

      const eventWithAnimatedStyle = {
        _targetInst: {
          elementType: { name: 'TouchableOpacity' },
          memoizedProps: {
            style: animatedStyle,
            children: 'Test Button',
          },
          return: null,
        },
        nativeEvent,
      }

      // Should not throw error when processing animated styles
      expect(() => {
        autocaptureFromTouchEvent(eventWithAnimatedStyle, mockPostHog)
      }).not.toThrow()

      // Should still capture the event, just with empty style
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const capturedElement = mockPostHog.autocapture.mock.calls[0][1][0]
      expect(capturedElement.attr__style).toBe('')
      expect(capturedElement.$el_text).toBe('Test Button')
    })

    it.each([
      ['string', 'the target'],
      ['number', 0],
      ['boolean', false],
    ] as const)('should capture %s data-ph-capture-attribute values', (_type, value) => {
      const mockPostHog = { autocapture: jest.fn() } as any

      const eventWithCaptureAttributes = {
        _targetInst: {
          elementType: { name: 'Text' },
          memoizedProps: {
            children: 'Tap me',
            'data-ph-capture-attribute-target-augment': value,
          },
          return: null,
        },
        nativeEvent,
      }

      autocaptureFromTouchEvent(eventWithCaptureAttributes, mockPostHog)

      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const capturedProperties = mockPostHog.autocapture.mock.calls[0][2]
      expect(capturedProperties).toMatchObject({
        $touch_x: 1,
        $touch_y: 2,
        'target-augment': value,
      })
    })

    it.each([
      ['empty string value', 'data-ph-capture-attribute-empty-value', '', 'empty-value'],
      ['empty attribute suffix', 'data-ph-capture-attribute-', 'empty suffix', ''],
      ['object value', 'data-ph-capture-attribute-object-value', { value: 'object' }, 'object-value'],
    ] as const)('should ignore data-ph-capture-attribute props with %s', (_case, key, value, propertyKey) => {
      const mockPostHog = { autocapture: jest.fn() } as any

      const eventWithCaptureAttributes = {
        _targetInst: {
          elementType: { name: 'Text' },
          memoizedProps: {
            children: 'Tap me',
            [key]: value,
          },
          return: null,
        },
        nativeEvent,
      }

      autocaptureFromTouchEvent(eventWithCaptureAttributes, mockPostHog)

      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const capturedProperties = mockPostHog.autocapture.mock.calls[0][2]
      if (propertyKey) {
        expect(capturedProperties).not.toHaveProperty(propertyKey)
      } else {
        expect(Object.prototype.hasOwnProperty.call(capturedProperties, '')).toBe(false)
      }
    })

    it('should capture data-ph-capture-attribute props from ignored labels', () => {
      const mockPostHog = { autocapture: jest.fn() } as any

      const eventWithCaptureAttributes = {
        _targetInst: {
          elementType: { name: 'Text' },
          memoizedProps: {
            children: 'Tap me',
            testID: 'target-id',
            'data-ph-capture-attribute-target-augment': 'the target',
          },
          return: {
            elementType: { name: 'View' },
            memoizedProps: {
              testID: 'parent-id',
              'data-ph-capture-attribute-parent-augment': 'the parent',
            },
            return: null,
          },
        },
        nativeEvent,
      }

      autocaptureFromTouchEvent(eventWithCaptureAttributes, mockPostHog, { ignoreLabels: ['View'] })

      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const capturedElements = mockPostHog.autocapture.mock.calls[0][1]
      const capturedProperties = mockPostHog.autocapture.mock.calls[0][2]
      expect(capturedElements).toHaveLength(1)
      expect(capturedElements[0].attr__testID).toBe('target-id')
      expect(capturedProperties).toMatchObject({
        $touch_x: 1,
        $touch_y: 2,
        'target-augment': 'the target',
        'parent-augment': 'the parent',
      })
    })

    it('should handle mixed animated and regular styles', () => {
      const mockPostHog = { autocapture: jest.fn() } as any

      const mixedStyle = [
        { backgroundColor: 'red', padding: 10 },
        {
          opacity: {
            _isReanimatedSharedValue: true,
            _value: 1,
          },
        },
      ]

      const eventWithMixedStyle = {
        _targetInst: {
          elementType: { name: 'View' },
          memoizedProps: {
            style: mixedStyle,
            testID: 'test-view',
          },
          return: null,
        },
        nativeEvent,
      }

      autocaptureFromTouchEvent(eventWithMixedStyle, mockPostHog)

      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      const capturedElement = mockPostHog.autocapture.mock.calls[0][1][0]
      // Should capture regular styles but skip animated values
      expect(capturedElement.attr__style).toContain('backgroundColor:red')
      expect(capturedElement.attr__style).toContain('padding:10')
      expect(capturedElement.attr__style).not.toContain('opacity')
    })
  })
})
