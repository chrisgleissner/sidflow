const listeners = new Set<(event: FeedbackEvent) => void>();

export type FeedbackEvent = 'rating' | 'implicit';

export function emitFeedbackEvent(event: FeedbackEvent): void {
  if (listeners.size === 0) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[FeedbackEvents] Listener threw an error', error);
    }
  }
}

export function subscribeFeedbackEvents(listener: (event: FeedbackEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
