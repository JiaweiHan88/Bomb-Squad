import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGameStore } from '../store/gameStore.js';
import BombStage from '../scenes/BombStage.js';
import { DEV_BOMB_CONTEXT } from '../scenes/devBombContext.js';
import { SANDBOX_MODULES } from '../modules/index.js';
import { getModuleRenderer } from '../modules/registry.js';
import { dispatchModuleAction, setModuleActionDispatch } from '../modules/dispatch.js';
import { createDevModuleDispatch } from './devDispatch.js';
import { buildSandboxBomb, parseSeed } from './sandbox.js';
import { serverNow } from '../net/serverClock.js';
import { formatTimerDisplay, timerRemainingMs } from '../scenes/timerLcd.js';

/**
 * /dev/sandbox — isolated module development workbench (AC3).
 *
 * One module, generated from a typed-in seed, mounted alone on the real
 * BombStage and driven through the REAL gameStore + dispatch seam with a
 * local reducer backend (devDispatch). Same seed → same instance, visibly.
 *
 * This is a dev tool: chrome is a plain operator-world overlay; keyboard
 * input exists only in the chrome (seed field), never as module interaction
 * (AC4 — no bomb-side keyboard shortcuts).
 */

const DEFAULT_SEED = '1';

export default function SandboxHarness() {
  const [seedInput, setSeedInput] = useState(DEFAULT_SEED);
  const [moduleId, setModuleId] = useState(SANDBOX_MODULES[0]?.id ?? '');
  const [seedError, setSeedError] = useState(false);
  /** Seed of the currently generated instance (inspector echo). */
  const [activeSeed, setActiveSeed] = useState<number | null>(null);
  /** Frozen clock value (seconds) for The Button's timed release — the bare
   *  sandbox has no running timer, so this sets a paused TimerState whose
   *  displayed digits feed the RELEASE action (Story 5.4 Task 6). */
  const [clockInput, setClockInput] = useState('4');

  // Install the local dispatch backend for the lifetime of the sandbox.
  // (Idempotent under StrictMode's mount→unmount→mount.)
  useEffect(() => {
    setModuleActionDispatch(createDevModuleDispatch(SANDBOX_MODULES));
    return () => setModuleActionDispatch(null);
  }, []);

  const generate = (id: string, input: string) => {
    const seed = parseSeed(input);
    const module = SANDBOX_MODULES.find((m) => m.id === id);
    if (seed === null || !module) {
      setSeedError(true);
      return;
    }
    setSeedError(false);
    setActiveSeed(seed);
    useGameStore.getState().setBomb(buildSandboxBomb(module, seed, DEV_BOMB_CONTEXT));
  };

  // Auto-generate on mount so the sandbox is alive immediately.
  useEffect(() => {
    generate(SANDBOX_MODULES[0]?.id ?? '', DEFAULT_SEED);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Freeze the clock at a chosen number of seconds (paused segment) so The
   *  Button's RELEASE reads deterministic, visible digits. */
  const setClock = (input: string) => {
    const seconds = Number(input);
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const now = serverNow();
    useGameStore.getState().setTimer({
      startedAt: now,
      remainingAtStart: Math.round(seconds) * 1000,
      speedMultiplier: 1,
      pausedAt: now, // frozen: timerRemainingMs returns remainingAtStart
    });
  };

  const bomb = useGameStore((s) => s.bomb);
  const timer = useGameStore((s) => s.timer);
  const mod = bomb?.modules[0];
  const Renderer = mod ? getModuleRenderer(mod.moduleId) : null;
  const clockDisplay = timer ? formatTimerDisplay(timerRemainingMs(timer, serverNow())) : '—';

  return (
    <div className="relative h-screen w-screen">
      <BombStage>
        <Canvas camera={{ position: [0, 0, 1.1], fov: 45 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[2, 3, 4]} intensity={1.1} />
          {mod && Renderer ? <Renderer.DefuserView moduleIndex={0} /> : null}
        </Canvas>
      </BombStage>

      {/* Operator-world chrome overlay (dev tool — function over form). */}
      <aside className="absolute left-0 top-0 flex h-full w-80 flex-col gap-4 overflow-y-auto bg-black/80 p-4 font-mono text-sm text-zinc-100">
        <h1 className="text-base font-bold tracking-wide">MODULE SANDBOX</h1>

        <label className="flex flex-col gap-1">
          <span className="text-zinc-400">Module</span>
          <select
            className="rounded border border-zinc-600 bg-zinc-900 px-2 py-1"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
          >
            {SANDBOX_MODULES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-zinc-400">Seed (non-negative integer)</span>
          <input
            className="rounded border border-zinc-600 bg-zinc-900 px-2 py-1"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') generate(moduleId, seedInput);
            }}
          />
          {seedError ? <span className="text-red-400">Enter a non-negative integer.</span> : null}
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-zinc-100 px-3 py-1 font-semibold text-zinc-900 active:translate-y-px"
            onClick={() => generate(moduleId, seedInput)}
          >
            Generate
          </button>
          <button
            type="button"
            className="rounded border border-zinc-500 px-3 py-1 active:translate-y-px"
            onClick={() => dispatchModuleAction(0, { type: 'MODULE_RESET', moduleIndex: 0 })}
          >
            Reset module
          </button>
        </div>

        {/* Clock control — The Button's held release reads the displayed timer
            digits. The bare sandbox has no running clock, so freeze it here. */}
        <label className="flex flex-col gap-1">
          <span className="text-zinc-400">Clock seconds (The Button release)</span>
          <div className="flex gap-2">
            <input
              className="w-20 rounded border border-zinc-600 bg-zinc-900 px-2 py-1"
              value={clockInput}
              onChange={(e) => setClockInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setClock(clockInput);
              }}
            />
            <button
              type="button"
              className="rounded border border-zinc-500 px-3 py-1 active:translate-y-px"
              onClick={() => setClock(clockInput)}
            >
              Set clock
            </button>
          </div>
          <span className="text-zinc-500">
            shows {clockDisplay} → digits [{clockDisplay === '—' ? '' : clockDisplay.replace(/\D/g, '').split('').join(', ')}]
          </span>
        </label>

        {mod ? (
          <dl className="space-y-1 border-t border-zinc-700 pt-3">
            <div className="flex justify-between">
              <dt className="text-zinc-400">seed</dt>
              <dd>{activeSeed ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">status</dt>
              <dd
                className={
                  mod.status === 'solved'
                    ? 'text-green-400'
                    : mod.status === 'struck'
                      ? 'text-red-400'
                      : ''
                }
              >
                {mod.status}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">strikes</dt>
              <dd>{bomb?.strikes}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">bomb.solved</dt>
              <dd>{String(bomb?.solved)}</dd>
            </div>
            <dt className="pt-2 text-zinc-400">module data</dt>
            <dd>
              <pre className="overflow-x-auto rounded bg-zinc-900 p-2 text-xs">
                {JSON.stringify(mod.data, null, 2)}
              </pre>
            </dd>
          </dl>
        ) : null}

        <p className="mt-auto text-xs text-zinc-500">
          Local reducer backend — production dispatch (MODULE_INTERACT) lands in Epic 8
          (resolved in 5.3: no server bomb lifecycle exists yet).
          Same seed regenerates the identical instance.
        </p>
      </aside>
    </div>
  );
}
