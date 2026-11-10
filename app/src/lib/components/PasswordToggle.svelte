<script lang="ts">
  import Icon from './Icon.svelte';

  /**
   * The "show password" eye that sits inside a password field. The field's own wrapper must be `position: relative`
   * with room on the right (the button is absolutely placed there); the input flips between `type="password"` and
   * `type="text"` on `visible`. Labels are props because the signed-out pages use plain English literals while the
   * signed-in app goes through i18n.
   */
  export let visible = false;
  export let showLabel: string;
  export let hideLabel: string;
</script>

<button type="button" class="pw-toggle" aria-pressed={visible} aria-label={visible ? hideLabel : showLabel} title={visible ? hideLabel : showLabel} on:click={() => (visible = !visible)}>
  <Icon name={visible ? 'eyeoff' : 'eye'} size={17} />
</button>

<style>
  .pw-toggle {
    position: absolute; top: 0; right: 0; bottom: 0; width: 44px; display: flex; align-items: center; justify-content: center;
    color: inherit; opacity: .8; border-radius: 0 9px 9px 0; cursor: pointer;
  }
  .pw-toggle:hover, .pw-toggle:focus-visible { opacity: 1; }
  .pw-toggle:focus-visible { outline: 2px solid currentColor; outline-offset: -4px; }
</style>
