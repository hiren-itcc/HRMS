/**
 * Pure `{{variable}}` substitution — no Prisma, no I/O.
 *
 * Values are HTML-escaped because template bodies are HTML and the values
 * come from user data (names, notes). A URL passed as a value is escaped too;
 * that is correct inside an href, where `&amp;` is the valid encoding.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * Unknown placeholders are left as-is rather than blanked: a visible
 * `{{approverName}}` in a test send is a bug report, an empty gap is not.
 */
export function render(template: string, vars: TemplateVars, escapeValues = true): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null) return match;
    const text = String(value);
    return escapeValues ? escapeHtml(text) : text;
  });
}

/** Subjects are plain text — escaping there would show `&amp;` in an inbox. */
export function renderSubject(template: string, vars: TemplateVars): string {
  return render(template, vars, false);
}

/** Placeholders a template actually uses, in first-appearance order. */
export function usedVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}
