import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown';

describe('renderMarkdown', () => {
  const users = [
    { id: 'u1', displayName: 'Jordan Cole', kind: 'human' },
    { id: 'a1', displayName: 'Triage Bot', kind: 'agent' },
  ];

  it('returns an empty string for blank input', () => {
    expect(renderMarkdown('   ')).toBe('');
  });

  it('renders markdown, honouring single line breaks', () => {
    expect(renderMarkdown('**bold**\nnext')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('one\ntwo')).toContain('<br>');
  });

  it('turns an @Full Name match into a mention pill, with a different class for agents', () => {
    const html = renderMarkdown('hi @Jordan Cole and @Triage Bot', users);
    expect(html).toContain('<span class="mention">@Jordan Cole</span>');
    expect(html).toContain('<span class="mention mention-agent">@Triage Bot</span>');
  });

  it('does not style an @name that is not a known user, or one inside a code span', () => {
    expect(renderMarkdown('hi @Nobody Here', users)).not.toContain('class="mention');
    expect(renderMarkdown('use `@Jordan Cole` literally', users)).not.toContain('class="mention');
  });

  it('strips scripts and event handlers from raw HTML (stored-XSS guard)', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">x</a>');
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
  });

  it('syntax-highlights fenced code blocks, and still renders one with an unknown language', () => {
    expect(renderMarkdown('```js\nconst x = 1;\n```')).toMatch(/hljs-keyword/);
    expect(renderMarkdown('```nonsense\nplain text\n```')).toContain('<pre><code');
  });
});
