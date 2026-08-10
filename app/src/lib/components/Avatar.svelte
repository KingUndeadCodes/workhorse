<script lang="ts">
  // Renders a person's uploaded picture if they have one, else their initials on a color
  // keyed to their user id (see avatarColor in util.ts).
  import { avatarColor, initials } from '../util';
  export let userId: string;
  export let name: string;
  export let avatarUrl: string | undefined = undefined;
  export let size = 20;
</script>

{#if avatarUrl}
  <img class="avatar" src={avatarUrl} alt={name} title={name} style="width:{size}px;height:{size}px" />
{:else}
  <div
    class="avatar"
    style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.42)}px;background:{avatarColor(userId)}"
    title={name}
  >
    {initials(name)}
  </div>
{/if}

<style>
  .avatar {
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    color: #fff;
    flex: 0 0 auto;
    object-fit: cover;
  }
</style>
