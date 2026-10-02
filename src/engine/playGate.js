import Phaser from 'phaser';
import { gdService } from './GdService.js';
import { GATED_SCENES, blocksStart, canPlay, gateLabel, resumesAfterScan } from './playGateRules.js';
import { takeGate } from './gateMemory.js';

/**
 * Wires the verified-human gate (playGateRules.js) into the game: every way of starting play goes through the scene
 * plugin's `start` or `restart` ("play again", the next chapter, the pause menu's restart), so two wrappers cover the
 * menu, the chapter picker, the leaderboard's "play" button and the story's own transitions. A blocked start opens the
 * wallet panel in gate mode instead; once the player is a verified human the panel offers "PLAY", which carries out the
 * start that was asked for.
 *
 * This is the experience of the rule, not its enforcement: the server only ranks and pays verified humans anyway.
 */

/** Development tooling (smoke tests) starts scenes without a wallet. Not available in a production build. */
const devBypass = () => Boolean(import.meta.env?.DEV && globalThis.__MS_GATE_OFF);

const openGate = (request) => globalThis.window?.__gdPanel?.openGate(request);

/** Whether starting `sceneKey` right now would be stopped by the gate (a screen that fades out first checks this). */
export const startIsBlocked = (sceneKey) => blocksStart(sceneKey, gdService.getStatus(), { bypass: devBypass() });

/** What a scene start does: the other scenes stop, the target starts. Used later, once the player has passed the gate. */
const goTo = (manager, key, data) => {
  for (const scene of manager.getScenes(true)) if (scene.scene.key !== key) manager.stop(scene.scene.key);
  manager.start(key, data);
};

/** Keep who-the-player-is fresh for the next gate decision: verification can lapse between runs. */
const keepStatusFresh = (sceneKey) => {
  if (GATED_SCENES.has(sceneKey)) gdService.refreshAll().catch(() => {});
};

/** The start was stopped: the screen may already have faded out on its way to the mode, so bring it back, the player stays here. */
const stopAtGate = (plugin, sceneKey, data) => {
  plugin.systems?.cameras?.main?.resetFX?.();
  openGate({ key: sceneKey, data, label: gateLabel(sceneKey), launch: () => goTo(plugin.manager, sceneKey, data) });
  return plugin;
};

export function installPlayGate() {
  const proto = Phaser.Scenes.ScenePlugin.prototype;
  if (proto.__playGate) return;
  proto.__playGate = true;
  const start = proto.start;
  proto.start = function gatedStart(key, data) {
    const target = key === undefined ? this.key : key;
    if (!startIsBlocked(target)) {
      const started = start.call(this, key, data);
      keepStatusFresh(target);
      return started;
    }
    // a deep link (?scene=...) arrives from the boot screen: show the menu behind the gate rather than a blank screen
    if (this.key === 'BootScene') start.call(this, 'MenuScene');
    return stopAtGate(this, target, data);
  };

  // "Play again", the next chapter and the pause menu's restart start the same scene over without going through `start`;
  // the player's verification may have lapsed since they first got in
  const restart = proto.restart;
  proto.restart = function gatedRestart(data) {
    if (!startIsBlocked(this.key)) {
      const restarted = restart.call(this, data);
      keepStatusFresh(this.key);
      return restarted;
    }
    return stopAtGate(this, this.key, data);
  };
}

/**
 * Coming back from GoodDollar's face scan the page has reloaded: if the player had asked to play something and is now
 * a verified human, offer that mode again: a single "PLAY" tap, or the blade step first if they have no blade yet.
 */
export async function resumeRememberedGate() {
  await gdService.ready;
  const wanted = takeGate(globalThis.sessionStorage);
  if (!wanted || !resumesAfterScan(gdService.getStatus())) return;
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
