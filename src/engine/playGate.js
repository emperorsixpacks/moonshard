import Phaser from 'phaser';
import { gdService } from './GdService.js';
import { GATED_SCENES, blocksStart, canPlay, gateLabel } from './playGateRules.js';
import { takeGate } from './gateMemory.js';

/**
 * Wires the verified-human gate (playGateRules.js) into the game: every way of starting play goes through the scene
 * plugin's `start`, so one wrapper covers the menu, the chapter picker, the leaderboard's "play" button and the
 * story's own transitions. A blocked start opens the wallet panel in gate mode instead; once the player is a
 * verified human the panel offers "PLAY", which carries out the start that was asked for.
 *
 * This is the experience of the rule, not its enforcement: the server only ranks and pays verified humans anyway.
 */

/** Development tooling (smoke tests) starts scenes without a wallet. Not available in a production build. */
const devBypass = () => Boolean(import.meta.env?.DEV && globalThis.__MS_GATE_OFF);

const openGate = (request) => globalThis.window?.__gdPanel?.openGate(request);

/** What a scene start does: the other scenes stop, the target starts. Used later, once the player has passed the gate. */
const goTo = (manager, key, data) => {
  for (const scene of manager.getScenes(true)) if (scene.scene.key !== key) manager.stop(scene.scene.key);
  manager.start(key, data);
};

export function installPlayGate() {
  const proto = Phaser.Scenes.ScenePlugin.prototype;
  if (proto.__playGate) return;
  proto.__playGate = true;
  const start = proto.start;
  proto.start = function gatedStart(key, data) {
    const target = key === undefined ? this.key : key;
    if (!blocksStart(target, gdService.getStatus(), { bypass: devBypass() })) {
      const started = start.call(this, key, data);
      // keep who-the-player-is fresh for the next gate decision (verification can lapse between runs)
      if (GATED_SCENES.has(target)) gdService.refreshAll().catch(() => {});
      return started;
    }
    // a deep link (?scene=...) arrives from the boot screen: show the menu behind the gate rather than a blank screen
    if (this.key === 'BootScene') start.call(this, 'MenuScene');
    openGate({ key: target, data, label: gateLabel(target), launch: () => goTo(this.manager, target, data) });
    return this;
  };
}

/**
 * Coming back from GoodDollar's face scan the page has reloaded: if the player had asked to play something and is now
 * a verified human, offer that mode again with a single "PLAY" tap.
 */
export async function resumeRememberedGate() {
  await gdService.ready;
  const wanted = takeGate(globalThis.sessionStorage);
  if (!wanted || !canPlay(gdService.getStatus())) return;
  openGate({ ...wanted, label: gateLabel(wanted.key), launch: () => goTo(globalThis.window.game.scene, wanted.key, wanted.data) });
}

/**
 * For a screen that wants to ask before it shows a play-only step (e.g. the menu row that opens the chapter picker).
 * Runs `launch` now if the player may play, otherwise opens the gate and runs it after they pass. Returns whether it ran.
 */
export function requirePlay(label, launch) {
  if (devBypass() || canPlay(gdService.getStatus())) {
    launch();
    return true;
  }
  openGate({ label, launch });
  return false;
}
