import { describe, expect, it } from 'vitest';
import { sniffFileKind } from './file-kind';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sniffFileKind', () => {
  it('recognises the kinds of file the app accepts by their first bytes', () => {
    expect(sniffFileKind(ascii('%PDF-1.7\n...'))).toBe('pdf');
    expect(sniffFileKind(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe('zip');
    expect(sniffFileKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('jpeg');
    expect(sniffFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png');
    expect(sniffFileKind(ascii('RIFF\x10\x00\x00\x00WEBPVP8 '))).toBe('webp');
    expect(sniffFileKind(ascii('GIF89a'))).toBe('gif');
  });

  it('accepts a PDF with a little junk before its marker, as readers do', () => {
    expect(sniffFileKind(ascii('\n\n  %PDF-1.4'))).toBe('pdf');
    // Too far in to be a PDF: it is just text that mentions one.
    expect(sniffFileKind(ascii(`${'a'.repeat(2000)}%PDF-1.4`))).toBe('text');
  });

  it('tells plain text from binary files with no known signature', () => {
    expect(sniffFileKind(ascii('Dear Sara,\r\n\tthank you.\n'))).toBe('text');
    expect(
      sniffFileKind(new TextEncoder().encode('caf\u00e9 \u2014 \u0645\u0631\u062d\u0628\u0627')),
    ).toBe('text');
    expect(sniffFileKind(new Uint8Array(0))).toBe('text');
    // An old .doc file, and a Windows program.
    expect(sniffFileKind(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0))).toBe(
      'unknown',
    );
    expect(sniffFileKind(bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00))).toBe('unknown');
  });

  it('is not fooled by a name: only the bytes count', () => {
    // A program renamed to .pdf or .jpg is still not a PDF or a picture.
    const program = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00);
    expect(sniffFileKind(program)).not.toBe('pdf');
    expect(sniffFileKind(program)).not.toBe('jpeg');
    // A web page renamed to .png is text, not a picture.
    expect(sniffFileKind(ascii('<html><script>alert(1)</script></html>'))).toBe('text');
  });
});
