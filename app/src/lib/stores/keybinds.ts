import { writable, get } from 'svelte/store';

/** One configurable action in Board.svelte's WASD keyboard-navigation mode. */
export type BoardNavAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'pickUpDrop'
  | 'goBack'
  | 'openDetails'
  | 'info'
  | 'prevSwimlane'
  | 'nextSwimlane'
  | 'firstColumn'
  | 'lastColumn'
  | 'cancel'
  | 'showHint';

export type BoardKeybinds = Record<BoardNavAction, string>;

/** Every key is stored lowercased (matches `KeyboardEvent.key.toLowerCase()`) so comparisons
 * never have to special-case casing. `goBack`'s key is always pressed while holding Shift —
 * that requirement itself isn't configurable, only which key completes the chord is. */
export const DEFAULT_KEYBINDS: BoardKeybinds = {
  moveUp: 'w',
  moveDown: 's',
  moveLeft: 'a',
  moveRight: 'd',
  pickUpDrop: 'shift',
  goBack: 'tab',
  openDetails: 'enter',
  info: 'f',
  prevSwimlane: '[',
  nextSwimlane: ']',
  firstColumn: 'home',
  lastColumn: 'end',
  cancel: 'escape',
  showHint: '?',
};

export const ACTION_ORDER: BoardNavAction[] = [
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'pickUpDrop',
  'goBack',
  'openDetails',
  'info',
  'prevSwimlane',
  'nextSwimlane',
  'firstColumn',
  'lastColumn',
  'cancel',
  'showHint',
];

/** i18n key (under `board.keyboardNav.actions`) for each action's short label — shared by
 * Board.svelte's legend and Settings.svelte's rebind list, so they can never drift apart. */
export const ACTION_LABEL_KEYS: Record<BoardNavAction, string> = Object.fromEntries(
  ACTION_ORDER.map((action) => [action, `board.keyboardNav.actions.${action}`]),
) as Record<BoardNavAction, string>;

/** A key no action may ever claim (except `goBack`, which always requires Shift held first) —
 * plain, unmodified Tab must keep moving focus off the board for standard keyboard/screen-reader
 * navigation, the same invariant the rest of this feature has protected throughout. */
const PROTECTED_KEY = 'tab';

const STORAGE_KEY = 'workhorse-keybinds';

function loadKeybinds(): BoardKeybinds {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_KEYBINDS };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    // Merged (not replaced) against defaults so a future new action always has a value, even
    // for a browser whose stored copy predates it.
    return { ...DEFAULT_KEYBINDS, ...stored };
  } catch {
    return { ...DEFAULT_KEYBINDS };
  }
}

export const keybinds = writable<BoardKeybinds>(loadKeybinds());

keybinds.subscribe((value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
});

/**
 * Assigns `key` (a raw `KeyboardEvent.key`, lowercased here) to `action`. Refuses and returns an
 * error reason instead of saving when the key is already bound elsewhere, or would break the
 * native Tab escape hatch — the caller (the Settings rebind UI) is expected to show that reason
 * next to the control being edited rather than silently doing nothing.
 */
export function setKeybind(action: BoardNavAction, rawKey: string): { ok: true } | { ok: false; reason: 'protected' | 'duplicate'; conflictsWith?: BoardNavAction } {
  const key = rawKey.toLowerCase();
  if (key === PROTECTED_KEY && action !== 'goBack') return { ok: false, reason: 'protected' };
  const current = get(keybinds);
  const conflict = ACTION_ORDER.find((a) => a !== action && current[a] === key);
  if (conflict) return { ok: false, reason: 'duplicate', conflictsWith: conflict };
  keybinds.set({ ...current, [action]: key });
  return { ok: true };
}

export function resetKeybinds(): void {
  keybinds.set({ ...DEFAULT_KEYBINDS });
}
