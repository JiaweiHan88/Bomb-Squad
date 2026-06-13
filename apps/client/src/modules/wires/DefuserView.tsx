import { useCallback, useMemo } from 'react';
import { Text } from '@react-three/drei';
import { useGameStore } from '../../store/gameStore.js';
import type { ModuleDefuserViewProps } from '../registry.js';
import { dispatchModuleAction } from '../dispatch.js';
import { moduleClickHandlers } from '../interaction.js';
import { useOptimisticPreFlash } from '../useOptimisticPreFlash.js';
import { WIRES_MODULE_ID, WIRE_COLOR_LABELS, type WireColor, type WiresState } from './types.js';

/**
 * Wires DefuserView — R3F rendering ONLY, zero game logic. Layout is fully
 * data-driven from the generated wires array (count, colours, cut flags);
 * the solve confirmation is ModuleBay's LED, not module chrome.
 *
 * Visual spec: mockup "3. Defuser Bomb View" Wires module — horizontal wire
 * rows between end grommets, a mono letter label per row (the colorblind
 * floor: colour is never the only signal), cut wires as two severed stubs.
 *
 * Body budget: the bay faceplate is 0.8×0.55 and ModuleBay mounts this group
 * at [0, -0.04, faceZ] — keep geometry within ~0.7×0.4, shallow z.
 */

/** Raw hexes with token names in comments — CSS vars can't reach WebGL (4.x convention). */
const WIRE_TINTS: Readonly<Record<WireColor, string>> = {
  red: '#D8402F', // mockup .wire.red gradient mid
  white: '#E5DDC9', // mockup .wire.white gradient mid
  blue: '#3B7BE0', // mockup .wire.blue gradient mid
  yellow: '#E0B53C', // brass-adjacent yellow, distinct from white at low light
  black: '#23202A', // near-bakelite black (label K carries the signal)
};
const LABEL_INK = '#8A8590'; // mockup .wire-lab
const GROMMET = '#5A5560'; // mockup grommet gray

const WIRE_LENGTH = 0.5;
const WIRE_RADIUS = 0.016;
const ROW_SPAN = 0.34; // total vertical span available for wire rows
const LABEL_X = -0.31;
const WIRE_X = 0.03; // wire centreline (labels sit left of the grommets)

function selectWiresData(moduleIndex: number) {
  return (s: ReturnType<typeof useGameStore.getState>): WiresState | null => {
    const mod = s.bomb?.modules[moduleIndex];
    // moduleId check guards a desynced payload from rendering garbage.
    return mod?.moduleId === WIRES_MODULE_ID ? (mod.data as WiresState) : null;
  };
}

