import { autocaptureFromTouchEvent } from '../src/autocapture'

import goodEvent from './data/autocapture-event.json'
import ignoreEvent from './data/autocapture-event-no-capture.json'

describe('PostHog React Native', () => {
  jest.useRealTimers()
  describe('autocapture', () => {
    const nativeEvent = { pageX: 1, pageY: 2 }
    it('should capture a valid event', () => {
      const mockPostHog = { autocapture: jest.fn() } as any
      autocaptureFromTouchEvent({ _targetInst: goodEvent, nativeEvent }, mockPostHog)
      expect(mockPostHog.autocapture).toHaveBeenCalledTimes(1)
      expect(mockPostHog.autocapture.mock.calls[0]).toMatchSnapshot()
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
