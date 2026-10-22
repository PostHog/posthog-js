import { emailContentHash } from '@/email-content-hash'

describe('emailContentHash', () => {
  it.each([
    {
      content: { subject: 'Welcome, {{ variables.first_name }}', html: '<p>Hi {{ variables.first_name }}</p>' },
      hash: 'v1:f74cd913f3aa2e5667a588f2865634e56693df77793ca594d18e9b5f89e3d2e6',
    },
    {
      content: { subject: 'Grüße', preheader: 'Vorschau', html: '<p>ä</p>', text: 'ä' },
      hash: 'v1:75cf6fc3189ca26f60da672d29a1d4c89c7db3dd458df3a550a34a4d2a92c149',
    },
    {
      content: {
        subject: 'Welcome, {{ variables.first_name }}',
        html: '<p>Hi {{ variables.first_name }}</p>',
        text: '\r\n\r',
      },
      hash: 'v1:8112876ee1b2dd7327f571b04b546ed057bfff5a904d9f0ae507b6a449ab6453',
    },
  ])('matches the content_hash v1 test vector of the server: $hash', async ({ content, hash }) => {
    expect(await emailContentHash(content)).toBe(hash)
  })

  it('hashes CRLF and lone CR line endings like LF', async () => {
    const lf = await emailContentHash({ subject: 'Hi', html: '<p>\na\nb\n</p>' })

    expect(await emailContentHash({ subject: 'Hi', html: '<p>\r\na\rb\r\n</p>' })).toBe(lf)
  })
})
