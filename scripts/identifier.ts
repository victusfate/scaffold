// identifier — turn any text into an identifier, and keep identifiers unique.
// Why: mermaid node ids and Structurizr identifiers both allow only letters, digits and underscore, and
// both must be unique within a diagram or workspace; the page renderer and the C4 output share one rule.

export const identifier = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, '_');

// `base`, or `base_2`, `base_3`, ... when taken, so ids that sanitize alike (`a.b`, `a_b`) stay distinct.
// Case is ignored, because Structurizr reads `c_a` and `C_A` as one identifier. `used` is updated.
export function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id.toLowerCase()); n++) id = `${base}_${n}`;
  used.add(id.toLowerCase());
  return id;
}
