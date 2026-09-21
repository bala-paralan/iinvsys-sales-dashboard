import { usePipeline } from './usePipeline';

/**
 * The role taxonomy, from the server. Labels, short forms and the transfer matrix all
 * ride in `/api/meta/pipeline` under `enums.roles`; the rule that a hardcoded enum
 * anywhere in src/ is a defect applies to role names exactly as it does to stages.
 */
export interface RoleDef {
  key: string;
  label: string;
  abbr: string | null;
  scope: 'own' | 'team' | 'all';
  reportsTo: Array<string | null> | null;
  transfersTo: string[] | null;
}

export function useRoles() {
  const { data: meta } = usePipeline();
  const roles: RoleDef[] = ((meta as any)?.enums?.roles ?? []) as RoleDef[];
  const byKey = Object.fromEntries(roles.map((r) => [r.key, r]));
  return {
    roles,
    /** "Area Sales Manager" — falls back to a de-snaked key so an unknown role still reads. */
    label: (key?: string | null) => (key ? byKey[key]?.label ?? key.replace(/_/g, ' ') : '—'),
    /** "ASM" — the brief's short form, or the label when the role has none. */
    abbr: (key?: string | null) => (key ? byKey[key]?.abbr ?? byKey[key]?.label ?? key : '—'),
    get: (key: string) => byKey[key],
  };
}
