<script lang="ts">
  import Avatar from './Avatar.svelte';
  import { currentUser } from '../stores/auth';
  import { updateWorkspaceMemberRole, users, workspace, workspaceMembers } from '../stores/workspace';
  import type { WorkspaceRole } from '$domain';

  const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

  $: myRole = $workspaceMembers.find((m) => m.userId === $currentUser?.id)?.role;
  $: isAdmin = myRole === 'owner' || myRole === 'admin';
  $: rows = $workspaceMembers
    .map((m) => ({ member: m, user: $users.find((u) => u.id === m.userId) }))
    .filter((r) => r.user)
    .sort((a, b) => a.member.joinedAt.localeCompare(b.member.joinedAt));

  let pendingUserId: string | null = null;

  async function handleRoleChange(userId: string, e: Event) {
    const role = (e.target as HTMLSelectElement).value as WorkspaceRole;
    pendingUserId = userId;
    try {
      await updateWorkspaceMemberRole(userId, role);
    } finally {
      pendingUserId = null;
    }
  }
</script>

<div class="workspace-view">
  <div class="header">
    <h1>{$workspace?.name ?? 'Workspace'}</h1>
    <p class="sub">{rows.length} {rows.length === 1 ? 'member' : 'members'}{isAdmin ? ' · you can manage roles' : ''}</p>
  </div>

  <div class="member-list">
    {#each rows as { member, user } (member.userId)}
      {#if user}
        <div class="member-row">
          <Avatar userId={user.id} name={user.displayName} avatarUrl={user.avatarUrl} size={32} />
          <div class="member-info">
            <div class="member-name">{user.displayName}{#if user.id === $currentUser?.id}<span class="you">you</span>{/if}</div>
            <div class="member-email">{user.email}</div>
          </div>
          {#if isAdmin && user.id !== $currentUser?.id}
            <select
              class="role-select"
              value={member.role}
              disabled={pendingUserId === user.id}
              on:change={(e) => handleRoleChange(user.id, e)}
            >
              {#each ROLES as r}<option value={r}>{r}</option>{/each}
            </select>
          {:else}
            <span class="role-badge">{member.role}</span>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .workspace-view { flex: 1; overflow-y: auto; padding: 28px 32px; max-width: 640px; }
  .header { margin-bottom: 22px; }
  h1 { font-size: 19px; font-weight: 700; color: var(--text); margin: 0 0 4px; }
  .sub { font-size: 12.5px; color: var(--text-2); margin: 0; }
  .member-list { display: flex; flex-direction: column; gap: 2px; }
  .member-row {
    display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 9px;
    border: 1px solid var(--border); background: var(--surface);
  }
  .member-row + .member-row { margin-top: 6px; }
  .member-info { flex: 1; min-width: 0; }
  .member-name { font-size: 13px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 7px; }
  .you { font-size: 10px; font-weight: 600; color: var(--text-3); background: var(--surface-2); padding: 1px 6px; border-radius: 99px; text-transform: uppercase; letter-spacing: .03em; }
  .member-email { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role-select {
    font: inherit; font-size: 12px; font-weight: 600; text-transform: capitalize; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 7px; padding: 6px 8px; flex: 0 0 auto;
  }
  .role-badge {
    font-size: 11.5px; font-weight: 600; text-transform: capitalize; color: var(--text-2);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 99px; padding: 4px 11px; flex: 0 0 auto;
  }
</style>
