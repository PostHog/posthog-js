import path from 'path';
import config from '../vite.config.default';

export default config(path.resolve(__dirname, 'src/index.ts'), 'rrweb', {
  plugins: [
    {
      name: 'resolve-rrweb-replay-source',
      enforce: 'pre',
      resolveId(source) {
        if (source === '@posthog/rrweb') {
          return path.resolve(__dirname, '../rrweb/src/entries/replay.ts');
        }
        if (source === '@posthog/rrweb/dist/style.css') {
          return path.resolve(__dirname, '../rrweb/src/replay/styles/style.css');
        }
      },
    },
  ],
});
