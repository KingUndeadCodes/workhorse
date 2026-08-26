<script lang="ts">
  import PolicyPage from './PolicyPage.svelte';

  export let onBack: () => void;

  const sections = [
    {
      heading: 'Our Commitment',
      body: "Workhorse is being actively audited against a Web Interface Guidelines checklist covering accessibility, keyboard focus, forms, and more, broadly aligned with WCAG 2.1. As of August 2026, the majority of that checklist passes: icon-only controls have accessible names, focus states are visible throughout the app, decorative icons are hidden from assistive technology, and async errors are announced to screen readers. This is ongoing work, not a finished certification — we don't claim full WCAG conformance.",
    },
    {
      heading: 'Known Limitations',
      body: "A few real gaps remain open. Moving a ticket between board columns, and connecting workflow transitions, has no keyboard alternative to drag-and-drop at desktop widths. Some destructive actions — deleting labels, fields, automation rules, webhooks, components, and versions — execute immediately with no confirmation step. A handful of multi-field forms don't warn before you navigate away with unsaved changes, and one error path (attaching an AI agent to a ticket) still uses a blocking browser alert instead of inline, screen-reader-friendly error text. We're working through these in rough priority order.",
    },
    {
      heading: 'Feedback',
      body: "Workhorse is self-hosted software with no central support line. If you run into an accessibility barrier, please contact whoever administers your workspace's deployment — they're best placed to route it to the right person or file it upstream.",
    },
  ];
</script>

<PolicyPage title="Accessibility Statement" {sections} {onBack} showPlaceholderNotice={false} />
