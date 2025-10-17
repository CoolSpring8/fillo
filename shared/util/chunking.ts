const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks to stay well under per-item limits.

export function chunkArrayBuffer(buffer: ArrayBuffer, chunkSize = DEFAULT_CHUNK_SIZE): ArrayBuffer[] {
  if (buffer.byteLength <= chunkSize) {
    return [buffer];
  }

  const chunks: ArrayBuffer[] = [];
  const view = new Uint8Array(buffer);

  for (let offset = 0; offset < view.byteLength; offset += chunkSize) {
    const slice = view.subarray(offset, offset + chunkSize);
    const chunk = new Uint8Array(slice.length);
    chunk.set(slice);
    chunks.push(chunk.buffer);
  }

  return chunks;
}

export function concatChunks(chunks: ArrayBuffer[]): ArrayBuffer {
  if (chunks.length === 1) {
    return chunks[0];
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);

  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}
