<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { priorityIcon, storyPointColor, typeIcon } from '../util';

  export let onGetStarted: () => void;
  export let onLogin: () => void;
  export let onPrivacy: () => void;
  export let onTerms: () => void;
  export let onAccessibility: () => void;

  const FEATURES: { icon: string; title: string; desc: string }[] = [
    { icon: 'columns', title: 'Board & Backlog', desc: 'Drag-and-drop kanban plus full sprint planning, without leaving the page.' },
    { icon: 'robot', title: 'AI Agents', desc: 'Attach an agent to a ticket and it picks up the work, commenting and updating status as it goes. Runs on a local Ollama model — no hosted AI provider required.' },
    { icon: 'route', title: 'Automations', desc: "Rule-based triggers and actions handle the busywork so your team doesn't have to." },
    { icon: 'branch', title: 'GitHub, built in', desc: 'Connect your own GitHub account to link a repo and create a branch straight from a ticket.' },
    { icon: 'lock', title: 'You stay in control', desc: 'Require approval before an agent acts, and cap how often and how much each one can do. Repo writes always wait for a human.' },
    { icon: 'clock', title: 'Insights', desc: 'Time-spent charts and most-active-ticket rankings, updated in real time.' },
  ];

  const STEPS: { n: string; title: string; desc: string }[] = [
    { n: '1', title: 'Attach', desc: 'Pick an agent and attach it to a ticket.' },
    { n: '2', title: 'Propose', desc: 'It reads the ticket and proposes actions from a closed, safe vocabulary.' },
    { n: '3', title: 'Approve', desc: 'Auto-apply, or review each proposal first. Everything lands in the activity log.' },
  ];

  /*
   * The mock board below mirrors the real Task Board (Board.svelte + IssueCard.svelte): same card
   * anatomy (type icon + key + priority icon / title / labels / due chip + points + agent + assignees),
   * same column header row, same epic swimlanes with grey per-column cells, and the same app-bar chrome.
   * Icons and story-point colors come from the real helpers in util.ts so they can't drift; the layout
   * and CSS are copied by hand (this page must not read the app's stores — see the note on the markup),
   * so when IssueCard or Board changes visually, update this to match.
   */
  type MockCard = {
    key: string; title: string; type: 'Story' | 'Bug' | 'Task'; priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
    labels?: { name: string; color: string }[]; due?: 'overdue' | 'soon'; points?: number; agent?: boolean; people?: number[];
  };
  const MOCK_COLUMNS: { label: string; tone: 'todo' | 'progress' | 'done' }[] = [
    { label: 'To Do', tone: 'todo' },
    { label: 'In Progress', tone: 'progress' },
    { label: 'Done', tone: 'done' },
  ];
  const MOCK_SWIMLANES: { name: string; epic?: { done: number; total: number }; cells: MockCard[][] }[] = [
    { name: 'No Epic', cells: [
      [{ key: 'WH-142', title: 'Add CSV export to reports', type: 'Story', priority: 'medium', labels: [{ name: 'Reports', color: '#3B7DC4' }], points: 5, people: [1, 2] }],
      [
        { key: 'WH-138', title: 'Fix OAuth token refresh race', type: 'Bug', priority: 'high', due: 'overdue', points: 2, people: [3] },
        { key: 'WH-140', title: 'Summarize weekly standup notes', type: 'Task', priority: 'medium', agent: true, people: [4] },
      ],
      [{ key: 'WH-131', title: 'Sprint burndown chart', type: 'Story', priority: 'low', points: 3, people: [3] }],
    ] },
    { name: 'Customer Onboarding Revamp', epic: { done: 1, total: 3 }, cells: [
      [{ key: 'WH-145', title: 'Dark mode contrast pass', type: 'Story', priority: 'low', due: 'soon', people: [4] }],
      [{ key: 'WH-141', title: 'Migrate webhook retries', type: 'Task', priority: 'medium', points: 3, people: [2] }],
      [{ key: 'WH-129', title: 'Audit accessibility of settings', type: 'Story', priority: 'low', points: 2, people: [1] }],
    ] },
  ];
  const columnCount = (i: number) => MOCK_SWIMLANES.reduce((n, lane) => n + lane.cells[i].length, 0);

  const currentYear = new Date().getFullYear();

  // The tab title is otherwise the app's ("Workhorse — Board"); restore it when the visitor
  // moves on to login or signs in.
  onMount(() => {
    document.title = 'Workhorse — Project management with AI agents';
    return undefined;
  });
