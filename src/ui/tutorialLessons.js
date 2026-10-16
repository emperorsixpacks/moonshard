/**
 * The six tutorial lessons: what Sylva says, what the player has to do, and which on-screen buttons to point at.
 *
 * What she says depends on how they play (src/engine/inputMode.js): keys named for a keyboard, buttons for fingers.
 * A word in [brackets] is drawn as a key cap.
 */

export const LESSONS = [
  {
    id: 'run',
    title: 'Running',
    say: {
      keys: 'Welcome, Moonwarden! Hold [A] and [D], or [←] and [→], to run.',
      touch: 'Welcome, Moonwarden! Hold [◀] and [▶] to run.',
    },
    tasks: [['left', 'Run left'], ['right', 'Run right']],
    buttons: ['touch-left', 'touch-right'],
  },
  {
    id: 'jump',
    title: 'Jump and double jump',
    say: {
      keys: 'Press [Space] to leap. Press it again in mid-air for a double jump!',
      touch: 'Tap [JUMP] to leap. Tap it again in mid-air for a double jump!',
    },
    tasks: [['jump', 'Jump'], ['double', 'Double jump']],
    buttons: ['touch-jump'],
  },
  {
    id: 'slash',
    title: 'Sword slash',
    say: {
      keys: 'Draw the Moonshard! Press [E] to slash and shatter the practice crate.',
      touch: 'Draw the Moonshard! Tap [SLASH] to strike and shatter the practice crate.',
    },
    tasks: [['crate', 'Shatter the crate']],
    buttons: ['touch-attack'],
  },
  {
    id: 'up',
    title: 'Upward strike',
    say: {
      keys: 'A corrupted bee swoops from above! Hold [W] and press [E] to strike it out of the air.',
      touch: 'A corrupted bee swoops from above! Tap [UP ATTK] to strike it out of the air.',
    },
    tasks: [['bee', 'Strike the bee']],
    buttons: ['touch-upslash'],
  },
  {
    id: 'stomp',
    title: 'Stomp bounce',
    say: {
      keys: 'Jump high above armoured foes and fall onto them to stomp-bounce safely!',
      touch: 'Jump high above armoured foes and fall onto them to stomp-bounce safely!',
    },
    tasks: [['stomp', 'Stomp the shell']],
    buttons: ['touch-jump'],
  },
  {
    id: 'spar',
    title: 'Sparring',
    say: {
      keys: 'Splendid! Combine all your moves to defeat this training dummy!',
      touch: 'Splendid! Combine all your moves to defeat this training dummy!',
    },
    tasks: [['dummy', 'Defeat the dummy']],
    buttons: [],
  },
];

/** What Sylva says in lesson `index` (0-based) for the way the player is playing. */
export const lessonSay = (index, mode) => {
  const lesson = LESSONS[index];
  return lesson ? (lesson.say[mode] ?? lesson.say.keys) : '';
};
