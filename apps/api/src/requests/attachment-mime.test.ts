import { describe, expect, it } from 'vitest';
import { sniffMime } from './attachment-mime.js';

const b = (...x: number[]) => Buffer.from(x);

describe('attachment allowlist', () => {
  it('accepts allowed types only when bytes and extension agree', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'), 'carta.PDF')).toBe('application/pdf');
    expect(sniffMime(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 'foto.png')).toBe('image/png');
    expect(sniffMime(b(0xff, 0xd8, 0xff, 0xe0), 'foto.jpeg')).toBe('image/jpeg');
    expect(sniffMime(b(0x50, 0x4b, 0x03, 0x04, 1), 'costos.xlsx')).toContain('spreadsheetml');
    expect(sniffMime(Buffer.from('grupo,alumnos\nRoma,10'), 'lista.csv')).toBe('text/csv');
  });

  it('rejects mismatches, executables, HTML and binary text', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7'), 'carta.exe')).toBeNull();
    expect(sniffMime(b(0x4d, 0x5a, 0x90), 'setup.pdf')).toBeNull();
    expect(sniffMime(Buffer.from('<html><script>'), 'page.html')).toBeNull();
    expect(sniffMime(b(0x50, 0x4b, 0x03, 0x04), 'archivo.zip')).toBeNull();
    expect(sniffMime(b(0x61, 0, 0x62), 'datos.csv')).toBeNull();
    expect(sniffMime(b(0xff, 0xfe, 0x00), 'datos.txt')).toBeNull();
  });
});
