<script lang="ts">
  // Renders a person's uploaded picture if they have one, else their initials on a color
  // keyed to their user id (see avatarColor in util.ts). AI agents never get initials — they
  // show the Ollama llama mark instead (public/agents/ollama-{light,dark}.svg), since the
  // shipped AgentRuntime is Ollama-backed (see server/src/services/AgentRuntime.ts). Which
  // file renders is the inverse of the app theme — the *dark* mark needs a light background
  // to read, and vice versa — so it follows the theme store, not the agent's own identity.
  import { avatarColor, initials } from '../util';
  import { resolvedTheme } from '../stores/theme';
  export let userId: string;
  export let name: string;
  export let avatarUrl: string | undefined = undefined;
  export let size = 20;
  export let kind: string = 'human';

  $: agentMarkSrc = $resolvedTheme === 'dark' ? '/agents/ollama-light.svg' : '/agents/ollama-dark.svg';

  // Resets whenever the avatar being shown changes, so a previously-failed image (e.g. a
  // since-fixed hotlink, or a slow load that errored out) gets a real retry instead of this
  // component being stuck showing initials for a URL it never actually tries again.
  let loadFailed = false;
  $: avatarUrl, (loadFailed = false);
</script>

{#if kind === 'agent'}
  <div class="avatar agent-avatar" style="width:{size}px;height:{size}px" title={name}>
    <img class="agent-mark" src={agentMarkSrc} alt="" style="width:{Math.round(size * 0.62)}px;height:{Math.round(size * 0.62)}px" />
  </div>
{:else if avatarUrl && !loadFailed}
  <!-- Falls back to initials on a failed load (dead link, slow/dropped request, etc.) instead
       of leaving a permanently broken image — this is the one place an avatar can silently
       fail to render, so it should never be a dead end. -->
  <img class="avatar" src={avatarUrl} alt={name} title={name} style="width:{size}px;height:{size}px" on:error={() => (loadFailed = true)} />
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
  .agent-avatar {
    background: var(--agent-accent-soft);
    color: var(--agent-accent);
  }
  .agent-mark {
    object-fit: contain;
  }
</style>
