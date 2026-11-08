<script lang="ts">
  import Icon from './Icon.svelte';
  import { currentProject, currentProjectId, featureFlags, gitRepoLink, settingsJumpTab, workspaceFeatures, linkGitRepo, unlinkGitRepo, setFeatureFlag, updateCurrentProject } from '../stores/workspace';
  import * as api from '../api';
  import { PROJECT_COLORS, type GitRepoSummary, type ProjectFeatureFlags } from '$domain';
  import { t } from '../i18n';

  /**
   * One of the two project-scoped tab bodies inside Settings.svelte (its "Project" group) —
   * Settings owns the tab nav, the panel padding and which tab is showing; this component only
   * renders the body for the tab it's given. Settings hides the Git tab when the git module is
   * switched off, so it never has to be rendered in that case.
   */
  export let tab: 'Project' | 'Git' = 'Project';

  /**
   * How the color picker lays out {@link PROJECT_COLORS}. The palette keeps its own order on purpose — new
   * projects take the next entry and `avatarColor` (util.ts) hashes into it, so the list alternates hues to keep
   * neighbouring picks distinct, and reordering it would recolor every existing avatar. So only the *display* is
   * arranged: vivid colors around the color wheel (rose, red, orange, yellow, green, teal, blue), then the muted
   * tones on a row of their own. Derived from the palette, so a color added later lands in the right place.
   */
  function hueAndSaturation(hex: string): { hue: number; sat: number } {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const lightness = (max + min) / 2;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * lightness - 1));
    let hue = 0;
    if (d !== 0) {
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return { hue, sat };
  }
  const MUTED_BELOW_SATURATION = 0.3;
  const swatchGroups: string[][] = (() => {
    // Each color is converted once up front, then filtered and sorted on the cached numbers.
    const colors = PROJECT_COLORS.map((hex) => ({ hex, ...hueAndSaturation(hex) }));
    // Shifted 30° so the wheel starts at rose rather than splitting the reds across both ends of the row.
    const byHue = (a: { hue: number }, b: { hue: number }) => ((a.hue + 30) % 360) - ((b.hue + 30) % 360);
    const vivid = colors.filter((c) => c.sat >= MUTED_BELOW_SATURATION).sort(byHue);
    const muted = colors.filter((c) => c.sat < MUTED_BELOW_SATURATION).sort(byHue);
    return [vivid, muted].filter((g) => g.length > 0).map((g) => g.map((c) => c.hex));
  })();

  /** What a swatch is called to a screen reader and in its tooltip. A color added to the palette before it has a name falls back to its hex. */
  $: colorName = (hex: string) => {
    const key = `projectSettings.colorNames.${hex}`;
    const name = $t(key);
    return name === key ? hex : name;
  };

  const FEATURE_LABEL_KEYS: Record<keyof ProjectFeatureFlags, string> = {
    reporters: 'projectSettings.features.reporters',
    storyPoints: 'projectSettings.features.storyPoints',
    dueDates: 'projectSettings.features.dueDates',
    timeTracking: 'projectSettings.features.timeTracking',
    priority: 'projectSettings.features.priority',
    sprints: 'projectSettings.features.sprints',
    labels: 'projectSettings.features.labels',
  };
  const FEATURE_KEYS = Object.keys(FEATURE_LABEL_KEYS) as (keyof ProjectFeatureFlags)[];

  // ---- Project ----
  let editProjectName = '';
  let editingProjectName = false;
  $: if ($currentProject && !editingProjectName) editProjectName = $currentProject.name;
  async function saveProjectName() {
    if (!editProjectName.trim() || !$currentProject || editProjectName.trim() === $currentProject.name) {
      editingProjectName = false;
      return;
    }
    await updateCurrentProject({ name: editProjectName.trim() });
    editingProjectName = false;
  }
  async function archiveProject() {
    if (!$currentProject || !confirm($t('projectSettings.archiveConfirm', { name: $currentProject.name }))) return;
    await updateCurrentProject({ archivedAt: new Date().toISOString() });
  }
  async function setProjectColor(color: string) {
    if (!$currentProject || color === $currentProject.color) return;
    await updateCurrentProject({ color });
  }

  // ---- Git ----
  // No provider ships built-in — see server/src/services/GitProvider.ts. The link form below
  // only renders once availableGitProviders confirms at least one is actually registered on
  // the server, instead of always showing a form that would 400 no matter what's typed into it.
  let availableGitProviders: string[] = [];

  let linkRepoError = '';
  // Linking verifies access with *your* connected account (Settings → Git), so say so up front
  // instead of letting the first submit 400. Only 'github' has a connection to check; 'local' needs none.
  let connections: { provider: string; accountLogin?: string }[] = [];
  // Only the Git tab uses either list, and this component serves both tabs of the Project group (and is rebuilt each
  // time the group is re-entered) — so fetch on first showing the Git tab, not whenever the Project tab opens.
  let gitDataRequested = false;
  $: if (tab === 'Git' && $workspaceFeatures.git && !gitDataRequested) {
    gitDataRequested = true;
    api.listGitProviders().then((p) => (availableGitProviders = p)).catch(() => {});
    api.listGitConnections().then((r) => (connections = r.connections)).catch(() => {});
  }
  $: myConnection = connections.find((c) => c.provider === newRepoProvider);
  // Repo picker: once the caller's own account is connected, list the repos it can reach so they
  // choose one instead of typing owner/repo/branch. Falls back to the manual fields if the list fails or is empty.
  let repos: GitRepoSummary[] = [];
  let reposState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let repoFilter = '';
  let selectedRepo = '';
  // Start over whenever the provider changes — otherwise the previous provider's repo list lingers, and a failed load never retries.
  $: if (newRepoProvider !== undefined) {
    reposState = 'idle';
    repos = [];
    selectedRepo = '';
    repoFilter = '';
  }
  $: if (newRepoProvider !== '' && myConnection && reposState === 'idle') loadRepos(newRepoProvider);
  async function loadRepos(provider: string) {
    reposState = 'loading';
    try {
      repos = await api.listGitRepos(provider);
      reposState = 'ready';
    } catch {
      reposState = 'error';
    }
  }
  $: usePicker = reposState === 'ready' && repos.length > 0;
  $: filteredRepos = repos.filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(repoFilter.trim().toLowerCase())).slice(0, 100);
  function pickRepo() {
    const r = repos.find((x) => `${x.owner}/${x.repo}` === selectedRepo);
    if (!r) return;
    newRepoOwner = r.owner;
    newRepoName = r.repo;
    newRepoDefaultBranch = r.defaultBranch;
  }
  $: needsConnection = newRepoProvider !== '' && newRepoProvider !== 'local' && !myConnection;

  let newRepoProvider = '';
  let newRepoOwner = '';
  let newRepoName = '';
  let newRepoDefaultBranch = '';
  let linkingRepo = false;
  // With exactly one registered provider, there's no real choice — lock to it, same treatment AgentForm gives Runtime.
  $: if (availableGitProviders.length === 1 && newRepoProvider !== availableGitProviders[0]) newRepoProvider = availableGitProviders[0];
  async function submitGitRepoLink() {
    if (!$currentProjectId || !newRepoProvider.trim() || !newRepoOwner.trim() || !newRepoName.trim() || needsConnection) return;
    linkingRepo = true;
    linkRepoError = '';
    try {
      await linkGitRepo($currentProjectId, { provider: newRepoProvider.trim(), owner: newRepoOwner.trim(), repo: newRepoName.trim(), defaultBranch: newRepoDefaultBranch.trim() || undefined });
      newRepoProvider = '';
      newRepoOwner = '';
      newRepoName = '';
      newRepoDefaultBranch = '';
      selectedRepo = '';
      repoFilter = '';
    } catch (err) {
      linkRepoError = err instanceof Error ? err.message : $t('projectSettings.failedLinkRepo');
    } finally {
      linkingRepo = false;
    }
  }
  async function removeGitRepoLink() {
    if (!$currentProjectId) return;
    await unlinkGitRepo($currentProjectId);
  }
