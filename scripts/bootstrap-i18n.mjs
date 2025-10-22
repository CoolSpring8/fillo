import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const wxtDir = path.join(root, '.wxt');
const i18nDir = path.join(wxtDir, 'i18n');
const indexPath = path.join(i18nDir, 'index.ts');
const structurePath = path.join(i18nDir, 'structure.d.ts');

const indexStub = `import { createI18n } from '@wxt-dev/i18n';

export const i18n = createI18n();
`;

const structureStub = `export interface GeneratedI18nStructure {
  [key: string]: {
    substitutions: number;
  };
}
`;

async function ensureFile(filePath, contents) {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    await writeFile(filePath, contents, 'utf8');
  }
}

async function main() {
  await mkdir(i18nDir, { recursive: true });
  await ensureFile(indexPath, indexStub);
  await ensureFile(structurePath, structureStub);
}

void main();
