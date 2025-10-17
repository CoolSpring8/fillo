import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?worker&url';

GlobalWorkerOptions.workerSrc = workerSrc;

const Y_BUCKET_SIZE = 2;

interface LineFragment {
  x: number;
  str: string;
}

function bucketY(value: number): number {
  return Math.round(value / Y_BUCKET_SIZE);
}

function buildTextFromItems(items: TextItem[]): string {
  const lines = new Map<number, LineFragment[]>();

  for (const item of items) {
    if (!item.str?.trim()) {
      continue;
    }

    const transform = item.transform ?? [];
    const y = bucketY(transform[5] ?? 0);
    const x = transform[4] ?? 0;

    const fragments = lines.get(y) ?? [];
    fragments.push({ x, str: item.str });
    lines.set(y, fragments);
  }

  return Array.from(lines.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([_, fragments]) =>
      fragments
        .sort((a, b) => a.x - b.x)
        .map((fragment) => fragment.str)
        .join(' '),
    )
    .join('\n');
}

export async function extractTextFromPdf(file: File): Promise<{ text: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  try {
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = buildTextFromItems(content.items as TextItem[]);
      if (text.trim().length > 0) {
        pages.push(text.trim());
      }
    }

    return { text: pages.join('\n\n') };
  } finally {
    await pdf.destroy();
  }
}