</script>

<!-- This is an unauthenticated marketing page and must not depend on anything the authenticated
     app can mutate — not the shared theme tokens (see <style> below), and not the shared i18n
     locale store either. Every string here is a literal, always in English. -->
<div class="landing">
  <header class="nav">
    <div class="nav-inner">
      <div class="brand"><Icon name="anvil" size={26} />Workhorse</div>
      <button type="button" class="login-link" on:click={onLogin}>Log in</button>
    </div>
  </header>

  <main class="content">
    <section class="hero">
      <span class="eyebrow">Boards · Sprints · AI agents</span>
      <h1>Project management that <span class="muted">keeps up with your team</span></h1>
      <p class="subtitle">Plan sprints, move work across the board, and let AI agents pick up tickets and work them — with you approving every step that matters. Self-hosted, so your data stays yours.</p>
    </section>

    <section class="preview-wrap">
      <div class="preview" aria-hidden="true">
        <div class="preview-bar">
          <span class="crumb"><span class="crumb-strong">Workhorse</span> / Sprint 12</span>
          <span class="seg"><span class="seg-on">Board</span><span>Backlog</span></span>
          <span class="spacer"></span>
          <span class="new-btn">+ New…</span>
        </div>
        <div class="preview-body">
          <div class="preview-search">
            <span class="search-field"><Icon name="search" size={12} />Search issues…</span>
            <span class="filters-btn">Filters</span>
          </div>
          <div class="board-head">
            {#each MOCK_COLUMNS as col, i}
              <div class="col-head"><span class="col-dot {col.tone}"></span><span class="col-name">{col.label}</span><span class="col-count">{columnCount(i)}</span></div>
            {/each}
          </div>
          {#each MOCK_SWIMLANES as lane}
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
                {#each lane.cells as cards, i}
                  <div class="cell">
                    <span class="cell-label">{MOCK_COLUMNS[i].label}</span>
                    {#each cards as card}
                      <div class="mcard">
                        <div class="mcard-top">
                          <span class="mkeytype">
                            <span class="mtype {card.type.toLowerCase()}"><Icon name={typeIcon(card.type)} size={9} /></span>
                            <span class="mkey">{card.key}</span>
                          </span>
                          <span class="mprio {card.priority}"><Icon name={priorityIcon(card.priority)} size={11} /></span>
                        </div>
                        <div class="mtitle">{card.title}</div>
                        {#if card.labels}
                          <div class="mlabels">{#each card.labels as l}<span class="mlabel"><span class="mldot" style="background:{l.color}"></span>{l.name}</span>{/each}</div>
                        {/if}
                        <div class="mbottom">
                          <div class="mbottom-left">
                            {#if card.due === 'overdue'}<span class="mdue overdue">OVERDUE</span>{:else if card.due === 'soon'}<span class="mdue soon">DUE SOON</span>{/if}
                          </div>
                          <div class="mbottom-right">
                            {#if card.points}<span class="mpoints" style="background:{storyPointColor(card.points).bg};color:{storyPointColor(card.points).text}">{card.points}</span>{/if}
                            {#if card.agent}
                              <span class="mstack magent"><span class="magent-avatar"><picture><source media="(prefers-color-scheme: dark)" srcset="/agents/ollama-light.svg" /><img src="/agents/ollama-dark.svg" alt="" width="11" height="11" /></picture></span></span>
                            {/if}
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
      </div>
    </section>

    <section class="section">
      <h2>Everything a team needs, nothing it doesn't</h2>
      <div class="features">
        {#each FEATURES as f}
          <div class="feature">
            <div class="feature-icon"><Icon name={f.icon} size={18} /></div>
            <div class="feature-title">{f.title}</div>
            <p class="feature-desc">{f.desc}</p>
          </div>
        {/each}
      </div>
    </section>

    <section class="section">
      <h2>Automation you can trust</h2>
      <p class="section-sub">Agents never get a free hand. Every action comes from a short, fixed list, and you decide how much they can do alone.</p>
      <ol class="steps">
        {#each STEPS as st}
          <li class="step">
            <span class="step-n">{st.n}</span>
            <div class="step-title">{st.title}</div>
            <p class="step-desc">{st.desc}</p>
          </li>
        {/each}
      </ol>
    </section>

    <section class="cta-band">
      <h2>Ready when your team is</h2>
      <p>Create a workspace and start moving work in minutes.</p>
      <button type="button" class="btn" on:click={onGetStarted}>Get started</button>
    </section>
  </main>

  <footer class="footer">
    <p class="copyright">© {currentYear} Workhorse. All rights reserved.</p>
    <div class="footer-links">
      <button type="button" class="footer-link" on:click={onGetStarted}>Get started</button>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a class="footer-link" href="/privacy" on:click|preventDefault={onPrivacy}>Privacy Policy</a>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a class="footer-link" href="/terms" on:click|preventDefault={onTerms}>Terms of Use</a>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a class="footer-link" href="/accessibility" on:click|preventDefault={onAccessibility}>Accessibility Statement</a>
    </div>
    <a class="footer-link github-link" href="https://github.com/KingUndeadCodes/workhorse" target="_blank" rel="noopener noreferrer">
      <img class="github-icon" src="/github.svg" alt="" width="22" height="22" />
      GitHub
    </a>
  </footer>
</div>

<style>
  /* This page is shown to unauthenticated visitors and must render purely off the browser's
     own prefers-color-scheme — it deliberately does NOT use the app's shared --bg/--text/etc
     tokens (app.css's :root), since those are mutated at runtime by an explicit [data-theme]
     choice persisted in localStorage. A returning visitor whose stored in-app theme happens to
     be "dark" should still see this page follow their current OS/browser preference, not
     whatever they last picked while logged in. Every color below is local to this component. */
  .landing {
    --lp-bg: #F5F5F5;
    --lp-surface: #FFFFFF;
    --lp-surface-2: #FAFAFA;
    --lp-surface-sunken: #EBEBEB;
    --lp-border: #DDDDDD;
    --lp-border-strong: #C6C6C6;
    --lp-text: #1F1F1F;
    --lp-text-2: #5A5A5A;
    --lp-text-3: #8C8C8C;
    --lp-accent: #46484D;
    --lp-accent-strong: #2E2F33;
    --lp-accent-soft: #E9E9EA;
    --lp-accent-on: #FFFFFF;
    /* Status/priority/agent colors copied from the app's own light tokens, for the mock board. */
    --lp-info: #3B7DC4; --lp-info-soft: #E6EFFA;
    --lp-success: #2E9E58; --lp-success-soft: #E3F5E9;
    --lp-warning: #B9791A; --lp-warning-soft: #FBF0DD;
    --lp-critical: #D6455A; --lp-critical-soft: #FBE6EA;
    --lp-agent-soft: rgba(204,120,92,.14);
    --lp-create-bg: #2563EB;
    /* The mock window is the one genuinely elevated surface on this page (the style guide reserves shadows for
       those), so it gets a layered shadow: a long soft fall-off plus a tighter contact shadow. Cards inside stay flat. */
    --lp-shadow-lg: 0 32px 64px -16px rgba(12,43,78,.30), 0 12px 24px -8px rgba(12,43,78,.16), 0 2px 6px rgba(12,43,78,.08);
  }
  @media (prefers-color-scheme: dark) {
    .landing {
      --lp-bg: #161616;
      --lp-surface: #1E1E1E;
      --lp-surface-2: #232323;
      --lp-surface-sunken: #121212;
      --lp-border: #333333;
      --lp-border-strong: #444444;
      --lp-text: #EDEDED;
      --lp-text-2: #B0B0B0;
      --lp-text-3: #7A7A7A;
      --lp-accent: #9AA0A6;
      --lp-accent-strong: #C2C7CC;
      --lp-accent-soft: rgba(154,160,166,.14);
      --lp-accent-on: #101114;
      --lp-info: #6FA8E4; --lp-info-soft: rgba(111,168,228,.15);
      --lp-success: #4FBE7C; --lp-success-soft: rgba(79,190,124,.15);
      --lp-warning: #E0A53D; --lp-warning-soft: rgba(224,165,61,.15);
      --lp-critical: #E8677C; --lp-critical-soft: rgba(232,103,124,.15);
      /* Black on a near-black page barely shows, so the dark version is heavier and adds a 1px light edge for definition. */
      --lp-shadow-lg: 0 32px 80px -12px rgba(0,0,0,.85), 0 12px 28px -8px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.06);
    }
  }
  .landing {
    height: 100vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    width: 100%;
    background: var(--lp-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
  }

  /* ---- nav ---- */
  .nav {
    position: sticky; top: 0; z-index: 5; width: 100%;
    background: color-mix(in srgb, var(--lp-bg) 85%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--lp-border);
  }
  .nav-inner {
    max-width: 1040px; margin: 0 auto; padding: 12px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .brand { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 700; color: var(--lp-text); }
  .brand :global(svg) { color: var(--lp-accent); }

  .login-link {
    background: none; border: none; cursor: pointer; font-size: 14px; font-weight: 600;
    color: var(--lp-text-2); padding: 12px 4px;
  }
  .login-link:hover { color: var(--lp-text); }
  .login-link:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; }

  /* ---- buttons ---- */
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 12px 26px; border-radius: 10px; border: 1px solid transparent;
    background: var(--lp-accent); color: var(--lp-accent-on);
    font-size: 14px; font-weight: 700; cursor: pointer; text-decoration: none;
  }
  .btn:hover { background: var(--lp-accent-strong); }
  .btn:focus-visible, .footer-link:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; }

  .content {
    width: 100%; max-width: 1040px; box-sizing: border-box;
    padding: 72px 24px 24px;
    display: flex; flex-direction: column; align-items: center; gap: 88px;
  }

  /* ---- hero ---- */
  .hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 18px; max-width: 700px; }
  .eyebrow {
    font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
    color: var(--lp-text-2); background: var(--lp-accent-soft);
    border: 1px solid var(--lp-border); border-radius: 999px; padding: 5px 14px;
  }
  h1 { font-size: 52px; font-weight: 800; line-height: 1.1; letter-spacing: -.02em; color: var(--lp-text); margin: 0; }
  h1 .muted { color: var(--lp-text-3); }
  .subtitle { font-size: 17px; line-height: 1.6; color: var(--lp-text-2); margin: 0; max-width: 600px; }

  /* ---- board preview ---- */
  /* Pulled up toward the hero text: .content's 88px section gap is right between the other sections, but
     too airy here now that the hero ends at the subtitle and the board is what the visitor came to see. */
  .preview-wrap { width: 100%; max-width: 920px; margin-top: -48px; }
  .preview {
    background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 14px;
    box-shadow: var(--lp-shadow-lg); overflow: hidden; text-align: left;
  }
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

  .preview-body { background: var(--lp-bg); padding: 12px 16px 14px; }
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
  .mprio.medium { color: var(--lp-info); }
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

  /* ---- sections ---- */
  .section { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 28px; text-align: center; }
  h2 { font-size: 28px; font-weight: 800; letter-spacing: -.01em; color: var(--lp-text); margin: 0; }
  .section-sub { font-size: 15px; line-height: 1.6; color: var(--lp-text-2); max-width: 560px; margin: -12px 0 0; }

  .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; width: 100%; text-align: left; }
  .feature {
    display: flex; flex-direction: column; gap: 8px; padding: 22px;
    background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 12px;
  }
  .feature-icon {
    width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    background: var(--lp-accent-soft); color: var(--lp-accent-strong); margin-bottom: 4px;
  }
  .feature-title { font-size: 15px; font-weight: 700; color: var(--lp-text); }
  .feature-desc { font-size: 13.5px; color: var(--lp-text-2); line-height: 1.55; margin: 0; }

  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; width: 100%; text-align: left; }
  .step { padding: 22px; border-left: 2px solid var(--lp-border-strong); display: flex; flex-direction: column; gap: 6px; }
  .step-n {
    width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
    background: var(--lp-accent); color: var(--lp-accent-on); font-size: 12.5px; font-weight: 700; margin-bottom: 4px;
  }
  .step-title { font-size: 16px; font-weight: 700; color: var(--lp-text); }
  .step-desc { font-size: 13.5px; line-height: 1.55; color: var(--lp-text-2); margin: 0; }

  .cta-band {
    width: 100%; box-sizing: border-box; text-align: center; padding: 56px 24px;
    background: var(--lp-surface); border: 1px solid var(--lp-border); border-radius: 18px;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .cta-band p { font-size: 15px; color: var(--lp-text-2); margin: 0 0 8px; }

  .footer { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 56px 24px 72px; }
  .copyright { font-size: 12px; color: var(--lp-text-2); margin: 0; }
  .footer-links { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0 8px; }
  .footer-link {
    display: inline-flex; align-items: center; gap: 5px; background: none; border: none;
    color: var(--lp-text-2); font-size: 13px; text-decoration: none; cursor: pointer; padding: 12px 8px; min-height: 44px; box-sizing: border-box;
  }
  .footer-link:hover { color: var(--lp-accent); }
  .github-link { gap: 7px; font-size: 15px; font-weight: 600; color: var(--lp-text-2); }
  /* github.svg is a fixed black fill, not currentColor — invisible-ish against the dark-mode
     footer otherwise, so it's inverted the same way this page already branches every other
     color on prefers-color-scheme (see the :root-level custom properties above). */
  .github-icon { display: block; }
  @media (prefers-color-scheme: dark) {
    .github-icon { filter: invert(1); }
  }
  .footer-sep { color: var(--lp-text-2); font-size: 12px; }

  @media (max-width: 860px) {
    .features, .steps { grid-template-columns: 1fr 1fr; }
    h1 { font-size: 40px; }
  }
  @media (max-width: 600px) {
    .content { padding: 44px 16px 16px; gap: 64px; }
    .preview-wrap { margin-top: -28px; }
    .nav-inner { padding: 10px 16px; }
    h1 { font-size: 32px; }
    .subtitle { font-size: 15.5px; }
    h2 { font-size: 23px; }
    /* Like the real board on a phone: header row hidden, each cell stacks and labels itself. Only the first
       swimlane is shown so the hero doesn't turn into a long scroll before the features. */
    .preview-bar .seg, .preview-search .filters-btn { display: none; }
    .preview-body { padding: 10px 10px 12px; }
    .board-head { display: none; }
    .swimlane-body { grid-template-columns: 1fr; gap: 12px; }
    .swimlane ~ .swimlane { display: none; }
    .cell { padding: 10px; gap: 10px; }
    .cell-label { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--lp-text-3); margin-bottom: 2px; }
    .features, .steps { grid-template-columns: 1fr; }
    .cta-band { padding: 40px 18px; }
  }
</style>
