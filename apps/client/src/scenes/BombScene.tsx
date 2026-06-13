import { useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { CameraControls, Stats } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { useGameStore } from '../store/gameStore.js';
import { useUiStore } from '../store/uiStore.js';
import { CHASSIS_SIZE, computeModuleLayout, type ModuleSlot } from './layout.js';
import { ChassisFeatures } from './ChassisFeatures.js';
import { ModuleBay } from './ModuleBay.js';
import { TimerLcd } from './TimerLcd.js';
import { StrikeIndicator } from './StrikeIndicator.js';
import { DEV_BOMB_CONTEXT } from './devBombContext.js';
import { DEV_PLACEHOLDER_MODULES } from './devBombState.js';
import { isTextEntryTarget, prefersReducedMotion } from './dom.js';

/**
 * Bomb scene: bakelite chassis with diegetic BombContext metadata (Story 4.2)
 * + registry-driven module bays with solve LEDs (Story 4.3)
 * + the diegetic 7-segment timer LCD with client extrapolation (Story 4.4)
 * + the strike indicator LEDs beside the timer (Story 4.5)
 * + the orbit/zoom/focus camera rig (Story 4.1).
 * Rendering only — zero game logic (R3F components are dumb renderers).
 * Preparation placeholder view lands in 4.6; snapshot sync/60fps pass in 4.7.
 */

/** Brass corner screws on the front/back faces (mockup .screw, Flow 1 "brass
 *  screws") — data-driven from a positions array, not JSX repetition. */
const SCREW_POSITIONS: ReadonlyArray<[number, number, number]> = (
  [1, -1] as const
).flatMap((face) =>
  ([1, -1] as const).flatMap((sx) =>
    ([1, -1] as const).map(
      (sy): [number, number, number] => [
        sx * (CHASSIS_SIZE[0] / 2 - 0.15),
        sy * (CHASSIS_SIZE[1] / 2 - 0.13),
        face * (CHASSIS_SIZE[2] / 2 + 0.012),
      ],
    ),
  ),
);

/** Raised bakelite-deep ribs near each end — shadowed-edge accent (DESIGN.md
 *  bakeliteDeep "shadowed chassis edge"), inset from the ±x faces so the
 *  serial sticker's end face stays clean. */
const RIB_X = CHASSIS_SIZE[0] / 2 - 0.08;
const RIB_SIZE: [number, number, number] = [0.08, CHASSIS_SIZE[1] + 0.06, CHASSIS_SIZE[2] + 0.06];

/** Overview pose framing the whole chassis inside the 16:9 stage. */
const OVERVIEW_POSITION: [number, number, number] = [0, 1.1, 5.2];
const OVERVIEW_TARGET: [number, number, number] = [0, 0, 0];
/** Eye distance from a module face when focused (camera dollies to here). */
const FOCUS_DISTANCE = 1.6;
/** Zoom clamps: can't enter the chassis, can't lose it to a speck. */
const MIN_DISTANCE = 1.2;
const MAX_DISTANCE = 10;
function CameraRig({ slots }: { slots: ModuleSlot[] }) {
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  // Reactive subscription is correct here: focus changes are click-rate, not
  // per-frame (getState()-in-useFrame applies to tick-rate reads only).
  const activeModuleIndex = useUiStore((s) => s.activeModuleIndex);
  const skippedFirstRun = useRef(false);

  // AC1 button contract: left-drag = orbit, wheel = zoom, right/middle = NONE (reserved).
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.mouseButtons.left = CameraControlsImpl.ACTION.ROTATE;
    controls.mouseButtons.middle = CameraControlsImpl.ACTION.NONE;
    controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
    controls.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY;
  }, []);

  // AC1: ESC returns to overview (clears focus; the pose effect below moves the camera).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isTextEntryTarget(event.target)) return;
      useUiStore.getState().setActiveModuleIndex(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Camera follows the focus state (uiStore.activeModuleIndex is the single source).
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (!skippedFirstRun.current) {
      // Mount: camera already sits at the overview pose — nothing to animate.
      skippedFirstRun.current = true;
      if (activeModuleIndex === null) return;
    }
    const animate = !prefersReducedMotion();
    if (activeModuleIndex === null) {
      void controls.setLookAt(...OVERVIEW_POSITION, ...OVERVIEW_TARGET, animate);
      return;
    }
    const slot = slots.find((s) => s.moduleIndex === activeModuleIndex);
    if (!slot) return; // defensive: stale index after a layout shrink → no-op
    const [x, y, z] = slot.position;
    const [nx, ny, nz] = slot.normal;
    void controls.setLookAt(
      x + nx * FOCUS_DISTANCE,
      y + ny * FOCUS_DISTANCE,
      z + nz * FOCUS_DISTANCE,
      x,
      y,
      z,
      animate,
    );
  }, [activeModuleIndex, slots]);

  return <CameraControls ref={controlsRef} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} />;
}

/** Opt-in FPS/ms overlay (stats.js via drei) for AC-3 verification. Off unless
 *  the URL carries `?stats` — never shown in normal play. Read once at module
 *  load; the round URL has no query string during play so this is stable. */
const SHOW_STATS =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stats');

export default function BombScene() {
  // Reactive (non-per-frame) reads: layout and metadata follow the bomb
  // snapshot when one exists, else the dev-harness placeholders. The modules
  // array (not a bare count) is the source of truth since 4.3 — each slot
  // renders its module's data (id → registry, status → solve LED).
  const modules = useGameStore((s) => s.bomb?.modules) ?? DEV_PLACEHOLDER_MODULES;
  const context = useGameStore((s) => s.bomb?.context) ?? DEV_BOMB_CONTEXT;
  const slots = useMemo(() => computeModuleLayout(modules.length), [modules.length]);

  return (
    <Canvas camera={{ position: OVERVIEW_POSITION, fov: 45 }}>
      {/* Minimal lighting: the bomb must read as a lit physical object
          (DESIGN.md depth tier 1). */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 5]} intensity={1.2} />

      {/* Chassis body — --color-bakelite #C2491F (DESIGN.md "primary chassis";
          Flow 1: "Bakelite orange, brass screws") */}
      <mesh>
        <boxGeometry args={CHASSIS_SIZE} />
        <meshStandardMaterial color="#C2491F" />
      </mesh>

      {/* Shadowed end ribs — --color-bakelite-deep #7A2A10 (DESIGN.md) */}
      {[RIB_X, -RIB_X].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={RIB_SIZE} />
          <meshStandardMaterial color="#7A2A10" />
        </mesh>
      ))}

      {/* Corner screws — --color-brass #B8924A (DESIGN.md) */}
      {SCREW_POSITIONS.map((position, i) => (
        <mesh key={i} position={position} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.03, 12]} />
          <meshStandardMaterial color="#B8924A" />
        </mesh>
      ))}

      {/* Diegetic BombContext metadata: serial / batteries / indicators / ports */}
      <ChassisFeatures context={context} />

      {/* Diegetic timer LCD on the chassis top band (Story 4.4) */}
      <TimerLcd />

      {/* Strike LED dots beside the timer (Story 4.5) */}
      <StrikeIndicator />

      {slots.map((slot) => (
        <ModuleBay
          key={slot.moduleIndex}
          slot={slot}
          moduleId={modules[slot.moduleIndex]?.moduleId ?? 'placeholder'}
        />
      ))}

      <CameraRig slots={slots} />

      {/* AC-3 verification aid: live FPS/ms panel, opt-in via ?stats (dev only). */}
      {SHOW_STATS && <Stats />}
    </Canvas>
  );
}
