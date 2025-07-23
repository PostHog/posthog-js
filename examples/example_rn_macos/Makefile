.PHONY: clean install run build

# Xcode build fails with 'butter/map.h' file not found
# https://github.com/facebook/react-native/issues/38520#issuecomment-1764167506
clean:
	cd macos && rm -rf Pods && rm -rf Podfile.lock && rm -rf build && pod cache clean --all && pod install

install:
	cd macos && pod install

run:
	yarn macos

build:
	xcodebuild -workspace macos/example_rn_macos.xcworkspace -configuration Debug -scheme example_rn_macos-macOS
