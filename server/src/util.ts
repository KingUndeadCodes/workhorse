/** True if two sets have exactly the same members, order-independent — the same-elements
 * comparison used anywhere a list of ids is diffed as "changed or not" (assignees, labels,
 * comments, attachments, links). Deliberately not `JSON.stringify([...].sort())`, which treats
 * a list with duplicate entries as different from its deduped form. */
export function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
