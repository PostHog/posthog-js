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
