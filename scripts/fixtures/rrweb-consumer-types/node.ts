// Existing Node consumers must keep using their own Node globals and stream types.
import type { Duplex } from 'node:stream'
import SimplePeer from 'simple-peer-light'
const duplex: Duplex = peer
const typedPeer: SimplePeer.Instance = peer
const constructedPeer: ReturnType<typeof plugin.setupPeer> = new SimplePeer()
const buffer: Buffer = Buffer.from('test')
peer.send(buffer)
void duplex
void typedPeer
void constructedPeer
