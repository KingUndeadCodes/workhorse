<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { currentUser, setCurrentUser } from '../stores/auth';
  import { workspaceMembers } from '../stores/workspace';
  import { changePassword, updateProfile } from '../api';
  import { locale, t } from '../i18n';

  /** The Profile tab of Settings.svelte (Personal group): your picture, name, email and password. */

  const MAX_NAME_LENGTH = 80;
  const MIN_PASSWORD_LENGTH = 8; // matches signup (server/src/routes/auth.ts)
  // Deliberately loose — the server is the real check; this only catches obvious typos before a round trip.
  const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ---- profile form ----
  let displayName = $currentUser?.displayName ?? '';
  let email = $currentUser?.email ?? '';
  let avatarUrl: string | null | undefined = $currentUser?.avatarUrl;
  let emailPassword = '';
  let nameTouched = false;
  let emailTouched = false;
  let fileInput: HTMLInputElement;
  let submitting = false;
  let error = '';
  let saved = false;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  $: nameError = !displayName.trim() ? $t('accountSettings.nameRequired') : displayName.trim().length > MAX_NAME_LENGTH ? $t('accountSettings.nameTooLong', { max: MAX_NAME_LENGTH }) : '';
  $: emailError = EMAIL_SHAPE.test(email.trim()) ? '' : $t('accountSettings.emailInvalid');
  // The server lowercases emails, so a case-only edit isn't a change.
  $: emailChanged = email.trim().toLowerCase() !== ($currentUser?.email ?? '');
  // Save stays disabled until something actually changed (a removed picture is `null`, an unset one `undefined`).
  $: dirty = displayName.trim() !== ($currentUser?.displayName ?? '') || emailChanged || (avatarUrl ?? null) !== ($currentUser?.avatarUrl ?? null);
  $: canSave = dirty && !nameError && !emailError && (!emailChanged || emailPassword !== '') && !submitting;
  // A fresh edit makes the last "Saved" stale.
  $: if (dirty && saved) saved = false;

  onDestroy(() => clearTimeout(savedTimer));

  const MAX_DIMENSION = 256;

  /** Resizes/crops the picked image to a square, downscaled to {@link MAX_DIMENSION} — keeps
   * the encoded data: URL small enough for a text column, regardless of the source photo's size. */
  function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so choosing the same file again after removing it still fires `change`
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      error = $t('accountSettings.invalidImage');
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
    // A file with an image type that still can't be decoded (corrupt, or a format this browser lacks).
    img.onerror = () => {
      error = $t('accountSettings.unreadableImage');
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function removePicture() {
    avatarUrl = null;
  }

  /** Puts every field back to what's saved. */
  function discard() {
    displayName = $currentUser?.displayName ?? '';
    email = $currentUser?.email ?? '';
    avatarUrl = $currentUser?.avatarUrl;
    emailPassword = '';
    nameTouched = false;
    emailTouched = false;
    error = '';
    saved = false;
  }

  async function submit() {
    if (!canSave) return;
    submitting = true;
    error = '';
    saved = false;
    try {
      const { user } = await updateProfile({
        displayName: displayName.trim(),
        email: email.trim(),
        avatarUrl,
        // Only an email change needs it; sending it otherwise would just be a secret travelling for nothing.
        currentPassword: emailChanged ? emailPassword : undefined,
      });
      setCurrentUser(user);
      emailPassword = '';
      saved = true;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved = false), 2500);
    } catch (err) {
      error = err instanceof Error ? err.message : $t('accountSettings.failedUpdate');
    } finally {
      submitting = false;
    }
  }

  // ---- password form ----
  // Collapsed until asked for — changing a password is rare, and three empty fields otherwise dominate the page.
  let passwordOpen = false;
  let currentPasswordEl: HTMLInputElement | undefined;
  async function togglePassword() {
    passwordOpen = !passwordOpen;
    if (passwordOpen) {
      await tick();
      currentPasswordEl?.focus();
    }
  }
  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';
  let newTouched = false;
  let confirmTouched = false;
  let pwSubmitting = false;
  let pwError = '';
  let pwChanged = false;
  let pwTimer: ReturnType<typeof setTimeout> | undefined;

  $: newPasswordError = newPassword.length < MIN_PASSWORD_LENGTH ? $t('accountSettings.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) : '';
  $: confirmError = confirmPassword !== newPassword ? $t('accountSettings.passwordMismatch') : '';
  $: canChangePassword = currentPassword !== '' && !newPasswordError && !confirmError && !pwSubmitting;

  onDestroy(() => clearTimeout(pwTimer));

  async function submitPassword() {
    if (!canChangePassword) return;
    pwSubmitting = true;
    pwError = '';
    pwChanged = false;
    try {
      await changePassword(currentPassword, newPassword);
      currentPassword = newPassword = confirmPassword = '';
      newTouched = confirmTouched = false;
      pwChanged = true;
      clearTimeout(pwTimer);
      pwTimer = setTimeout(() => (pwChanged = false), 4000);
    } catch (err) {
      pwError = err instanceof Error ? err.message : $t('accountSettings.failedPassword');
    } finally {
      pwSubmitting = false;
    }
  }

  // ---- account details ----
  $: role = $workspaceMembers.find((m) => m.userId === $currentUser?.id)?.role;
  $: memberSince = $currentUser?.createdAt ? new Date($currentUser.createdAt).toLocaleDateString($locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
</script>

<div class="profile">
  <form class="card" on:submit|preventDefault={submit}>
    <div class="avatar-row">
      <Avatar userId={$currentUser?.id ?? ''} name={displayName || $t('accountSettings.youFallback')} avatarUrl={avatarUrl ?? undefined} size={72} />
      <div class="avatar-side">
        <div class="avatar-actions">
          <button type="button" class="btn ghost small" on:click={() => fileInput.click()}>{$t('accountSettings.uploadPicture')}</button>
          {#if avatarUrl}<button type="button" class="btn ghost small" on:click={removePicture}>{$t('accountSettings.removePicture')}</button>{/if}
        </div>
        <input bind:this={fileInput} type="file" accept="image/*" on:change={handleFile} hidden />
        <span class="hint">{$t('accountSettings.pictureHint')}</span>
      </div>
    </div>

    <div class="fields">
      <label class="field">
        <span class="label">{$t('accountSettings.nameLabel')}</span>
        <input
          type="text"
          name="name"
          autocomplete="name"
          bind:value={displayName}
          on:blur={() => (nameTouched = true)}
          placeholder={$t('accountSettings.namePlaceholder')}
          aria-invalid={nameTouched && nameError ? 'true' : undefined}
          aria-describedby={nameTouched && nameError ? 'profile-name-error' : undefined}
        />
        {#if nameTouched && nameError}<span class="field-error" id="profile-name-error">{nameError}</span>{/if}
      </label>

      <label class="field">
        <span class="label">{$t('accountSettings.emailLabel')}</span>
        <input
          type="email"
          name="email"
          autocomplete="email"
          bind:value={email}
          on:blur={() => (emailTouched = true)}
          placeholder={$t('accountSettings.emailPlaceholder')}
          aria-invalid={emailTouched && emailError ? 'true' : undefined}
          aria-describedby={emailTouched && emailError ? 'profile-email-error' : undefined}
        />
        {#if emailTouched && emailError}<span class="field-error" id="profile-email-error">{emailError}</span>{/if}
      </label>

      {#if emailChanged && !emailError}
        <label class="field wide">
          <span class="label">{$t('accountSettings.currentPasswordLabel')}</span>
          <input type="password" name="email-confirm-password" autocomplete="current-password" bind:value={emailPassword} aria-describedby="profile-email-password-hint" />
          <span class="hint" id="profile-email-password-hint">{$t('accountSettings.emailPasswordHint')}</span>
        </label>
      {/if}
    </div>

    <div class="card-footer">
      <div class="footer-start">
        <div class="status" aria-live="polite">
          {#if error}<span class="error">{error}</span>{:else if saved}<span class="saved">{$t('accountSettings.saved')}</span>{/if}
        </div>
        {#if dirty}<button type="button" class="link-btn" on:click={discard} disabled={submitting}>{$t('accountSettings.discardButton')}</button>{/if}
      </div>
      <button type="submit" class="btn primary" disabled={!canSave}>{submitting ? $t('accountSettings.savingButton') : $t('accountSettings.saveButton')}</button>
    </div>
  </form>

  <form class="card" on:submit|preventDefault={submitPassword}>
    <h3 class="card-title">
      <button type="button" class="card-toggle" aria-expanded={passwordOpen} aria-controls="profile-password-fields" on:click={togglePassword}>
        <span>{$t('accountSettings.passwordHeading')}</span>
        <span class="toggle-side">
          {#if !passwordOpen}<span>{$t('accountSettings.changePasswordButton')}</span>{/if}
          <span class="chevron" class:open={passwordOpen}><Icon name="chevron" size={14} /></span>
        </span>
      </button>
    </h3>
    {#if passwordOpen}
      <div class="fields" id="profile-password-fields">
        <label class="field wide">
          <span class="label">{$t('accountSettings.currentPasswordLabel')}</span>
          <input type="password" name="current-password" autocomplete="current-password" bind:this={currentPasswordEl} bind:value={currentPassword} />
        </label>
        <label class="field">
          <span class="label">{$t('accountSettings.newPasswordLabel')}</span>
          <input
            type="password"
            name="new-password"
            autocomplete="new-password"
            bind:value={newPassword}
            on:blur={() => (newTouched = true)}
            aria-invalid={newTouched && newPasswordError ? 'true' : undefined}
            aria-describedby="profile-new-password-help"
          />
          {#if newTouched && newPasswordError}<span class="field-error" id="profile-new-password-help">{newPasswordError}</span>{:else}<span class="hint" id="profile-new-password-help">{$t('accountSettings.passwordTooShort', { min: MIN_PASSWORD_LENGTH })}</span>{/if}
        </label>
        <label class="field">
          <span class="label">{$t('accountSettings.confirmPasswordLabel')}</span>
          <input
            type="password"
            name="confirm-password"
            autocomplete="new-password"
            bind:value={confirmPassword}
            on:blur={() => (confirmTouched = true)}
            aria-invalid={confirmTouched && confirmError ? 'true' : undefined}
            aria-describedby={confirmTouched && confirmError ? 'profile-confirm-password-error' : undefined}
          />
          {#if confirmTouched && confirmError}<span class="field-error" id="profile-confirm-password-error">{confirmError}</span>{/if}
        </label>
      </div>
      <div class="card-footer">
        <div class="footer-start">
          <div class="status" aria-live="polite">
            {#if pwError}<span class="error">{pwError}</span>{:else if pwChanged}<span class="saved">{$t('accountSettings.passwordChanged')}</span>{/if}
          </div>
        </div>
        <button type="submit" class="btn primary" disabled={!canChangePassword}>{pwSubmitting ? $t('accountSettings.changingPasswordButton') : $t('accountSettings.changePasswordButton')}</button>
      </div>
    {/if}
  </form>

  <section class="card">
    <h3 class="card-title">{$t('accountSettings.detailsHeading')}</h3>
    <dl class="details">
      {#if role}
        <div><dt>{$t('accountSettings.roleLabel')}</dt><dd class="role">{$t(`workspaceView.roles.${role}`)}</dd></div>
      {/if}
      {#if memberSince}
        <div><dt>{$t('accountSettings.memberSinceLabel')}</dt><dd>{memberSince}</dd></div>
      {/if}
    </dl>
  </section>
</div>

<style>
  /* Cards, like the Appearance tab's panels, so this screen reads as part of the same Settings. */
  .profile { display: flex; flex-direction: column; gap: 16px; max-width: 640px; }
  .card {
    --pad-x: 22px; --pad-y: 20px;
    display: flex; flex-direction: column; gap: 18px; padding: var(--pad-y) var(--pad-x);
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px;
  }
  .card-title { font-size: 14px; font-weight: 700; color: var(--text); margin: 0; }
  /* The whole header row is the button: padded out to a 44px target and pulled back with a negative margin so it looks unchanged. */
  .card-toggle {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; box-sizing: border-box;
    width: calc(100% + 2 * var(--pad-x)); min-height: 44px; margin: -12px calc(-1 * var(--pad-x)); padding: 0 var(--pad-x);
    font: inherit; color: inherit; text-align: left; background: none; border-radius: 12px;
  }
  .card-toggle:focus-visible { outline-offset: -3px; border-radius: 12px; }
  .toggle-side { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 400; color: var(--text-3); }
  .chevron { display: flex; color: var(--text-2); transition: transform .15s ease; }
  .chevron.open { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }

  .avatar-row { display: flex; align-items: center; gap: 18px; }
  .avatar-side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .avatar-actions { display: flex; flex-wrap: wrap; gap: 8px; }

  /* Two across when there's room, one when there isn't — no breakpoint needed. */
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .field.wide { grid-column: 1 / -1; }
  .label { font-size: 12.5px; font-weight: 500; color: var(--text-2); }
  .field input {
    font: inherit; font-size: 13.5px; color: var(--text); width: 100%; box-sizing: border-box;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px;
    transition: border-color .12s ease, box-shadow .12s ease;
  }
  .field input::placeholder { color: var(--text-3); }
  .field input:hover { border-color: var(--border-strong); }
  .field input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .field input[aria-invalid='true'] { border-color: var(--critical); }
  .hint { font-size: 12px; color: var(--text-3); line-height: 1.4; }
  .field-error { font-size: 12px; font-weight: 500; color: var(--critical); line-height: 1.4; }

  /* Message and Discard on the left, the primary action on the right — one row, so there's no
     reserved empty band above the button the way a separate status line left. */
  .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border); }
  .footer-start { display: flex; align-items: center; gap: 14px; min-width: 0; font-size: 12.5px; }
  .status { min-width: 0; }
  .error { color: var(--critical); }
  .saved { color: var(--success); font-weight: 500; }
  .link-btn { font-size: 12.5px; font-weight: 500; color: var(--text-2); text-decoration: underline; text-underline-offset: 3px; padding: 4px 2px; }
  .link-btn:hover { color: var(--text); }
  .link-btn:disabled { opacity: .5; cursor: default; }

  .btn { font-size: 12.5px; font-weight: 600; padding: 8px 16px; border-radius: 8px; white-space: nowrap; }
  .btn.small { font-size: 12px; padding: 6px 12px; }
  .btn.ghost { color: var(--text); background: var(--surface); border: 1px solid var(--border); }
  .btn.ghost:hover { border-color: var(--border-strong); }
  .btn.primary { color: var(--accent-on); background: var(--accent); }
  .btn.primary:hover:not(:disabled) { background: var(--accent-strong); }
  .btn:disabled { opacity: .45; cursor: default; }

  .details { margin: -4px 0 0; display: flex; flex-direction: column; }
  .details > div { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; padding: 10px 0; }
  .details > div + div { border-top: 1px solid var(--border); }
  .details dt { color: var(--text-2); }
  .details dd { margin: 0; color: var(--text); text-align: right; }
  .details dd.role { text-transform: capitalize; }

  @media (max-width: 768px) {
    .card { --pad-x: 16px; --pad-y: 16px; gap: 16px; }
    .field input { padding: 11px 12px; font-size: 14px; }
    .btn { padding: 12px 16px; font-size: 13.5px; }
    .btn.small { padding: 9px 14px; font-size: 12.5px; }
    .card-footer { flex-direction: column; align-items: stretch; }
    .card-footer .btn.primary { width: 100%; }
    .footer-start { justify-content: space-between; }
  }
</style>
