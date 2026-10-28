/** Allowed attachment types, decided from the bytes (and the extension only to tell ZIP-based Office files apart). */
const OFFICE: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const TEXT: Record<string, string> = { csv: 'text/csv', txt: 'text/plain' };

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

/** The MIME type to store and serve, or null when the file is not on the allowlist. */
export function sniffMime(buf: Buffer, fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]) && ext === 'pdf') return 'application/pdf';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && ext === 'png') return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff]) && (ext === 'jpg' || ext === 'jpeg')) return 'image/jpeg';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && OFFICE[ext]) return OFFICE[ext];
  if (
    TEXT[ext] &&
    !buf.includes(0) &&
    new TextDecoder('utf-8', { fatal: false }).decode(buf).indexOf('�') === -1
  )
    return TEXT[ext];
  return null;
}
