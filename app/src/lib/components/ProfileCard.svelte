<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { closeProfileCard, openProfileCard, profileCard } from '../stores/profileCard';
  import { agents, issuesStore, statusCategories, users, workflow, workspaceMembers } from '../stores/workspace';
  import { isMobile } from '../stores/viewport';
  import { displayName, openAssignedIssueCount } from '../util';
  import { locale, t, tn } from '../i18n';

  /**
   * The profile card — a small popover (a bottom sheet on a phone) showing who someone is. Mounted once, in
   * AppShell. Anything carrying `data-profile-user="<id>"` opens it: ordinary markup via the `profileTrigger`
   * action, and mention pills inside rendered markdown (see markdown.ts) because Svelte can't bind handlers
   * into `{@html}`. One document listener handles them all, which is why it lives here.
   */
  const CARD_WIDTH = 300;
  const EDGE = 8;
  const GAP = 6;

  let cardEl: HTMLDivElement | undefined;
  let top = 0;
  let left = 0;

  $: person = $profileCard ? $users.find((u) => u.id === $profileCard!.userId) : undefined;
  $: agent = person?.kind === 'agent' ? $agents.find((a) => a.userId === person!.id) : undefined;
  $: role = person ? $workspaceMembers.find((m) => m.userId === person!.id)?.role : undefined;
  $: openIssues = person ? openAssignedIssueCount(person.id, $issuesStore, $workflow, $statusCategories) : 0;
  $: memberSince = person?.createdAt ? new Date(person.createdAt).toLocaleDateString($locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  // A person who has since been removed leaves nothing to show — don't keep an empty card open.
  $: if ($profileCard && !person) closeProfileCard();

  /** Puts the card under its trigger, or above it when there's no room below, kept inside the viewport. Phones use a bottom sheet instead, placed by CSS. */
  async function place() {
    await tick();
    const trigger = $profileCard?.trigger;
    if (!trigger || !cardEl || $isMobile) return;
    const anchor = trigger.getBoundingClientRect();
    const height = cardEl.offsetHeight;
    left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - CARD_WIDTH - EDGE));
    const below = anchor.bottom + GAP;
    top = below + height + EDGE <= window.innerHeight ? below : Math.max(EDGE, anchor.top - GAP - height);
  }

  $: if ($profileCard) {
    void place();
    void tick().then(() => cardEl?.focus({ preventScroll: true }));
  }

  function close(returnFocus: boolean) {
    const trigger = $profileCard?.trigger;
    closeProfileCard();
    if (returnFocus) trigger?.focus({ preventScroll: true });
  }

  function triggerFor(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? (target.closest('[data-profile-user]') as HTMLElement | null) : null;
  }

  function handleClick(e: MouseEvent) {
    const trigger = triggerFor(e.target);
    if (trigger?.dataset.profileUser) {
      // The same trigger again closes it, like re-tapping a toggle.
      if ($profileCard?.trigger === trigger) close(false);
      else openProfileCard(trigger.dataset.profileUser, trigger);
      return;
    }
    if ($profileCard && cardEl && !cardEl.contains(e.target as Node)) close(false);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $profileCard) {
      e.preventDefault();
      close(true);
      return;
    }
    // Enter/Space on a focused trigger that isn't a native button (a mention pill, a wrapped avatar).
    if (e.key === 'Enter' || e.key === ' ') {
      const trigger = triggerFor(e.target);
      if (trigger?.dataset.profileUser && !(trigger instanceof HTMLButtonElement)) {
        e.preventDefault();
        openProfileCard(trigger.dataset.profileUser, trigger);
      }
    }
  }

  // The card is anchored to a spot on screen, so rather than follow the page as it scrolls, let it go.
  function handleScroll(e: Event) {
    if ($profileCard && !cardEl?.contains(e.target as Node)) close(false);
  }

  onMount(() => {
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  });
</script>

<svelte:window on:resize={place} />

{#if $profileCard && person}
  {#if $isMobile}<div class="backdrop" aria-hidden="true"></div>{/if}
  <div
    class="card"
    class:sheet={$isMobile}
    bind:this={cardEl}
    role="dialog"
    aria-label={$t('profileCard.label', { name: displayName(person) })}
    tabindex="-1"
    style={$isMobile ? undefined : `top:${top}px;left:${left}px;width:${CARD_WIDTH}px`}
  >
    {#if $isMobile}
      <button type="button" class="close" aria-label={$t('common.close')} on:click={() => close(true)}><Icon name="x" size={14} /></button>
    {/if}
    <div class="head">
      <Avatar userId={person.id} name={displayName(person)} avatarUrl={person.avatarUrl} kind={person.kind} size={56} />
      <div class="who">
        <div class="name">{displayName(person)}</div>
        <div class="badges">
          {#if person.kind === 'agent'}<span class="badge agent">{$t('profileCard.agentBadge')}</span>{/if}
          {#if role}<span class="badge">{$t(`workspaceView.roles.${role}`)}</span>{/if}
        </div>
      </div>
    </div>

    {#if agent?.description}<p class="about">{agent.description}</p>{/if}

    <dl class="facts">
      {#if person.kind === 'human' && person.email}
        <div><dt>{$t('profileCard.email')}</dt><dd><a href="mailto:{person.email}">{person.email}</a></dd></div>
      {/if}
      {#if memberSince}<div><dt>{$t('profileCard.memberSince')}</dt><dd>{memberSince}</dd></div>{/if}
      <div><dt>{$t('profileCard.assigned')}</dt><dd>{$tn('profileCard.openIssues', openIssues)}</dd></div>
      {#if agent}
        <div><dt>{$t('profileCard.model')}</dt><dd class="mono">{agent.model}</dd></div>
        {#if !agent.enabled}<div><dt>{$t('profileCard.status')}</dt><dd>{$t('profileCard.disabled')}</dd></div>{/if}
      {/if}
    </dl>
  </div>
{/if}

<style>
  .card {
    position: fixed; z-index: 60; box-sizing: border-box; padding: 16px;
    background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-lg);
  }
  .card:focus { outline: none; }
  .head { display: flex; align-items: center; gap: 12px; }
  .who { min-width: 0; }
  .name { font-size: 15px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
  .badge { font-size: 10.5px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; color: var(--text-2); background: var(--surface-sunken); border-radius: 99px; padding: 2px 8px; }
  .badge.agent { color: var(--agent-accent); background: var(--agent-accent-soft); }
  .about { margin: 12px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-2); }
  .facts { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 9px; font-size: 12.5px; }
  .facts > div { display: flex; justify-content: space-between; gap: 14px; }
  dt { color: var(--text-3); flex: 0 0 auto; }
  dd { margin: 0; text-align: right; min-width: 0; overflow-wrap: anywhere; color: var(--text); }
  dd a { color: var(--accent-strong); text-decoration: none; }
  dd a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .mono { font-family: Mono, ui-monospace, monospace; font-size: 12px; }

  .backdrop { position: fixed; inset: 0; z-index: 59; background: rgba(0, 0, 0, .45); }
  /* After the base rules on purpose: same specificity, so source order decides. */
  .card.sheet {
    top: auto; left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-bottom: none;
    padding: 20px 18px calc(24px + env(safe-area-inset-bottom)); max-height: 80vh; overflow-y: auto;
  }
  .close { position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--text-2); border-radius: 50%; }
  .close:hover { background: var(--surface-sunken); color: var(--text); }
  .card.sheet .head { padding-right: 40px; }
</style>
