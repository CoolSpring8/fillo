import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Resume Importer',
    description:
      'Import resumes from PDF, extract structured JSON Resume data, and store local profiles.',
    version: '0.1.0',
    manifest_version: 3,
    action: {
      default_popup: 'popup.html',
    },
    options_page: 'options.html',
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: ['https://api.openai.com/*'],
    web_accessible_resources: [
      {
        resources: ['pdf.worker.mjs'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
