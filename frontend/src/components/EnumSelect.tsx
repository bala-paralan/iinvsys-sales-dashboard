/**
 * Every dropdown in the app. Options come from the pipeline payload's `enums`
 * block — the component takes an enum NAME, not an options array, so a call
 * site cannot quietly substitute a hardcoded list.
 */
import { usePipeline } from '../meta/usePipeline';

interface Props {
  enumName: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

export function EnumSelect({ enumName, value, onChange, placeholder = '— Select —', id }: Props) {
  const { data: meta } = usePipeline();
  const options = meta?.enums[enumName] ?? [];

  return (
    <select
      id={id}
      className="form-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={options.length === 0}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
    </select>
  );
}
