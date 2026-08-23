<script lang="ts">
  // A Jira-style workflow diagram, built on Svelte Flow (@xyflow/svelte) rather than
  // hand-rolled SVG: status boxes auto-arranged in columns by category, and transitions
  // drawn by dragging from one status's handle to another's — Svelte Flow's own
  // drag-to-connect, pan/zoom, and edge selection replace the click-click state machine
  // and manual line-trimming math the first version needed.
  //
  // Still intentionally out of scope: persisted node positions (dragging feels right during
  // a session but resets to the computed column layout on reload — the domain model has no
  // x/y field to persist to), and conditions/validators/post-functions/screens — no
  // equivalent of those exists elsewhere in this app either.
  import { untrack } from 'svelte';
  import { SvelteFlow, Background, Controls, MarkerType, type Node, type Edge, type Connection, type OnBeforeDelete, type OnDelete } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import Icon from './Icon.svelte';
  import StatusNode from './StatusNode.svelte';
  import * as api from '../api';
  import { statusCategories, workflow } from '../stores/workspace';
  import type { StatusCategory, WorkflowStatus, WorkflowTransition } from '$domain';
  import { t } from '../i18n';

  /**
   * Mirrors WorkflowRepository.hasPathFromEveryTodoToDone on the server — checked here too
   * so a doomed deletion never gets approved in the first place. This matters specifically
   * because Svelte Flow's async-delete lifecycle removes nodes/edges from the bound
   * nodes/edges arrays itself once `onbeforedelete` approves them; trying to reject
   * afterward from `ondelete` (once the server call fails) is too late to undo cleanly.
   * `onbeforedelete` is the only real veto point.
   */
  function hasPathFromEveryTodoToDone(allStatuses: WorkflowStatus[], categoriesById: Map<string, StatusCategory>, allTransitions: WorkflowTransition[]): boolean {
    const todoStatuses = allStatuses.filter((s) => categoriesById.get(s.categoryId)?.type === 'todo');
    const doneIds = new Set(allStatuses.filter((s) => categoriesById.get(s.categoryId)?.type === 'done').map((s) => s.id));
    if (todoStatuses.length === 0 || doneIds.size === 0) return true;

    const allIds = allStatuses.map((s) => s.id);
    const adjacency = new Map<string, string[]>(allIds.map((id) => [id, []]));
    for (const t of allTransitions) {
      if (t.fromStatusId === '*') {
        for (const id of allIds) if (id !== t.toStatusId) adjacency.get(id)?.push(t.toStatusId);
      } else {
        adjacency.get(t.fromStatusId)?.push(t.toStatusId);
      }
    }

    return todoStatuses.every((todo) => {
      const seen = new Set<string>([todo.id]);
      const stack = [todo.id];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (doneIds.has(current)) return true;
        for (const next of adjacency.get(current) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      return false;
    });
  }

  const nodeTypes = { status: StatusNode };
  const COL_W = 230;
  const ROW_H = 80;

  let categories = $derived([...$statusCategories].sort((a, b) => a.order - b.order));
  let categoryById = $derived(new Map(categories.map((c) => [c.id, c])));
  let statuses = $derived($workflow?.statuses ?? []);
  let transitions = $derived($workflow?.transitions ?? []);
  let globalTransitions = $derived(transitions.filter((t) => t.fromStatusId === '*'));

  function statusName(id: string): string {
    return statuses.find((s) => s.id === id)?.name ?? id;
  }

  /** Only statuses in an `inProgress` category can be deleted — `todo`/`done` are the workflow's fixed entry/exit points (see WorkflowRepository.deleteStatus). */
  function isDeletable(status: WorkflowStatus): boolean {
    return categoryById.get(status.categoryId)?.type === 'inProgress';
  }

  let deleteError = $state('');

  // ---- Edit a status (rename/recolor) ----
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editColor = $state('');
  let savingEdit = $state(false);

  function startEdit(status: WorkflowStatus) {
    editingId = status.id;
    editName = status.name;
    editColor = status.color ?? '';
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveEdit() {
    if (!editingId || !editName.trim() || savingEdit) return;
    savingEdit = true;
    try {
      const updated = await api.updateWorkflowStatus(editingId, { name: editName.trim(), color: editColor.trim() || undefined });
      workflow.update((w) => (w ? { ...w, statuses: w.statuses.map((s) => (s.id === updated.id ? updated : s)) } : w));
      editingId = null;
    } finally {
      savingEdit = false;
    }
  }

  // ---- Nodes/edges kept in sync with the workflow store ----
  // Node positions default to a per-category column layout, but once Svelte Flow has a node
  // (and the user may have dragged it), we keep its current position across re-syncs instead
  // of snapping it back — only genuinely new statuses get a fresh computed position.
  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);

  $effect(() => {
    const existing = untrack(() => nodes);
    const existingById = new Map(existing.map((n) => [n.id, n]));
    nodes = categories.flatMap((cat, ci) =>
      statuses
        .filter((s) => s.categoryId === cat.id)
        .map((status, si): Node => {
          const prior = existingById.get(status.id);
          return {
            id: status.id,
            type: 'status',
            position: prior?.position ?? { x: ci * COL_W, y: si * ROW_H },
            data: { status, deletable: isDeletable(status), onEdit: () => startEdit(status) },
          };
        }),
    );
  });

  $effect(() => {
    edges = transitions
      .filter((t) => t.fromStatusId !== '*')
      .map(
        (t): Edge => ({
          id: t.id,
          source: t.fromStatusId,
          target: t.toStatusId,
          label: t.name,
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-3)' },
          style: 'stroke: var(--text-3);',
          labelStyle: 'fill: var(--text-3); font-size: 10px; font-weight: 600;',
        }),
      );
  });

  // ---- Draw a transition by dragging handle-to-handle ----
  async function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    const transition = await api.createWorkflowTransition(`${statusName(connection.source)} → ${statusName(connection.target)}`, connection.source, connection.target);
    workflow.update((w) => (w ? { ...w, transitions: [...w.transitions, transition] } : w));
  }

  // ---- Deletion ----
  // Every veto has to happen here, before Svelte Flow removes anything from the bound
  // nodes/edges arrays — `ondelete` fires after that removal already happened, too late to
  // cleanly reject. So this mirrors the server's two rules client-side: only inProgress
  // statuses are deletable at all, and nothing may be removed if doing so would leave some
  // To Do status with no path to Done.
  const onbeforedelete: OnBeforeDelete<Node, Edge> = async ({ nodes: toDelete, edges: edgesToDelete }) => {
    deleteError = '';

    const keptEdges = edgesToDelete.filter((edge) => {
      const remaining = transitions.filter((t) => t.id !== edge.id);
      const ok = hasPathFromEveryTodoToDone(statuses, categoryById, remaining);
      if (!ok) deleteError = $t('workflowDiagram.pathErrorTransition');
      return ok;
    });

    const keptNodes = toDelete.filter((node) => {
      if (!node.data.deletable) return false;
      const remainingStatuses = statuses.filter((s) => s.id !== node.id);
      const remainingTransitions = transitions.filter((t) => t.fromStatusId !== node.id && t.toStatusId !== node.id);
      const ok = hasPathFromEveryTodoToDone(remainingStatuses, categoryById, remainingTransitions);
      if (!ok) deleteError = $t('workflowDiagram.pathErrorStatus');
      return ok;
    });

    return { nodes: keptNodes, edges: keptEdges };
  };

  const ondelete: OnDelete<Node, Edge> = async ({ nodes: deletedNodes, edges: deletedEdges }) => {
    const removedEdgeIds = new Set<string>();
    for (const edge of deletedEdges) {
      try {
        await api.deleteWorkflowTransition(edge.id);
        removedEdgeIds.add(edge.id);
      } catch (err) {
        // A race with something else (e.g. another client) — the client-side check above
        // passed, but the server disagreed. Nothing to visually undo here; just surface it.
        deleteError = err instanceof Error ? err.message : $t('workflowDiagram.failedDeleteTransition');
      }
    }
    const removedStatusIds = new Set<string>();
    for (const node of deletedNodes) {
      try {
        await api.deleteWorkflowStatus(node.id);
        removedStatusIds.add(node.id);
      } catch (err) {
        deleteError = err instanceof Error ? err.message : $t('workflowDiagram.failedDeleteStatus');
      }
    }
    workflow.update((w) =>
      w
        ? {
            ...w,
            statuses: w.statuses.filter((s) => !removedStatusIds.has(s.id)),
            transitions: w.transitions.filter(
              (t) => !removedEdgeIds.has(t.id) && !removedStatusIds.has(t.fromStatusId) && !removedStatusIds.has(t.toStatusId),
            ),
          }
        : w,
    );
  };

  // ---- Add status ----
  let newStatusName = $state('');
  let newStatusCategoryId = $state('');
  $effect(() => {
    if (!newStatusCategoryId && categories.length) newStatusCategoryId = categories[0].id;
  });

  async function addStatus() {
    if (!newStatusName.trim() || !newStatusCategoryId) return;
    const status = await api.createWorkflowStatus(newStatusName.trim(), newStatusCategoryId);
    workflow.update((w) => (w ? { ...w, statuses: [...w.statuses, status] } : w));
    newStatusName = '';
  }

  // ---- Global ("from any status") transitions ----
  let newGlobalName = $state('');
  let newGlobalTargetId = $state('');
  $effect(() => {
    if (!newGlobalTargetId && statuses.length) newGlobalTargetId = statuses[0].id;
  });

  async function addGlobalTransition() {
    if (!newGlobalName.trim() || !newGlobalTargetId) return;
    const transition = await api.createWorkflowTransition(newGlobalName.trim(), '*', newGlobalTargetId);
    workflow.update((w) => (w ? { ...w, transitions: [...w.transitions, transition] } : w));
    newGlobalName = '';
  }

  async function removeGlobalTransition(id: string) {
    deleteError = '';
    try {
      await api.deleteWorkflowTransition(id);
      workflow.update((w) => (w ? { ...w, transitions: w.transitions.filter((t) => t.id !== id) } : w));
    } catch (err) {
      deleteError = err instanceof Error ? err.message : $t('workflowDiagram.failedDeleteTransition');
    }
  }
