<script lang="ts">
  import PolicyPage from './PolicyPage.svelte';

  export let onBack: () => void;

  const sectionKeys = [
    { headingKey: 'accessibilityStatement.commitmentHeading', bodyKey: 'accessibilityStatement.commitmentBody' },
    { headingKey: 'accessibilityStatement.knownLimitationsHeading', bodyKey: 'accessibilityStatement.knownLimitationsBody' },
    { headingKey: 'accessibilityStatement.feedbackHeading', bodyKey: 'accessibilityStatement.feedbackBody' },
  ];
</script>

<PolicyPage titleKey="accessibilityStatement.title" {sectionKeys} {onBack} />
