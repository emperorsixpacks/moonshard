// Floating in-world labels (the bee's "SWOOP!", crate drops, "DEFLECT!") stay readable on a phone held upright, where a game
// unit is only ~0.8 CSS pixels, and are left alone where a unit is already large (desktop).
//   node test/client/browser/labels.mjs        (run from the repository root)
import { bootGame } from './lib.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

/** Makes a bee in the live endless-mode scene, lets it telegraph a swoop, and reads the label it drew. */
async function swoopLabel(viewport) {
  const g = await bootGame({ viewport });
  try {
    await g.goto();
    await g.startScene('SurvivalScene');
    const label = await g.page.evaluate(async () => {
      const scene = window.game.scene.getScene('SurvivalScene');
      const { default: Bee } = await import('/src/entities/Bee.js');
      const bee = new Bee(scene, 200, 100);
      bee.startSwoop({ x: 210, y: 180, isDead: false });
      const text = scene.children.list.find((o) => o.type === 'Text' && o.text === 'SWOOP!');
      const out = text && {
        px: parseFloat(text.style.fontSize),
        family: text.style.fontFamily,
        cssPerUnit: scene.scale.displaySize.width / scene.scale.gameSize.width,
      };
      bee.destroy();
      return out;
    });
    return { label, errors: g.errors };
  } finally { await g.close(); }
}

log('▶ the bee\'s swoop warning');
const desktop = await swoopLabel({ width: 1000, height: 600 });
check(Boolean(desktop.label), 'desktop: the warning is drawn');
check(desktop.label && desktop.label.px === 7, `desktop: left at its design size (${desktop.label?.px} units, ${(desktop.label?.px * desktop.label?.cssPerUnit).toFixed(1)} CSS px)`);
check(desktop.errors.length === 0, `desktop: no browser errors ${desktop.errors.join(' | ')}`);

const phone = await swoopLabel({ width: 390, height: 844 });
check(Boolean(phone.label), 'upright phone: the warning is drawn');
const css = phone.label ? phone.label.px * phone.label.cssPerUnit : 0;
check(css >= 8.5, `upright phone: at least 8.5 CSS px on screen (${phone.label?.px.toFixed(1)} units, ${css.toFixed(1)} CSS px)`);
check(phone.label && phone.label.px <= 14, 'upright phone: and no more than twice its design size');
check(phone.errors.length === 0, `upright phone: no browser errors ${phone.errors.join(' | ')}`);

if (failures.length) {
  console.log(`\n❌ labels check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ labels check passed');
