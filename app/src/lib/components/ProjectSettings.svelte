<script lang="ts">
  import Icon from './Icon.svelte';
  import { components as componentsStore, currentProject, currentProjectId, featureFlags, gitRepoLink, settingsJumpTab, versions, linkGitRepo, unlinkGitRepo, setFeatureFlag, updateCurrentProject } from '../stores/workspace';
  import * as api from '../api';
  import { PROJECT_COLORS, type ProjectFeatureFlags } from '$domain';

  const allTabs = ['Project', 'Components', 'Versions', 'Git'] as const;
  $: tabs = $featureFlags.componentsAndVersions ? allTabs : (allTabs.filter((t) => t !== 'Components' && t !== 'Versions') as unknown as typeof allTabs);
  let activeTab: (typeof allTabs)[number] = 'Project';
  // If Components/Versions get turned off while one of those tabs is active, fall back to Project.
  $: if (!tabs.includes(activeTab)) activeTab = 'Project';

  // Lets the TopBar "New…" menu open this view already on the relevant tab (e.g. "New Component").
  if ($settingsJumpTab && (allTabs as readonly string[]).includes($settingsJumpTab)) {
    activeTab = $settingsJumpTab as (typeof allTabs)[number];
  }
  settingsJumpTab.set(null);

  const FEATURE_LABELS: Record<keyof ProjectFeatureFlags, string> = {
    reporters: 'Reporters',
    storyPoints: 'Story Points',
    dueDates: 'Due Dates',
    timeTracking: 'Time Tracking',
    priority: 'Priority',
    componentsAndVersions: 'Components & Versions',
    sprints: 'Sprints',
    labels: 'Labels',
  };
  const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as (keyof ProjectFeatureFlags)[];

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
    if (!$currentProject || !confirm(`Archive "${$currentProject.name}"? It'll stay in the workspace but hidden from the project switcher.`)) return;
    await updateCurrentProject({ archivedAt: new Date().toISOString() });
  }
  async function setProjectColor(color: string) {
    if (!$currentProject || color === $currentProject.color) return;
    await updateCurrentProject({ color });
  }

  // ---- Components ----
  let newComponentName = '';
  async function addComponent() {
    if (!newComponentName.trim() || !$currentProjectId) return;
    const component = await api.createComponent($currentProjectId, newComponentName.trim());
    componentsStore.update((l) => [...l, component]);
    newComponentName = '';
  }
  async function removeComponent(id: string) {
    await api.deleteComponent(id);
    componentsStore.update((l) => l.filter((x) => x.id !== id));
  }

  // ---- Versions ----
  let newVersionName = '';
  async function addVersion() {
    if (!newVersionName.trim() || !$currentProjectId) return;
    const version = await api.createVersion($currentProjectId, newVersionName.trim());
    versions.update((l) => [...l, version]);
    newVersionName = '';
  }
  async function releaseVersion(id: string) {
    const version = await api.releaseVersion(id);
    versions.update((l) => l.map((v) => (v.id === id ? version : v)));
  }
  async function removeVersion(id: string) {
    await api.deleteVersion(id);
    versions.update((l) => l.filter((x) => x.id !== id));
  }

  // ---- Git ----
  let newRepoOwner = '';
  let newRepoName = '';
  let newRepoDefaultBranch = '';
  let newRepoToken = '';
  let linkingRepo = false;
  let linkRepoError = '';
  async function submitGitRepoLink() {
    if (!$currentProjectId || !newRepoOwner.trim() || !newRepoName.trim() || !newRepoToken.trim()) return;
    linkingRepo = true;
    linkRepoError = '';
    try {
      await linkGitRepo($currentProjectId, { owner: newRepoOwner.trim(), repo: newRepoName.trim(), defaultBranch: newRepoDefaultBranch.trim() || undefined, token: newRepoToken.trim() });
      newRepoOwner = '';
      newRepoName = '';
      newRepoDefaultBranch = '';
      newRepoToken = '';
    } catch (err) {
      linkRepoError = err instanceof Error ? err.message : 'Failed to link repository';
    } finally {
      linkingRepo = false;
    }
  }
  async function removeGitRepoLink() {
    if (!$currentProjectId) return;
    await unlinkGitRepo($currentProjectId);
  }
</script>

