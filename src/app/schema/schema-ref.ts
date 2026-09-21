/** The `$schema` a document points at, if it is a non-empty string. Resolving it is the host's job. */
export function schemaRefOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const ref = (data as Record<string, unknown>)['$schema'];
  return typeof ref === 'string' && ref.trim() ? ref : undefined;
}
