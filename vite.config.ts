import { defineConfig, type Plugin } from 'vite';
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
    plugins: [
      {
        name: 'extpay-local-credentials',
        transform(code, id) {
          if (!id.includes('/extpay/dist/')) return;
          // Fail closed if a dependency update changes these privacy/lifecycle patches.
          for (const [needle, expected] of [
            ['browser.storage.sync', 2],
            ["method: 'GET',", 2],
            ["method: 'POST',", 1],
            ['browser.windows.create({', 2],
            ['open_popup(url, 500, 800);', 1],
          ] as const) {
            if (code.split(needle).length - 1 !== expected)
              throw new Error(
                `ExtPay SDK changed: review build adaptation for ${needle}`,
              );
          }
          // Keep licensing credentials on this device, like monitor data.
          return code
            .replaceAll('browser.storage.sync', 'browser.storage.local')
            .replaceAll(
              "method: 'GET',",
              "method: 'GET', signal: AbortSignal.timeout(8000),",
            )
            .replaceAll(
              "method: 'POST',",
              "method: 'POST', signal: AbortSignal.timeout(8000),",
            )
            .replaceAll(
              'browser.windows.create({',
              'await browser.windows.create({',
            )
            .replaceAll(
              'open_popup(url, 500, 800);',
              'await open_popup(url, 500, 800);',
            );
        },
      },
      ...(firefox
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
                    data_collection_permissions: {
                      required: ['none'],
                      optional: [
                        'authenticationInfo',
                        'personallyIdentifyingInfo',
                        'financialAndPaymentInfo',
                      ],
                    },
                  },
                };
                this.emitFile({
                  type: 'asset',
                  fileName: 'manifest.json',
                  source: JSON.stringify(manifest, null, 2) + '\n',
                });
              },
            } satisfies Plugin,
          ]
        : []),
    ],
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
