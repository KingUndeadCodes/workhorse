<script lang="ts">
  /*
   * The landing page's scrollytelling showcase. One pinned "stage" shows a mock of the Workhorse window;
   * as the visitor scrolls through a tall track, the stage stays put and its scene changes — a board where a
   * card gets dragged, an agent being attached, an approval, a GitHub branch, an automation rule, the stats
   * view — each with a caption underneath. Everything on the stage is decorative (aria-hidden); the same
   * content is available as a plain list for screen readers, as real buttons (the dots) for keyboard users,
   * and, with "reduce motion" on, as a static board plus the original feature grid (no pinning, no animation).
   *
   * Like the rest of this page it must not read the app's stores. The board scene mirrors Board.svelte +
   * IssueCard.svelte, and the other scenes mirror the issue drawer, agent runs, Git settings, automation rules
   * and Stats; icons and story-point colors come from util.ts so they can't drift, the layout and CSS are copied
   * by hand — when those screens change visually, update the matching scene here.
   */
  import { onMount } from 'svelte';
  import { crossfade, fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import Icon from './Icon.svelte';
  import { formatDuration, priorityIcon, storyPointColor, typeIcon } from '../util';

  type Scene = { id: string; icon: string; title: string; desc: string; crumb: string };
  const SCENES: Scene[] = [
    { id: 'board', icon: 'columns', title: 'Board & Backlog', desc: 'Drag-and-drop kanban plus full sprint planning, without leaving the page.', crumb: 'Sprint 12' },
    { id: 'agents', icon: 'robot', title: 'AI Agents', desc: 'Attach an agent to a ticket and it picks up the work, commenting and updating status as it goes. Runs on a local Ollama model — no hosted AI provider required.', crumb: 'Sprint 12' },
    { id: 'control', icon: 'lock', title: 'You stay in control', desc: 'Require approval before an agent acts, and cap how often and how much each one can do. Repo writes always wait for a human.', crumb: 'Settings' },
    { id: 'github', icon: 'branch', title: 'GitHub, built in', desc: 'Connect your own GitHub account to link a repo and create a branch straight from a ticket.', crumb: 'Project settings' },
    { id: 'automations', icon: 'route', title: 'Automations', desc: "Rule-based triggers and actions handle the busywork so your team doesn't have to.", crumb: 'Settings' },
    { id: 'insights', icon: 'clock', title: 'Insights', desc: 'Time-spent charts and most-active-ticket rankings, updated in real time.', crumb: 'Stats' },
  ];

  // Stage geometry (px). The pinned block is scaled down to fit when the viewport is shorter than this.
  const STAGE_H = 548;
  const BASE_H = 676; // window + caption + dots
  let fit = 1;

  // ---- scene 0: the board ----
  type MockCard = {
    lane: number; col: number; key: string; title: string; type: 'Story' | 'Bug' | 'Task'; priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
    labels?: { name: string; color: string }[]; due?: 'overdue' | 'soon'; points?: number; agent?: boolean; people?: number[];
  };
  const MOCK_COLUMNS: { label: string; tone: 'todo' | 'progress' | 'done' }[] = [
    { label: 'To Do', tone: 'todo' },
    { label: 'In Progress', tone: 'progress' },
    { label: 'Done', tone: 'done' },
  ];
  const MOCK_LANES: { name: string; epic?: { done: number; total: number } }[] = [{ name: 'No Epic' }, { name: 'Customer Onboarding Revamp', epic: { done: 1, total: 3 } }];
  const MOCK_CARDS: MockCard[] = [
    { lane: 0, col: 0, key: 'WH-142', title: 'Add CSV export to reports', type: 'Story', priority: 'medium', labels: [{ name: 'Reports', color: '#3B7DC4' }], points: 5, people: [1, 2] },
    { lane: 0, col: 1, key: 'WH-138', title: 'Fix OAuth token refresh race', type: 'Bug', priority: 'high', due: 'overdue', points: 2, people: [3] },
    { lane: 0, col: 1, key: 'WH-140', title: 'Summarize weekly standup notes', type: 'Task', priority: 'medium', agent: true, people: [4] },
    { lane: 0, col: 2, key: 'WH-131', title: 'Sprint burndown chart', type: 'Story', priority: 'low', points: 3, people: [3] },
    { lane: 1, col: 0, key: 'WH-145', title: 'Dark mode contrast pass', type: 'Story', priority: 'low', due: 'soon', people: [4] },
    { lane: 1, col: 1, key: 'WH-141', title: 'Migrate webhook retries', type: 'Task', priority: 'medium', points: 3, people: [2] },
    { lane: 1, col: 2, key: 'WH-129', title: 'Audit accessibility of settings', type: 'Story', priority: 'low', points: 2, people: [1] },
  ];
  const DEMO_CARD = 'WH-142'; // the card that gets dragged from To Do to In Progress
  let moved = false;
  let dragOver = false;

  /** The cards in one board cell. The dragged card sorts first in its new cell so it stays visible on phones, which show one card per cell. */
  function cardsIn(lane: number, col: number, movedNow: boolean): MockCard[] {
    const effectiveCol = (c: MockCard) => (c.key === DEMO_CARD && movedNow ? 1 : c.col);
    return MOCK_CARDS.filter((c) => c.lane === lane && effectiveCol(c) === col).sort((a, b) => Number(b.key === DEMO_CARD) - Number(a.key === DEMO_CARD));
  }
  const columnCount = (col: number, movedNow: boolean) => MOCK_LANES.reduce((n, _, lane) => n + cardsIn(lane, col, movedNow).length, 0);
  const [send, receive] = crossfade({ duration: 450, easing: cubicOut, fallback: (node) => fade(node, { duration: 300 }) });

  // ---- scenes 1-5: demo state. Each scene mirrors a real screen (see the header note); the flags below are
  // the little bit of "someone is using it" that plays when the scene appears. ----
  const SETTINGS_TABS = ['Appearance', 'Accessibility', 'Labels', 'Fields', 'Workflow', 'Automations', 'Agents', 'Git', 'Webhooks'];
  const PROJECT_TABS = ['Project', 'Git'];
  // Scene 1: IssueDrawer
  let agentAttached = false;
  let agentRunning = false;
  let agentReplied = false;
  // Scene 2: Settings → Agents, "Awaiting your approval"
  let approvePressed = false;
  let approved = false;
  // Scene 3: Project settings → Git, then the drawer's Branch section
  let repoPicked = false;
  let linkPressed = false;
  let repoLinked = false;
  let branchFormOpen = false;
  let branchCreated = false;
  // Scene 4: Settings → Automations
  let nudgeEnabled = false;
  // Scene 5: Stats
  let statsWin: '1w' | '30d' = '1w';
  let barsIn = false;

  const PROPOSED = ['comment "Summary: 5 decisions, 3 acti…"', '→ In Progress'];
  const RULES = [
    { name: 'Escalate high-priority bugs', on: 'issue.statusChanged', ifs: 'priority = "high" and type = "Bug"', then: 'assign Sam Rivera; comment "Escalated for triage"' },
    { name: 'Nudge stale tickets', on: 'issue.fieldChanged', ifs: '', then: 'comment "Still on this?"' },
  ];
  // Hours logged per bucket. 1w shows weekday labels, 30d shows a thin bar per day with every 5th labelled — as Stats.svelte does.
  const WEEK = [3.5, 6, 4.5, 8, 5.5, 1.5, 0.5].map((h, i) => ({ h, label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] }));
  const MONTH = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(2026, 8, 6 + i);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    return { h: weekend ? (i * 7) % 3 : 2 + ((i * 5) % 7), label: day.toLocaleDateString('en', { month: 'short', day: 'numeric' }) };
  });
  const TOP: Record<'1w' | '30d', { key: string; title: string; n: number }[]> = {
    '1w': [
      { key: 'WH-138', title: 'Fix OAuth token refresh race', n: 12 },
      { key: 'WH-140', title: 'Summarize weekly standup notes', n: 9 },
      { key: 'WH-142', title: 'Add CSV export to reports', n: 7 },
      { key: 'WH-131', title: 'Sprint burndown chart', n: 4 },
    ],
    '30d': [
      { key: 'WH-138', title: 'Fix OAuth token refresh race', n: 41 },
      { key: 'WH-142', title: 'Add CSV export to reports', n: 33 },
      { key: 'WH-140', title: 'Summarize weekly standup notes', n: 27 },
      { key: 'WH-141', title: 'Migrate webhook retries', n: 19 },
    ],
  };
  $: buckets = statsWin === '1w' ? WEEK : MONTH;
  $: labelStride = statsWin === '1w' ? 1 : 5;
  $: maxH = Math.max(1, ...buckets.map((b) => b.h));
  $: totalHours = buckets.reduce((n, b) => n + b.h, 0);
  $: top = TOP[statsWin];
  $: maxN = Math.max(1, ...top.map((t) => t.n));

  // ---- which scene is showing, and the demo that plays when it appears ----
  let active = 0;
  let reduced = false;
  let mounted = false;
  let timers: number[] = [];
  const later = (fn: () => void, ms: number) => void timers.push(window.setTimeout(fn, ms));
  const clearDemo = () => {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  };

  /** Puts every scene's demo back to its starting state, except the one now showing. */
  function resetExcept(keep: number) {
    if (keep !== 0) (moved = false), (dragOver = false);
    if (keep !== 1) (agentAttached = false), (agentRunning = false), (agentReplied = false);
    if (keep !== 2) (approvePressed = false), (approved = false);
    if (keep !== 3) (repoPicked = false), (linkPressed = false), (repoLinked = false), (branchFormOpen = false), (branchCreated = false);
    if (keep !== 4) nudgeEnabled = false;
    if (keep !== 5) (statsWin = '1w'), (barsIn = false);
  }

  function runScene(i: number, noMotion: boolean) {
    clearDemo();
    if (noMotion) return; // static: the board as it starts, nothing plays
    // Reset what we left only after it has faded out, so nothing visibly snaps back mid-transition.
    later(() => resetExcept(i), 450);
    switch (i) {
      case 0:
        later(() => (dragOver = true), 1000);
        later(() => ((dragOver = false), (moved = true)), 1900);
        break;
      case 1:
        later(() => (agentAttached = true), 600);
        later(() => (agentRunning = true), 1700);
        later(() => ((agentRunning = false), (agentReplied = true)), 2700);
        break;
      case 2:
        later(() => (approvePressed = true), 2300);
        later(() => ((approvePressed = false), (approved = true)), 2700);
        break;
      case 3:
        later(() => (repoPicked = true), 600);
        later(() => (linkPressed = true), 1500);
        later(() => ((linkPressed = false), (repoLinked = true)), 1800);
        later(() => (branchFormOpen = true), 2500);
        later(() => ((branchFormOpen = false), (branchCreated = true)), 3400);
        break;
      case 4:
        later(() => (nudgeEnabled = true), 1300);
        break;
      case 5:
        later(() => (barsIn = true), 350);
        later(() => ((statsWin = '30d'), (barsIn = false), later(() => (barsIn = true), 60)), 3000);
        break;
    }
  }
  $: if (mounted) runScene(active, reduced);

  let root: HTMLElement;
  let sentinels: HTMLElement[] = [];

  function goTo(i: number) {
    sentinels[i]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }

  onMount(() => {
    // `.landing` is this page's own scroll container (it is 100vh and scrolls), not the window — so the
    // scroll listener, the sticky pinning, and the fit calculation all key off it.
    const scroller = root.closest('.landing') as HTMLElement | null;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const onMotionChange = () => (reduced = mq.matches);
    mq.addEventListener('change', onMotionChange);

    const updateFit = () => {
      const h = scroller?.clientHeight ?? window.innerHeight;
      fit = Math.min(1, Math.max(0.6, (h - 80) / BASE_H));
    };
    updateFit();
    window.addEventListener('resize', updateFit);

    // The active scene is whichever slice of the tall track is under the middle of the viewport. Computed from
    // the scroll position rather than observed per slice, so a fast scroll or a jump past either end can't skip it
    // and leave a stale scene showing.
    const track = root.querySelector('.story-track') as HTMLElement;
    const update = () => {
      const view = scroller?.getBoundingClientRect() ?? { top: 0, height: window.innerHeight };
      const rect = track.getBoundingClientRect();
      const progress = (view.top + view.height / 2 - rect.top) / rect.height;
      active = Math.min(SCENES.length - 1, Math.max(0, Math.floor(progress * SCENES.length)));
    };
    update();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', update, { passive: true });

    mounted = true;
    return () => {
      target.removeEventListener('scroll', update);
      mq.removeEventListener('change', onMotionChange);
      window.removeEventListener('resize', updateFit);
      clearDemo();
    };
  });
