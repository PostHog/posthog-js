import { throwError } from './nested'

export function main() {
    throwError()
    throw new Error('Hello from webpack playground !')
}

main()
