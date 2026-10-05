const MAX_UPLOAD_METADATA_BYTES = 2048;

/** Enforce a byte limit on the actual stream, not only the optional size header. */
export async function readUploadJson(request: Request, allowEmpty = false): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_UPLOAD_METADATA_BYTES)) {
    await request.body?.cancel().catch(() => undefined);
    throw new Error("Invalid upload metadata size.");
  }
  if (!request.body) {
    if (allowEmpty) return {};
    throw new Error("Upload metadata is required.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_UPLOAD_METADATA_BYTES) {
        await reader.cancel();
        throw new Error("Upload metadata exceeds its size limit.");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  if (!length && allowEmpty) return {};
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
