/** Cancellation is a scheduling outcome, never measured engine evidence. */
export async function requestUnlessStopped<T>(request: () => Promise<T>, stopped: () => boolean): Promise<T | undefined> {
  if (stopped()) return undefined;
  try {
    return await request();
  } catch (error) {
    if (!stopped()) throw error;
    console.debug("ROM census request cancelled; leaving the subtune pending", error);
    return undefined;
  }
}