<div class="settings">
  <nav class="tabs">
    {#each tabs as tab}
      <button class="tab" class:active={tab === activeTab} on:click={() => (activeTab = tab)}>{tab}</button>
    {/each}
  </nav>

  <div class="panel">
    {#if activeTab === 'Project'}
      {#if $currentProject}
        <div class="field-row">
          <label class="field-label" for="proj-name-input">Name</label>
          <input id="proj-name-input" type="text" bind:value={editProjectName} on:focus={() => (editingProjectName = true)} on:blur={saveProjectName} on:keydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </div>
        <div class="field-row">
          <span class="field-label">Key</span>
          <span class="row-tag mono">{$currentProject.key}</span>
        </div>
        <p class="section-hint">The key is permanent — it's baked into every issue's key (e.g. "{$currentProject.key}-142").</p>
        <div class="field-row">
          <span class="field-label">Color</span>
          <div class="swatch-row">
            {#each PROJECT_COLORS as c}
              <button
                type="button"
                class="swatch"
                class:active={c === $currentProject.color}
                style="background:{c}"
                title={c}
                on:click={() => setProjectColor(c)}
              ><Icon name="check" size={11} /></button>
            {/each}
          </div>
        </div>
        <div class="subsection-label">Features</div>
        <p class="section-hint">Turn off whatever process this project doesn't need — nothing is deleted, and re-enabling brings it right back.</p>
        <div class="feature-list">
          {#each FEATURE_KEYS as key}
            <label class="toggle feature-toggle">
              <input type="checkbox" checked={$featureFlags[key]} on:change={(e) => setFeatureFlag(key, (e.target as HTMLInputElement).checked)} />
              {FEATURE_LABELS[key]}
            </label>
          {/each}
        </div>

        <button type="button" class="text-btn danger" on:click={archiveProject}>Archive this project</button>
      {/if}
    {:else if activeTab === 'Components'}
      <div class="list">
        {#each $componentsStore as c (c.id)}
          <div class="row"><span class="row-name">{c.name}</span><button class="icon-btn" on:click={() => removeComponent(c.id)}><Icon name="trash" size={13} /></button></div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addComponent}>
        <input type="text" placeholder="Component name" bind:value={newComponentName} />
        <button type="submit">Add component</button>
      </form>
    {:else if activeTab === 'Versions'}
      <div class="list">
        {#each $versions as v (v.id)}
          <div class="row">
            <span class="row-name">{v.name}</span>
            <span class="row-tag" class:released={!!v.releasedAt}>{v.releasedAt ? 'Released' : 'Unreleased'}</span>
            {#if !v.releasedAt}<button class="text-btn" on:click={() => releaseVersion(v.id)}>Release</button>{/if}
            <button class="icon-btn" on:click={() => removeVersion(v.id)}><Icon name="trash" size={13} /></button>
          </div>
        {/each}
      </div>
      <form class="add-form" on:submit|preventDefault={addVersion}>
        <input type="text" placeholder="Version name (e.g. v3.5.0)" bind:value={newVersionName} />
        <button type="submit">Add version</button>
      </form>
    {:else if activeTab === 'Git'}
      <p class="section-hint">Link this project to a GitHub repository to create a real branch for any ticket, right from its drawer.</p>
      {#if $gitRepoLink}
        <div class="row">
          <Icon name="branch" size={13} />
          <span class="row-name">{$gitRepoLink.owner}/{$gitRepoLink.repo}</span>
          <span class="row-tag">default branch: {$gitRepoLink.defaultBranch}</span>
          <button class="icon-btn" on:click={removeGitRepoLink}><Icon name="trash" size={13} /></button>
        </div>
      {:else}
        <form class="add-form column" on:submit|preventDefault={submitGitRepoLink}>
          <input type="text" placeholder="Owner (e.g. octocat)" bind:value={newRepoOwner} />
          <input type="text" placeholder="Repo (e.g. Hello-World)" bind:value={newRepoName} />
          <input type="text" placeholder="Default branch (main)" bind:value={newRepoDefaultBranch} />
          <input type="password" placeholder="Personal access token" bind:value={newRepoToken} />
          <button type="submit" disabled={linkingRepo}>{linkingRepo ? 'Linking…' : 'Link repository'}</button>
        </form>
        {#if linkRepoError}<p class="error">{linkRepoError}</p>{/if}
      {/if}
    {/if}
  </div>
</div>

<style>
  .settings { flex: 1; display: flex; overflow: hidden; }
  .tabs { flex: 0 0 180px; display: flex; flex-direction: column; gap: 2px; padding: 16px 10px; border-right: 1px solid var(--border); overflow-y: auto; }
  .tab { text-align: left; font-size: 12.5px; font-weight: 500; color: var(--text-2); padding: 7px 10px; border-radius: 7px; }
  .tab:hover { background: var(--surface-sunken); }
  .tab.active { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
  .panel { flex: 1; overflow-y: auto; padding: 20px 24px; }

  @media (max-width: 768px) {
    .settings { flex-direction: column; overflow: auto; }
    .tabs {
      flex: 0 0 auto; flex-direction: row; overflow-x: auto; overflow-y: visible;
      border-right: none; border-bottom: 1px solid var(--border); padding: 10px;
    }
    .tab { white-space: nowrap; }
    .panel { padding: 16px; }
  }
  .section-hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 0 0 12px; max-width: 520px; }
  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 18px 0 8px; }
  .feature-list { display: grid; grid-template-columns: repeat(2, minmax(0, 200px)); gap: 8px 20px; margin-bottom: 18px; }
  .toggle { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text); white-space: nowrap; }
  .field-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .field-label { flex: 0 0 60px; font-size: 12px; font-weight: 600; color: var(--text-2); }
  .field-row input[type='text'] {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 7px; padding: 6px 10px; max-width: 320px; width: 100%;
  }
  .list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; font-size: 12.5px; }
  .row-name { color: var(--text); font-weight: 500; }
  .row-tag { color: var(--text-3); font-size: 11.5px; flex: 1; }
  .row-tag.released { color: var(--success); }
  .icon-btn { color: var(--text-3); padding: 4px; border-radius: 6px; margin-left: auto; }
  .icon-btn:hover { background: var(--surface); color: var(--critical); }
  .text-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); }
  .text-btn.danger { color: var(--critical); }
  .error { color: var(--critical); font-size: 12px; margin: 0 0 8px; }
  .add-form { display: flex; gap: 8px; }
  .add-form.column { flex-direction: column; align-items: stretch; max-width: 360px; }
  .add-form input { font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px; flex: 1; }
  .add-form button { font-size: 12px; font-weight: 600; color: var(--accent-on); background: var(--accent); padding: 7px 12px; border-radius: 7px; white-space: nowrap; }
  .add-form button:disabled { opacity: .5; cursor: default; }
  .swatch-row { display: flex; gap: 7px; flex-wrap: wrap; }
  .swatch {
    width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: #fff; transition: transform .1s ease;
  }
  .swatch:hover { transform: scale(1.12); }
  .swatch :global(svg) { opacity: 0; }
  .swatch.active :global(svg) { opacity: 1; }
</style>
