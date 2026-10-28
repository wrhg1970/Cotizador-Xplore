/** Official Xplore Together logo (Canva brand kit). Both versions render; CSS shows the one that fits the theme. */
export function Logo({ height }: { height: number }) {
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
