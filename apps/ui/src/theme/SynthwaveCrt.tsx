import { useThemeId } from './useThemeId';

/** Seven SMPTE-style bars, doubled so the strip can slide half its width and loop. */
const BAR_COUNT = 14;
const BARS = Array.from({ length: BAR_COUNT }, (_, index) => index);

/** Channel numbers the pack ships with. The display shows one; cycling four
 *  of them was four more animations for a detail nobody reads. */
export const RETRO_CHANNELS = ['03', '07', '12', '21'] as const;

/**
 * The Retro pack's television set: a slow sunburst, the SMPTE colour-bar strip,
 * a rolling tracking band, scanlines and a VCR on-screen display.
 *
 * It used to also paint a second counter-rotating sunburst, a harvest sun, four
 * expanding ident rings, a six-band rainbow arc, a horizon glow, an
 * oscilloscope trace and a flicker layer — around eighteen concurrent
 * animations and two rotating conic gradients, competing with the content
 * instead of sitting behind it. What is left is the part that reads as a
 * television; the rest was noise.
 *
 * Mounted only while the theme is selected, so other themes pay nothing.
 */
export function SynthwaveCrt(): React.JSX.Element {
  const theme = useThemeId();
  return <>{theme === 'synthwave' ? <RetroSet /> : null}</>;
}

function RetroSet(): React.JSX.Element {
  return (
    <div className="rt-set" aria-hidden="true">
      <div className="rt-set__tube" />
      <div className="rt-set__burst" />
      <div className="rt-set__burst-fade" />
      <div className="rt-set__bars">
        {BARS.map((bar) => <i key={bar} />)}
      </div>
      <div className="rt-set__track" />
      <div className="rt-set__scan" />
      <div className="rt-set__osd">
        <span className="rt-set__osd-line">
          <span>CH</span>
          <span className="rt-set__osd-ch">{RETRO_CHANNELS[0]}</span>
        </span>
        <span className="rt-set__osd-line rt-set__osd-play">▶ PLAY</span>
      </div>
    </div>
  );
}
