import { describe, expect, it } from 'vitest';
import type { AgentRun, AutomationAction, Comment, EventEnvelope, User, Workflow } from '$domain';
import {
  agentRunStatusLabel, avatarColor, describeAutomationAction, describeEvent, describeEventType, formatBucketLabel, formatDuration, formatHours,
  formatRelativeDate, formatTokenCount, initials, priorityIcon, recentRunsForAgent, removeCommentSubtree, renderMarkdown, splitHumansAndAgents,
  storyPointColor, storyPointDueDateWarning, totalTokensForAgent, typeIcon,
} from '../src/lib/util';

// Echoes the key and params, so assertions check *which* message was chosen and *what* it was filled with.
const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}${JSON.stringify(params)}` : key);
const tn = (key: string, count: number) => `${key}:${count}`;

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
});

describe('removeCommentSubtree', () => {
  const c = (id: string, parentCommentId?: string) => ({ id, parentCommentId }) as Comment;

  it('removes a comment and every reply beneath it, however deep', () => {
    const list = [c('a'), c('b', 'a'), c('c', 'b'), c('d'), c('e', 'd')];
    expect(removeCommentSubtree(list, 'a').map((x) => x.id)).toEqual(['d', 'e']);
  });

  it('handles replies listed before their parent', () => {
    const list = [c('c', 'b'), c('b', 'a'), c('a')];
    expect(removeCommentSubtree(list, 'a')).toEqual([]);
  });

  it('leaves siblings alone and does not mutate the input', () => {
    const list = [c('a'), c('b', 'a'), c('x')];
    expect(removeCommentSubtree(list, 'b').map((x) => x.id)).toEqual(['a', 'x']);
    expect(list).toHaveLength(3);
  });
});

describe('people helpers', () => {
  it('initials takes up to two uppercase initials', () => {
    expect(initials('Jordan Cole')).toBe('JC');
    expect(initials('madonna')).toBe('M');
    expect(initials('Mary Jane Watson')).toBe('MJ');
  });

  it('avatarColor is deterministic per id and always a palette color', () => {
    expect(avatarColor('u_123')).toBe(avatarColor('u_123'));
    const colors = new Set(Array.from({ length: 50 }, (_, i) => avatarColor(`user-${i}`)));
    expect(colors.size).toBeGreaterThan(3);
  });

  it('splitHumansAndAgents puts agents in their own group', () => {
    const { humans, agents } = splitHumansAndAgents([{ kind: 'human', n: 1 }, { kind: 'agent', n: 2 }, { kind: 'human', n: 3 }]);
    expect(humans.map((u) => u.n)).toEqual([1, 3]);
    expect(agents.map((u) => u.n)).toEqual([2]);
  });
});

describe('agent run helpers', () => {
  const run = (agentUserId: string, startedAt: string, tokenUsage?: number) => ({ agentUserId, startedAt, tokenUsage }) as AgentRun;
  const runs = [run('a1', '2026-01-01', 100), run('a1', '2026-01-03', 50), run('a2', '2026-01-02', 999), run('a1', '2026-01-02')];

  it('totals tokens for one agent only, treating a missing usage as 0', () => {
    expect(totalTokensForAgent('a1', runs)).toBe(150);
    expect(totalTokensForAgent('nobody', runs)).toBe(0);
  });

  it('lists an agent\'s runs newest first, capped by the limit', () => {
    expect(recentRunsForAgent('a1', runs).map((r) => r.startedAt)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01']);
    expect(recentRunsForAgent('a1', runs, 1)).toHaveLength(1);
  });

  it('formats token counts compactly', () => {
    expect([formatTokenCount(999), formatTokenCount(1500), formatTokenCount(2_500_000)]).toEqual(['999', '1.5k', '2.5M']);
  });

  it('labels a run status through the translator', () => {
    expect(agentRunStatusLabel('awaitingApproval', t)).toBe('agentsSettings.statusLabels.awaitingApproval');
  });
});

describe('icons', () => {
  it('maps priorities, defaulting to a flat dash', () => {
    expect(['highest', 'high', 'medium', 'low', 'lowest', 'weird'].map(priorityIcon)).toEqual(['chevup2', 'chevup', 'minus', 'chevdown', 'chevdown', 'minus']);
  });
  it('maps issue types, defaulting to story', () => {
    expect([typeIcon('Bug'), typeIcon('Task'), typeIcon('Epic')]).toEqual(['bug', 'task', 'story']);
  });
});

describe('time formatting', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it('formatRelativeDate: today, N days ago (plural-aware), then a locale date after a month', () => {
    expect(formatRelativeDate(new Date().toISOString(), t, tn)).toBe('relativeDate.today');
    expect(formatRelativeDate(daysAgo(3), t, tn)).toBe('relativeDate.daysAgo:3');
    expect(formatRelativeDate(daysAgo(45), t, tn)).toBe(new Date(daysAgo(45)).toLocaleDateString('en'));
  });

  it('formatDuration shows whole hours bare and others to one decimal', () => {
    expect([formatDuration(21600), formatDuration(9000), formatDuration(0)]).toEqual(['6h', '2.5h', '0h']);
  });

  it('formatHours follows the locale\'s separators', () => {
    expect(formatHours(6.5, 'en')).toBe('6.5');
    expect(formatHours(6.5, 'de')).toBe('6,5');
    expect(formatHours(6.456, 'en', 2)).toBe('6.46');
  });

  it('formatBucketLabel picks hour / weekday / date by window', () => {
    const iso = '2026-03-04T15:00:00';
    expect(formatBucketLabel(iso, '24h')).toBe(new Date(iso).toLocaleTimeString('en', { hour: 'numeric' }));
    expect(formatBucketLabel(iso, '1w')).toBe('Wed');
    expect(formatBucketLabel(iso, '30d')).toBe('Mar 4');
  });
});

describe('story points', () => {
  it('colors known sizes and falls back to theme tokens for others', () => {
    expect(storyPointColor(13)).toEqual({ bg: '#E85D5D', text: '#FFFFFF' });
    expect(storyPointColor(4)).toEqual({ bg: 'var(--surface-2)', text: 'var(--text-2)' });
  });

  describe('storyPointDueDateWarning', () => {
    const today = new Date('2026-06-10T09:00:00');

    it('says nothing without a due date or for an unknown size', () => {
      expect(storyPointDueDateWarning(5, undefined, t, tn, today)).toBeNull();
      expect(storyPointDueDateWarning(4, '2026-06-10', t, tn, today)).toBeNull();
    });

    it('flags a due date in the past', () => {
      expect(storyPointDueDateWarning(3, '2026-06-09', t, tn, today)).toBe('storyPointWarning.pastDue{"points":3}');
    });

    it('flags a due date sooner than the size\'s typical effort, but not one with enough runway', () => {
      expect(storyPointDueDateWarning(8, '2026-06-12', t, tn, today)).toContain('storyPointWarning.tooSoon');
      expect(storyPointDueDateWarning(8, '2026-06-17', t, tn, today)).toBeNull();
    });

    it('expresses sub-day estimates in hours', () => {
      expect(storyPointDueDateWarning(1, '2026-06-10', t, tn, today)).toContain('storyPointWarning.hoursDuration');
    });
  });
});

describe('activity descriptions', () => {
  const ctx = {
    workflow: { statuses: [{ id: 's1', name: 'To Do' }, { id: 's2', name: 'Done' }] } as Workflow,
    labels: [{ id: 'l1', name: 'urgent' }] as never,
    users: [{ id: 'u1', displayName: 'Jordan' }, { id: 'u2', displayName: 'Sam' }] as User[],
  };
  const ev = (payload: object) => ({ payload }) as EventEnvelope;

  it('describeEventType maps known types and de-dots unknown ones', () => {
    expect(describeEventType('issue.statusChanged', t)).toBe('activity.eventType.issueStatusChanged');
    expect(describeEventType('comment.mentioned', t)).toBe('activity.eventType.commentMentioned');
    expect(describeEventType('agent.runApplied' as never, t)).toBe('agent runApplied');
  });

  it('describeEvent resolves ids to names, falling back to the raw id', () => {
    expect(describeEvent(ev({ type: 'issue.statusChanged', fromStatusId: 's1', toStatusId: 's2' }), ctx, t)).toBe('activity.event.issueStatusChanged{"from":"To Do","to":"Done"}');
    expect(describeEvent(ev({ type: 'issue.resolved', statusId: 'gone' }), ctx, t)).toBe('activity.event.issueResolved{"status":"gone"}');
    expect(describeEvent(ev({ type: 'issue.assigneesChanged', fromUserIds: ['u1'], toUserIds: ['u2'] }), ctx, t)).toBe('activity.event.assigneesChangedTo{"from":"Jordan","to":"Sam"}');
    expect(describeEvent(ev({ type: 'issue.assigneesChanged', fromUserIds: [], toUserIds: [] }), ctx, t)).toContain('assigneesUnassignedAll');
  });

  it('describeEvent distinguishes a reply from a top-level comment, and a cleared due date from a set one', () => {
    expect(describeEvent(ev({ type: 'comment.created', parentCommentId: 'c0' }), ctx, t)).toBe('activity.event.commentReplied');
    expect(describeEvent(ev({ type: 'comment.created' }), ctx, t)).toBe('activity.event.commentCreated');
    expect(describeEvent(ev({ type: 'issue.dueDateChanged', toDueDate: '2026-01-01' }), ctx, t)).toContain('dueDateSet');
    expect(describeEvent(ev({ type: 'issue.dueDateChanged' }), ctx, t)).toBe('activity.event.dueDateCleared');
  });

  it('describeEvent falls back to a readable version of the type for the long tail', () => {
    expect(describeEvent(ev({ type: 'issue.repoFileRead' }), ctx, t)).toBe('issue repoFileRead');
  });

  it('describeAutomationAction names each action, truncating long comment bodies', () => {
    const c = { workflow: ctx.workflow, users: ctx.users, fieldDefinitions: [{ id: 'f1', name: 'Severity' }] as never };
    const d = (a: AutomationAction) => describeAutomationAction(a, c, t);
    expect(d({ type: 'transitionStatus', toStatusId: 's2' })).toBe('automation.action.transitionStatus{"status":"Done"}');
    expect(d({ type: 'assignTo', userId: 'u1' })).toBe('automation.action.assignTo{"name":"Jordan"}');
    expect(d({ type: 'addComment', body: 'x'.repeat(40) })).toContain(`${'x'.repeat(30)}…`);
    expect(d({ type: 'addComment', body: 'short' })).toContain('"short"');
    expect(d({ type: 'setField', fieldId: 'f1', value: 'high' })).toBe('automation.action.setField{"field":"Severity","value":"\\"high\\""}');
    expect(d({ type: 'readRepoFile', path: 'README.md' })).toBe('automation.action.readRepoFile{"path":"README.md"}');
    expect(d({ type: 'writeRepoFile', path: 'a.ts', content: '', branchName: 'b' })).toBe('automation.action.writeRepoFile{"path":"a.ts","branch":"b"}');
  });
});
