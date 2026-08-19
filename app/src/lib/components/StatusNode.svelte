<script lang="ts">
  // Custom Svelte Flow node for one workflow status. Handles on both sides let Svelte Flow's
  // own drag-to-connect create transitions — no hand-rolled "click source, click target" state.
  import { Handle, Position } from '@xyflow/svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';
  import type { WorkflowStatus } from '$domain';

  interface StatusNodeData {
    status: WorkflowStatus;
    deletable: boolean;
    onEdit: () => void;
  }

  let { data }: { data: StatusNodeData } = $props();
</script>

<div class="status-node" style={data.status.color ? `border-color:${data.status.color}` : ''}>
  <Handle type="target" position={Position.Left} />
  {#if !data.deletable}
    <span class="lock" title={$t('statusNode.lockedTitle')}><Icon name="lock" size={10} /></span>
  {/if}
  <span class="name">{data.status.name}</span>
  <button
    class="edit-btn"
    title={$t('statusNode.editTitle')}
    onmousedown={(e) => e.stopPropagation()}
    onclick={(e) => {
      e.stopPropagation();
      data.onEdit();
    }}
  >
    <Icon name="pencil" size={11} />
  </button>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .status-node {
    display: flex; align-items: center; gap: 6px; padding: 10px 12px; min-width: 140px;
    background: var(--surface); border: 1.5px solid var(--border); border-radius: 8px;
    font-size: 12.5px; font-weight: 600; color: var(--text); box-shadow: var(--shadow);
  }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lock { display: flex; align-items: center; color: var(--text-3); flex: 0 0 auto; }
  .edit-btn { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 5px; color: var(--text-3); flex: 0 0 auto; }
  .edit-btn:hover { background: var(--surface-sunken); color: var(--accent-strong); }
</style>
