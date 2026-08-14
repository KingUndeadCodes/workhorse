/**
 * The domain package: plain TypeScript interfaces describing the data model for Workhorse.
 * No behavior, no I/O — every consumer (the API server, the frontend) imports its types
 * from here rather than redefining them.
 */

export * from './ids';
export * from './user';
export * from './workspace';
export * from './project';
export * from './field';
export * from './workflow';
export * from './issue';
export * from './planning';
export * from './board';
export * from './collaboration';
export * from './events';
export * from './subscription';
export * from './agent';
export * from './notifications';
export * from './automation';
export * from './integrations';
