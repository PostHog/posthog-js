@public @acceptance @sdk:client
Feature: Supplemental Electron bootstrapped flag integration
  SDK-owned integration evidence, not published sdk-specs conformance.

  Scenario: Cached getters return native bootstrapped values and decoded payload
    Given an isolated SDK with empty persistent storage
    And the mock PostHog server is reset
    And the SDK is initialized with token "phc_test_key" and JSON configuration:
      """application/json
      {"preload_feature_flags":false,"disable_remote_feature_flags":true,"bootstrap":{"featureFlags":{"beta":true,"variant":"test","off":false},"featureFlagPayloads":{"variant":{"message":"hello"}}}}
      """
    When get feature flag "beta" is called
    Then the returned feature flag value should be true
    When get feature flag "off" is called
    Then the returned feature flag value should be false
    When get feature flag "variant" is called
    Then the returned feature flag value should be "test"
    When get feature flag payload "variant" is called
    Then the returned payload should include:
      | field   | value |
      | message | hello |
    When pending captures are flushed
    Then exactly 1 capture request should have been received
    And every capture request path should be one of:
      | path    |
      | /batch/ |
