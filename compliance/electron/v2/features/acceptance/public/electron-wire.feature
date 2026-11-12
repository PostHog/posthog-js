@public @acceptance @sdk:client
Feature: Supplemental Electron public wire integration
  SDK-owned integration evidence, not published sdk-specs conformance.

  Background:
    Given an isolated SDK with empty persistent storage
    And the mock PostHog server is reset
    And the SDK is initialized with token "phc_test_key" and JSON configuration:
      """application/json
      {"flush_at":1,"preload_feature_flags":false,"disable_remote_feature_flags":true}
      """

  Scenario: Ambient client capture delivers native metadata and supplied properties
    When capture is called with JSON arguments:
      """application/json
      {"event":"electron_capture","properties":{"enabled":false,"count":0,"label":""}}
      """
    And pending captures are flushed
    Then exactly 1 capture request should have been received
    And the first received event field "event" should equal "electron_capture"
    And the first received event UUID should be valid
    And the first received event should contain root field "timestamp"
    And the first received event should contain property "$lib"
    And the first received event property "enabled" should equal JSON false
    And the first received event property "count" should equal JSON 0
    And the first received event property "label" should equal JSON ""
    And the first request body should contain a batch array and an api_key field

  Scenario: Identify uses native client identity and literal person properties
    When identify is called with JSON arguments:
      """application/json
      {"distinct_id":"electron-person","set":{"email":"test@example.invalid","count":0}}
      """
    And pending captures are flushed
    Then exactly 1 capture request should have been received
    And the first received event field "event" should equal "$identify"
    And the first received event field "distinct_id" should equal "electron-person"
    And the first received event property "$set" should equal JSON {"email":"test@example.invalid","count":0}

  Scenario: Handled native TypeError retains its type message and stack
    When capture exception is called with JSON arguments:
      """application/json
      {"error":{"type":"TypeError","message":"electron handled failure"},"properties":{"source":"fixture"}}
      """
    And pending captures are flushed
    Then exactly 1 capture request should have been received
    And the first received event field "event" should equal "$exception"
    And the first received event's primary exception should have type "TypeError" and message "electron handled failure"
    And the first received event's primary exception should be handled
    And the first received event's primary exception should have stack frames
