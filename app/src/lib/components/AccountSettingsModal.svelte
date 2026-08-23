<script lang="ts">
  import Avatar from './Avatar.svelte';
  import { currentUser, setCurrentUser } from '../stores/auth';
  import { updateProfile } from '../api';
  import { t } from '../i18n';

  export let onClose: () => void;

  let displayName = $currentUser?.displayName ?? '';
  let email = $currentUser?.email ?? '';
  let avatarUrl = $currentUser?.avatarUrl;
  let fileInput: HTMLInputElement;
  let submitting = false;
  let error = '';

  const MAX_DIMENSION = 256;

  /** Resizes/crops the picked image to a square, downscaled to {@link MAX_DIMENSION} — keeps
   * the encoded data: URL small enough for a text column, regardless of the source photo's size. */
  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      error = $t('accountSettingsModal.invalidImage');
      return;
    }
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const size = Math.min(MAX_DIMENSION, side);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      avatarUrl = canvas.toDataURL('image/jpeg', 0.85);
      error = '';
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function removePicture() {
    avatarUrl = null as unknown as string | undefined;
  }

  async function submit() {
    if (!displayName.trim() || !email.trim() || submitting) return;
    submitting = true;
    error = '';
    try {
      const { user } = await updateProfile({ displayName: displayName.trim(), email: email.trim(), avatarUrl });
      setCurrentUser(user);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : $t('accountSettingsModal.failedUpdate');
    } finally {
      submitting = false;
    }
  }
</script>

<div
  class="backdrop"
  role="button"
  tabindex="0"
  on:click={onClose}
  on:keydown={(e) => e.key === 'Escape' && onClose()}
>
  <div class="modal" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-label={$t('accountSettingsModal.title')} tabindex="-1">
    <h2 class="modal-title">{$t('accountSettingsModal.title')}</h2>
    <form on:submit|preventDefault={submit}>
      <div class="avatar-row">
        <Avatar userId={$currentUser?.id ?? ''} name={displayName || $t('accountSettingsModal.youFallback')} avatarUrl={avatarUrl ?? undefined} size={64} />
        <div class="avatar-actions">
          <button type="button" class="btn ghost small" on:click={() => fileInput.click()}>{$t('accountSettingsModal.uploadPicture')}</button>
          {#if avatarUrl}<button type="button" class="btn ghost small" on:click={removePicture}>{$t('accountSettingsModal.removePicture')}</button>{/if}
          <input bind:this={fileInput} type="file" accept="image/*" on:change={handleFile} hidden />
        </div>
      </div>
      <label class="field">
        <span>{$t('accountSettingsModal.nameLabel')}</span>
        <input type="text" bind:value={displayName} placeholder={$t('accountSettingsModal.namePlaceholder')} />
      </label>
      <label class="field">
        <span>{$t('accountSettingsModal.emailLabel')}</span>
        <input type="email" bind:value={email} placeholder={$t('accountSettingsModal.emailPlaceholder')} />
      </label>
      {#if error}<p class="error" aria-live="polite">{error}</p>{/if}
      <div class="actions">
        <button type="button" class="btn ghost" on:click={onClose}>{$t('common.cancel')}</button>
        <button type="submit" class="btn primary" disabled={!displayName.trim() || !email.trim() || submitting}>{submitting ? $t('accountSettingsModal.savingButton') : $t('accountSettingsModal.saveButton')}</button>
      </div>
    </form>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(10, 12, 18, 0.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .modal { width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; background: var(--surface); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 20px; }
  .modal-title { font-size: 15px; font-weight: 700; color: var(--text); margin: 0 0 14px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  .avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
  .avatar-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: .04em; }
  .field input {
    font: inherit; font-size: 13px; text-transform: none; font-weight: 400; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px;
  }
  .error { color: var(--critical); font-size: 12px; margin: 0; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .btn { font-size: 12.5px; font-weight: 600; padding: 8px 14px; border-radius: 7px; }
  .btn.small { font-size: 11.5px; padding: 5px 10px; }
  .btn.ghost { color: var(--text-2); background: var(--surface-2); }
  .btn.primary { color: var(--accent-on); background: var(--accent); }
  .btn.primary:disabled { opacity: .5; }

  @media (max-width: 640px) {
    .backdrop { align-items: flex-end; }
    .modal { width: 100%; max-height: calc(100vh - 60px); border-radius: 16px 16px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); }
    .modal-title { font-size: 16px; }
    .field input { padding: 10px 12px; }
    .btn { padding: 11px 16px; font-size: 13.5px; }
    .btn.small { padding: 8px 12px; font-size: 12.5px; }
  }
</style>
