import { FocusButton } from './FocusButton';

export function Switch({ id, label, checked, onChange, disabled }: {
  id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}): React.JSX.Element {
  return (
    <FocusButton id={id} role="switch" ariaLabel={label} ariaChecked={checked} tabIndex={0}
      className="tvm-switch" disabled={disabled} onSelect={() => onChange(!checked)}>
      <span className="tvm-switch__knob" />
    </FocusButton>
  );
}
