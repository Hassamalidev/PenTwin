/** What a file really is, judged by its first bytes rather than its name. */
export type FileKind = 'pdf' | 'zip' | 'jpeg' | 'png' | 'webp' | 'gif' | 'text' | 'unknown';

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * Looks at the start of a file and says what it is. A file's name and the type a browser
 * reports are both chosen by whoever sent it; the bytes are what will actually be parsed.
 * A Word document (.docx) is a zip archive. `text` means: no signature, and nothing in
 * the first few kilobytes that plain text would not contain.
 */
export function sniffFileKind(bytes: Uint8Array): FileKind {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip';

  // "%PDF-" may be preceded by a little junk; readers accept it within the first kilobyte.
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 5 <= head.length; i++) {
    if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d], i)) return 'pdf';
  }

  if (bytes.length === 0) return 'text';
  const sample = bytes.subarray(0, 4096);
  for (const byte of sample) {
    // Control characters other than tab, line feed, form feed and carriage return.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b) || byte === 0x0b) {
      return 'unknown';
    }
  }
  return 'text';
}
