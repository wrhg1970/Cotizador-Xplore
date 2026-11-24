import type { QuoteReview } from '@ee/db';

/**
 * Authorization signatures (Will, 2026-11-23): an approver who did not prepare a quote authorizes it
 * alone; when one of the signers prepared or corrected it, a second, different approver must sign too.
 */
export const PREPARER_SIGNED = 'Firma de quien la preparó';
/** An approver took a version in review (or a new copy of an approved one) to fix it himself; it stays editable for him until he returns or submits it. */
export const CORRECTION_PREFIX = 'En corrección por el autorizador';
/** Will (2026-11-24): the platform super admin's signature completes a version alone, even one he prepared or corrected. */
export const SUPER_ADMIN_SIGNED = 'Firma del súper admin';

type Review = Pick<QuoteReview, 'reviewerId' | 'decision' | 'comment'>;
interface Signed {
  createdById: string;
  status: string;
  reviews: Review[];
}

const isCorrection = (r: Review) => r.decision === 'RETURNED' && !!r.comment?.startsWith(CORRECTION_PREFIX);

/** Whoever built, quotes, corrected or signed as preparer of this version. */
export function preparerIds(v: Signed, assigneeId: string | null): Set<string> {
  const ids = new Set([v.createdById]);
  if (assigneeId) ids.add(assigneeId);
  for (const r of v.reviews)
    if (r.reviewerId && (r.comment === PREPARER_SIGNED || isCorrection(r))) ids.add(r.reviewerId);
  return ids;
}

/** Approvals given since the version last went back to the quoter. */
export function signersThisRound<R extends Review>(v: { reviews: R[] }): R[] {
  const lastReturn = v.reviews.findLastIndex((x) => x.decision === 'RETURNED');
  return v.reviews.slice(lastReturn + 1).filter((x) => x.decision === 'APPROVED');
}

/** One signature, or two once a preparer is among the signers; the super admin's always counts alone. */
export function signaturesNeeded(signers: readonly Review[], preparers: Set<string>): 1 | 2 {
  if (signers.some((s) => s.comment?.startsWith(SUPER_ADMIN_SIGNED))) return 1;
  return signers.some((s) => s.reviewerId !== null && preparers.has(s.reviewerId)) ? 2 : 1;
}

/** True while this approver is correcting the version (he opened the correction and nobody moved it since). */
export function isCorrecting(v: Signed, userId: string): boolean {
  const last = v.reviews.at(-1);
  const editable = v.status === 'RETURNED' || v.status === 'DRAFT';
  return editable && !!last && isCorrection(last) && last.reviewerId === userId;
}

/** The committee line on Dictaminar, e.g. "Firmas 1/2: Ana (la preparó). Falta la firma de otro autorizador". */
export function signatureSummary(
  v: Signed & { reviews: (Review & { reviewer?: { name: string } | null })[] },
  preparers: Set<string>,
): string {
  const signers = signersThisRound(v);
  if (!signers.length) return 'Una firma de un autorizador; dos si firma quien la preparó o corrigió';
  const needed = signaturesNeeded(signers, preparers);
  const names = signers.map((s) =>
    s.reviewerId === null
      ? 'regla de Administración'
      : `${s.reviewer?.name ?? '—'}${preparers.has(s.reviewerId) ? ' (la preparó)' : ''}`,
  );
  const missing = signers.length < needed ? '. Falta la firma de otro autorizador' : '';
  return `Firmas ${Math.min(signers.length, needed)}/${needed}: ${names.join(', ')}${missing}`;
}
