'use client';

export interface OfficeOption {
  id: string;
  code: string;
  name: string;
}
/** All offices, only those with work in progress (default), or one picked from the list. */
export interface OfficeView {
  all: boolean;
  officeId: string;
}
export const DEFAULT_OFFICE_VIEW: OfficeView = { all: false, officeId: '' };

/** Applies the view; `isActive` says whether an office has requests in Borrador, Por asignar or En cotización. */
export const visibleOffices = <T extends OfficeOption>(
  list: T[],
  v: OfficeView,
  isActive: (o: T) => boolean,
) => (v.officeId ? list.filter((o) => o.id === v.officeId) : v.all ? list : list.filter(isActive));

/** Section header for the office tables of Inicio / Mi Dashboard and Dashboard ejecutivo. */
export function OfficeFilter({
  id,
  title,
  offices,
  value,
  onChange,
}: {
  id: string;
  title: string;
  offices: OfficeOption[];
  value: OfficeView;
  onChange: (v: OfficeView) => void;
}) {
  return (
    <div className="office-filter">
      <h2 id={id}>{title}</h2>
      <button
        type="button"
        className="secondary small"
        aria-pressed={value.all && !value.officeId}
        onClick={() => onChange({ all: !value.all || !!value.officeId, officeId: '' })}
      >
        {value.all && !value.officeId ? 'Solo oficinas activas' : 'Ver todas las oficinas'}
      </button>
      <select
        aria-label={`Elegir oficina en ${title}`}
        value={value.officeId}
        onChange={(e) => onChange({ ...value, officeId: e.target.value })}
      >
        <option value="">{value.all ? 'Todas las oficinas' : 'Oficinas activas'}</option>
        {offices.map((o) => (
          <option key={o.id} value={o.id}>
            {o.code} · {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
