import { createFrame } from './base'
import { createDefaultStackParser } from './index'

describe.each(['web:javascript', 'hermes'] as const)('createFrame (%s)', (platform) => {
  it('marks ordinary browser frames as in_app', () => {
    const frame = createFrame(platform, 'https://example.com/app.js', 'doThing', 1, 2)
    expect(frame.in_app).toBe(true)
  })

  it.each([
    ['Safari masking an extension content script', 'webkit-masked-url://hidden/'],
    ['an Android in-app browser bridge', 'iabjs://navigation_performance_logger_android'],
    ['a Chromium extension content script', 'chrome-extension://abcdef/content.js'],
    ['a Firefox extension content script', 'moz-extension://abcdef/content.js'],
    ['a Safari extension, which the parser prefixes with a bare scheme', 'safari-extension:abcdef/content.js'],
    ['a Safari web extension', 'safari-web-extension:abcdef/content.js'],
    ['an extension with a mixed-case scheme', 'CHROME-Extension://abcdef/content.js'],
    ['an unknown container scheme', 'other-bridge://injected.js'],
    ['an inline data URL', 'data:text/javascript,void 0'],
  ])('does not mark a frame the container injected as in_app: %s', (_name, filename) => {
    const frame = createFrame(platform, filename, 'doThing', 1, 2)
    expect(frame.in_app).toBe(false)
  })

  it.each([
    ['a script served over http', 'http://localhost:8000/app.js'],
    ['a Cordova or Electron app served from disk', 'file:///android_asset/www/app.js'],
    ['a worker the page created from a blob', 'blob:https://example.com/6b0b0e6a'],
    ['a Capacitor webview', 'capacitor://localhost/app.js'],
    ['an Ionic webview', 'ionic://localhost/app.js'],
    ['a script with a mixed-case scheme', 'HTTPS://example.com/app.js'],
    ['a webpack source frame', 'webpack:///./src/App.js'],
    ['an Angular JIT component', 'ng:///CheckoutComponent.js'],
    ['a custom app scheme, as an Electron or React Native shell serves', 'app://checkout.js'],
    ['a bundler-rewritten dev frame', 'webpack-internal:///./src/App.js'],
    ['a React Native release bundle, which has no scheme', 'index.android.bundle'],
    ['an absolute path with no scheme', '/data/user/0/com.example/files/index.bundle'],
    ['a Windows path with backslashes', 'C:\\app\\index.bundle'],
    ['a Windows path with forward slashes', 'C:/app/index.bundle'],
  ])("still marks the app's own code as in_app: %s", (_name, filename) => {
    const frame = createFrame(platform, filename, 'doThing', 1, 2)
    expect(frame.in_app).toBe(true)
  })

  it('keeps the masked frame rather than discarding it', () => {
    const frame = createFrame(platform, 'webkit-masked-url://hidden/', 'someFn', 3, 4)
    expect(frame).toMatchObject({
      filename: 'webkit-masked-url://hidden/',
      function: 'someFn',
      lineno: 3,
      colno: 4,
    })
  })

  it('does not mark Chromium <anonymous> frames as in_app', () => {
    // Chromium reports scripts that have no URL (extension-injected code, devtools, string eval)
    // as `<anonymous>`. They can never be symbolicated and are not attributable to the page.
    const frame = createFrame(platform, '<anonymous>', '?', 1, 394)
    expect(frame.in_app).toBe(false)
    expect(frame).toMatchObject({ filename: '<anonymous>', function: '?', lineno: 1, colno: 394 })
  })

  it('does not mark frames without a filename as in_app', () => {
    // Regex capture groups that do not participate arrive here as undefined despite the type
    const frame = createFrame(platform, undefined as unknown as string, 'doThing')
    expect(frame.in_app).toBe(false)
  })

  it('does not mark frames with an empty filename as in_app', () => {
    const frame = createFrame(platform, '', 'sendDataToNative', 1, 10198)
    expect(frame.in_app).toBe(false)
    expect(frame).toMatchObject({ function: 'sendDataToNative', lineno: 1, colno: 10198 })
  })
})

describe('createDefaultStackParser in_app classification', () => {
  const parse = createDefaultStackParser()

  it('demotes a bare <anonymous> frame from injected code', () => {
    const frames = parse("SyntaxError: Failed to execute 'appendChild' on 'Node': boom\n    at <anonymous>:1:394")
    expect(frames).toEqual([
      { platform: 'web:javascript', filename: '<anonymous>', function: '?', in_app: false, lineno: 1, colno: 394 },
    ])
  })

  it('demotes the native bridge frames an Android in-app browser injects', () => {
    // The bridge script has no URL, so every frame arrives as `at <fn> (:1:<col>)`.
    const frames = parse(
      'Error: Error invoking postMessage: Java object is gone\n' +
        '    at sendDataToNative (:1:10198)\n' +
        '    at sendJsBlockingTimeMessage (:1:14668)'
    )
    expect(frames.map((f) => [f.function, f.in_app])).toEqual([
      ['sendJsBlockingTimeMessage', false],
      ['sendDataToNative', false],
    ])
  })

  it('demotes the bridge frames an Android in-app browser serves from its own scheme', () => {
    const frames = parse(
      'Error: Error invoking postMessage: Java object is gone\n' +
        '    at sendDataToNative (iabjs://navigation_performance_logger_android:1:10198)\n' +
        '    at sendJsBlockingTimeMessage (iabjs://navigation_performance_logger_android:1:14668)'
    )
    expect(frames.map((f) => [f.function, f.in_app])).toEqual([
      ['sendJsBlockingTimeMessage', false],
      ['sendDataToNative', false],
    ])
  })

  it.each([
    '    at CheckoutComponent_Template (ng:///CheckoutComponent.js:10:5)',
    'CheckoutComponent_Template@ng:///CheckoutComponent.js:10:5',
  ])('keeps Angular JIT application frames as in_app: %s', (stackLine) => {
    const frames = parse(`Error: template failed\n${stackLine}`)
    expect(frames).toEqual([
      expect.objectContaining({
        filename: 'ng:///CheckoutComponent.js',
        function: 'CheckoutComponent_Template',
        lineno: 10,
        colno: 5,
        in_app: true,
      }),
    ])
  })

  it.each([
    'webkit-masked-url://hidden/',
    '<anonymous>',
    'iabjs://navigation_performance_logger_android',
    'chrome-extension://abcdef/content.js',
    'moz-extension://abcdef/content.js',
  ])('retains injected frames without demoting the calling app frame: %s', (filename) => {
    const frames = parse(
      `Error: boom\n    at injected (${filename}:1:2)\n    at checkout (https://example.com/app.js:10:5)`
    )
    expect(frames.map((frame) => [frame.filename, frame.in_app])).toEqual([
      ['https://example.com/app.js', true],
      [filename, false],
    ])
  })

  it("keeps the page's own eval'd code as in_app", () => {
    // V8 attributes eval'd code to the script that called eval; the chrome parser already
    // rewrites these frames to that URL, so they must not be caught by the <anonymous> rule.
    const frames = parse(
      'Error: boom\n' +
        '    at eval (eval at <anonymous> (https://example.com/app.js:10:5), <anonymous>:1:394)\n' +
        '    at https://example.com/app.js:10:5'
    )
    expect(frames.map((f) => [f.filename, f.in_app])).toEqual([
      ['https://example.com/app.js', true],
      ['https://example.com/app.js', true],
    ])
  })
})
