/** Escape LIKE metacharacters so identifiers are matched literally.
 * This search is applied server-side *after* the authenticated company scope.
 */
export function timelineSearchPattern(value: string): string | null {
  const query = value.trim();
  if (!query) return null;
  return "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
}
