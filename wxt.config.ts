import { defineConfig } from 'wxt';

// WXT configuration for ApplyForge — see https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // WXT auto-injects `options_ui: {page: "options.html"}` whenever
    // src/entrypoints/options/ exists, even if we set `options_page` in the
    // manifest config. With both present, Chrome uses options_ui and ignores
    // options_page → the page opens inside the chrome://extensions modal
    // instead of a full tab. Strip options_ui post-generation so only
    // options_page wins.
    'build:manifestGenerated': (_wxt, manifest) => {
      delete (manifest as { options_ui?: unknown }).options_ui;
    },
  },
  manifest: {
    name: 'ApplyForge — AI 活动报名助手',
    description: '基于你的项目档案 + 历史经验，自动填写各类活动报名表单',
    version: '0.1.0',
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      'sidePanel',
      'downloads',
    ],
    host_permissions: [
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      '<all_urls>',
    ],
    action: {
      default_title: 'ApplyForge',
      default_icon: {
        16: 'icon/16.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    // Use the legacy `options_page` instead of `options_ui` — WXT 0.19 strips
    // the `open_in_tab` flag from options_ui during build (it ends up as just
    // `{page:"options.html"}` in the final manifest, defaulting to the
    // embedded chrome://extensions modal). `options_page` has no equivalent
    // flag because it ALWAYS opens in a full tab. Equivalent UX without the
    // bug.
    options_page: 'options.html',
    icons: {
      16: 'icon/16.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.anthropic.com https://api.openai.com https://*.sentry.io",
    },
  },
  vite: () => ({
    build: { target: 'esnext' },
  }),
});
