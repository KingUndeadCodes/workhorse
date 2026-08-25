<script lang="ts">
  import PolicyPage from './PolicyPage.svelte';

  export let onBack: () => void;

  const sectionKeys = [
    { headingKey: 'privacyPolicy.dataCollectedHeading', bodyKey: 'privacyPolicy.dataCollectedBody' },
    { headingKey: 'privacyPolicy.dataUseHeading', bodyKey: 'privacyPolicy.dataUseBody' },
    { headingKey: 'privacyPolicy.contactHeading', bodyKey: 'privacyPolicy.contactBody' },
  ];
</script>

<PolicyPage titleKey="privacyPolicy.title" {sectionKeys} {onBack} />
