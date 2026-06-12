import { memo, useEffect, useMemo, useRef } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { useGameStore } from '../store/gameStore.js';
import { useUiStore } from '../store/uiStore.js';
import {
  CHASSIS_SIZE,
  DEFAULT_PLACEHOLDER_COUNT,
  computeModuleLayout,
  type ModuleSlot,
} from './layout.js';
import { ChassisFeatures } from './ChassisFeatures.js';
import { DEV_BOMB_CONTEXT } from './devBombContext.js';

/**
 * Bomb scene: bakelite chassis with diegetic BombContext metadata (Story 4.2)
 * + clickable module faceplates + the orbit/zoom/focus camera rig (Story 4.1).
 * Rendering only — zero game logic (R3F components are dumb renderers).
 * Registry-driven module layout + solve LEDs land in 4.3.
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
/** Clicks that travelled further than this (px) are drag-orbits, not clicks. */
const CLICK_DRAG_TOLERANCE_PX = 4;

/** Accessibility Floor: reduced-motion users get instant camera transitions. */
const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
};

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

/** Memoized: module slots re-render on every store broadcast otherwise. */
const ModulePlaceholder = memo(function ModulePlaceholder({ slot }: { slot: ModuleSlot }) {
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.button !== 0) return; // AC1: right/middle-click reserved
    if (event.delta > CLICK_DRAG_TOLERANCE_PX) return; // drag-orbit release ≠ click
    event.stopPropagation();
    useUiStore.getState().setActiveModuleIndex(slot.moduleIndex);
  };
  const [x, y, z] = slot.position;
  const nz = slot.normal[2];
  return (
    // Faceplate sits proud of the chassis face by half its thickness.
    <mesh position={[x, y, z + nz * 0.04]} onClick={onClick}>
      <boxGeometry args={[0.8, 0.55, 0.08]} />
      {/* --color-graphite #1A1A1F (DESIGN.md) — modules read as dark bays against
          the bakelite chassis (raw hex; CSS vars can't reach WebGL materials).
          Bay framing/screws/solve LEDs are Story 4.3. */}
      <meshStandardMaterial color="#1A1A1F" />
    </mesh>
  );
});

export default function BombScene() {
  // Reactive (non-per-frame) reads: layout and metadata follow the bomb
  // snapshot when one exists, else the dev-harness placeholders.
  const moduleCount = useGameStore((s) => s.bomb?.modules.length ?? DEFAULT_PLACEHOLDER_COUNT);
  const context = useGameStore((s) => s.bomb?.context) ?? DEV_BOMB_CONTEXT;
  const slots = useMemo(() => computeModuleLayout(moduleCount), [moduleCount]);

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

      {slots.map((slot) => (
        <ModulePlaceholder key={slot.moduleIndex} slot={slot} />
      ))}

      <CameraRig slots={slots} />
    </Canvas>
  );
}
