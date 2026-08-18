import type { ReactNode } from 'react';
import { LoopingRow } from './LoopingRow';

interface RailProps {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  bare?: boolean;
}

export function Rail({ title, children, action, id, bare = false }: RailProps): React.JSX.Element {
  return (
    <section className={`rail${bare ? ' rail--bare' : ''}`} data-rail={id}>
      {!bare && title !== undefined && title !== '' && (
        <header className="rail__header">
          <h2 className="rail__title">{title}</h2>
          {action}
        </header>
      )}
      <LoopingRow className="rail__track">{children}</LoopingRow>
    </section>
  );
}
