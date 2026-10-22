import { randomInt } from 'node:crypto';

// No 0/O/1/I so folios read well over the phone.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const FOLIO_PATTERN = /^EE-\d{4}-[2-9A-HJ-NP-Z]{6}$/;

/** Readable and random (US-196): knowing one folio says nothing about the next. */
export function newFolio(now = new Date()): string {
  const suffix = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `EE-${now.getUTCFullYear()}-${suffix}`;
}
