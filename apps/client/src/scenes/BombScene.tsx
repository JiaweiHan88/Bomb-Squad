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

/**
 * Story 4.1 bomb scene: placeholder chassis + clickable module faceplates +
 * the orbit/zoom/focus camera rig. Rendering only — zero game logic (R3F
 * components are dumb renderers). Real chassis materials land in 4.2,
 * registry-driven module layout + LEDs in 4.3.
 */

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
      {/* --color-bakelite #C2491F (DESIGN.md) — raw hex; CSS vars can't reach WebGL materials */}
      <meshStandardMaterial color="#C2491F" />
    </mesh>
  );
});

export default function BombScene() {
  // Reactive (non-per-frame) read: layout follows the bomb snapshot when one
  // exists, else the dev-harness placeholder count.
  const moduleCount = useGameStore((s) => s.bomb?.modules.length ?? DEFAULT_PLACEHOLDER_COUNT);
  const slots = useMemo(() => computeModuleLayout(moduleCount), [moduleCount]);

  return (
    <Canvas camera={{ position: OVERVIEW_POSITION, fov: 45 }}>
      {/* Minimal lighting: the bomb must read as a lit physical object (DESIGN.md
          depth tier 1); materials/look-dev belong to Story 4.2. */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 5]} intensity={1.2} />

      {/* Placeholder chassis — --color-graphite #1A1A1F (DESIGN.md) */}
      <mesh>
        <boxGeometry args={CHASSIS_SIZE} />
        <meshStandardMaterial color="#1A1A1F" />
      </mesh>

      {slots.map((slot) => (
        <ModulePlaceholder key={slot.moduleIndex} slot={slot} />
      ))}

      <CameraRig slots={slots} />
    </Canvas>
  );
}
