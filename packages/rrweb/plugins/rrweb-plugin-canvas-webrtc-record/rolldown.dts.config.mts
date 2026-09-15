import { readFileSync } from 'node:fs';
import declarations from '../../rolldown.dts.config.mts';

const configs = declarations();
for (const config of configs) {
  config.output.banner = '/// <reference path="./simple-peer-light.d.ts" />';
  config.plugins.push({
    name: 'simple-peer-light-declarations',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'simple-peer-light.d.ts',
        source: readFileSync('src/simple-peer-light.d.ts', 'utf8'),
      });
    },
  });
}
export default configs;
