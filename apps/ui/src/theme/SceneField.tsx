import { useThemeId } from './useThemeId';
/** Static theme-colored backdrop, mounted once behind the screen stack. */
export function SceneField(): React.JSX.Element | null {
  const theme = useThemeId();
  if (theme === 'anime' || theme === 'synthwave') return null;
  return (
    <div className="tvm-scene" data-engine="css" aria-hidden="true">
      <div className="tvm-scene__css" />
    </div>
  );
}
