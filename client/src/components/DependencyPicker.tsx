export interface LinkOption {
  id: number;
  name: string;
  status: string;
  phaseName: string;
}

interface Props {
  options: LinkOption[];
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}

/**
 * "Comes after" as a chip list: chosen items show as removable chips, and the
 * select underneath appends another. An item opens only when every linked item
 * is Complete.
 */
export default function DependencyPicker({ options, value, onChange, disabled }: Props) {
  const chosen = value
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is LinkOption => !!o);
  const remaining = options.filter((o) => !value.includes(o.id));

  return (
    <div className="dep-picker">
      {chosen.length > 0 && (
        <div className="dep-chips">
          {chosen.map((o) => (
            <span
              className={`dep-chip${o.status === 'Complete' ? ' done' : ''}`}
              key={o.id}
              title={`${o.phaseName}: ${o.name} — ${o.status}`}
            >
              {o.name}
              <button
                type="button"
                aria-label={`Remove link to ${o.name}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((id) => id !== o.id))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <select
        className="select"
        value=""
        disabled={disabled || remaining.length === 0}
        onChange={(e) => {
          if (e.target.value) onChange([...value, Number(e.target.value)]);
        }}
      >
        <option value="">
          {chosen.length === 0 ? 'No links — independent item' : '+ Add another link…'}
        </option>
        {remaining.map((o) => (
          <option key={o.id} value={o.id}>
            {o.phaseName}: {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
