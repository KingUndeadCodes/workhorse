<script lang="ts">
  import PolicyPage from './PolicyPage.svelte';

  export let onBack: () => void;

  const sections = [
    {
      heading: 'The Software',
      body: 'Workhorse is open-source, self-hosted software, licensed under the MIT License. You (or whoever administers your workspace) run it on infrastructure you control — there is no hosted "Workhorse service" operated by us that these terms could grant or restrict access to. Using it means you accept the MIT License terms in full, which permit using, copying, modifying, and redistributing the software.',
    },
    {
      heading: 'Your Content',
      body: "Everything you create in a Workhorse workspace — issues, comments, attachments, and the rest — is yours. It's stored in your own deployment's database, and we make no claim to it. You're responsible for how your workspace is configured and who has access to it, same as with any self-hosted tool.",
    },
    {
      heading: 'AI Agents',
      body: "Workhorse can attach AI agents to tickets, and those agents can take real actions — commenting, changing status, editing fields, touching a linked repository — under an approval and budget policy you configure. You're responsible for reviewing that configuration and for whatever actions an agent takes under it; treat an unreviewed high-trust policy the same way you'd treat handing someone write access to your workspace.",
    },
    {
      heading: 'No Warranty',
      body: 'As stated in the MIT License, this software is provided "as is," without warranty of any kind. The authors aren\'t liable for any claim or damages arising from its use. This is standard open-source licensing, not a bespoke limitation — see the LICENSE file in the repository for the exact legal text.',
    },
    {
      heading: 'Changes to These Terms',
      body: "These terms may be updated as the software changes. Since this is self-hosted software, there's no account to notify — check back here, or track the repository, if that matters to your deployment.",
    },
  ];
</script>

<PolicyPage title="Terms of Use" {sections} {onBack} showPlaceholderNotice={false} />
