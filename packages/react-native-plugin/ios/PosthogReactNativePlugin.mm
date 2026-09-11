#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(PosthogReactNativePlugin, RCTEventEmitter)

RCT_EXTERN_METHOD(setup:(NSString)sessionId
                 withSdkOptions:(NSDictionary)sdkOptions
                 withPluginConfig:(NSDictionary)pluginConfig
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(start:(NSString)sessionId
                 withSdkOptions:(NSDictionary)sdkOptions
                 withSdkReplayConfig:(NSDictionary)sdkReplayConfig
                 withDecideReplayConfig:(NSDictionary)decideReplayConfig
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startSession:(NSString)sessionId
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isEnabled:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endSession:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(identify:(NSString)distinctId
                  withAnonymousId:(NSString)anonymousId
                  withResolver:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startRecording:(BOOL)resumeCurrent
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopRecording:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(addExceptionStep:(NSString)message
                 withProperties:(NSDictionary)properties
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(reset:(NSString)distinctId
                 withAnonymousId:(NSString)anonymousId
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(registerPushNotificationToken:(NSString)deviceToken
                 withAppId:(NSString)appId
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(unregisterPushNotificationToken:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setOptOut:(BOOL)optOut
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(capturePushNotificationOpened:(NSDictionary)properties
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(providePushIdentityToken:(NSString)requestId
                 withToken:(NSString)token
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end

#if TARGET_OS_IOS
#import <UIKit/UIKit.h>

// Implemented in PosthogReactNativePlugin.swift.
@interface PosthogReactNativePlugin (PushNotificationOpenPrewarm)
+ (void)prewarmPushNotificationOpenCapture;
@end

// A notification tap that cold-launches the app is delivered right after launch, long before JS
// reaches setup(), and native modules are created lazily, so no module code runs in time. This
// runs at image load, like the RCT_EXTERN_MODULE registration above, so the host app needs no code.
__attribute__((constructor)) static void PosthogReactNativePluginObserveLaunch(void)
{
  [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(__unused NSNotification *notification) {
                                                  [PosthogReactNativePlugin prewarmPushNotificationOpenCapture];
                                                }];
}
#endif
