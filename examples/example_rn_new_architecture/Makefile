.PHONY: clean install run doctor

# Xcode build fails with 'butter/map.h' file not found
# https://github.com/facebook/react-native/issues/38520#issuecomment-1764167506
clean:
	rm -rf ios/Podfile.lock ios/Pods

install:
	cd ios && bundle install && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install

# export ANDROID_HOME=$HOME/Library/Android/sdk
run:
	yarn ios
	yarn android

doctor:
	npx react-native doctor
