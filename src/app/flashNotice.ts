// A one-time message handed to the next page through the router ("Dodano lek ..."). It travels
// in the navigation state, so it needs no global store and is gone after the page shows it.

export interface FlashNoticeState {
  notice: string;
}

export function flashNotice(message: string): { state: FlashNoticeState } {
  return { state: { notice: message } };
}

/** Reads the message from router state, if there is one. The state is `unknown`, so it is checked. */
export function readFlashNotice(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null;
  return typeof state.notice === 'string' ? state.notice : null;
}
