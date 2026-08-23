<script lang="ts">
  /** Symbol name from public/icons.svg, without the `i-` prefix (e.g. "chevron" for #i-chevron). */
  export let name: string;
  export let size = 16;
</script>

<svg style="width:{size}px;height:{size}px;flex:0 0 {size}px" aria-hidden="true">
  <use href={`/icons.svg#i-${name}`} />
</svg>
