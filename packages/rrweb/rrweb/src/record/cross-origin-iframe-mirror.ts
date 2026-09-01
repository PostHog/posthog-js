import type { ICrossOriginIframeMirror } from '@posthog/rrweb-types';
export default class CrossOriginIframeMirror
  implements ICrossOriginIframeMirror
{
  private iframeRemoteIdToLocalIdMap: WeakMap<
    HTMLIFrameElement,
    Map<number, number>
  > = new WeakMap();
  private iframeLocalIdToRemoteIdMap: WeakMap<
    HTMLIFrameElement,
    Map<number, number>
  > = new WeakMap();

  constructor(private generateIdFn: () => number) {}

  getId(
    iframe: HTMLIFrameElement,
    remoteId: number,
    remoteToLocalMap?: Map<number, number>,
    localToRemoteMap?: Map<number, number>,
  ): number {
    if (remoteId < 0) return remoteId;

    const remoteIdToLocalIdMap =
      remoteToLocalMap || this.getRemoteIdToLocalIdMap(iframe);
    const localIdToRemoteIdMap =
      localToRemoteMap || this.getLocalIdToRemoteIdMap(iframe);

    let localId = remoteIdToLocalIdMap.get(remoteId);
    if (localId === undefined) {
      localId = this.generateIdFn();
      remoteIdToLocalIdMap.set(remoteId, localId);
      localIdToRemoteIdMap.set(localId, remoteId);
    }
    return localId;
  }

  getIds(iframe: HTMLIFrameElement, remoteIds: number[]): number[] {
    const remoteIdToLocalIdMap = this.getRemoteIdToLocalIdMap(iframe);
    const localIdToRemoteIdMap = this.getLocalIdToRemoteIdMap(iframe);
    return remoteIds.map((remoteId) =>
      this.getId(
        iframe,
        remoteId,
        remoteIdToLocalIdMap,
        localIdToRemoteIdMap,
      ),
    );
  }

  getRemoteId(
    iframe: HTMLIFrameElement,
    localId: number,
    map?: Map<number, number>,
  ): number {
    if (typeof localId !== 'number') return localId;
    if (localId < 0) return localId;

    const localIdToRemoteIdMap = map || this.getLocalIdToRemoteIdMap(iframe);
    return localIdToRemoteIdMap.get(localId) ?? -1;
  }

  getRemoteIds(iframe: HTMLIFrameElement, localIds: number[]): number[] {
    const localIdToRemoteIdMap = this.getLocalIdToRemoteIdMap(iframe);

    return localIds.map((localId) =>
      this.getRemoteId(iframe, localId, localIdToRemoteIdMap),
    );
  }

  reset(iframe?: HTMLIFrameElement) {
    if (!iframe) {
      this.iframeRemoteIdToLocalIdMap = new WeakMap();
      this.iframeLocalIdToRemoteIdMap = new WeakMap();
      return;
    }
    this.iframeRemoteIdToLocalIdMap.delete(iframe);
    this.iframeLocalIdToRemoteIdMap.delete(iframe);
  }

  private getRemoteIdToLocalIdMap(iframe: HTMLIFrameElement) {
    let remoteIdToLocalIdMap = this.iframeRemoteIdToLocalIdMap.get(iframe);
    if (!remoteIdToLocalIdMap) {
      remoteIdToLocalIdMap = new Map();
      this.iframeRemoteIdToLocalIdMap.set(iframe, remoteIdToLocalIdMap);
    }
    return remoteIdToLocalIdMap;
  }

  private getLocalIdToRemoteIdMap(iframe: HTMLIFrameElement) {
    let localIdToRemoteIdMap = this.iframeLocalIdToRemoteIdMap.get(iframe);
    if (!localIdToRemoteIdMap) {
      localIdToRemoteIdMap = new Map();
      this.iframeLocalIdToRemoteIdMap.set(iframe, localIdToRemoteIdMap);
    }
    return localIdToRemoteIdMap;
  }
}