export function WiresDefuserView({ moduleIndex }: ModuleDefuserViewProps) {
  // Snapshot-rate reactive selector — memoized on moduleIndex so the selector
  // reference is stable across renders (no per-render closure); zustand only
  // re-subscribes when moduleIndex changes. Nothing per-frame here.
  const selector = useMemo(() => selectWiresData(moduleIndex), [moduleIndex]);
  const data = useGameStore(selector);

  // Optimistic pre-flash (AC-2): a cut wire shows severed on the click's own
  // frame, before the server confirms. `isConfirmed` reads the LATEST
  // authoritative snapshot (not the render closure) so reconcile drops the
  // marker the instant the server's MODULE_UPDATE reflects the cut; if no
  // confirmation lands it rolls back. This NEVER touches module status / the
  // solve LED — only the server snapshot flips `solved`.
  const isConfirmed = useCallback(
    (wireIndex: number) => {
      const mod = useGameStore.getState().bomb?.modules[moduleIndex];
      // Module/bomb momentarily gone or replaced (e.g. a re-sync, a round
      // transition) is NOT a confirmation — there's no evidence the cut landed.
      // Return false so the marker keeps tracking and rolls back via its timeout,
      // rather than being silently dropped as a phantom "confirmed" (the visual is
      // gated on `data` anyway, so an un-confirmed marker renders nothing here).
      if (mod?.moduleId !== WIRES_MODULE_ID) return false;
      return (mod.data as WiresState).wires[wireIndex]?.cut === true;
    },
    [moduleIndex],
  );
  const preFlash = useOptimisticPreFlash(isConfirmed);

  if (!data) return null;

  const rows = data.wires.length;
  const spacing = rows > 1 ? ROW_SPAN / (rows - 1) : 0;
  const topY = ROW_SPAN / 2;

  return (
    <group>
      {data.wires.map((wire, wireIndex) => {
        const y = topY - wireIndex * spacing;
        const tint = WIRE_TINTS[wire.color];
        // Severed visual = authoritative cut OR an unconfirmed optimistic cut
        // (the pre-flash). Both render identically, so confirmation is seamless.
        const severed = wire.cut || preFlash.active.has(wireIndex);
        // Click anywhere on the row's wire group = cut THIS wire (idempotent
        // on a severed wire — the reducer judges, the view only dispatches).
        // Mark the pre-flash SYNCHRONOUSLY before the emit so the sever renders
        // this frame (≤100ms perceived budget, independent of the round-trip).
        const cut = moduleClickHandlers(() => {
          // Read the LIVE authoritative module/wire (not the `wire` render
          // closure, which can be stale on a rapid re-click or when a snapshot
          // landed between paint and click) to decide whether this click can
          // actually change state. An already-cut wire or a solved (inert) module
          // is a server no-op with no confirming snapshot.
          const mod = useGameStore.getState().bomb?.modules[moduleIndex];
          const liveWire =
            mod?.moduleId === WIRES_MODULE_ID
              ? (mod.data as WiresState).wires[wireIndex]
              : undefined;
          const canChange = mod?.status !== 'solved' && liveWire?.cut === false;
          // Dispatch first (the server is authority and treats an inert click as a
          // clean no-op). Only pre-flash if the action actually went out AND can
          // change state — otherwise there is no confirming snapshot to reconcile
          // against and the marker would linger until the rollback timeout (a
          // phantom sever). The emit is synchronous, so the mark still happens on
          // the click's own frame (≤100ms perceived budget, independent of RTT).
          const dispatched = dispatchModuleAction(moduleIndex, { type: 'CUT', wireIndex });
          if (dispatched && canChange) preFlash.mark(wireIndex);
        });
        return (
          <group key={wireIndex} position={[0, y, 0.02]}>
            {/* Letter label — pattern/label redundancy (never colour alone). */}
            <Text
              font="/fonts/jetbrains-mono-700.ttf"
              fontSize={0.045}
              color={LABEL_INK}
              anchorX="center"
              anchorY="middle"
              position={[LABEL_X, 0, 0]}
            >
              {WIRE_COLOR_LABELS[wire.color]}
            </Text>

            <group position={[WIRE_X, 0, 0]} {...cut}>
              {severed ? (
                <>
                  {/* Severed: two drooping stubs with a visible gap (cylinder
                      axis is Y, so horizontal = π/2 base rotation ± droop). */}
                  <mesh position={[-WIRE_LENGTH / 4, -0.01, 0]} rotation={[0, 0, Math.PI / 2 - 0.25]}>
                    <cylinderGeometry args={[WIRE_RADIUS, WIRE_RADIUS, WIRE_LENGTH / 2 - 0.04, 8]} />
                    <meshStandardMaterial color={tint} />
                  </mesh>
                  <mesh position={[WIRE_LENGTH / 4, -0.01, 0]} rotation={[0, 0, Math.PI / 2 + 0.25]}>
                    <cylinderGeometry args={[WIRE_RADIUS, WIRE_RADIUS, WIRE_LENGTH / 2 - 0.04, 8]} />
                    <meshStandardMaterial color={tint} />
                  </mesh>
                </>
              ) : (
                <mesh rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[WIRE_RADIUS, WIRE_RADIUS, WIRE_LENGTH, 8]} />
                  <meshStandardMaterial color={tint} />
                </mesh>
              )}
              {/* End grommets anchor the wire visually and pad the click target. */}
              {([-1, 1] as const).map((side) => (
                <mesh key={side} position={[(side * WIRE_LENGTH) / 2, 0, 0]}>
                  <boxGeometry args={[0.035, 0.05, 0.035]} />
                  <meshStandardMaterial color={GROMMET} />
                </mesh>
              ))}
            </group>
          </group>
        );
      })}
    </group>
  );
}
