import path from 'path';
import config from '../vite.config.default';

const workspacePackages: Record<string, string> = {
  '@posthog/rrweb': path.resolve(__dirname, '../rrweb/src/entries/record.ts'),
  '@posthog/rrweb-snapshot': path.resolve(
    __dirname,
    '../rrweb-snapshot/src/record.ts',
  ),
  '@posthog/rrdom': path.resolve(__dirname, '../rrdom/src/index.ts'),
};

export default config(path.resolve(__dirname, 'src/index.ts'), 'rrweb', {
  plugins: [
    {
      name: 'resolve-workspace-sources',
      enforce: 'pre' as const,
      resolveId(source: string) {
        if (workspacePackages[source]) {
          return workspacePackages[source];
        }
      },
    },
  ],
});
