import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/i18n/module', '@wxt-dev/module-react'],
  manifest: {
    default_locale: 'en',
    name: 'Resume Importer',
    description:
      'Import resumes from PDF, extract structured JSON Resume data, and store local profiles.',
    version: '0.1.0',
    manifest_version: 3,
    action: {
      default_title: 'Resume Helper',
    },
    options_page: 'options.html',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'sidePanel', 'contextMenus'],
    host_permissions: [
      'https://api.openai.com/*',
      'https://*.greenhouse.io/*',
      'https://*.lever.co/*',
      'https://*.myworkdayjobs.com/*',
      'https://*.ashbyhq.com/*',
      'https://*.smartrecruiters.com/*',
      'https://*.workable.com/*',
    ],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    web_accessible_resources: [
      {
        resources: ['pdf.worker.mjs'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
