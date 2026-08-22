<script lang="ts">
  import { onMount } from 'svelte';
  import { loadStats, statsWindow, workspaceStats } from '../stores/stats';
  import { formatBucketLabel, formatDuration } from '../util';
  import { locale, t } from '../i18n';
  import type { StatsWindow } from '$domain';

  onMount(loadStats);

  const WINDOWS: { value: StatsWindow; labelKey: string }[] = [
    { value: '24h', labelKey: 'stats.window24h' },
    { value: '1w', labelKey: 'stats.window1w' },
    { value: '30d', labelKey: 'stats.window30d' },
  ];

  $: current = $workspaceStats?.windows[$statsWindow];
  $: maxBucketSeconds = Math.max(1, ...(current?.timeSpentBuckets.map((b) => b.totalSeconds) ?? [0]));
  $: maxEventCount = Math.max(1, ...(current?.mostActiveTickets.map((ticket) => ticket.eventCount) ?? [0]));
  // Thin the x-axis labels so they don't crowd — every 4th hour on the 24h view, every ~5th day on 30d, every day on 1w.
  $: labelStride = $statsWindow === '24h' ? 4 : $statsWindow === '30d' ? 5 : 1;
</script>

<div class="stats-view">
  <div class="header">
    <h1>{$t('stats.title')}</h1>
    <div class="window-switcher">
      {#each WINDOWS as w (w.value)}
        <button type="button" class="view-tab" class:active={w.value === $statsWindow} on:click={() => statsWindow.set(w.value)}>{$t(w.labelKey)}</button>
      {/each}
    </div>
  </div>

  {#if !$workspaceStats}
    <div class="status-card"><div class="status-title">{$t('stats.loading')}</div></div>
  {:else if current}
    <div class="subsection-label usage-label">
      {$t('stats.timeSpentLabel')}
      <span class="total-seconds mono">{formatDuration(current.totalSecondsLogged)}</span>
    </div>
    <!-- Always render the chart grid, even with every bucket at zero — swapping it out for a
         plain text line when there's no data made an empty graph look like a missing one. -->
    <div class="bar-chart">
      {#each current.timeSpentBuckets as bucket, i (bucket.bucketStart)}
        <div class="bar-col">
          <div class="bar-track">
            {#if bucket.totalSeconds > 0}<span class="bar-fill" style="height:{(bucket.totalSeconds / maxBucketSeconds) * 100}%"></span>{/if}
          </div>
          <span class="bar-label">{i % labelStride === 0 ? formatBucketLabel(bucket.bucketStart, $statsWindow, $locale) : ''}</span>
        </div>
      {/each}
    </div>
    {#if current.totalSecondsLogged === 0}
      <p class="no-activity">{$t('stats.noActivity')}</p>
    {/if}

    <div class="subsection-label">{$t('stats.mostActiveLabel')}</div>
    {#if current.mostActiveTickets.length === 0}
      <p class="no-activity">{$t('stats.noActivity')}</p>
    {:else}
      <div class="ticket-list">
        {#each current.mostActiveTickets as ticket (ticket.issueId)}
          <div class="ticket-row">
            <span class="ticket-key mono">{ticket.issueKey}</span>
            <span class="ticket-title">{ticket.issueTitle}</span>
            <div class="ticket-bar"><span style="width:{(ticket.eventCount / maxEventCount) * 100}%"></span></div>
            <span class="ticket-count mono">{ticket.eventCount}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .stats-view { flex: 1; overflow-y: auto; padding: 28px 32px; max-width: 720px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; gap: 12px; }
  h1 { font-size: 19px; font-weight: 700; color: var(--text); margin: 0; }

  .window-switcher { display: flex; align-items: center; gap: 2px; background: var(--surface-sunken); border-radius: 8px; padding: 3px; flex-shrink: 0; }
  .view-tab { padding: 5px 12px; font-size: 12.5px; font-weight: 500; color: var(--text-2); border-radius: 6px; }
  .view-tab.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow); font-weight: 600; }

  .status-card { padding: 24px 0; }
  .status-title { font-size: 13px; color: var(--text-2); }

  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 24px 0 10px; }
  .subsection-label:first-of-type { margin-top: 0; }
  .usage-label { display: flex; align-items: center; justify-content: space-between; }
  .total-seconds { font-size: 12px; font-weight: 600; color: var(--text-3); text-transform: none; letter-spacing: normal; }

  .no-activity { font-size: 12px; color: var(--text-3); font-style: italic; margin: 0; }

  .bar-chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; padding: 8px 0; }
  .bar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; height: 100%; }
  /* A visible baseline the whole chart sits on — without it, 29 near-invisible zero-height
     tracks next to one tall bar just reads as blank space with a stray bar in it, not a chart. */
  .bar-track { width: 100%; flex: 1; display: flex; align-items: flex-end; background: var(--surface-sunken); border-radius: 3px 3px 0 0; border-bottom: 2px solid var(--border); overflow: hidden; }
  .bar-fill { display: block; width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 1px; }
  /* Rotated so a 6-character label ("Aug 16") needs far less horizontal room than its own
     ~24px-wide column — upright text at this bar count overflowed into neighboring columns. */
  .bar-label {
    font-size: 9.5px; color: var(--text-3); white-space: nowrap; height: 14px;
    transform: rotate(-40deg); transform-origin: top right;
  }

  .ticket-list { display: flex; flex-direction: column; gap: 4px; }
  .ticket-row { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 6px 0; }
  .ticket-key { color: var(--text-3); flex: 0 0 auto; }
  .ticket-title { color: var(--text-2); flex: 1 1 auto; min-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ticket-bar { width: 96px; height: 6px; border-radius: 99px; background: var(--surface-sunken); overflow: hidden; flex: 0 0 auto; }
  .ticket-bar > span { display: block; height: 100%; border-radius: 99px; background: var(--accent); }
  .ticket-count { color: var(--text-3); flex: 0 0 auto; width: 2em; text-align: right; }

  @media (max-width: 767px) {
    .stats-view { padding: 16px; }
    .header { margin-bottom: 16px; }
    h1 { font-size: 17px; }
    .bar-chart { height: 90px; }
    .bar-label { display: none; }
    .ticket-title { min-width: 60px; }
    .ticket-bar { width: 56px; }
  }
</style>
