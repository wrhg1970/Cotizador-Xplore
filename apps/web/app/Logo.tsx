const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The agency's own logo when it uploaded one; otherwise the official Xplore Together logo
 * (Canva brand kit), both versions rendered so CSS shows the one that fits the theme.
 */
export function Logo({ height, src, alt }: { height: number; src?: string | null; alt?: string }) {
  if (src) return <img src={src} alt={alt ?? 'Logo'} height={height} style={{ width: 'auto' }} />;
  const width = Math.round((height * 447) / 240);
  return (
    <>
      <img
        className="logo-light"
        src="/marca/xt-logo-claro.png"
        alt="Xplore Together"
        width={width}
        height={height}
      />
      <img
        className="logo-dark"
        src="/marca/xt-logo-oscuro.png"
        alt="Xplore Together"
        width={width}
        height={height}
      />
    </>
  );
}

/** Agency colors over the light theme; dark mode keeps its tuned palette for contrast. */
export function BrandColors({
  brand,
}: {
  brand: { primaryColor: string | null; accentColor: string | null } | null;
}) {
  // The API validates the format too; checked again because it lands inside a <style>.
  const ink = brand?.primaryColor && HEX.test(brand.primaryColor) ? brand.primaryColor : null;
  const accent = brand?.accentColor && HEX.test(brand.accentColor) ? brand.accentColor : null;
  if (!ink && !accent) return null;
  const vars = [ink && `--ink: ${ink};`, accent && `--accent: ${accent}; --accent-strong: ${accent};`]
    .filter(Boolean)
    .join(' ');
  return <style>{`@media not (prefers-color-scheme: dark) { :root { ${vars} } }`}</style>;
}
