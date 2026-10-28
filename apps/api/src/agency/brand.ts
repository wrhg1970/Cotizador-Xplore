import { EE_AGENCY_ID, type Agency, type PrismaClient } from '@ee/db';
import type { Env } from '../env.js';
import type { AgencyBrand } from '@ee/contracts';

type BrandRow = Omit<Agency, 'logo'>;
/** Every agency column except the logo bytes. */
export const BRAND_OMIT = { logo: true } as const;

export const toBrand = (a: BrandRow): AgencyBrand => ({
  name: a.name,
  brandName: a.brandName,
  primaryColor: a.primaryColor,
  accentColor: a.accentColor,
  proposalFooter: a.proposalFooter,
  mailFromName: a.mailFromName,
  customDomain: a.customDomain,
  // The timestamp busts caches when the logo changes.
  logoUrl:
    a.logoUpdatedAt && a.logoMime ? `/api/v1/agencies/${a.id}/logo?v=${a.logoUpdatedAt.getTime()}` : null,
});

export const agencyOfOffice = (prisma: Pick<PrismaClient, 'agency'>, officeId: string) =>
  prisma.agency.findFirstOrThrow({ where: { offices: { some: { id: officeId } } }, omit: BRAND_OMIT });

/** Agency served on this hostname: the one that owns it as custom domain, else EE (the default brand). */
export const agencyOfHost = async (prisma: PrismaClient, host: string | undefined) =>
  (host &&
    (await prisma.agency.findFirst({
      where: { customDomain: host.toLowerCase().replace(/:\d+$/, ''), active: true },
      omit: BRAND_OMIT,
    }))) ||
  prisma.agency.findUniqueOrThrow({ where: { id: EE_AGENCY_ID }, omit: BRAND_OMIT });

/** Sender name, links and signature of an agency's automatic emails. */
export const mailBrand = (a: BrandRow, webOrigin: string) => ({
  fromName: a.mailFromName ?? undefined,
  origin: a.customDomain ? `https://${a.customDomain}` : webOrigin,
  signature: `Cotizador de ${a.brandName ?? a.name}. Aviso automático, no respondas este correo.`,
});

/** Look of the emails a school receives: the agency's name, colors and logo; EE's when unset. */
export const clientMailBrand = (a: BrandRow, webOrigin: string) => {
  const { fromName, origin } = mailBrand(a, webOrigin);
  const logo = toBrand(a).logoUrl;
  return {
    fromName,
    origin,
    name: a.brandName ?? a.name,
    primaryColor: a.primaryColor ?? '#00457f',
    accentColor: a.accentColor ?? '#c2410c',
    logoUrl: logo ? `${origin}${logo}` : a.id === EE_AGENCY_ID ? `${origin}/icon.png` : null,
  };
};
export type ClientMailBrand = ReturnType<typeof clientMailBrand>;

/** Google Workspace domains of an agency; EE also keeps the ones in ALLOWED_GOOGLE_DOMAINS. */
export const agencyDomains = (
  a: Pick<Agency, 'id' | 'allowedDomains'>,
  env: Pick<Env, 'ALLOWED_GOOGLE_DOMAINS'>,
) => [...a.allowedDomains, ...(a.id === EE_AGENCY_ID ? env.ALLOWED_GOOGLE_DOMAINS : [])];
