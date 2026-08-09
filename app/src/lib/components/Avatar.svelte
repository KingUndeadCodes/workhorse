<script lang="ts">
  // Renders a person's initials on a color keyed to their user id (see avatarColor in util.ts).
  import { avatarColor, initials } from '../util';
  export let userId: string;
  export let name: string;
  export let size = 20;
</script>

<div
  class="avatar"
  style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.42)}px;background:{avatarColor(userId)}"
  title={name}
>
  {initials(name)}
</div>

<style>
  .avatar {
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    color: #fff;
    flex: 0 0 auto;
  }
</style>
