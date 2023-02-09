// Same as loader-globals.ts except includes rrweb scripts.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import rrwebRecord from 'rrweb/es/rrweb/packages/rrweb/src/record'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import 'rrweb/es/rrweb/packages/rrweb/src/plugins/console/record'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
window.rrweb = { record: rrwebRecord }
