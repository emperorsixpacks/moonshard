export function createMulberry32(seedInput) {
  let a = 0;
  if (typeof seedInput === 'string') {
    for (let i = 0; i < seedInput.length; i++) {
      a = ((a << 5) - a + seedInput.charCodeAt(i)) | 0;
    }
  } else {
    a = seedInput | 0;
  }

  // Mulberry32 32-bit generator
  const next = () => {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    rangeInt: (min, max) => Math.floor(min + next() * (max - min + 1)),
    choice: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }
  };
}

export function getTodaySeedString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Fixed arena layout for every player so leaderboard scores are comparable
 * (no per-day randomization). Survival is still a daily contest by date for
 * scoring/payouts, but the arena itself never changes.
 */
export const CLASSIC_ARENA_SEED = 'moonshard-classic-arena-v1';

export function generateDailySurvivalSpec(seedStr = CLASSIC_ARENA_SEED) {
  const prng = createMulberry32(seedStr);
  
  // Deterministic Arena Platform Layout
  // Virtual dimensions: width 800, height 360
  const platforms = [
    // Main solid ground (spans full arena -20 to 860)
    { x: 420, y: 340, width: 880, height: 40, type: 'ground' },
    
    // Tier 1 platforms
    { x: 180, y: 260, width: 130, height: 16, type: 'ruins' },
    { x: 620, y: 260, width: 130, height: 16, type: 'ruins' },
    
    // Center floating terrace
    { x: 400, y: 200, width: 180, height: 16, type: 'ruins' },
    
    // Tier 2 high perches
    { x: 120, y: 140, width: 100, height: 16, type: 'ruins' },
    { x: 680, y: 140, width: 100, height: 16, type: 'ruins' },
  ];

  // Seeded crate spawns (3-4 breakables per arena)
  const crateCount = prng.rangeInt(3, 5);
  const crateSpots = [
    { x: 150, y: 240 },
    { x: 650, y: 240 },
    { x: 380, y: 180 },
    { x: 420, y: 180 },
    { x: 100, y: 120 },
    { x: 700, y: 120 },
  ];
  const shuffledSpots = prng.shuffle(crateSpots);
  const crates = shuffledSpots.slice(0, crateCount);

  // Deterministic 5-wave escalating schedule
  const waves = [
    {
      waveNumber: 1,
      title: 'Wave 1: Forest Incursion (15 Foes)',
      spawns: [
        // Squad 1: Shell Crawlers (t=0s, 4 foes) - ground floor flanks
        { type: 'snail', x: 80, y: 280, delay: 0 },
        { type: 'snail', x: 720, y: 280, delay: 0 },
        { type: 'snail', x: 140, y: 280, delay: 500 },
        { type: 'snail', x: 660, y: 280, delay: 500 },

        // Squad 2: Tusks & Stingers (t=3.2s, 4 foes)
        { type: 'boar', x: 70, y: 280, delay: 3200 },
        { type: 'boar', x: 730, y: 280, delay: 3200 },
        { type: 'bee', x: 400, y: 160, delay: 3600 },
        { type: 'snail', x: 220, y: 280, delay: 4000 },

        // Squad 3: Spore Snipers & Tusks (t=7.5s, 4 foes)
        { type: 'mushroom', x: 120, y: 280, delay: 7500 },
        { type: 'boar', x: 200, y: 280, delay: 7800 },
        { type: 'boar', x: 600, y: 280, delay: 7800 },
        { type: 'bee', x: 250, y: 160, delay: 8200 },

        // Squad 4: Charging Vanguard (t=12s, 3 foes)
        { type: 'boar', x: 80, y: 280, delay: 12000 },
        { type: 'boar', x: 720, y: 280, delay: 12000 },
        { type: 'mushroom', x: 680, y: 280, delay: 12500 },
      ]
    },
    {
      waveNumber: 2,
      title: 'Wave 2: Airborne Ambush & Goblin Bombers (18 Foes)',
      spawns: [
        // Squad 1 (t=0s, 4 foes)
        { type: 'flying_eye', x: 150, y: 160, delay: 0 },
        { type: 'flying_eye', x: 650, y: 160, delay: 0 },
        { type: 'goblin', x: 180, y: 240, delay: 400 },
        { type: 'boar', x: 100, y: 280, delay: 800 },

        // Squad 2 (t=3.5s, 5 foes)
        { type: 'snail', x: 180, y: 240, delay: 3500 },
        { type: 'snail', x: 620, y: 240, delay: 3500 },
        { type: 'goblin', x: 620, y: 240, delay: 3800 },
        { type: 'bee', x: 300, y: 160, delay: 4200 },
        { type: 'bee', x: 500, y: 160, delay: 4200 },

        // Squad 3 (t=7.5s, 5 foes)
        { type: 'mushroom', x: 400, y: 175, delay: 7500 },
        { type: 'flying_eye', x: 200, y: 160, delay: 7800 },
        { type: 'flying_eye', x: 600, y: 160, delay: 7800 },
        { type: 'boar', x: 80, y: 280, delay: 8200 },
        { type: 'boar', x: 720, y: 280, delay: 8200 },

        // Squad 4 (t=12s, 4 foes)
        { type: 'goblin', x: 400, y: 175, delay: 12000 },
        { type: 'boar', x: 250, y: 280, delay: 12300 },
        { type: 'boar', x: 550, y: 280, delay: 12300 },
        { type: 'flying_eye', x: 400, y: 150, delay: 12600 },
      ]
    },
    {
      waveNumber: 3,
      title: 'Wave 3: Toxic Spores & Artillery (22 Foes)',
      spawns: [
        // Squad 1 (t=0s, 5 foes)
        { type: 'mushroom', x: 180, y: 240, delay: 0 },
        { type: 'mushroom', x: 620, y: 240, delay: 0 },
        { type: 'snail', x: 80, y: 280, delay: 400 },
        { type: 'snail', x: 720, y: 280, delay: 400 },
        { type: 'bee', x: 400, y: 160, delay: 800 },

        // Squad 2 (t=3.5s, 6 foes)
        { type: 'goblin', x: 180, y: 240, delay: 3500 },
        { type: 'goblin', x: 620, y: 240, delay: 3500 },
        { type: 'boar', x: 90, y: 280, delay: 3800 },
        { type: 'boar', x: 710, y: 280, delay: 3800 },
        { type: 'flying_eye', x: 250, y: 160, delay: 4200 },
        { type: 'flying_eye', x: 550, y: 160, delay: 4200 },

        // Squad 3 (t=7.5s, 6 foes)
        { type: 'mushroom', x: 400, y: 175, delay: 7500 },
        { type: 'snail', x: 180, y: 240, delay: 7800 },
        { type: 'snail', x: 620, y: 240, delay: 7800 },
        { type: 'boar', x: 100, y: 280, delay: 8100 },
        { type: 'boar', x: 700, y: 280, delay: 8100 },
        { type: 'bee', x: 400, y: 160, delay: 8400 },

        // Squad 4 (t=12s, 5 foes)
        { type: 'goblin', x: 180, y: 240, delay: 12000 },
        { type: 'goblin', x: 620, y: 240, delay: 12000 },
        { type: 'flying_eye', x: 300, y: 160, delay: 12400 },
        { type: 'flying_eye', x: 500, y: 160, delay: 12400 },
        { type: 'boar', x: 400, y: 175, delay: 12800 },
      ]
    },
    {
      waveNumber: 4,
      title: 'Wave 4: The Frenzied Stampede (25 Foes)',
      spawns: [
        // Squad 1 (t=0s, 6 foes)
        { type: 'boar', x: 70, y: 280, delay: 0 },
        { type: 'boar', x: 730, y: 280, delay: 0 },
        { type: 'snail', x: 200, y: 280, delay: 400 },
        { type: 'snail', x: 600, y: 280, delay: 400 },
        { type: 'bee', x: 150, y: 160, delay: 800 },
        { type: 'bee', x: 650, y: 160, delay: 800 },

        // Squad 2 (t=3.2s, 7 foes)
        { type: 'flying_eye', x: 200, y: 160, delay: 3200 },
        { type: 'flying_eye', x: 600, y: 160, delay: 3200 },
        { type: 'mushroom', x: 180, y: 240, delay: 3500 },
        { type: 'mushroom', x: 620, y: 240, delay: 3500 },
        { type: 'boar', x: 100, y: 280, delay: 3800 },
        { type: 'boar', x: 700, y: 280, delay: 3800 },
        { type: 'snail', x: 400, y: 175, delay: 4200 },

        // Squad 3 (t=7s, 6 foes)
        { type: 'goblin', x: 180, y: 240, delay: 7000 },
        { type: 'goblin', x: 620, y: 240, delay: 7000 },
        { type: 'boar', x: 80, y: 280, delay: 7400 },
        { type: 'boar', x: 720, y: 280, delay: 7400 },
        { type: 'flying_eye', x: 400, y: 150, delay: 7800 },
        { type: 'bee', x: 300, y: 160, delay: 8100 },

        // Squad 4 (t=11s, 6 foes)
        { type: 'boar', x: 90, y: 280, delay: 11000 },
        { type: 'boar', x: 710, y: 280, delay: 11000 },
        { type: 'snail', x: 180, y: 240, delay: 11400 },
        { type: 'snail', x: 620, y: 240, delay: 11400 },
        { type: 'goblin', x: 400, y: 175, delay: 11800 },
        { type: 'flying_eye', x: 500, y: 160, delay: 12200 },
      ]
    },
    {
      waveNumber: 5,
      title: 'Wave 5: The Chieftain\'s Wrath (BOSS SHOWDOWN)',
      spawns: [
        // Squad 1: Boss & Vanguard (t=0s, 1 Boss + 4 minions)
        { type: 'boss_gorgok', x: 620, y: 270, delay: 0 },
        { type: 'boar', x: 100, y: 280, delay: 0 },
        { type: 'snail', x: 180, y: 240, delay: 500 },
        { type: 'snail', x: 620, y: 240, delay: 500 },
        { type: 'bee', x: 400, y: 160, delay: 900 },

        // Squad 2 (t=4s, 4 minions)
        { type: 'mushroom', x: 180, y: 240, delay: 4000 },
        { type: 'goblin', x: 620, y: 240, delay: 4000 },
        { type: 'flying_eye', x: 250, y: 160, delay: 4500 },
        { type: 'flying_eye', x: 550, y: 160, delay: 4500 },

        // Squad 3 (t=8.5s, 4 minions)
        { type: 'boar', x: 80, y: 280, delay: 8500 },
        { type: 'boar', x: 720, y: 280, delay: 8500 },
        { type: 'snail', x: 400, y: 175, delay: 8900 },
        { type: 'bee', x: 350, y: 160, delay: 9300 },

        // Squad 4 (t=13s, 4 minions)
        { type: 'goblin', x: 180, y: 240, delay: 13000 },
        { type: 'mushroom', x: 400, y: 175, delay: 13000 },
        { type: 'flying_eye', x: 200, y: 160, delay: 13400 },
        { type: 'flying_eye', x: 600, y: 160, delay: 13400 },
      ]
    }
  ];

  return {
    seedStr,
    platforms,
    crates,
    waves
  };
}
