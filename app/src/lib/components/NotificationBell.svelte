<script lang="ts">
  import { tick } from 'svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import type { NotificationWithContext } from '../api';
  import {
    hasMoreNotifications,
    loadMoreNotifications,
    markAllRead,
    markRead,
    notifications,
    notificationsLoaded,
    unreadCount,
  } from '../stores/notifications';
  import { currentProjectId, currentView, selectedIssueId, switchProject, users } from '../stores/workspace';
  import { formatRelativeDate } from '../util';
  import { locale, t, tn } from '../i18n';

  /**
   * The bell's dropdown panel — same pattern TopBar.svelte's own new-issue/user-info dropdowns
   * use (an absolutely-positioned panel, closed on any outside click), plus a roving-focus
   * keyboard layer matching this app's other always-on keyboard navigation: arrows move
   * between rows, Enter opens the focused one, Escape closes the panel. Unlike Board/Backlog's
   * global window-level handler, this one is only live while the panel is actually open — a
   * transient dropdown, not a persistent view, so there's nothing to intercept the rest of the
   * time.
   */
  let open = false;
  let focusIndex = -1;
  let wrap: HTMLDivElement;
  let bellButton: HTMLButtonElement;
  let panelEl: HTMLDivElement;

  const ICON_BY_KIND: Record<NotificationWithContext['kind'], string> = {
    assigned: 'list',
    statusChanged: 'route',
    resolved: 'check',
    commented: 'comment',
    mentioned: 'reply',
  };

  // Built once per users change, so each row's avatar lookup is O(1). The picture isn't sent with a notification (it can be megabytes), so it comes from the users the app already has.
  $: usersById = new Map($users.map((u) => [u.id, u]));

  /** Who did it, for a person's name or, when there is no user behind it, what did. */
  function actorLabel(n: NotificationWithContext): string {
    return n.actorName ?? (n.actorKind === 'automation' ? $t('notifications.automation') : $t('notifications.unknownActor'));
  }

  type Bucket = 'today' | 'yesterday' | 'thisWeek' | 'earlier';
  /** Which day-group a notification falls in, by calendar day rather than hours ago, so 11pm last night is "Yesterday" at 9am. */
  function bucketOf(iso: string): Bucket {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const day = new Date(iso);
    day.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((startOfToday.getTime() - day.getTime()) / 86_400_000);
    if (daysAgo <= 0) return 'today';
    if (daysAgo === 1) return 'yesterday';
    return daysAgo <= 6 ? 'thisWeek' : 'earlier';
  }

  // Newest first, so each group is contiguous. `index` is the row's place in the full list, which the keyboard
  // navigation below addresses by (headings between groups aren't rows and don't count).
  $: sections = $notifications.reduce<{ bucket: Bucket; rows: { n: NotificationWithContext; index: number }[] }[]>((groups, n, index) => {
    const bucket = bucketOf(n.createdAt);
    let group = groups.at(-1);
    if (!group || group.bucket !== bucket) groups.push((group = { bucket, rows: [] }));
    group.rows.push({ n, index });
    return groups;
  }, []);

  /**
   * Moves real DOM focus onto the panel itself the moment it opens — without this, focus
   * stays on the bell button (a sibling of `.panel`, not a descendant), so a keydown never
   * bubbles to the panel's own listener at all, and arrow keys fall through to whatever
   * always-on keyboard nav happens to be running underneath (Board's, in particular — the
   * exact bug this project's own keyboard-nav work already ran into once for a different
   * reason). Focusing the panel container itself, not just a row, means the listener still
   * receives events even before any row is focus-indexed (an empty list, or before the first
   * arrow press).
   */
  function toggle() {
    open = !open;
    focusIndex = -1;
    if (open) tick().then(() => panelEl?.focus());
  }

  function close() {
    open = false;
    focusIndex = -1;
  }

  /** Closes the panel on any click outside it, without needing a full-screen backdrop — same approach TopBar.svelte's own dropdowns use. */
  function handleWindowClick(e: MouseEvent) {
    if (open && wrap && !wrap.contains(e.target as Node)) close();
  }

  async function openNotification(n: NotificationWithContext) {
    close();
    await markRead(n.id);
    if (!n.projectId) return; // the issue this was about has since been deleted — nothing to open
    if (n.projectId !== $currentProjectId) await switchProject(n.projectId);
    $currentView = 'board';
    $selectedIssueId = n.issueId;
  }

  function focusRow() {
    tick().then(() => document.getElementById(`notif-row-${focusIndex}`)?.focus());
  }

  /**
   * `stopPropagation` matters here as much as `preventDefault` does: Board/Backlog/the
   * Workflow editor each run their own always-on `window`-level arrow-key handler (see
   * Board.svelte's `handleBoardKeydown` doc comment), and this panel sits inside that same
   * DOM tree. Without stopping propagation, a key this panel already acted on would keep
   * bubbling to `window` and get acted on *again* there — moving a card underneath this
   * panel while it's open, which is exactly what happened before this was added.
   */
  function handlePanelKeydown(e: KeyboardEvent) {
    const count = $notifications.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (count === 0) return;
        focusIndex = Math.min(focusIndex + 1, count - 1);
        focusRow();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (count === 0) return;
        focusIndex = Math.max(focusIndex - 1, 0);
        focusRow();
        break;
      case 'Enter':
        if (focusIndex < 0 || focusIndex >= count) return;
        e.preventDefault();
        e.stopPropagation();
        openNotification($notifications[focusIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        bellButton?.focus();
        break;
    }
  }
</script>

<svelte:window on:click={handleWindowClick} />

<div class="bell-wrap" bind:this={wrap}>
  <button
    class="bell-btn"
    bind:this={bellButton}
    title={$t('notifications.bellTitle')}
    aria-label={$unreadCount > 0 ? $t('notifications.bellTitleUnread', { count: $unreadCount }) : $t('notifications.bellTitle')}
    on:click={toggle}
  >
    <Icon name="bell" />
    {#if $unreadCount > 0}<span class="badge">{$unreadCount > 99 ? '99+' : $unreadCount}</span>{/if}
  </button>
  {#if open}
    <div class="panel" bind:this={panelEl} tabindex="-1" role="menu" aria-label={$t('notifications.bellTitle')} on:keydown={handlePanelKeydown}>
      <div class="panel-head">
        <div class="head-title">
          <span class="panel-title">{$t('notifications.bellTitle')}</span>
          {#if $unreadCount > 0}<span class="count-pill">{$t('notifications.unreadCount', { count: $unreadCount })}</span>{/if}
        </div>
        {#if $unreadCount > 0}
          <button type="button" class="mark-all-btn" on:click={() => markAllRead()}><Icon name="check" size={12} />{$t('notifications.markAllRead')}</button>
        {/if}
      </div>
      <div class="panel-list">
        {#if !$notificationsLoaded}
          <div class="panel-empty">{$t('notifications.loading')}</div>
        {:else if $notifications.length === 0}
          <div class="panel-empty">
            <span class="empty-icon"><Icon name="bell" size={20} /></span>
            {$t('notifications.empty')}
          </div>
        {:else}
          {#each sections as section (`${section.bucket}-${section.rows[0].n.id}`)}
            <div class="section-label">{$t(`notifications.groups.${section.bucket}`)}</div>
            {#each section.rows as { n, index } (n.id)}
              {@const actor = n.actorId ? usersById.get(n.actorId) : undefined}
              <div
                id="notif-row-{index}"
                class="notif-row"
                class:unread={!n.read}
                role="menuitem"
                tabindex="-1"
                on:click={() => openNotification(n)}
              >
                <span class="notif-avatar">
                  {#if actor}
                    <Avatar userId={actor.id} name={actor.displayName} avatarUrl={actor.avatarUrl} kind={actor.kind} size={34} />
                  {:else}
                    <span class="actor-fallback"><Icon name={n.actorKind === 'automation' ? 'route' : 'gear'} size={16} /></span>
                  {/if}
                  <span class="kind-badge kind-{n.kind}"><Icon name={ICON_BY_KIND[n.kind]} size={9} /></span>
                </span>
                <div class="notif-body">
                  <div class="notif-line"><strong class="notif-actor">{actorLabel(n)}</strong> <span class="notif-action">{$t(`notifications.actions.${n.kind}`)}</span></div>
                  <div class="notif-issue">
                    {#if n.issueKey}
                      <span class="issue-key mono">{n.issueKey}</span>{#if n.issueTitle}<span class="issue-title">{n.issueTitle}</span>{/if}
                    {:else}
                      <span class="issue-deleted">{$t('notifications.deletedIssue')}</span>
                    {/if}
                  </div>
                  {#if n.statusName}
                    <div class="status-line">
                      {#if n.fromStatusName}<span class="chip">{n.fromStatusName}</span><span class="status-arrow"><Icon name="chevron" size={10} /></span>{/if}<span class="chip to">{n.statusName}</span>
                    </div>
                  {/if}
                  {#if n.commentPreview}<blockquote class="notif-quote">{n.commentPreview}</blockquote>{/if}
                  <time class="notif-time" datetime={n.createdAt} title={new Date(n.createdAt).toLocaleString($locale, { dateStyle: 'medium', timeStyle: 'short' })}>
                    {formatRelativeDate(n.createdAt, $t, $tn, $locale)}
                  </time>
                </div>
                {#if !n.read}<span class="unread-dot" aria-hidden="true"></span>{/if}
              </div>
            {/each}
          {/each}
          {#if $hasMoreNotifications}
            <button type="button" class="load-more-btn" on:click={() => loadMoreNotifications()}>{$t('notifications.loadMore')}</button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .bell-wrap { position: relative; display: flex; }
  /* Svelte scopes a component's own CSS to elements literally in its own template — TopBar's
     `.icon-btn` rule (width/height/hover) never reaches this button just because it's also
     given that class name, since this button lives in a child component's template instead.
     Restated here in full so this bell renders as the same size/shape as its sibling icon
     buttons (Stats/Project settings/Workspace settings) instead of shrinking to its icon's
     own intrinsic size — which is what made it look like a stray element bolted on next to
     the group rather than the last member of it. */
  .bell-btn {
    position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    border-radius: 7px; color: var(--text-2);
  }
  .bell-btn:hover { background: var(--surface-sunken); color: var(--text); }
  .badge {
    position: absolute; top: 3px; right: 3px; min-width: 15px; height: 15px; padding: 0 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9.5px; font-weight: 700; line-height: 1; color: #fff;
    background: var(--critical, #dc2626); border-radius: 99px; border: 1.5px solid var(--surface);
  }

  .panel {
    position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: 400px; max-width: 92vw;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden;
  }
  /* Focused programmatically the instant the panel opens (see `toggle`'s doc comment) purely
     so keyboard events have something inside the panel to bubble from — not a meaningful
     interactive target itself, so no visible ring. */
  .panel:focus { outline: none; }

  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .head-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .panel-title { font-size: 14px; font-weight: 700; color: var(--text); }
  .count-pill { font-size: 11px; font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
  .mark-all-btn { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--text-2); padding: 5px 8px; border-radius: 6px; white-space: nowrap; }
  .mark-all-btn:hover { background: var(--surface-sunken); color: var(--text); }

  .panel-list { max-height: min(520px, 72vh); overflow-y: auto; display: flex; flex-direction: column; }
  .panel-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 36px 16px; text-align: center; font-size: 12.5px; color: var(--text-3); }
  .empty-icon { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: var(--surface-sunken); color: var(--text-3); }
  .section-label {
    position: sticky; top: 0; z-index: 1; padding: 8px 16px 6px; background: var(--surface-2);
    font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3);
    border-bottom: 1px solid var(--border);
  }

  .notif-row {
    position: relative; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; cursor: pointer;
    border-top: 1px solid var(--border);
  }
  .section-label + .notif-row { border-top: none; }
  .notif-row:hover { background: var(--surface-sunken); }
  .notif-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; background: var(--surface-sunken); }
  /* Unread reads at a glance from across the panel: a tinted row with an accent bar down its edge, as well as the dot. */
  .notif-row.unread { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
  .notif-row.unread:hover, .notif-row.unread:focus-visible { filter: brightness(0.97); }

  .notif-avatar { position: relative; flex: 0 0 34px; width: 34px; height: 34px; }
  .actor-fallback { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; background: var(--surface-sunken); color: var(--text-3); }
  /* What happened, as a small badge on the corner of whoever did it. */
  .kind-badge {
    position: absolute; right: -4px; bottom: -3px; width: 17px; height: 17px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface); border: 1.5px solid var(--surface); box-shadow: 0 0 0 1px var(--border);
    color: var(--text-2);
  }
  .kind-assigned { color: var(--accent-strong); }
  .kind-statusChanged { color: var(--info); }
  .kind-resolved { color: var(--success); }
  .kind-commented { color: var(--text-2); }
  .kind-mentioned { color: var(--warning); }

  .notif-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .notif-line { font-size: 13px; line-height: 1.4; color: var(--text-2); }
  .notif-actor { font-weight: 600; color: var(--text-2); }
  .notif-row.unread .notif-actor { color: var(--text); }
  .notif-row.unread .notif-line { color: var(--text); }
  .notif-issue { display: flex; align-items: baseline; gap: 7px; min-width: 0; font-size: 12px; }
  .issue-key { flex: 0 0 auto; font-size: 11px; font-weight: 500; color: var(--text-3); }
  .issue-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 500; }
  .issue-deleted { color: var(--text-3); font-style: italic; }

  .status-line { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
  .chip { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 99px; color: var(--text-2); background: var(--surface-sunken); border: 1px solid var(--border); }
  .chip.to { color: var(--info); background: var(--info-soft); border-color: transparent; }
  .status-arrow { display: flex; color: var(--text-3); }
  .status-arrow :global(svg) { transform: rotate(-90deg); }

  /* The comment itself, set off as a quotation, two lines at most. */
  .notif-quote {
    margin: 3px 0 0; padding: 2px 0 2px 9px; border-left: 2px solid var(--border-strong);
    font-size: 12px; line-height: 1.45; color: var(--text-2);
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
    overflow-wrap: anywhere;
  }
  .notif-time { margin-top: 2px; font-size: 11px; color: var(--text-3); }
  .unread-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 6px; }
  .load-more-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); padding: 12px; text-align: center; border-top: 1px solid var(--border); }
  .load-more-btn:hover { background: var(--surface-sunken); }

  @media (max-width: 768px) {
    .panel { position: fixed; top: 58px; right: 8px; left: 8px; width: auto; max-width: none; }
    .panel-list { max-height: calc(100vh - 58px - 8px - 56px - 72px); }
    .notif-row { padding: 14px 16px; }
    .mark-all-btn { padding: 9px 10px; }
  }
</style>
