import { memo, useEffect, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type { MeshStandardMaterial } from 'three';
import { useGameStore } from '../store/gameStore.js';
import { useUiStore } from '../store/uiStore.js';
import { selectModuleRenderer } from '../modules/registry.js';
import { isPrimaryActivation } from '../modules/interaction.js';
import { formatBayTag, formatModuleType, type ModuleSlot } from './layout.js';
import { prefersReducedMotion } from './dom.js';
import { SOLVE_LED_FLASH_MS, solveLedVisual, type ModuleStatus } from './moduleLed.js';
import { DEV_PLACEHOLDER_MODULES } from './devBombState.js';

/**
 * One module bay: graphite faceplate with rim + corner screws + MOD-NN tag
 * (mockup .bay anatomy), the solve LED, and the module body resolved through
 * the renderer registry (AC1: data-driven, no per-module conditionals here).
 * Rendering only — the LED renders server truth; green iff status==='solved'.
 *
 * `typesOnly` is the Preparation placeholder mode (Story 4.6): the tag shows the
 * module *type* instead of MOD-NN, the face is forced to the empty
 * PLACEHOLDER_RENDERER (no generated value can leak), and the bay is inert —
 * no click-to-focus and no per-frame LED work (the prep bomb is static).
 */

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
  typesOnly = false,
}: {
  slot: ModuleSlot;
  moduleId: string;
  /** Preparation placeholder mode (Story 4.6): type tag, value-free face, inert. */
  typesOnly?: boolean;
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
    if (typesOnly) return; // prep bomb has no live status — nothing to flash.
    let prev = statusAt(useGameStore.getState().bomb?.modules, slot.moduleIndex);
    return useGameStore.subscribe((s) => {
      const next = statusAt(s.bomb?.modules, slot.moduleIndex);
      if (next === 'struck' && prev !== 'struck') flashPendingRef.current = true;
      prev = next;
    });
  }, [slot.moduleIndex, typesOnly]);

  // Flash driver: the only per-frame work in the scene. Early-outs when no
  // flash is active; no allocations inside the callback (Color.set reuses).
  useFrame(({ clock }) => {
    if (typesOnly) return; // static prep bomb — no per-frame work (project rule).
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

  // In prep the bay is inert: no click-to-focus, no module interaction
  // (Story 4.6 — "verify a click does nothing"). Orbit/zoom still orient.
  const onClick = typesOnly
    ? undefined
    : (event: ThreeEvent<MouseEvent>) => {
        // Shared with the module interaction helpers (5.1) so click-to-focus and
        // module clicks use the same button/drag-tolerance contract.
        if (!isPrimaryActivation(event.button, event.delta)) return;
        event.stopPropagation();
        useUiStore.getState().setActiveModuleIndex(slot.moduleIndex);
      };

  // Base (non-flash) LED visual is declarative; the useFrame driver overrides
  // it only while a flash is active and re-asserts every active frame. In prep
  // there is no live status, so the LED sits at its base armed visual.
  const base = solveLedVisual(status, null, false);
  // Prep forces the empty-face placeholder for every slot — the value-free
  // guarantee (no wire colours / button label / letters / symbols ever leak).
  const Renderer = selectModuleRenderer(moduleId, typesOnly);

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

      {/* Bay tag — mockup .bay-tag (#5A5560, mono, letter-spaced). In prep
          (Story 4.6) it carries the module TYPE centered on the empty face;
          in the live round it is the MOD-NN micro-label. */}
      {typesOnly ? (
        <Text
          font="/fonts/jetbrains-mono-700.ttf"
          fontSize={0.07}
          color="#9A95A0"
          letterSpacing={0.04}
          anchorX="center"
          anchorY="middle"
          maxWidth={0.72}
          textAlign="center"
          position={[0, 0, FACE_Z]}
        >
          {formatModuleType(moduleId)}
        </Text>
      ) : (
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
      )}

      {/* Solve LED — the Defuser's only visual solved-confirmation (AC2). It is
          live-round state chrome: hidden in prep (Story 4.6), where there is no
          committed bomb and a lit LED would imply a (non-existent) solve. */}
      {!typesOnly && (
        <mesh position={LED_POSITION} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[LED_RADIUS, LED_RADIUS, 0.012, 16]} />
          <meshStandardMaterial
            ref={ledMatRef}
            color={base.color}
            emissive={base.emissive}
            emissiveIntensity={base.emissiveIntensity}
          />
        </mesh>
      )}

      {/* Module body — resolved via the renderer registry (placeholder until Epic 5) */}
      <group position={[0, -0.04, FACE_Z]}>
        <Renderer.DefuserView moduleIndex={slot.moduleIndex} />
      </group>
    </group>
  );
});
