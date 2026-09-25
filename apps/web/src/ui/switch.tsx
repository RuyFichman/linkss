interface SwitchProps { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void; }
export function Switch({ checked, disabled = false, label, onChange }: SwitchProps) {
  return <button type="button" className="ui-switch" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span className="ui-switch-track" aria-hidden="true" /><span>{label}</span></button>;
}
