export interface HeroArtState {
  current: string;
  previous: string;
}

/** Only a decoded image can replace the last good frame. */
export function readyHeroArt(state: HeroArtState, loaded: string, requested: string): HeroArtState {
  if (loaded !== requested || loaded === '' || state.current === loaded) return state;
  return { current: loaded, previous: state.current };
}

/** Late transition events cannot discard a newer transition's backing image. */
export function settleHeroArt(state: HeroArtState, src: string): HeroArtState {
  return state.current === src && state.previous !== '' ? { current: src, previous: '' } : state;
}
