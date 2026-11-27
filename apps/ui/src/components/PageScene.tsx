/** Viewport mesh used on Home and the other ribbon destinations. */
export function PageScene(): React.JSX.Element {
  return (
    <div className="home__scene home__scene--mesh" aria-hidden="true">
      <div className="home__bloom-ribbon home__bloom-ribbon--1" />
      <div className="home__bloom-ribbon home__bloom-ribbon--2" />
      <div className="home__bloom-ribbon home__bloom-ribbon--3" />
      <div className="home__bloom-ribbon home__bloom-ribbon--4" />
    </div>
  );
}
