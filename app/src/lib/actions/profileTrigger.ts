/**
 * Marks an element as something that opens a person's profile card when activated. ProfileCard.svelte owns the one
 * document-level listener that finds `[data-profile-user]`, so this only labels the element — the same attribute is
 * what `renderMarkdown` puts on a mention pill, which Svelte can't attach handlers to.
 *
 * Elements that aren't natively interactive also get `role="button"` and `tabindex="0"` so the keyboard can reach them.
 * Keep it off anything that already sits inside a clickable parent (a board card, an expandable row): the tap would
 * trigger both.
 */
export function profileTrigger(node: HTMLElement, userId: string) {
  const native = node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement;
  node.dataset.profileUser = userId;
  if (!native) {
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
  }
  return {
    update(next: string) {
      node.dataset.profileUser = next;
    },
  };
}
