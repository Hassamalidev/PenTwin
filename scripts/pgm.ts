import { readFileSync } from 'node:fs';

/** Reads a binary PGM (P5): the simplest image file there is. */
export function readPgm(path: string): { width: number; height: number; data: Uint8Array } {
  const bytes = readFileSync(path);
  let at = 0;
  const token = (): string => {
    while (bytes[at] === 32 || bytes[at] === 10 || bytes[at] === 13) at++;
    const start = at;
    while (at < bytes.length && ![32, 10, 13].includes(bytes[at]!)) at++;
    return bytes.toString('latin1', start, at);
  };
  if (token() !== 'P5') throw new Error(`${path} is not a binary PGM`);
  const width = Number(token());
  const height = Number(token());
  token();
  at++;
  return { width, height, data: bytes.subarray(at, at + width * height) };
}