</script>

{#snippet agentAvatar(px: number)}
  <span class="magent-avatar" style="width:{px}px;height:{px}px"><picture><source media="(prefers-color-scheme: dark)" srcset="/agents/ollama-light.svg" /><img src="/agents/ollama-dark.svg" alt="" width={Math.round(px * 0.62)} height={Math.round(px * 0.62)} /></picture></span>
{/snippet}

<section class="showcase" bind:this={root} aria-labelledby="showcase-title">
  <h2 id="showcase-title" class="sr-only">Features</h2>
  <ol class="sr-only sr-list">
    {#each SCENES as s}<li><strong>{s.title}.</strong> {s.desc}</li>{/each}
  </ol>

  <div class="story-track" style="--n:{SCENES.length}">
    {#each SCENES as _, i}<div class="sentinel" style="--i:{i}" data-i={i} bind:this={sentinels[i]}></div>{/each}

    <div class="story-pin" style="height:{BASE_H * fit}px">
      <div class="story-fit" style="width:{100 / fit}%;height:{BASE_H}px;transform:scale({fit})">
        <div class="window" style="height:{STAGE_H}px" aria-hidden="true">
          <div class="preview-bar">
            <span class="crumb"><span class="crumb-strong">Workhorse</span> / {SCENES[active].crumb}</span>
            <span class="seg"><span class:seg-on={active === 0}>Board</span><span>Backlog</span></span>
            <span class="spacer"></span>
            <span class="new-btn">+ New…</span>
          </div>

          <div class="scenes">
            <!-- 0 · Board & Backlog -->
            <div class="scene scene-board" class:on={active === 0}>
              <div class="preview-search">
                <span class="search-field"><Icon name="search" size={12} />Search issues…</span>
                <span class="filters-btn">Filters</span>
              </div>
              <div class="board-head">
                {#each MOCK_COLUMNS as col, i}
                  <div class="col-head"><span class="col-dot {col.tone}"></span><span class="col-name">{col.label}</span><span class="col-count">{columnCount(i, moved)}</span></div>
                {/each}
              </div>
              {#each MOCK_LANES as lane, l}
                <div class="swimlane">
                  <div class="swimlane-head">
                    <span class="epic-dot" class:none={!lane.epic}></span>
                    <span class="epic-name">{lane.name}</span>
                    {#if lane.epic}
                      <span class="epic-bar"><span style="width:{(lane.epic.done / lane.epic.total) * 100}%"></span></span>
                      <span class="epic-progress">{lane.epic.done}/{lane.epic.total}</span>
                    {/if}
                  </div>
                  <div class="swimlane-body">
                    {#each MOCK_COLUMNS as col, c}
                      <div class="cell" class:drag-over={dragOver && l === 0 && c === 1}>
                        <span class="cell-label">{col.label}</span>
                        {#each cardsIn(l, c, moved) as card (card.key)}
                          <div class="mcard" in:receive={{ key: card.key }} out:send={{ key: card.key }} animate:flip={{ duration: 300 }}>
                            <div class="mcard-top">
                              <span class="mkeytype">
                                <span class="mtype {card.type.toLowerCase()}"><Icon name={typeIcon(card.type)} size={9} /></span>
                                <span class="mkey">{card.key}</span>
                              </span>
                              {#if card.priority !== 'medium'}<span class="mprio {card.priority}"><Icon name={priorityIcon(card.priority)} size={11} /></span>{/if}
                            </div>
                            <div class="mtitle">{card.title}</div>
                            {#if card.labels}
                              <div class="mlabels">{#each card.labels as lb}<span class="mlabel"><span class="mldot" style="background:{lb.color}"></span>{lb.name}</span>{/each}</div>
                            {/if}
                            <div class="mbottom">
                              <div class="mbottom-left">
                                {#if card.due === 'overdue'}<span class="mdue overdue">OVERDUE</span>{:else if card.due === 'soon'}<span class="mdue soon">DUE SOON</span>{/if}
                              </div>
                              <div class="mbottom-right">
                                {#if card.points}<span class="mpoints" style="background:{storyPointColor(card.points).bg};color:{storyPointColor(card.points).text}">{card.points}</span>{/if}
                                {#if card.agent}<span class="mstack magent">{@render agentAvatar(17)}</span>{/if}
                                {#if card.people}
                                  <span class="mstack">{#each card.people as n}<img class="mavatar" src="/headshots/avatar-{n}.jpg" alt="" width="19" height="19" loading="lazy" />{/each}</span>
                                {/if}
                              </div>
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>

            <!-- 1 · AI Agents — the real IssueDrawer: head, key row, title, field grid, AI Agents section, Comments tab -->
            <div class="scene scene-flush" class:on={active === 1}>
              <div class="drawer">
                <div class="drawer-head"><span class="dcrumb"><b>Sprint 12</b></span><span class="x"><Icon name="x" size={14} /></span></div>
                <div class="drawer-body">
                  <div class="key-row">
                    <span class="type-icon task"><Icon name={typeIcon('Task')} size={11} /></span>
                    <span class="key">WH-140</span>
                    <span class="status-pill inprogress">In Progress</span>
                  </div>
                  <div class="title-input">Summarize weekly standup notes</div>
                  <div class="field-grid">
                    <div class="field">
                      <span class="field-label">Assignees</span>
                      <span class="assignee-chip"><img class="mavatar" style="width:16px;height:16px" src="/headshots/avatar-4.jpg" alt="" width="16" height="16" />Sam Rivera</span>
                    </div>
                    <div class="field"><span class="field-label">Priority</span><span class="field-select">Medium</span></div>
                    <div class="field"><span class="field-label">Story points</span><span class="field-select">—</span></div>
                    <div class="field"><span class="field-label">Sprint</span><span class="field-select">Sprint 12 (Active)</span></div>
                  </div>
                  <div class="section">
                    <div class="section-label">AI Agents</div>
                    {#if !agentAttached}<p class="agents-hint" out:fade={{ duration: 150 }}>Attach an agent to have it work this ticket.</p>{/if}
                    <div class="agent-chips">
                      {#if agentAttached}
                        <span class="agent-chip" in:scale={{ duration: 300, start: 0.8 }}>
                          <span class="chip-name">{@render agentAvatar(16)}<Icon name="robot" size={11} />Triage Bot</span>
                          <span class="chip-run">{agentRunning ? 'Running…' : 'Run'}</span>
                          <span class="chip-remove"><Icon name="x" size={10} /></span>
                        </span>
                      {/if}
                      <span class="assignee-add">+ Add</span>
                    </div>
                  </div>
                  <div class="tabs"><span class="tab-on">Comments</span><span>Activity</span></div>
                  {#if agentReplied}
                    <div class="comment" in:fly={{ y: 12, duration: 380 }}>
                      {@render agentAvatar(24)}
                      <div class="comment-body">
                        <div class="comment-meta"><span class="comment-name"><Icon name="robot" size={11} />Triage Bot</span><span class="comment-time">just now</span></div>
                        <div class="comment-text">Summary: 5 decisions, 3 action items and 1 blocker. Owners are listed for each.</div>
                      </div>
                    </div>
                  {:else}
                    <div class="comment-empty">No comments yet.</div>
                  {/if}
                </div>
              </div>
            </div>

            <!-- 2 · You stay in control — Settings → Agents, "Awaiting your approval" and the agent list -->
            <div class="scene scene-flush" class:on={active === 2}>
              <div class="sframe">
                <nav class="stabs">{#each SETTINGS_TABS as tn}<span class="stab" class:active={tn === 'Agents'}>{tn}</span>{/each}</nav>
                <div class="spanel">
                  {#if !approved}
                    <div class="subsection-label" out:fade={{ duration: 150 }}>Awaiting your approval</div>
                    <div class="pending-card" out:fade={{ duration: 250 }}>
                      <div class="pending-head">
                        {@render agentAvatar(20)}
                        <span class="agent-name">Triage Bot<span class="ai-badge">AI</span></span>
                        <span class="issue-key">WH-140</span>
                        <span class="run-time">2 minutes ago</span>
                      </div>
                      <p class="rationale">Summarizing the standup notes and moving the ticket to In Progress.</p>
                      <ul class="proposed-actions">{#each PROPOSED as a}<li>{a}</li>{/each}</ul>
                      <div class="pending-actions"><span class="text-btn" class:pressed={approvePressed}>Approve</span><span class="text-btn danger">Reject</span></div>
                    </div>
                  {/if}
                  <div class="subsection-label">Agents</div>
                  <p class="section-hint">Agents work tickets on a teammate's behalf — attach one to an issue and it can comment, change status, reassign, or update fields as it makes progress, always attributed back to the human it's acting for.</p>
                  <div class="agent-card">
                    <span class="avatar-ring">{@render agentAvatar(30)}</span>
                    <div class="agent-info">
                      <span class="agent-name">Triage Bot<span class="ai-badge">AI</span><span class="status-dot enabled"></span></span>
                      <span class="agent-instructions">Summarizes meeting notes and keeps ticket status current.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3 · GitHub — Project settings → Git (link a repo), then the drawer's Branch section -->
            <div class="scene scene-flush" class:on={active === 3}>
              <div class="sframe">
                <nav class="stabs">{#each PROJECT_TABS as tn}<span class="stab" class:active={tn === 'Git'}>{tn}</span>{/each}</nav>
                <div class="spanel">
                  <p class="section-hint">Link this project to a git repository to create a real branch for any ticket, right from its drawer.</p>
                  {#if repoLinked}
                    <div class="row" in:fade={{ duration: 250 }}>
                      <Icon name="branch" size={13} /><span class="row-name">acme/widgets</span><span class="row-tag">github · default branch: main</span><Icon name="trash" size={13} />
                    </div>
                  {:else}
                    <div class="add-form column">
                      <span class="f-input muted-ph">Search your repositories</span>
                      <span class="f-input" class:muted-ph={!repoPicked}>{repoPicked ? 'acme/widgets · private' : 'Choose a repository'}<Icon name="chevdown" size={11} /></span>
                      <span class="f-input" class:muted-ph={!repoPicked}>{repoPicked ? 'main' : 'Default branch (main)'}</span>
                      <p class="field-hint">Access is checked with your GitHub account (@octocat). Connections are per account — manage yours under Settings → Git.</p>
                      <span class="f-btn" class:pressed={linkPressed} class:off={!repoPicked}>Link repository</span>
                    </div>
                  {/if}
                  <div class="subsection-label branch-label">In the issue drawer</div>
                  <div class="section-label">Branch</div>
                  {#if branchCreated}
                    <span class="branch-link" in:scale={{ duration: 300, start: 0.9 }}><Icon name="branch" size={13} />issue/WH-140-summarize-weekly-standup-notes</span>
                  {:else if branchFormOpen}
                    <div class="inline-form" in:fade={{ duration: 200 }}><span class="inline-input">issue/WH-140-summarize-weekly-standup-notes</span><span class="inline-btn">Create</span></div>
                  {:else}
                    <span class="assignee-add">+ Create Branch</span>
                  {/if}
                </div>
              </div>
            </div>

            <!-- 4 · Automations — Settings → Automations: a row per rule, then the if/then detail lines -->
            <div class="scene scene-flush" class:on={active === 4}>
              <div class="sframe">
                <nav class="stabs">{#each SETTINGS_TABS as tn}<span class="stab" class:active={tn === 'Automations'}>{tn}</span>{/each}</nav>
                <div class="spanel">
                  <div class="list">
                    {#each RULES as rule, i}
                      <div class="row column">
                        <div class="row">
                          <span class="row-name">{rule.name}</span>
                          <span class="row-tag">on {rule.on}</span>
                          <span class="toggle"><span class="check" class:on={i === 0 || nudgeEnabled}>{#if i === 0 || nudgeEnabled}<Icon name="check" size={9} />{/if}</span>enabled</span>
                          <Icon name="trash" size={13} />
                        </div>
                        {#if rule.ifs}<p class="rule-detail">if {rule.ifs}</p>{/if}
                        <p class="rule-detail">{rule.then}</p>
                      </div>
                    {/each}
                  </div>
                </div>
              </div>
            </div>

            <!-- 5 · Insights — the real Stats view: header + window switch, Time spent chart, Most active tickets -->
            <div class="scene scene-flush" class:on={active === 5}>
              <div class="stats-view">
                <div class="s-header">
                  <span class="s-title">Stats</span>
                  <span class="window-switcher">
                    <span class="view-tab" class:active={false}>24h</span><span class="view-tab" class:active={statsWin === '1w'}>1 week</span><span class="view-tab" class:active={statsWin === '30d'}>30 days</span>
                  </span>
                </div>
                <div class="subsection-label usage-label">Time spent<span class="total-seconds">{formatDuration(totalHours * 3600)}</span></div>
                <div class="bar-chart" class:month={statsWin === '30d'}>
                  {#each buckets as b, i (statsWin + i)}
                    <div class="bar-col">
                      <div class="bar-track">{#if b.h > 0}<span class="bar-fill" style="height:{barsIn ? (b.h / maxH) * 100 : 0}%;transition-delay:{i * 25}ms"></span>{/if}</div>
                      <span class="bar-label">{i % labelStride === 0 ? b.label : ''}</span>
                    </div>
                  {/each}
                </div>
                <div class="subsection-label">Most active tickets</div>
                <div class="ticket-list">
                  {#each top as t, i (statsWin + t.key)}
                    <div class="ticket-row">
                      <span class="ticket-key">{t.key}</span><span class="ticket-title">{t.title}</span>
                      <span class="ticket-bar"><span style="width:{barsIn ? (t.n / maxN) * 100 : 0}%;transition-delay:{i * 80}ms"></span></span>
                      <span class="ticket-count">{t.n}</span>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="captions" aria-hidden="true">
          {#each SCENES as s, i}
            <div class="caption" class:on={active === i}>
              <div class="cap-icon"><Icon name={s.icon} size={18} /></div>
              <div>
                <div class="cap-title">{s.title}</div>
                <p class="cap-desc">{s.desc}</p>
              </div>
            </div>
          {/each}
        </div>

        <nav class="dots" aria-label="Feature tour">
          {#each SCENES as s, i}
            <button type="button" class="dot" class:on={active === i} aria-label={s.title} aria-current={active === i ? 'true' : undefined} on:click={() => goTo(i)}></button>
          {/each}
        </nav>
      </div>
    </div>
  </div>

  <!-- Shown instead of the pinned tour when the visitor prefers reduced motion. -->
  <div class="features-static">
    <h2>Everything a team needs, nothing it doesn't</h2>
    <div class="features">
      {#each SCENES as s}
        <div class="feature">
          <div class="feature-icon"><Icon name={s.icon} size={18} /></div>
          <div class="feature-title">{s.title}</div>
          <p class="feature-desc">{s.desc}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  /* ---- board preview ---- */
  /* Pulled up toward the hero text: .content's 88px section gap is right between the other sections, but
     too airy here now that the hero ends at the subtitle and the board is what the visitor came to see. */
  /* App bar: the real TopBar's breadcrumb, Board|Backlog switch, and blue "+ New…" button. */
  .preview-bar {
    display: flex; align-items: center; gap: 14px; padding: 9px 14px;
    background: var(--lp-surface); border-bottom: 1px solid var(--lp-border); font-size: 12px; color: var(--lp-text-3);
  }
  .crumb { white-space: nowrap; }
  .crumb-strong { color: var(--lp-text); font-weight: 600; }
  .seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 8px; background: var(--lp-surface-sunken); border: 1px solid var(--lp-border); font-weight: 600; font-size: 11.5px; }
  .seg > span { padding: 4px 11px; border-radius: 6px; color: var(--lp-text-2); }
  .seg > .seg-on { background: var(--lp-surface); color: var(--lp-text); box-shadow: 0 0 0 1px var(--lp-border); }
  .spacer { flex: 1; }
  .new-btn { background: var(--lp-create-bg); color: #fff; font-size: 11.5px; font-weight: 600; padding: 6px 12px; border-radius: 8px; white-space: nowrap; }

  .preview-search { display: flex; gap: 10px; margin-bottom: 4px; }
  .search-field {
    flex: 1; display: flex; align-items: center; gap: 7px; padding: 7px 10px; font-size: 12px; color: var(--lp-text-3);
    background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 8px;
  }
  .filters-btn { padding: 7px 12px; font-size: 12px; font-weight: 600; color: var(--lp-text-2); background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 8px; }

  /* Column header row — the real .board-head / .col-head. */
  .board-head { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 12px 0 10px; }
  .col-head { display: flex; align-items: center; gap: 7px; padding: 2px 6px; }
  .col-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--lp-text-3); }
  .col-dot.progress { background: var(--lp-info); }
  .col-dot.done { background: var(--lp-success); }
  .col-name { font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--lp-text-2); }
  .col-count { font-size: 11px; color: var(--lp-text-3); }

  /* Epic swimlanes with a grey cell per column — the real .swimlane / .cell. */
  .swimlane { margin-bottom: 6px; }
  .swimlane-head { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px; }
  .epic-dot { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 9px; background: var(--lp-info); }
  .epic-dot.none { background: var(--lp-text-3); }
  .epic-name { font-size: 12.5px; font-weight: 700; color: var(--lp-text); }
  .epic-bar { width: 64px; height: 4px; border-radius: 99px; background: var(--lp-surface-sunken); overflow: hidden; }
  .epic-bar > span { display: block; height: 100%; border-radius: 99px; background: var(--lp-text); }
  .epic-progress { font-size: 11px; color: var(--lp-text-3); }
  .swimlane-body { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .cell { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 10px; background: var(--lp-surface-sunken); min-height: 40px; }
  .cell-label { display: none; }

  /* The card — the real IssueCard, section for section. */
  .mcard {
    display: flex; flex-direction: column; gap: 7px; padding: 10px 11px 9px;
    background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 9px;
  }
  .mcard-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .mkeytype { display: flex; align-items: center; gap: 6px; }
  .mtype { width: 14px; height: 14px; flex: 0 0 14px; border-radius: 3px; display: flex; align-items: center; justify-content: center; background: var(--lp-success-soft); color: var(--lp-success); }
  .mtype.bug { background: var(--lp-critical-soft); color: var(--lp-critical); }
  .mtype.task { background: var(--lp-info-soft); color: var(--lp-info); }
  .mkey { font-family: Mono, ui-monospace, monospace; font-size: 11px; font-weight: 500; color: var(--lp-text-3); }
  .mprio { display: flex; align-items: center; }
  .mprio.highest { color: var(--lp-critical); }
  .mprio.high { color: var(--lp-warning); }
  .mprio.low, .mprio.lowest { color: var(--lp-text-3); }
  .mtitle { font-size: 12.5px; font-weight: 500; line-height: 1.4; color: var(--lp-text); }
  .mlabels { display: flex; gap: 5px; flex-wrap: wrap; }
  .mlabel { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 5px; color: var(--lp-text-2); background: var(--lp-surface-2); border: 1px solid var(--lp-border); }
  .mldot { width: 6px; height: 6px; border-radius: 2px; }
  .mbottom { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; min-height: 19px; }
  .mbottom-left, .mbottom-right { display: flex; align-items: center; }
  .mbottom-right { gap: 6px; }
  .mdue { font-family: Mono, ui-monospace, monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; }
  .mdue.overdue { background: var(--lp-critical-soft); color: var(--lp-critical); }
  .mdue.soon { background: var(--lp-warning-soft); color: var(--lp-warning); }
  .mpoints { width: 19px; height: 19px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: Mono, ui-monospace, monospace; font-size: 10px; font-weight: 700; }
  .mstack { display: flex; }
  .mstack > * { margin-left: -6px; border-radius: 50%; box-shadow: 0 0 0 2px var(--lp-surface); }
  .mstack > :first-child { margin-left: 0; }
  .magent { margin-right: 2px; }
  .mavatar { width: 19px; height: 19px; border-radius: 50%; object-fit: cover; background: var(--lp-border-strong); }
  .magent-avatar { width: 17px; height: 17px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--lp-agent-soft); }
  .magent-avatar img { object-fit: contain; }


  /* ---- layout: a tall track with one pinned stage ---- */
  .showcase { width: 100%; max-width: 920px; margin-top: -48px; text-align: left; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .story-track { position: relative; height: calc(var(--n) * 78vh); }
  .sentinel { position: absolute; left: 0; width: 1px; top: calc(var(--i) * 100% / var(--n)); height: calc(100% / var(--n)); pointer-events: none; }
  .story-pin { position: sticky; top: 72px; }
  .story-fit { transform-origin: top left; display: flex; flex-direction: column; gap: 14px; }

  .window {
    display: flex; flex-direction: column; background: var(--lp-bg); border: 1px solid var(--lp-border); border-radius: 14px;
    box-shadow: var(--lp-shadow-lg); overflow: hidden; flex: none;
  }
  .scenes { position: relative; flex: 1; min-height: 0; }
  .scene {
    position: absolute; inset: 0; padding: 12px 16px 14px; overflow: hidden;
    opacity: 0; pointer-events: none; transition: opacity .4s ease;
  }
  .scene.on { opacity: 1; }

  .captions { display: grid; padding: 0 4px; }
  .caption { grid-area: 1 / 1; display: flex; gap: 14px; align-items: flex-start; opacity: 0; transform: translateY(6px); transition: opacity .35s ease, transform .35s ease; }
  .caption.on { opacity: 1; transform: none; }
  .cap-icon {
    width: 38px; height: 38px; flex: 0 0 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    background: var(--lp-accent-soft); color: var(--lp-accent-strong);
  }
  .cap-title { font-size: 17px; font-weight: 700; color: var(--lp-text); margin-bottom: 3px; }
  .cap-desc { font-size: 14px; line-height: 1.55; color: var(--lp-text-2); margin: 0; max-width: 680px; }

  .dots { display: flex; justify-content: center; gap: 0; }
  .dot { all: unset; box-sizing: border-box; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%; }
  .dot::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--lp-border-strong); transition: background .2s, transform .2s; }
  .dot.on::before { background: var(--lp-text); transform: scale(1.25); }
  .dot:focus-visible { outline: 2px solid var(--lp-accent-strong); outline-offset: 1px; }

  /* ---- board scene extras ---- */
  .cell { transition: background .25s, box-shadow .25s; }
  .cell.drag-over { box-shadow: inset 0 0 0 2px var(--lp-info); }

  /* ---- the screens below mirror real ones (IssueDrawer, Settings, AgentsSettings, ProjectSettings, Stats) ---- */
  .scene-flush { padding: 0; background: var(--lp-surface); }
  .mono, .key, .issue-key, .ticket-key, .ticket-count, .total-seconds { font-family: Mono, ui-monospace, monospace; }
  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--lp-text-2); margin: 18px 0 8px; }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--lp-text-2); margin: 0 0 8px; }
  .section-hint { font-size: 12px; line-height: 1.5; color: var(--lp-text-3); margin: 0 0 12px; max-width: 520px; }
  .field-hint { font-size: 11px; line-height: 1.4; color: var(--lp-text-3); margin: 0; }
  .text-btn { font-size: 12px; font-weight: 600; color: var(--lp-accent-strong); transition: transform .15s; }
  .text-btn.danger { color: var(--lp-critical); }
  .text-btn.pressed { transform: scale(.9); }
  .ai-badge { display: inline-flex; align-items: center; font-size: 9px; font-weight: 700; letter-spacing: .03em; color: var(--lp-agent); background: var(--lp-agent-soft); border-radius: 4px; padding: 1px 5px; margin-left: 6px; }
  .agent-name { display: flex; align-items: center; font-size: 12.5px; font-weight: 600; color: var(--lp-text); }
  .x { display: inline-flex; color: var(--lp-text-3); }
  .assignee-add { font-size: 12px; color: var(--lp-text-3); background: var(--lp-surface-2); border: 1px dashed var(--lp-border); border-radius: 999px; padding: 3px 10px; }

  /* IssueDrawer */
  .drawer { height: 100%; display: flex; flex-direction: column; background: var(--lp-surface); max-width: 640px; margin: 0 auto; border-left: 1px solid var(--lp-border); border-right: 1px solid var(--lp-border); }
  .drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px 9px; border-bottom: 1px solid var(--lp-border); }
  .dcrumb { font-size: 11.5px; color: var(--lp-text-3); }
  .dcrumb b { color: var(--lp-text-2); font-weight: 600; }
  .drawer-body { padding: 16px 24px 14px; overflow: hidden; }
  .key-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .type-icon { width: 18px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center; background: var(--lp-success-soft); color: var(--lp-success); }
  .type-icon.task { background: var(--lp-info-soft); color: var(--lp-info); }
  .key-row .key { font-size: 12px; font-weight: 500; color: var(--lp-text-3); }
  .status-pill { display: inline-flex; padding: 5px 10px; border-radius: 99px; font-size: 11.5px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; background: var(--lp-surface-2); color: var(--lp-text-2); }
  .status-pill.inprogress { background: var(--lp-info-soft); color: var(--lp-info); }
  .title-input { font-size: 20px; font-weight: 700; color: var(--lp-text); padding: 4px 6px; margin: 0 -6px 12px; line-height: 1.25; }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin-bottom: 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field-label { font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--lp-text-3); }
  .field-select { display: flex; align-items: center; height: 30px; box-sizing: border-box; padding: 0 8px; font-size: 12.5px; color: var(--lp-text); background: var(--lp-surface-2); border: 1px solid var(--lp-border); border-radius: 6px; }
  .assignee-chip { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--lp-text); background: var(--lp-surface-2); border: 1px solid var(--lp-border); border-radius: 999px; padding: 3px 8px 3px 5px; }
  .section { margin-bottom: 16px; }
  .agents-hint { font-size: 12px; color: var(--lp-text-3); margin: 0 0 8px; }
  .agent-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 26px; }
  .agent-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--lp-text); background: var(--lp-surface-2); border: 1px solid var(--lp-border); border-radius: 999px; padding: 3px 8px 3px 5px; }
  .chip-name { display: inline-flex; align-items: center; gap: 5px; }
  .chip-run { font-size: 10.5px; font-weight: 600; color: var(--lp-text-3); border: 1px solid var(--lp-border); border-radius: 99px; padding: 1px 7px; }
  .chip-remove { display: flex; color: var(--lp-text-3); }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--lp-border); margin-bottom: 12px; }
  .tabs > span { font-size: 12px; font-weight: 600; color: var(--lp-text-3); padding: 6px 4px 8px; margin-right: 14px; border-bottom: 2px solid transparent; }
  .tabs > .tab-on { color: var(--lp-text); border-bottom-color: var(--lp-accent); }
  .comment { display: flex; gap: 9px; }
  .comment .magent-avatar { flex: 0 0 24px; }
  .comment-body { flex: 1; min-width: 0; }
  .comment-meta { display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px; }
  .comment-name { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; color: var(--lp-text); }
  .comment-name :global(svg) { color: var(--lp-agent); }
  .comment-time { font-size: 11px; color: var(--lp-text-3); }
  .comment-text { font-size: 12.5px; line-height: 1.5; color: var(--lp-text); }
  .comment-empty { font-size: 12px; color: var(--lp-text-3); }

  /* Settings / ProjectSettings: a tab column plus a panel */
  .sframe { display: flex; height: 100%; }
  .stabs { flex: 0 0 180px; display: flex; flex-direction: column; gap: 2px; padding: 16px 10px; border-right: 1px solid var(--lp-border); }
  .stab { font-size: 12.5px; font-weight: 500; color: var(--lp-text-2); padding: 7px 10px; border-radius: 7px; }
  .stab.active { background: var(--lp-accent-soft); color: var(--lp-accent-strong); font-weight: 600; }
  .spanel { flex: 1; min-width: 0; padding: 18px 24px; overflow: hidden; }
  .spanel > .subsection-label:first-child { margin-top: 0; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--lp-surface-2); border: 1px solid var(--lp-border); border-radius: 8px; font-size: 12.5px; max-width: 560px; color: var(--lp-text-3); }
  .row.column { flex-direction: column; align-items: stretch; gap: 4px; }
  .row.column > .row { padding: 0; background: none; border: none; max-width: none; }
  .row-name { color: var(--lp-text); font-weight: 500; }
  .row-tag { color: var(--lp-text-3); font-size: 11.5px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list { display: flex; flex-direction: column; gap: 6px; }
  .rule-detail { font-size: 12px; color: var(--lp-text-2); margin: 0; }
  .toggle { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--lp-text-3); white-space: nowrap; }
  .check { width: 13px; height: 13px; border-radius: 3px; border: 1px solid var(--lp-border-strong); display: inline-flex; align-items: center; justify-content: center; background: var(--lp-surface); color: var(--lp-accent-on); transition: background .2s, border-color .2s; }
  .check.on { background: var(--lp-accent); border-color: var(--lp-accent); }

  /* AgentsSettings: pending approval card + agent card */
  .pending-card { background: var(--lp-warning-soft); border: 1px solid var(--lp-border); border-radius: 10px; padding: 10px 12px; max-width: 560px; }
  .pending-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .issue-key { font-size: 11px; color: var(--lp-text-2); background: var(--lp-surface); border-radius: 5px; padding: 1px 6px; }
  .run-time { font-size: 11px; color: var(--lp-text-3); margin-left: auto; white-space: nowrap; }
  .rationale { font-size: 12px; color: var(--lp-text-2); margin: 6px 0 0; }
  .proposed-actions { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: var(--lp-text-2); }
  .pending-actions { display: flex; gap: 12px; margin-top: 8px; }
  .agent-card { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--lp-surface-2); border: 1px solid var(--lp-border); border-radius: 10px; max-width: 560px; }
  .avatar-ring { display: flex; padding: 3px; border-radius: 50%; background: var(--lp-agent-soft); flex: 0 0 auto; }
  .avatar-ring .magent-avatar { background: transparent; }
  .agent-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .agent-instructions { font-size: 11.5px; color: var(--lp-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--lp-text-3); margin-left: 8px; flex: 0 0 auto; }
  .status-dot.enabled { background: var(--lp-success); }

  /* ProjectSettings → Git, and the drawer's Branch control */
  .add-form.column { display: flex; flex-direction: column; gap: 8px; max-width: 360px; }
  .f-input { display: flex; align-items: center; justify-content: space-between; gap: 7px; font-size: 12.5px; color: var(--lp-text); background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 7px; padding: 7px 9px; transition: color .2s; }
  .f-input.muted-ph { color: var(--lp-text-3); }
  .f-btn { align-self: stretch; text-align: center; font-size: 12px; font-weight: 600; color: var(--lp-accent-on); background: var(--lp-accent); padding: 7px 12px; border-radius: 7px; transition: transform .15s, opacity .2s; }
  .f-btn.off { opacity: .5; }
  .f-btn.pressed { transform: scale(.96); }
  .branch-label { margin-top: 16px; }
  .branch-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--lp-accent-strong); background: var(--lp-accent-soft); border-radius: 7px; padding: 5px 10px; max-width: 100%; overflow-wrap: anywhere; }
  .inline-form { display: flex; gap: 6px; }
  .inline-input { flex: 1; min-width: 0; font-size: 12px; color: var(--lp-text); background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 6px; padding: 5px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inline-btn { font-size: 12px; font-weight: 600; color: var(--lp-accent-on); background: var(--lp-accent); border-radius: 6px; padding: 5px 12px; }

  /* Stats */
  .stats-view { padding: 24px 32px; max-width: 720px; margin: 0 auto; }
  .s-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
  .s-title { font-size: 19px; font-weight: 700; color: var(--lp-text); }
  .window-switcher { display: flex; gap: 2px; background: var(--lp-surface-sunken); border-radius: 8px; padding: 3px; }
  .view-tab { padding: 5px 12px; font-size: 12.5px; font-weight: 500; color: var(--lp-text-2); border-radius: 6px; transition: background .2s; }
  .view-tab.active { background: var(--lp-surface); color: var(--lp-text); box-shadow: 0 0 0 1px var(--lp-border); font-weight: 600; }
  .stats-view .subsection-label:first-of-type { margin-top: 0; }
  .usage-label { display: flex; align-items: center; justify-content: space-between; }
  .total-seconds { font-size: 12px; font-weight: 600; color: var(--lp-text-3); text-transform: none; letter-spacing: normal; }
  .bar-chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; padding: 8px 0; }
  .bar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; height: 100%; }
  .bar-track { width: 100%; flex: 1; display: flex; align-items: flex-end; background: var(--lp-surface-sunken); border-radius: 3px 3px 0 0; border-bottom: 2px solid var(--lp-border); overflow: hidden; }
  .bar-fill { display: block; width: 100%; background: var(--lp-accent); border-radius: 3px 3px 0 0; min-height: 1px; transition: height .7s cubic-bezier(.22,1,.36,1); }
  .bar-label { font-size: 9.5px; color: var(--lp-text-3); white-space: nowrap; height: 14px; transform: rotate(-40deg); transform-origin: top right; }
  .ticket-list { display: flex; flex-direction: column; gap: 4px; }
  .ticket-row { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 6px 0; }
  .ticket-key { color: var(--lp-text-3); flex: 0 0 auto; }
  .ticket-title { color: var(--lp-text-2); flex: 1 1 auto; min-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ticket-bar { width: 96px; height: 6px; border-radius: 99px; background: var(--lp-surface-sunken); overflow: hidden; flex: 0 0 auto; }
  .ticket-bar > span { display: block; height: 100%; border-radius: 99px; background: var(--lp-accent); transition: width .7s cubic-bezier(.22,1,.36,1); }
  .ticket-count { color: var(--lp-text-3); flex: 0 0 auto; width: 2em; text-align: right; }

  /* ---- reduce motion: no pinning, a static board, and the plain feature grid ---- */
  .features-static { display: none; }
  .features-static h2 { font-size: 28px; font-weight: 800; letter-spacing: -.01em; color: var(--lp-text); margin: 0 0 28px; text-align: center; }
  .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; width: 100%; }
  .feature { display: flex; flex-direction: column; gap: 8px; padding: 22px; background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 12px; }
  .feature-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--lp-accent-soft); color: var(--lp-accent-strong); margin-bottom: 4px; }
  .feature-title { font-size: 15px; font-weight: 700; color: var(--lp-text); }
  .feature-desc { font-size: 13.5px; color: var(--lp-text-2); line-height: 1.55; margin: 0; }
  @media (prefers-reduced-motion: reduce) {
    .story-track { height: auto; }
    .story-pin { position: static; height: auto !important; }
    .story-fit { transform: none !important; width: 100% !important; height: auto !important; }
    .sentinel, .captions, .dots, .sr-list { display: none; }
    .window { height: auto !important; }
    .scene { transition: none; }
    .scene:not(.scene-board) { display: none; }
    .scene-board { position: static; opacity: 1; }
    .features-static { display: block; margin-top: 88px; }
    .sr-only:not(.sr-list) { position: absolute; }
  }
  @media (max-width: 860px) { .features { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 600px) {
    .showcase { margin-top: -28px; }
    .features { grid-template-columns: 1fr; }
    .features-static h2 { font-size: 23px; }
    .cap-title { font-size: 16px; }
    .cap-desc { font-size: 13.5px; }
    .preview-bar .seg, .preview-search .filters-btn, .preview-search { display: none; }
    .scene { padding: 10px 10px 12px; }
    .board-head { display: none; }
    .swimlane-body { grid-template-columns: 1fr; gap: 8px; }
    .swimlane ~ .swimlane { display: none; }
    .cell { padding: 8px; gap: 8px; }
    .cell .mcard ~ .mcard { display: none; }
    .cell-label { display: block; font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--lp-text-3); }
    .scene-flush { padding: 0; }
    .drawer-body { padding: 12px 14px; }
    .field-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
    .title-input { font-size: 17px; }
    .stabs { display: none; }
    .spanel { padding: 14px; }
    .stats-view { padding: 16px 14px; }
    .bar-chart { height: 90px; }
    .bar-label { display: none; }
    .ticket-bar { width: 56px; }
    .ticket-title { min-width: 60px; }
    .row { flex-wrap: wrap; }
    .row-tag { flex-basis: 100%; order: 3; }
  }

</style>
