import { useThemeId } from './useThemeId';

/** Seven SMPTE-style bars, doubled so the strip can slide half its width and loop. */
const BAR_COUNT = 14;
const BARS = Array.from({ length: BAR_COUNT }, (_, index) => index);

/** Channel numbers the VCR display cycles through. */
export const RETRO_CHANNELS = ['03', '07', '12', '21'] as const;

/** Expanding ident rings, staggered by CSS animation-delay. */
const RINGS = [0, 1, 2, 3] as const;

/** Rainbow arc bands, outermost first: 1970s station-ident colours. */
const ARC_BANDS = ['#d2571c', '#e0a526', '#b8b03a', '#2f9a8a', '#3557a8', '#8c3a7c'] as const;

/**
 * One period of the oscilloscope trace. Drawn twice side by side so the strip
 * can slide half its width and loop without a seam.
 */
const WAVE_PERIOD =
  'M0 40 C 20 40, 20 3, 50 3 S 80 40, 100 40 S 120 77, 150 77 S 180 40, 200 40 ' +
  'C 220 40, 220 8, 250 8 S 280 40, 300 40 S 320 72, 350 72 S 380 40, 400 40';

/**
 * The Retro pack's television set: sunburst, harvest sun, station-ident rings
 * and test-card arc, oscilloscope trace, colour bars, tracking band, scanlines
 * and a VCR on-screen display. Mounted only while the theme is selected so
 * other themes pay nothing for it. No cabinet frame: the picture runs edge
 * to edge.
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
      <div className="rt-set__burst rt-set__burst--counter" />
      <div className="rt-set__burst-fade" />
      <div className="rt-set__sun" />
      <div className="rt-set__rings">
        {RINGS.map((ring) => <i key={ring} />)}
      </div>
      <svg className="rt-set__arc" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax meet">
        {ARC_BANDS.map((colour, index) => (
          <path
            key={colour}
            d={`M ${20 + index * 26} 200 A ${180 - index * 26} ${180 - index * 26} 0 0 1 ${380 - index * 26} 200`}
            fill="none"
            stroke={colour}
            strokeWidth="22"
          />
        ))}
      </svg>
      <div className="rt-set__horizon" />
      <svg className="rt-set__wave" viewBox="0 0 800 80" preserveAspectRatio="none">
        <path d={WAVE_PERIOD} />
        <path d={WAVE_PERIOD} transform="translate(400 0)" />
      </svg>
      <div className="rt-set__bars">
        {BARS.map((bar) => <i key={bar} />)}
      </div>
      <div className="rt-set__track" />
      <div className="rt-set__scan" />
      <div className="rt-set__flicker" />
      <div className="rt-set__osd">
        <span className="rt-set__osd-line">
          <span>CH</span>
          <span className="rt-set__osd-ch">
            {RETRO_CHANNELS.map((channel) => <span key={channel}>{channel}</span>)}
          </span>
        </span>
        <span className="rt-set__osd-line rt-set__osd-play">▶ PLAY</span>
      </div>
    </div>
  );
}
