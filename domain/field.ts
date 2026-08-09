import type { FieldId, IssueTypeId, ProjectId, WorkspaceId } from './ids';

/** The kind of value a custom field holds — determines how {@link FieldValue.value} is interpreted. */
export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'user'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'formula';

/** One choice in a `select`/`multiSelect` field. */
export interface FieldOption {
  id: string;
  label: string;
  color?: string;
}

/**
 * The schema for a custom field — a workspace-defined addition to the fixed {@link Issue}
 * shape. Compare {@link FieldValue}, which is the value an issue actually holds for one
 * of these.
 */
export interface FieldDefinition {
  id: FieldId;
  workspaceId: WorkspaceId;
  /** Stable machine key, e.g. "qa_status" — referenced by automations/formulas, never renamed. */
  key: string;
  /** Display label, safe to rename freely. */
  name: string;
  type: FieldType;
  /** `select` / `multiSelect` only. */
  options?: FieldOption[];
  /** `formula` fields only; references other field keys. */
  formula?: string;
  scope: {
    /** Omitted = all projects. */
    projectIds?: ProjectId[];
    /** Omitted = all issue types in scope. */
    issueTypeIds?: IssueTypeId[];
  };
  isRequired: boolean;
}

/**
 * The value an issue holds for one field. The shape of `value` is determined by the
 * referenced {@link FieldDefinition.type} and validated at write time, not by this type.
 */
export interface FieldValue {
  fieldId: FieldId;
  value: string | number | boolean | string[] | null;
}
