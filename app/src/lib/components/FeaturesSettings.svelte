<script lang="ts">
  import type { WorkspaceFeatureFlags } from '$domain';
  import { setWorkspaceFeature, workspaceFeatures } from '../stores/workspace';
  import { t } from '../i18n';

  // Order is the order shown; labels/descriptions live under `featuresSettings.<flag>` in i18n.
  const FLAGS: (keyof WorkspaceFeatureFlags)[] = ['agents', 'automations', 'webhooks', 'insights', 'git'];

  let busyFlag: keyof WorkspaceFeatureFlags | null = null;
  let error = '';

  async function toggle(flag: keyof WorkspaceFeatureFlags, input: HTMLInputElement) {
    const enabled = input.checked;
    busyFlag = flag;
    error = '';
    try {
      await setWorkspaceFeature(flag, enabled);
    } catch (err) {
      // The store didn't change, so nothing re-renders the checkbox — put it back by hand.
      input.checked = !enabled;
      error = err instanceof Error ? err.message : $t('featuresSettings.failed');
    } finally {
      busyFlag = null;
    }
  }
</script>

<p class="hint">{$t('featuresSettings.hint')}</p>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="list">
  {#each FLAGS as flag (flag)}
    <label class="row">
      <span class="copy">
        <span class="name">{$t(`featuresSettings.${flag}.label`)}</span>
        <span class="desc">{$t(`featuresSettings.${flag}.description`)}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={$workspaceFeatures[flag]}
        disabled={busyFlag === flag}
        on:change={(e) => toggle(flag, e.currentTarget)}
      />
    </label>
  {/each}
</div>

<p class="note">{$t('featuresSettings.coreNote')}</p>

<style>
  .hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin: 0 0 16px; max-width: 560px; }
  .error { font-size: 12px; color: var(--critical); margin: 0 0 12px; }
  .list { display: flex; flex-direction: column; gap: 8px; max-width: 560px; }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; cursor: pointer;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
  }
  .copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .name { font-size: 13px; font-weight: 600; color: var(--text); }
  .desc { font-size: 12px; line-height: 1.45; color: var(--text-3); }
  input[type='checkbox'] { flex: 0 0 auto; width: 18px; height: 18px; cursor: pointer; }
  input[type='checkbox']:disabled { cursor: default; opacity: .5; }
  .note { font-size: 11.5px; color: var(--text-3); margin: 16px 0 0; max-width: 560px; }

  @media (max-width: 767px) {
    .row { padding: 14px; }
    .name { font-size: 14px; }
    .desc { font-size: 12.5px; }
    input[type='checkbox'] { width: 22px; height: 22px; }
  }
</style>
