/**
 * Collapses many "this changed, save it" signals into one save. sql.js has no file I/O of its own, so every
 * write used to re-export and rewrite the *entire* database synchronously — and one PATCH emits up to seven
 * events, each persisting both databases, so a single request cost fourteen full rewrites that blocked the
 * event loop for the whole time. Now `markDirty()` only records that a save is owed; the save itself happens
 * once, at {@link flush} (called at the end of every request, before the response goes out), or — for work
 * that isn't inside a request, like a webhook delivery logging its result — on the next turn of the event
 * loop as a fallback.
 */
export class CoalescingWriter {
  private dirty = false;
  private scheduled = false;

  constructor(
    private readonly write: () => void,
    private readonly schedule: (run: () => void) => void = (run) => void setImmediate(run),
    private readonly onBackgroundError: (err: unknown) => void = (err) => console.error('Failed to persist database:', err),
  ) {}

  markDirty(): void {
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      try {
        this.flush();
      } catch (err) {
        this.onBackgroundError(err); // nobody is waiting on this save; stay dirty so the next flush retries
      }
    });
  }

  /** Saves now if anything is owed. A failed write throws and leaves the writer dirty, so the next flush tries again. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.write();
    } catch (err) {
      this.dirty = true;
      throw err;
    }
  }

  get isDirty(): boolean {
    return this.dirty;
  }
}
