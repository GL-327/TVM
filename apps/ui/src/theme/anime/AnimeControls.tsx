import { useEffect, useState } from 'react';
import { FocusButton } from '../../components/FocusButton';
import { fetchHome, type HomePayload } from '../../data/media';
import { useThemeId } from '../useThemeId';
import { deathNotePage, nextAnimeScene, useAnimeScene } from './catalog';
export function AnimeControls(): React.JSX.Element | null {
  const theme = useThemeId();
  return theme === 'anime' ? <Controls /> : null;
}
function Controls(): React.JSX.Element {
  const scene = useAnimeScene();
  const [home, setHome] = useState<HomePayload | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let live = true;
    const loaded = (event: Event): void => { setHome((event as CustomEvent<HomePayload | null>).detail); setPage(0); };
    window.addEventListener('tvm:home', loaded);
    void fetchHome().then(value => { if (live) setHome(value); });
    return () => { live = false; window.removeEventListener('tvm:home', loaded); };
  }, []);
  const entries = deathNotePage(home?.finished ?? [], page);
  const pages = Math.max(1, Math.ceil((home?.finished?.length ?? 0) / 40));
  return <section className="anime-controls" aria-label="Anime scene">
    <FocusButton id="anime-scene-next" detail={scene.hook} onSelect={() => { nextAnimeScene(); setPage(0); }}>Scene · {scene.title} →</FocusButton>
    {scene.id === 'death-note' && <div className="anime-notebook"><h2>The last page</h2>{entries.length ? <ol start={page * 40 + 1}>{entries.map(item => <li key={item.id}>{item.title}{item.year ? ` · ${item.year}` : ''}</li>)}</ol> : <p>Waiting for a name. Finish a story to write its line.</p>}<FocusButton id="anime-notebook-page" onSelect={() => setPage(n => (n + 1) % pages)}>Page {page + 1} / {pages} →</FocusButton></div>}
  </section>;
}
