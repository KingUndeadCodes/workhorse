<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { currentUser } from '../stores/auth';
  import {
    createWorkspaceInvite,
    fetchWorkspaceInvites,
    removeWorkspaceMember,
    revokeWorkspaceInvite,
    updateWorkspaceMemberRole,
    users,
    workspace,
    workspaceInvites,
    workspaceMembers,
  } from '../stores/workspace';
  import { displayName } from '../util';
  import { t, tn } from '../i18n';
  import type { WorkspaceRole } from '$domain';

  const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];
  $: roleLabel = (role: WorkspaceRole) => $t(`workspaceView.roles.${role}`);

  $: myRole = $workspaceMembers.find((m) => m.userId === $currentUser?.id)?.role;
  $: isAdmin = myRole === 'owner' || myRole === 'admin';
  $: rows = $workspaceMembers
    .map((m) => ({ member: m, user: $users.find((u) => u.id === m.userId) }))
    .filter((r) => r.user)
    .sort((a, b) => a.member.joinedAt.localeCompare(b.member.joinedAt));

  // Invites are owner/admin-only data, not part of bootstrap — fetch once, the first time this
  // view renders for an admin (isAdmin flips true as soon as $workspaceMembers loads).
  let invitesLoaded = false;
  $: if (isAdmin && !invitesLoaded) {
    invitesLoaded = true;
    fetchWorkspaceInvites();
  }

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

  async function handleRemove(userId: string, name: string) {
    if (!confirm($t('workspaceView.removeConfirm', { name }))) return;
    pendingUserId = userId;
    try {
      await removeWorkspaceMember(userId);
    } finally {
      pendingUserId = null;
    }
  }

  let inviteEmail = '';
  let inviteRole: WorkspaceRole = 'member';
  let invitingError = '';
  let inviting = false;

  async function submitInvite() {
    if (!inviteEmail.trim()) return;
    inviting = true;
    invitingError = '';
    try {
      await createWorkspaceInvite(inviteEmail.trim(), inviteRole);
      inviteEmail = '';
      inviteRole = 'member';
    } catch (err) {
      invitingError = err instanceof Error ? err.message : $t('workspaceView.failedInvite');
    } finally {
      inviting = false;
    }
  }
</script>

<div class="workspace-view">
  <div class="header">
    <h1>{$workspace?.name ?? ''}</h1>
    <p class="sub">{$tn('common.members', rows.length)}{isAdmin ? ` · ${$t('workspaceView.canManageRoles')}` : ''}</p>
  </div>

  <div class="member-list">
    {#each rows as { member, user } (member.userId)}
      {#if user}
        <div class="member-row">
          <Avatar userId={user.id} name={displayName(user)} avatarUrl={user.avatarUrl} kind={user.kind} size={32} />
          <div class="member-info">
            <div class="member-name">{displayName(user)}{#if user.id === $currentUser?.id}<span class="you">{$t('workspaceView.youBadge')}</span>{/if}</div>
            <div class="member-email">{user.email}</div>
          </div>
          {#if isAdmin && user.id !== $currentUser?.id}
            <select
              class="role-select"
              value={member.role}
              disabled={pendingUserId === user.id}
              on:change={(e) => handleRoleChange(user.id, e)}
            >
              {#each ROLES as r}<option value={r}>{roleLabel(r)}</option>{/each}
            </select>
            <button
              type="button"
              class="icon-btn"
              aria-label={$t('common.removeNamed', { name: displayName(user) })}
              disabled={pendingUserId === user.id}
              on:click={() => handleRemove(user.id, displayName(user))}
            ><Icon name="trash" size={13} /></button>
          {:else}
            <span class="role-badge">{roleLabel(member.role)}</span>
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  {#if isAdmin}
    <div class="invites-section">
      <h2 class="section-label">{$t('workspaceView.invitesLabel')}</h2>
      <p class="section-hint">{$t('workspaceView.invitesHint')}</p>

      {#if $workspaceInvites.length > 0}
        <div class="member-list">
          {#each $workspaceInvites as invite (invite.id)}
            <div class="member-row invite-row">
              <div class="member-info">
                <div class="member-name">{invite.email}</div>
              </div>
              <span class="role-badge">{roleLabel(invite.role)}</span>
              <button
                type="button"
                class="icon-btn"
                aria-label={$t('workspaceView.revokeLabel', { email: invite.email })}
                on:click={() => revokeWorkspaceInvite(invite.id)}
              ><Icon name="trash" size={13} /></button>
            </div>
          {/each}
        </div>
      {/if}

      <form class="invite-form" on:submit|preventDefault={submitInvite}>
        <input type="email" placeholder={$t('workspaceView.inviteEmailPlaceholder')} bind:value={inviteEmail} autocomplete="off" />
        <select bind:value={inviteRole}>
          {#each ROLES as r}<option value={r}>{roleLabel(r)}</option>{/each}
        </select>
        <button type="submit" disabled={inviting || !inviteEmail.trim()}>{inviting ? $t('workspaceView.invitingButton') : $t('workspaceView.inviteButton')}</button>
      </form>
      {#if invitingError}<p class="error">{invitingError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .workspace-view { flex: 1; overflow-y: auto; padding: 28px 32px; max-width: 640px; }

  @media (max-width: 767px) {
    .workspace-view { padding: 16px; }
    .member-row { padding: 12px; gap: 11px; }
    .member-name { font-size: 14px; }
    .member-email { font-size: 12.5px; }
    .role-select, .role-badge { padding: 8px 10px; font-size: 12.5px; }
    .invite-form { flex-wrap: wrap; }
  }
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
  .icon-btn {
    flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    color: var(--text-3); border-radius: 7px;
  }
  .icon-btn:hover:not(:disabled) { color: var(--critical); background: var(--surface-2); }
  .icon-btn:disabled { opacity: .5; cursor: default; }

  .invites-section { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--border); }
  .section-label { font-size: 13px; font-weight: 700; color: var(--text); margin: 0 0 4px; }
  .section-hint { font-size: 12px; color: var(--text-3); margin: 0 0 14px; }
  .invite-row .member-name { font-weight: 500; }
  .invite-form { display: flex; gap: 8px; margin-top: 12px; }
  .invite-form input {
    flex: 1; min-width: 0; font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface);
    border: 1px solid var(--border); border-radius: 7px; padding: 7px 9px;
  }
  .invite-form select {
    font: inherit; font-size: 12px; font-weight: 600; text-transform: capitalize; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 7px; padding: 7px 8px; flex: 0 0 auto;
  }
  .invite-form button {
    font-size: 12px; font-weight: 600; color: var(--accent-on); background: var(--accent);
    padding: 7px 14px; border-radius: 7px; white-space: nowrap;
  }
  .invite-form button:disabled { opacity: .5; cursor: default; }
  .error { font-size: 12px; color: var(--critical); margin: 8px 0 0; }
</style>
