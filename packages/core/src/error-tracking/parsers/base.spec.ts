import { createFrame } from './base'
import { createDefaultStackParser } from './index'

describe('createFrame', () => {
  const platform = 'web:javascript'

  it('marks ordinary browser frames as in_app', () => {
    const frame = createFrame(platform, 'https://example.com/app.js', 'doThing', 1, 2)
    expect(frame.in_app).toBe(true)
  })

  it('does not mark frames Safari has masked as in_app', () => {
    // Safari hides the origin of extension content scripts, and of blob:/eval'd code, behind
    // this placeholder. None of it is the page's own code.
    const frame = createFrame(platform, 'webkit-masked-url://hidden/', '_classCallCheck', 1, 2)
    expect(frame.in_app).toBe(false)
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

  it('falls back to in_app when the parser could not determine a filename', () => {
    // Regex capture groups that do not participate arrive here as undefined despite the type
    const frame = createFrame(platform, undefined as unknown as string, 'doThing')
    expect(frame.in_app).toBe(true)
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