</script>

<div class="toolbar">
  <form class="inline-form" onsubmit={(e) => (e.preventDefault(), addStatus())}>
    <input class="inline-input" type="text" placeholder={$t('workflowDiagram.newStatusPlaceholder')} bind:value={newStatusName} />
    <select class="inline-select" bind:value={newStatusCategoryId}>
      {#each categories as cat (cat.id)}<option value={cat.id}>{cat.name}</option>{/each}
    </select>
    <button class="inline-btn" type="submit">{$t('workflowDiagram.addStatusButton')}</button>
  </form>
  <div class="hint">{$t('workflowDiagram.dragHint')}</div>
</div>
{#if deleteError}<p class="delete-error">{deleteError}</p>{/if}

<div class="flow-wrap">
  <SvelteFlow bind:nodes bind:edges {nodeTypes} onconnect={handleConnect} {onbeforedelete} {ondelete} fitView colorMode="dark" proOptions={{ hideAttribution: true }}>
    <Background />
    <Controls showLock={false} />
  </SvelteFlow>
</div>

{#if editingId}
  <div class="edit-panel">
    <div class="edit-title">{$t('workflowDiagram.editStatusTitle')}</div>
    <label class="field">
      <span>{$t('workflowDiagram.nameLabel')}</span>
      <input type="text" bind:value={editName} />
    </label>
    <label class="field">
      <span>{$t('workflowDiagram.colorLabel')}</span>
      <input type="text" placeholder="#3b82f6" bind:value={editColor} />
    </label>
    <div class="edit-actions">
      <button type="button" class="inline-btn ghost" onclick={cancelEdit}>{$t('common.cancel')}</button>
      <button type="button" class="inline-btn" disabled={!editName.trim() || savingEdit} onclick={saveEdit}>{savingEdit ? $t('workflowDiagram.savingButton') : $t('common.save')}</button>
    </div>
  </div>
{/if}

<div class="subsection-label">{$t('workflowDiagram.transitionsFromAnyLabel')}</div>
<div class="list">
  {#each globalTransitions as gt (gt.id)}
    <div class="row"><span class="row-name">{gt.name}</span><span class="row-tag">→ {statusName(gt.toStatusId)}</span><button class="icon-btn small" aria-label={$t('workflowDiagram.removeTransitionLabel', { status: statusName(gt.toStatusId) })} onclick={() => removeGlobalTransition(gt.id)}><Icon name="x" size={12} /></button></div>
  {/each}
</div>
<form class="add-form" onsubmit={(e) => (e.preventDefault(), addGlobalTransition())}>
  <input type="text" placeholder={$t('workflowDiagram.transitionNamePlaceholder')} bind:value={newGlobalName} />
  <select bind:value={newGlobalTargetId}>
    {#each statuses as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
  </select>
  <button type="submit">{$t('workflowDiagram.addGlobalTransitionButton')}</button>
</form>

<style>
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
  .hint { font-size: 11.5px; color: var(--text-3); }
  .delete-error { font-size: 11.5px; color: var(--critical); margin: -6px 0 10px; }
  .inline-form { display: flex; gap: 6px; }
  .inline-input, .inline-select {
    font: inherit; font-size: 12px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 7px;
  }
  .inline-btn { font-size: 12px; font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); border-radius: 6px; padding: 5px 10px; white-space: nowrap; }
  .inline-btn.ghost { color: var(--text-2); background: var(--surface-2); }
  .inline-btn:disabled { opacity: .5; }

  .flow-wrap {
    position: relative; height: 420px; border: 1px solid var(--border); border-radius: 10px;
    background: var(--surface-sunken); margin-bottom: 16px; overflow: hidden;
  }
  .flow-wrap :global(.svelte-flow__attribution) { display: none; }

  /* Re-point Svelte Flow's own CSS variables at this app's theme tokens instead of its
     built-in light/dark palette — otherwise edge labels, node chrome, and controls render
     with xyflow's defaults (a plain white label pill, generic grays) that clash with the
     surrounding surface colors. */
  .flow-wrap :global(.svelte-flow) {
    --xy-background-color: var(--surface-sunken);
    --xy-background-pattern-dots-color: var(--border);
    --xy-edge-stroke: var(--text-3);
    --xy-edge-stroke-selected: var(--accent-strong);
    --xy-edge-label-background-color: var(--surface-sunken);
    --xy-edge-label-color: var(--text-3);
    --xy-node-background-color: var(--surface);
    --xy-node-color: var(--text);
    --xy-node-border: 1.5px solid var(--border);
    --xy-node-boxshadow-selected: 0 0 0 2px var(--accent-soft);
    --xy-handle-background-color: var(--text-3);
    --xy-handle-border-color: var(--surface);
    --xy-controls-button-background-color: var(--surface-2);
    --xy-controls-button-background-color-hover: var(--surface-sunken);
    --xy-controls-button-color: var(--text-2);
    --xy-controls-button-color-hover: var(--text);
    --xy-controls-button-border-color: var(--border);
    --xy-controls-box-shadow: var(--shadow);
    --xy-minimap-background-color: var(--surface-sunken);
  }
  .flow-wrap :global(.svelte-flow__edge-textbg) { fill: var(--surface-sunken); }
  .flow-wrap :global(.svelte-flow__controls) { box-shadow: none; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .flow-wrap :global(.svelte-flow__controls-button) { border: none; border-bottom: 1px solid var(--border); }

  .edit-panel {
    position: fixed; right: 32px; bottom: 32px; width: 220px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow-lg); padding: 14px; display: flex; flex-direction: column; gap: 10px; z-index: 30;
  }
  .edit-title { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; }
  .field input { font: inherit; font-size: 12.5px; text-transform: none; font-weight: 400; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
  .edit-actions { display: flex; justify-content: flex-end; gap: 6px; }

  .subsection-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); margin: 18px 0 8px; }
  .list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); font-size: 12.5px; }
  .row-name { font-weight: 600; color: var(--text); flex: 1; }
  .row-tag { color: var(--text-3); font-size: 11.5px; }
  .icon-btn.small { width: 20px; height: 20px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; border-radius: 5px; color: var(--text-3); }
  .icon-btn.small:hover { background: var(--surface-sunken); color: var(--critical); }
  .add-form { display: flex; gap: 6px; }
  .add-form input, .add-form select {
    font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 8px; flex: 1; min-width: 0;
  }
  .add-form button { font-size: 12px; font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); border-radius: 6px; padding: 6px 12px; flex: 0 0 auto; }
</style>
