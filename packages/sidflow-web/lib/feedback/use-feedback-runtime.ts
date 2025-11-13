import { useEffect, useState } from 'react';
import { getFeedbackRuntimeState, subscribeFeedbackRuntime, type FeedbackRuntimeState } from '@/lib/feedback/runtime';

export function useFeedbackRuntimeState(): FeedbackRuntimeState {
  const [state, setState] = useState<FeedbackRuntimeState>(() => getFeedbackRuntimeState());

  useEffect(() => {
    const unsubscribe = subscribeFeedbackRuntime(setState);
    return () => {
      unsubscribe();
    };
  }, []);

  return state;
}
