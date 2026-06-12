import { memo, useEffect, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type { MeshStandardMaterial } from 'three';
import { useGameStore } from '../store/gameStore.js';
import { useUiStore } from '../store/uiStore.js';
import { getModuleRenderer } from '../modules/registry.js';
import { formatBayTag, type ModuleSlot } from './layout.js';
import { prefersReducedMotion } from './dom.js';
import { SOLVE_LED_FLASH_MS, solveLedVisual, type ModuleStatus } from './moduleLed.js';
import { DEV_PLACEHOLDER_MODULES } from './devBombState.js';

/**
 * One module bay: graphite faceplate with rim + corner screws + MOD-NN tag
 * (mockup .bay anatomy), the solve LED, and the module body resolved through
 * the renderer registry (AC1: data-driven, no per-module conditionals here).
 * Rendering only — the LED renders server truth; green iff status==='solved'.
 */

/** Clicks that travelled further than this (px) are drag-orbits, not clicks. */
const CLICK_DRAG_TOLERANCE_PX = 4;

/** Faceplate dimensions (Story 4.1's plate, now framed as a bay). */
const PLATE_SIZE: [number, number, number] = [0.8, 0.55, 0.08];
/** Rim reads as the bay's dark recessed border (mockup .bay border #0C0B0E). */
const RIM_SIZE: [number, number, number] = [0.86, 0.61, 0.07];
const PLATE_Z = 0.04;
/** Surface for features sitting on the plate (proud by ~0.01 — z-fight guard). */
const FACE_Z = PLATE_Z + PLATE_SIZE[2] / 2 + 0.005;

/**
 * Solve LED radius — the "10px" AC translated to world units: at the overview
 * pose (distance ≈5.2, fov 45°, 1080p stage) one pixel ≈ 2·5.2·tan(22.5°)/1080
 * ≈ 0.004 world units, so a 10px LED ≈ 0.042 diameter → radius 0.021.
 */
const LED_RADIUS = 0.021;
const LED_POSITION: [number, number, number] = [0.3, 0.21, FACE_Z];
const TAG_POSITION: [number, number, number] = [-0.3, 0.21, FACE_Z];

/** Brass bay screws at the plate corners — data-driven, not JSX repetition. */
const BAY_SCREW_POSITIONS: ReadonlyArray<[number, number, number]> = (
  [1, -1] as const
).flatMap((sx) =>
  ([1, -1] as const).map(
    (sy): [number, number, number] => [sx * 0.355, sy * 0.23, FACE_Z],
  ),
);

const statusAt = (modules: ReadonlyArray<{ status: ModuleStatus }> | undefined, index: number) =>
  (modules ?? DEV_PLACEHOLDER_MODULES)[index]?.status ?? 'armed';

/** Memoized per-bay: a MODULE_UPDATE to module 3 re-renders only bay 3. */
export const ModuleBay = memo(function ModuleBay({
  slot,
  moduleId,
}: {
  slot: ModuleSlot;
  moduleId: string;
}) {
  // Scoped reactive selector (snapshot-rate, not per-frame): primitive value,
  // so unrelated store broadcasts don't re-render this bay.
  const status = useGameStore((s) => statusAt(s.bomb?.modules, slot.moduleIndex));

  const ledMatRef = useRef<MeshStandardMaterial>(null);
  const flashPendingRef = useRef(false);
  const flashStartRef = useRef<number | null>(null);
  const flashReducedRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  // Edge-trigger the strike flash from a direct store subscription: zustand
  // notifies synchronously per set(), so a transient armed→struck→armed pulse
  // is observed even when React batches the two updates into one render
  // ('struck' is transient by contract — the bomb reducer rolls it up).
  useEffect(() => {
    let prev = statusAt(useGameStore.getState().bomb?.modules, slot.moduleIndex);
    return useGameStore.subscribe((s) => {
      const next = statusAt(s.bomb?.modules, slot.moduleIndex);
      if (next === 'struck' && prev !== 'struck') flashPendingRef.current = true;
      prev = next;
    });
  }, [slot.moduleIndex]);

  // Flash driver: the only per-frame work in the scene. Early-outs when no
  // flash is active; no allocations inside the callback (Color.set reuses).
  useFrame(({ clock }) => {
    const mat = ledMatRef.current;
    if (!mat) return;
    if (flashPendingRef.current) {
      flashPendingRef.current = false;
      flashStartRef.current = clock.elapsedTime;
      flashReducedRef.current = prefersReducedMotion();
    }
    if (flashStartRef.current === null) return;
    const elapsedMs = (clock.elapsedTime - flashStartRef.current) * 1000;
    const visual = solveLedVisual(statusRef.current, elapsedMs, flashReducedRef.current);
    mat.color.set(visual.color);
    mat.emissive.set(visual.emissive);
    mat.emissiveIntensity = visual.emissiveIntensity;
    if (elapsedMs >= SOLVE_LED_FLASH_MS) flashStartRef.current = null;
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.button !== 0) return; // AC1 (4.1): right/middle-click reserved
    if (event.delta > CLICK_DRAG_TOLERANCE_PX) return; // drag-orbit release ≠ click
    event.stopPropagation();
    useUiStore.getState().setActiveModuleIndex(slot.moduleIndex);
  };

  // Base (non-flash) LED visual is declarative; the useFrame driver overrides
  // it only while a flash is active and re-asserts every active frame.
  const base = solveLedVisual(status, null, false);
  const Renderer = getModuleRenderer(moduleId);

  return (
    // Back-face bays (normal -z) rotate 180° about y so tag/LED/body face outward.
    <group position={slot.position} rotation={[0, slot.normal[2] < 0 ? Math.PI : 0, 0]}>
      {/* Bay rim — mockup .bay border #0C0B0E (raw hex; CSS vars can't reach WebGL) */}
      <mesh position={[0, 0, 0.025]}>
        <boxGeometry args={RIM_SIZE} />
        <meshStandardMaterial color="#0C0B0E" />
      </mesh>

      {/* Faceplate — --color-graphite #1A1A1F; carries the click-to-focus contract */}
      <mesh position={[0, 0, PLATE_Z]} onClick={onClick}>
        <boxGeometry args={PLATE_SIZE} />
        <meshStandardMaterial color="#1A1A1F" />
      </mesh>

      {/* Bay screws — --color-brass #B8924A (mockup .bay-screw) */}
      {BAY_SCREW_POSITIONS.map((position, i) => (
        <mesh key={i} position={position} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.018, 12]} />
          <meshStandardMaterial color="#B8924A" />
        </mesh>
      ))}

      {/* Bay tag — mockup .bay-tag (#5A5560, mono, letter-spaced) */}
      <Text
        font="/fonts/jetbrains-mono-700.ttf"
        fontSize={0.04}
        color="#5A5560"
        letterSpacing={0.18}
        anchorX="left"
        anchorY="middle"
        position={TAG_POSITION}
      >
        {formatBayTag(slot.moduleIndex)}
      </Text>

      {/* Solve LED — the Defuser's only visual solved-confirmation (AC2) */}
      <mesh position={LED_POSITION} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[LED_RADIUS, LED_RADIUS, 0.012, 16]} />
        <meshStandardMaterial
          ref={ledMatRef}
          color={base.color}
          emissive={base.emissive}
          emissiveIntensity={base.emissiveIntensity}
        />
      </mesh>

      {/* Module body — resolved via the renderer registry (placeholder until Epic 5) */}
      <group position={[0, -0.04, FACE_Z]}>
        <Renderer.DefuserView moduleIndex={slot.moduleIndex} />
      </group>
    </group>
  );
});
