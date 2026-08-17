import { FocusButton } from './FocusButton';

const ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

interface OnScreenKeyboardProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  idPrefix?: string;
}

export function OnScreenKeyboard({
  value,
  onChange,
  onSubmit,
  idPrefix = 'key',
}: OnScreenKeyboardProps): React.JSX.Element {
  return (
    <section className="osk" aria-label="On-screen keyboard">
      {ROWS.map((row, rowIndex) => (
        <div className="osk__row" key={`row-${rowIndex}`}>
          {row.map((key) => (
            <FocusButton
              key={key}
              id={`${idPrefix}-${key.toLowerCase()}`}
              className="osk__key"
              onSelect={() => onChange(`${value}${key.toLowerCase()}`)}
            >
              {key}
            </FocusButton>
          ))}
        </div>
      ))}
      <div className="osk__row osk__row--actions">
        <FocusButton id={`${idPrefix}-space`} className="osk__key osk__key--wide" onSelect={() => onChange(`${value} `)}>
          Space
        </FocusButton>
        <FocusButton
          id={`${idPrefix}-backspace`}
          className="osk__key osk__key--wide"
          onSelect={() => onChange(value.slice(0, -1))}
        >
          Delete
        </FocusButton>
        <FocusButton id={`${idPrefix}-clear`} className="osk__key osk__key--wide" onSelect={() => onChange('')}>
          Clear
        </FocusButton>
        <FocusButton id={`${idPrefix}-search`} className="osk__key osk__key--wide" variant="primary" onSelect={onSubmit}>
          Search
        </FocusButton>
      </div>
    </section>
  );
}
