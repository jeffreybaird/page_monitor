import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export default defineConfig(({ mode }) => {
  const firefox = mode === 'firefox';
  return {
    resolve: {
      alias: {
        '#platform': resolve(
          `src/platform/${firefox ? 'firefox' : 'chrome'}.ts`,
        ),
      },
    },
    plugins: firefox
      ? [
          {
            name: 'firefox-manifest',
            async generateBundle() {
              const manifest = JSON.parse(
                await readFile('public/manifest.json', 'utf8'),
              );
              delete manifest.minimum_chrome_version;
              delete manifest.side_panel;
              manifest.permissions = manifest.permissions.filter(
                (permission: string) =>
                  !['offscreen', 'sidePanel'].includes(permission),
              );
              manifest.background = {
                scripts: ['background.js'],
                type: 'module',
              };
              manifest.sidebar_action = {
                default_title: 'Page Monitor',
                default_panel: 'sidepanel.html',
                default_icon: { '128': 'icons/128.png' },
              };
              manifest.browser_specific_settings = {
                gecko: {
                  id: 'page-monitor@local',
                  strict_min_version: '140.0',
                  data_collection_permissions: { required: ['none'] },
                },
              };
              this.emitFile({
                type: 'asset',
                fileName: 'manifest.json',
                source: JSON.stringify(manifest, null, 2) + '\n',
              });
            },
          },
        ]
      : [],
    build: {
      outDir: firefox ? 'dist-firefox' : 'dist',
      rollupOptions: {
        input: {
          sidepanel: resolve('sidepanel.html'),
          ...(firefox ? {} : { offscreen: resolve('offscreen.html') }),
          background: resolve('src/background/index.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
  };
});
