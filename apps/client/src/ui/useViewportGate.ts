import { useEffect, useState } from 'react';
import { evaluateGate, type GateResult } from './platform.js';

function readGate(): GateResult {
  return evaluateGate({
    width: window.innerWidth,
    height: window.innerHeight,
    userAgent: navigator.userAgent,
  });
}

/**
 * Tracks the live platform-gate result, re-evaluating on window resize.
 * Pure decision lives in {@link evaluateGate}; this only bridges it to the DOM.
 */
export function useViewportGate(): GateResult {
  const [gate, setGate] = useState<GateResult>(readGate);

  useEffect(() => {
    const onResize = () => setGate(readGate());
    window.addEventListener('resize', onResize);
    // Re-sync once on mount in case the viewport changed before listeners attached.
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return gate;
}
