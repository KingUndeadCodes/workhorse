/**
 * Single re-export point for the domain package, so every other server file uses a short
 * relative path (`./domain`) instead of reaching across into `../../domain` repeatedly.
 */
export * from '../../domain/index';