</script>

<div class="project-panel">
  {#if tab === 'Project'}
    {#if $currentProject}
      <div class="field-row">
        <label class="field-label" for="proj-name-input">{$t('projectSettings.nameLabel')}</label>
        <input id="proj-name-input" type="text" bind:value={editProjectName} on:focus={() => (editingProjectName = true)} on:blur={saveProjectName} on:keydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </div>
      <div class="field-row">
        <span class="field-label">{$t('projectSettings.keyLabel')}</span>
        <span class="row-tag mono">{$currentProject.key}</span>
      </div>
      <p class="section-hint">{$t('projectSettings.keyHint', { key: $currentProject.key })}</p>
      <div class="field-row top">
        <span class="field-label">{$t('projectSettings.colorLabel')}</span>
        <div class="swatch-groups" role="group" aria-label={$t('projectSettings.colorLabel')}>
          {#each swatchGroups as group}
            <div class="swatch-row">
              {#each group as c}
                <button
                  type="button"
                  class="swatch"
                  class:active={c === $currentProject.color}
                  style="background:{c}"
                  title={colorName(c)}
                  aria-label={$t('projectSettings.colorSwatchLabel', { color: colorName(c) })}
                  aria-pressed={c === $currentProject.color}
                  on:click={() => setProjectColor(c)}
                ><Icon name="check" size={12} /></button>
              {/each}
            </div>
          {/each}
        </div>
      </div>
      <div class="subsection-label">{$t('projectSettings.featuresLabel')}</div>
      <p class="section-hint">{$t('projectSettings.featuresHint')}</p>
      <div class="feature-list">
        {#each FEATURE_KEYS as key}
          <label class="toggle feature-toggle">
            <input type="checkbox" checked={$featureFlags[key]} on:change={(e) => setFeatureFlag(key, (e.target as HTMLInputElement).checked)} />
            {$t(FEATURE_LABEL_KEYS[key])}
          </label>
        {/each}
      </div>

      <button type="button" class="text-btn danger" on:click={archiveProject}>{$t('projectSettings.archiveButton')}</button>
    {/if}
  {:else if tab === 'Git'}
    <p class="section-hint">{$t('projectSettings.gitHint')}</p>
    {#if $gitRepoLink}
      <div class="row">
        <Icon name="branch" size={13} />
        <span class="row-name">{$gitRepoLink.owner}/{$gitRepoLink.repo}</span>
        <span class="row-tag">{$gitRepoLink.provider} · {$t('projectSettings.defaultBranchSuffix', { branch: $gitRepoLink.defaultBranch })}</span>
        <button class="icon-btn" aria-label={$t('projectSettings.unlinkRepoLabel')} on:click={removeGitRepoLink}><Icon name="trash" size={13} /></button>
      </div>
    {:else if availableGitProviders.length === 0}
      <p class="section-hint">{$t('projectSettings.noGitProviderHint')}</p>
    {:else}
      <form class="add-form column" on:submit|preventDefault={submitGitRepoLink}>
        {#if availableGitProviders.length > 1}
          <select bind:value={newRepoProvider}>
            {#each availableGitProviders as p}<option value={p}>{p}</option>{/each}
          </select>
        {/if}
        {#if usePicker}
          <input type="search" placeholder={$t('projectSettings.repoSearchPlaceholder')} bind:value={repoFilter} aria-label={$t('projectSettings.repoSearchPlaceholder')} />
          <select bind:value={selectedRepo} on:change={pickRepo} aria-label={$t('projectSettings.repoSelectPlaceholder')}>
            <option value="">{$t('projectSettings.repoSelectPlaceholder')}</option>
            {#each filteredRepos as r (`${r.owner}/${r.repo}`)}
              <option value={`${r.owner}/${r.repo}`}>{r.owner}/{r.repo}{r.private ? ` · ${$t('projectSettings.privateTag')}` : ''}</option>
            {/each}
          </select>
        {:else}
          {#if reposState === 'loading'}<p class="field-hint">{$t('projectSettings.reposLoading')}</p>{/if}
          <input type="text" placeholder={$t('projectSettings.ownerPlaceholder')} bind:value={newRepoOwner} />
          <input type="text" placeholder={$t('projectSettings.repoPlaceholder')} bind:value={newRepoName} />
        {/if}
        <input type="text" placeholder={$t('projectSettings.defaultBranchPlaceholder')} bind:value={newRepoDefaultBranch} />
        {#if needsConnection}
          <p class="field-hint">{$t('projectSettings.connectAccountHint')}</p>
          <button type="button" class="text-btn" on:click={() => settingsJumpTab.set('Git')}>{$t('projectSettings.connectAccountButton')}</button>
        {:else if myConnection?.accountLogin}
          <p class="field-hint">{$t('projectSettings.linkingAsHint', { login: myConnection.accountLogin })}</p>
        {/if}
        <button type="submit" disabled={linkingRepo || needsConnection || (usePicker && !selectedRepo)}>{linkingRepo ? $t('projectSettings.linkingRepoButton') : $t('projectSettings.linkRepoButton')}</button>
      </form>
      {#if linkRepoError}<p class="error">{linkRepoError}</p>{/if}
    {/if}
  {/if}
</div>

<style>
  @media (max-width: 768px) {
    .row { padding: 11px 12px; font-size: 13.5px; }
    .icon-btn { padding: 8px; }
    .field-row { flex-wrap: wrap; gap: 8px 12px; }
    .field-row input[type='text'] { padding: 9px 11px; max-width: none; }
    .add-form { flex-wrap: wrap; }
    .add-form input, .add-form select { padding: 9px 11px; }
    .add-form button { padding: 10px 14px; }
    .feature-list { grid-template-columns: 1fr; }
    .toggle { font-size: 13.5px; }
    .toggle input[type="checkbox"] { width: 18px; height: 18px; }
  }
  .section-hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 0 0 12px; max-width: 520px; }
  .field-hint { font-size: 11px; line-height: 1.4; color: var(--text-3); margin: -4px 0 0; }
  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 18px 0 8px; }
  .feature-list { display: grid; grid-template-columns: repeat(2, minmax(0, 200px)); gap: 8px 20px; margin-bottom: 18px; }
  .toggle { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text); white-space: nowrap; }
  .field-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .field-label { flex: 0 0 60px; font-size: 12px; font-weight: 600; color: var(--text-2); }
  .field-row input[type='text'] {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 7px; padding: 6px 10px; max-width: 320px; width: 100%;
  }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; }
  .row-name { color: var(--text); font-weight: 500; }
  .row-tag { color: var(--text-3); font-size: 11.5px; flex: 1; }
  .icon-btn { color: var(--text-3); padding: 4px; border-radius: 6px; margin-left: auto; }
  .icon-btn:hover { background: var(--surface); color: var(--critical); }
  .text-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); }
  .text-btn.danger { color: var(--critical); }
  .error { color: var(--critical); font-size: 12px; margin: 0 0 8px; }
  .add-form { display: flex; gap: 8px; }
  .add-form.column { flex-direction: column; align-items: stretch; max-width: 360px; }
  .add-form input, .add-form select { font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px; flex: 1; }
  .add-form button { font-size: 12px; font-weight: 600; color: var(--accent-on); background: var(--accent); padding: 7px 12px; border-radius: 7px; white-space: nowrap; }
  .add-form button:disabled { opacity: .5; cursor: default; }
  .field-row.top { align-items: flex-start; }
  .field-row.top .field-label { padding-top: 5px; }
  .swatch-groups { display: flex; flex-direction: column; gap: 12px; }
  .swatch-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .swatch {
    width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: #fff; transition: transform .1s ease;
  }
  .swatch:hover { transform: scale(1.12); }
  .swatch :global(svg) { opacity: 0; }
  .swatch.active :global(svg) { opacity: 1; }

  /* After the base .swatch rules on purpose: same specificity, so source order decides, and an earlier
     media block would lose to them. */
  @media (max-width: 768px) {
    /* Five to a row, big enough to tap, so each group wraps into tidy rows instead of a ragged tail. */
    .swatch-groups { gap: 14px; width: 100%; }
    .swatch-row { display: grid; grid-template-columns: repeat(5, 36px); gap: 14px 16px; }
    .swatch { width: 36px; height: 36px; }
  }
</style>
