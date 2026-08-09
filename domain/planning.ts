import type { ProjectId, SprintId } from './ids';

export type SprintState = 'future' | 'active' | 'closed';

/** A time-boxed planning period a project's issues can be scheduled into. */
export interface Sprint {
  id: SprintId;
  projectId: ProjectId;
  /** e.g. "Sprint 24". */
  name: string;
  goal?: string;
  state: SprintState;
  startDate?: string;
  endDate?: string;
  /** When actually closed — may differ from {@link endDate}. */
  completedAt?: string;
}
