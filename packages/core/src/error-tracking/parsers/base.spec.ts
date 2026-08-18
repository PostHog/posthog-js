import { createFrame } from './base'

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

  it('falls back to in_app when the parser could not determine a filename', () => {
    // Regex capture groups that do not participate arrive here as undefined despite the type
    const frame = createFrame(platform, undefined as unknown as string, 'doThing')
    expect(frame.in_app).toBe(true)
  })
})
