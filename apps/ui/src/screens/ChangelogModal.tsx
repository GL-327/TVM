import { FocusButton } from '../components/FocusButton';
import { markChangelogSeen, parseChangelogEntry, type ChangelogEntry } from '../data/changelog';
import { formatAppDate } from '../i18n/locale';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function ChangelogModal({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const version = typeof params['version'] === 'string' ? params['version'] : '';
  const appliedAt = typeof params['appliedAt'] === 'string' ? params['appliedAt'] : '';
  const entries: ChangelogEntry[] = Array.isArray(params['entries'])
    ? params['entries'].map(parseChangelogEntry).filter((entry): entry is ChangelogEntry => entry !== null)
    : [];

  const close = (): void => {
    void markChangelogSeen();
    navigate.pop();
  };

  return (
    <div className="panel-scrim" role="dialog" aria-modal="true" aria-label="What's new">
      <section className="panel panel--changelog">
        <h2 className="panel__title">What's new</h2>
        <p className="page__lede">
          {version === '' ? 'This copy just updated from GitHub.' : `Build ${version} is on this device.`}
          {appliedAt !== '' ? ` ${formatAppDate(appliedAt)}.` : ''}
        </p>
        {entries.length > 0 ? (
          <ol className="changelog">
            {entries.map((entry) => (
              <li key={`${entry.sha}-${entry.title}`} className="changelog__item">
                <p className="changelog__title">{entry.title}</p>
                {entry.body !== '' ? <p className="changelog__body">{entry.body}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="page__lede">The latest GitHub changes are now in this interface.</p>
        )}
        <FocusButton id="close" variant="primary" onSelect={close}>
          Close
        </FocusButton>
      </section>
    </div>
  );
}
