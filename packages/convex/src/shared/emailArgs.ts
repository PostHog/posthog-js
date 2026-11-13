import { v, type GenericValidator } from 'convex/values'

const addresses = v.union(v.string(), v.array(v.string()))

const tracking = v.union(
  v.boolean(),
  v.object({ opens: v.optional(v.boolean()), clicks: v.optional(v.boolean()), engagement: v.optional(v.boolean()) })
)

/** The arguments of the component's `emails.send`. The client checks an email against them before it sends or queues. */
export const emailArgs = {
  to: v.string(),
  subject: v.string(),
  templateKey: v.string(),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
  from: v.optional(v.string()),
  replyTo: v.optional(addresses),
  cc: v.optional(addresses),
  bcc: v.optional(addresses),
  attachments: v.optional(
    v.array(
      v.object({
        filename: v.string(),
        content: v.string(),
        contentType: v.optional(v.string()),
        contentId: v.optional(v.string()),
      })
    )
  ),
  distinctId: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  sensitive: v.optional(v.boolean()),
  tracking: v.optional(tracking),
}

/** The first field of `email` that `emails.send` doesn't take, as a path such as `attachments[0].disposition`. */
export function fieldNotSent(email: object): string | undefined {
  return fieldOutside(email, v.object(emailArgs), '')
}

function fieldOutside(value: unknown, validator: GenericValidator, path: string): string | undefined {
  if (validator.kind === 'object' && isRecord(value)) {
    for (const [key, field] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key
      const fieldValidator = validator.fields[key] as GenericValidator | undefined
      const outside = fieldValidator ? fieldOutside(field, fieldValidator, at) : field === undefined ? undefined : at
      if (outside) {
        return outside
      }
    }
  }
  if (validator.kind === 'array' && Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const outside = fieldOutside(element, validator.element, `${path}[${index}]`)
      if (outside) {
        return outside
      }
    }
  }
  if (validator.kind === 'union') {
    const member = validator.members.find(
      (m: GenericValidator) => (m.kind === 'object' && isRecord(value)) || (m.kind === 'array' && Array.isArray(value))
    )
    return member ? fieldOutside(value, member, path) : undefined
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
