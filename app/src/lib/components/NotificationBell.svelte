<script lang="ts">
  import { tick } from 'svelte';
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
  import { currentProjectId, currentView, selectedIssueId, switchProject } from '../stores/workspace';
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

  function describe(n: NotificationWithContext): string {
    const actor = n.actorName ?? $t('notifications.unknownActor');
    const issue = n.issueKey ?? $t('notifications.deletedIssue');
    switch (n.kind) {
      case 'assigned':
        return $t('notifications.kinds.assigned', { actor, issue });
      case 'statusChanged':
        return $t('notifications.kinds.statusChanged', { actor, issue, status: n.statusName ?? '' });
      case 'resolved':
        return $t('notifications.kinds.resolved', { actor, issue });
      case 'commented':
        return $t('notifications.kinds.commented', { actor, issue });
      case 'mentioned':
        return $t('notifications.kinds.mentioned', { actor, issue });
      default:
        // Exhaustive over NotificationKind's closed set (see domain/notifications.ts) — this
        // is unreachable in practice; TS just can't prove a switch with no `default` returns
        // on every path, so this keeps that check happy without an unsafe cast.
        return n.kind;
    }
  }

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
        <span class="panel-title">{$t('notifications.bellTitle')}</span>
        {#if $unreadCount > 0}
          <button type="button" class="mark-all-btn" on:click={() => markAllRead()}>{$t('notifications.markAllRead')}</button>
        {/if}
      </div>
      <div class="panel-list">
        {#if !$notificationsLoaded}
          <div class="panel-empty">{$t('notifications.loading')}</div>
        {:else if $notifications.length === 0}
          <div class="panel-empty">{$t('notifications.empty')}</div>
        {:else}
          {#each $notifications as n, i (n.id)}
            <div id="notif-row-{i}" class="notif-row" class:unread={!n.read} role="menuitem" tabindex="-1" on:click={() => openNotification(n)}>
              <span class="notif-icon"><Icon name={ICON_BY_KIND[n.kind]} size={13} /></span>
              <div class="notif-body">
                <span class="notif-text">{describe(n)}</span>
                {#if n.commentPreview}<span class="notif-preview">{n.commentPreview}</span>{/if}
                <span class="notif-time">{formatRelativeDate(n.createdAt, $t, $tn, $locale)}</span>
              </div>
              {#if !n.read}<span class="unread-dot" aria-hidden="true"></span>{/if}
            </div>
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
    position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: 340px; max-width: 90vw;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden;
  }
  /* Focused programmatically the instant the panel opens (see `toggle`'s doc comment) purely
     so keyboard events have something inside the panel to bubble from — not a meaningful
     interactive target itself, so no visible ring. */
  .panel:focus { outline: none; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .panel-title { font-size: 12.5px; font-weight: 700; color: var(--text); }
  .mark-all-btn { font-size: 11px; font-weight: 600; color: var(--accent-strong); padding: 3px 6px; border-radius: 5px; }
  .mark-all-btn:hover { background: var(--surface-sunken); }
  .panel-list { max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; }
  .panel-empty { padding: 22px 12px; text-align: center; font-size: 12px; color: var(--text-3); }
  .notif-row {
    display: flex; align-items: flex-start; gap: 9px; padding: 10px 12px; cursor: pointer;
    border-bottom: 1px solid var(--border); position: relative;
  }
  .notif-row:last-child { border-bottom: none; }
  .notif-row:hover, .notif-row:focus-visible { background: var(--surface-sunken); outline: none; }
  .notif-row.unread { background: var(--accent-soft); }
  .notif-row.unread:hover, .notif-row.unread:focus-visible { filter: brightness(0.97); }
  .notif-icon { flex: 0 0 auto; margin-top: 2px; color: var(--text-3); }
  .notif-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .notif-text { font-size: 12px; color: var(--text-2); line-height: 1.4; }
  .notif-row.unread .notif-text { color: var(--text); font-weight: 500; }
  .notif-preview {
    font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; font-style: italic;
  }
  .notif-time { font-size: 10.5px; color: var(--text-3); }
  .unread-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-top: 5px; }
  .load-more-btn { font-size: 11.5px; font-weight: 600; color: var(--accent-strong); padding: 10px; text-align: center; }
  .load-more-btn:hover { background: var(--surface-sunken); }

  @media (max-width: 768px) {
    .panel { position: fixed; top: 58px; right: 8px; left: 8px; width: auto; max-width: none; }
  }
</style>
