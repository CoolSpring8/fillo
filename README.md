# Fillo

Tab-complete any job form. Built for the Google Chrome Built-in AI Challenge 2025.

Fillo is a browser extension that pulls structured data from your resume, maps it to application forms, and partners with AI to finish repetitive fields for you. It ships with a side panel workflow, inline prompt overlay, and options workspace so you can review every fill before it lands in the page.

## Highlights
- Resume workspace that parses PDFs into a JSON Resume-compatible profile and lets you edit every field before saving.
- Side panel scanner that classifies inputs on any job form, shows live context, and lets you accept, tweak, or reject fills from your profile.
- Guided AI suggestions powered by Chrome's on-device Gemini Nano (when available) or your own OpenAI API key for harder prompts.
- Inline "tab complete" overlay that surfaces the best slot match, AI suggestion, and recent manual values without leaving the form.
- Field-label adapters for English and Simplified Chinese plus autocomplete/ID heuristics so international sites still resolve the right slot.
- Lightweight memory system that remembers the values you approved or corrected most often and offers them first next time.
- Context menu and toolbar entry points that pop open the side panel when you're focused on an input.

## Getting Started

### Prerequisites
- Google Chrome >= 138 if you plan to use the on-device AI.
- Node.js and [pnpm](https://pnpm.io/) installed locally.

### Installation
```bash
pnpm install
```
The postinstall hook bootstraps localization typings and prepares the WXT extension scaffold.

### Run the extension during development
```bash
pnpm dev
```
This launches the WXT runner and opens an isolated Chrome profile with Fillo loaded.

### Build artifacts
```bash
pnpm build        # Production build in dist/
pnpm zip          # Zip the latest build for store upload
```

### Tests and type checks
```bash
pnpm test -- --run   # Single-pass Vitest run
pnpm compile         # TypeScript with no emit
```

## Using Fillo
1. Open the options workspace (`options.html`) to upload or paste your resume. Fillo extracts text from PDFs, validates against the JSON Resume schema, and stores multiple profiles locally.
2. Choose an AI provider. Gemini Nano runs on-device when Chrome makes it available; OpenAI requires an API key, model, and optional custom base URL.
3. Pick which field-label adapters are active and configure autofill fallback behavior (skip or pause when confidence is low).
4. Navigate to a job application form. Activate the side panel from the toolbar icon or the editable-field context menu, then start a scan to classify fields.
5. Accept fills individually, trigger AI suggestions for tricky questions, or switch to manual copy mode. Fillo logs accepted values so future scans suggest them first.
6. Toggle the inline overlay from the popup to "tab complete" directly in the page when you already know the right match.

## Localization
Fillo localizes UI through `@wxt-dev/i18n`. Whenever you add visible strings, create a key in both `locales/en.yml` and `locales/zh-CN.yml`, then re-run `pnpm install` or `node scripts/bootstrap-i18n.mjs` to refresh typings.

## License
MIT
