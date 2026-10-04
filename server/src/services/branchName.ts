/**
 * Branch names arrive from user input (the issue-branch route, an agent's `writeRepoFile`, a repo
 * link's default branch) and end up as arguments to `git` or in GitHub API URLs. A name that begins
 * with `-` would be parsed by git as an *option* — `git branch -D main` instead of creating a branch
 * named `-D` — so every name is checked here before it goes anywhere near a command. The accepted
 * set is a conservative subset of what git allows (ASCII letters, digits, `. _ / -`), with git's own
 * structural rules on top (no `..`, no empty/dot-leading components, no `.lock` suffix).
 */
export function isValidBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.includes('/.')
  );
}

/** Throws a message safe to show the user if `name` isn't a usable branch name. */
export function assertValidBranchName(name: string, label = 'branch name'): void {
  if (!isValidBranchName(name)) throw new Error(`Invalid ${label} "${name}" — use letters, digits, and . _ / - only, and don't start with "-"`);
}
