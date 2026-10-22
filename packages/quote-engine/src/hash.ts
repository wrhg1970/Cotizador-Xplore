import { createHash } from 'node:crypto';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** JSON with sorted keys so the same snapshot always yields the same hash. */
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as Json)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const calculationHash = (snapshot: Json): string =>
  `sha256:${createHash('sha256').update(canonicalJson(snapshot)).digest('hex')}`;
