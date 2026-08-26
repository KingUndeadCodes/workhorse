<script lang="ts">
  import PolicyPage from './PolicyPage.svelte';

  export let onBack: () => void;

  const sections = [
    {
      heading: 'Data We Collect',
      body: "Workhorse collects the account details you provide to sign up — email, display name, and password — and the workspace content you and your team create: issues, comments, labels, attachments, worklogs, and the full history of changes to them, since the app is built on a durable, auditable event log. It doesn't collect anything beyond what you and your team put into it.",
    },
    {
      heading: 'How We Use It',
      body: "That data is used to run the product itself: showing your team's issues back to you, powering the automations and AI agents you configure, and keeping an audit trail you can inspect. Workhorse is self-hosted — your account and workspace data live in your own deployment's database (two local SQLite files), not in a cloud service run by us. The one external request the app makes is to Google Fonts, to load the interface's typeface; no workspace or account data is sent there, only the font request itself, which (like any font CDN) can see the requesting IP address.",
    },
    {
      heading: 'Contact',
      body: 'Workhorse is self-hosted software with no central support line. If you have questions about how your workspace’s data is handled, please contact whoever administers your workspace’s deployment — they control the actual data, since it lives in their own installation, not ours.',
    },
  ];
</script>

<PolicyPage title="Privacy Policy" {sections} {onBack} showPlaceholderNotice={false} />
