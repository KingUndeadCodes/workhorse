<script lang="ts">
  import { statusCategories, workflow } from '../stores/workspace';

  /** A status as a small colored-dot chip — its own color if it has one, else its category's. Used where an issue's state needs showing beside its key (linked issues, picker results). */
  export let statusId: string;

  $: status = $workflow?.statuses.find((s) => s.id === statusId);
  $: category = status ? $statusCategories.find((c) => c.id === status!.categoryId) : undefined;
  $: color = status?.color ?? category?.color;
</script>

{#if status}
  <span class="status-chip"><span class="dot" style={color ? `background:${color}` : undefined}></span>{status.name}</span>
{/if}

<style>
  .status-chip {
    display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; max-width: 110px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    font-size: 10.5px; font-weight: 600; color: var(--text-2); background: var(--surface-sunken); border-radius: 99px; padding: 2px 8px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); flex: 0 0 auto; }
</style>
