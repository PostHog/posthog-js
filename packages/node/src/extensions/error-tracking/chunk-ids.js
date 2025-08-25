// Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
// Licensed under the MIT License
let parsedStackResults;
let lastKeysCount;
let cachedFilenameChunkIds;
export function getFilenameToChunkIdMap(stackParser) {
    const chunkIdMap = globalThis._posthogChunkIds;
    if (!chunkIdMap) {
        console.error('No chunk id map found');
        return {};
    }
    const chunkIdKeys = Object.keys(chunkIdMap);
    if (cachedFilenameChunkIds && chunkIdKeys.length === lastKeysCount) {
        return cachedFilenameChunkIds;
    }
    lastKeysCount = chunkIdKeys.length;
    cachedFilenameChunkIds = chunkIdKeys.reduce((acc, stackKey) => {
        if (!parsedStackResults) {
            parsedStackResults = {};
        }
        const result = parsedStackResults[stackKey];
        if (result) {
            acc[result[0]] = result[1];
        }
        else {
            const parsedStack = stackParser(stackKey);
            for (let i = parsedStack.length - 1; i >= 0; i--) {
                const stackFrame = parsedStack[i];
                const filename = stackFrame?.filename;
                const chunkId = chunkIdMap[stackKey];
                if (filename && chunkId) {
                    acc[filename] = chunkId;
                    parsedStackResults[stackKey] = [filename, chunkId];
                    break;
                }
            }
        }
        return acc;
    }, {});
    return cachedFilenameChunkIds;
}
//# sourceMappingURL=chunk-ids.js.map