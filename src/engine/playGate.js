import Phaser from 'phaser';
import { gdService } from './GdService.js';
import { blocksStart, canPlay, gateLabel } from './playGateRules.js';

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

export function installPlayGate() {
  const proto = Phaser.Scenes.ScenePlugin.prototype;
  if (proto.__playGate) return;
  proto.__playGate = true;
  const start = proto.start;
  proto.start = function gatedStart(key, data) {
    const target = key === undefined ? this.key : key;
    if (!blocksStart(target, gdService.getStatus(), { bypass: devBypass() })) return start.call(this, key, data);
    openGate({ label: gateLabel(target), launch: () => start.call(this, key, data) });
    return this;
  };
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
