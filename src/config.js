export const GAME_CONFIG = {
  WIDTH: 480,
  HEIGHT: 270,
  PORTRAIT_HEIGHT: 440,
  BASE_WIDTH: 480,
  BASE_HEIGHT: 270,
  GRAVITY: 650,
  
  PLAYER: {
    MAX_HEALTH: 100,
    RUN_SPEED: 155,
    JUMP_FORCE: -310,
    DOUBLE_JUMP_FORCE: -270,
    WALL_SLIDE_SPEED: 48,
    WALL_JUMP_X: 180,
    WALL_JUMP_Y: -260,
    COMBO_WINDOW_MS: 380,
    INVULNERABILITY_MS: 1200,
    UPWARD_SLASH_BONUS: 1.5,
  },

  MOBS: {
    BOAR: {
      HP: 60,
      WALK_SPEED: 50,
      CHARGE_SPEED: 210,
      PTS: 50,
      DAMAGE: 20,
      BACKSTAB_MULTIPLIER: 3.0,
      COUNTER_MULTIPLIER: 3.0,
      AGGRO_RANGE: 260,
      CHARGE_RANGE: 150,
    },
    SNAIL: {
      HP: 30,
      WALK_SPEED: 25,
      SHELL_SPEED: 240,
      PTS: 25,
      RICOCHET_BONUS_PTS: 50,
      DAMAGE: 20,
    },
    BEE: {
      HP: 20,
      HOVER_SPEED: 55,
      SWOOP_SPEED: 165,
      PTS: 35,
      DAMAGE: 15,
      SWOOP_RANGE: 320,
    },
    MUSHROOM: {
      HP: 45,
      WALK_SPEED: 35,
      SPORE_SPEED: 180,
      PTS: 45,
      DAMAGE: 15,
    },
    FLYING_EYE: {
      HP: 35,
      HOVER_SPEED: 60,
      DIVE_SPEED: 140,
      PTS: 40,
      DAMAGE: 15,
    },
    GOBLIN: {
      HP: 40,
      WALK_SPEED: 70,
      BOMB_SPEED: 130,
      PTS: 45,
      DAMAGE: 20,
    },
    BOG_LURKER: {
      HP: 55,
      WALK_SPEED: 35,
      PTS: 60,
      DAMAGE: 16,
      SPIT_SPEED: 160,
    },
    DREAD_BAT: {
      HP: 40,
      FLY_SPEED: 80,
      DIVE_SPEED: 230,
      PTS: 55,
      DAMAGE: 16,
    },
    CRYPT_WRAITH: {
      HP: 60,
      FLOAT_SPEED: 50,
      PTS: 70,
      DAMAGE: 20,
      SHRIEK_RADIUS: 90,
    },
    BASALT_GOLEM: {
      HP: 90,
      WALK_SPEED: 32,
      PTS: 85,
      DAMAGE: 26,
    },
    VOID_STALKER: {
      HP: 65,
      RUN_SPEED: 115,
      POUNCE_SPEED: 230,
      PTS: 80,
      DAMAGE: 22,
    },
    MIRELURKER: {
      HP: 55,
      WALK_SPEED: 45,
      LEAP_SPEED: 210,
      PTS: 60,
      DAMAGE: 18,
      SPIT_SPEED: 170,
    },
    HORNET_GUARD: {
      HP: 45,
      HOVER_SPEED: 65,
      DRILL_SPEED: 240,
      PTS: 55,
      DAMAGE: 18,
      STINGER_SPEED: 190,
    },
    SKELETON_WARRIOR: {
      HP: 65,
      WALK_SPEED: 45,
      PTS: 70,
      DAMAGE: 22,
    },
    CINDER_DRAKE: {
      HP: 50,
      FLY_SPEED: 70,
      DIVE_SPEED: 220,
      PTS: 65,
      DAMAGE: 20,
      MAGMA_SPEED: 160,
    },
    ASTRAL_SHADE: {
      HP: 55,
      FLOAT_SPEED: 60,
      PTS: 75,
      DAMAGE: 22,
      CRESCENT_SPEED: 180,
    },
    BOSS_GORGOK: {
      HP: 240,
      NAME: 'GORGOK, FOREST CHIEFTAIN',
      WALK_SPEED: 55,
      CHARGE_SPEED: 220,
      PTS: 500,
      DAMAGE: 30,
    },
    BOSS_WIZARD: {
      HP: 300,
      NAME: 'MALAKOR, CORRUPTED ARCHMAGE',
      PTS: 750,
      DAMAGE: 30,
    },
    BOSS_SKELETON: {
      HP: 360,
      NAME: 'VORGATH, THE BONE SOVEREIGN',
      WALK_SPEED: 50,
      PTS: 1000,
      DAMAGE: 25,
    },
    BOSS_DEMON: {
      HP: 440,
      NAME: 'IGNIS, THE CINDER DRAKE',
      FLY_SPEED: 75,
      PTS: 1250,
      DAMAGE: 25,
    },
    BOSS_NIGHTBORNE: {
      HP: 520,
      NAME: 'UMBRA, SOVEREIGN OF THE SHATTERED MOON',
      RUN_SPEED: 110,
      PTS: 1500,
      DAMAGE: 30,
    }
  },

  WEAPONS: {
    STARTER: {
      id: 'iron_starter',
      name: 'Rusted Shortsword',
      tier: 'Standard',
      damageMul: 1.0,
      rangeMul: 1.0,
      effect: 'none',
      crafted: true
    },
    IRON_BROADSWORD: {
      id: 'iron_broadsword',
      name: 'Iron Broadsword',
      tier: 'Tier 1 (Crafted)',
      damageMul: 1.25,
      rangeMul: 1.15,
      effect: 'iron_slash',
      cost: { bark: 10, iron: 5, amber: 0 }
    },
    FOREST_GLAIVE: {
      id: 'forest_glaive',
      name: 'Forest Glaive',
      tier: 'Tier 2 (Crafted)',
      damageMul: 1.5,
      rangeMul: 1.35,
      effect: 'leaf_glaive',
      cost: { bark: 15, iron: 8, amber: 10 }
    },
    GOLDEN_ALBATROSS: {
      id: 'golden_albatross',
      name: 'Golden Solar Blade',
      tier: 'Celestial Blade',
      damageMul: 1.5, // Fair Non-P2W: identical combat power
      rangeMul: 1.35,
      effect: 'golden_spark',
      cost: { amber: 8, iron: 6 },
      cosmeticDescription: 'Forged from radiant solar amber. Golden sword trails & sparkling embers.'
    },
    CORRUPTED_VOID: {
      id: 'corrupted_void',
      name: 'Corrupted Void Edge',
      tier: 'Celestial Blade',
      damageMul: 1.5, // Fair Non-P2W: identical combat power
      rangeMul: 1.35,
      effect: 'void_smoke',
      cost: { amber: 10, iron: 8 },
      cosmeticDescription: 'Infused with ancient twilight essence. Deep obsidian blade with purple shadow trails.'
    },
    SKIN_FLAME: {
      id: 'skin_flame',
      name: 'Crimson Flame Katana',
      tier: 'Cosmetic Skin',
      isSkin: true,
      iconKey: 'sword_flame',
      damageMul: 1.0, // Pure cosmetic skin: no damage increase
      rangeMul: 1.0,
      effect: 'crimson_flame',
      slashColor: 0xff4411,
      slashAccent: 0xffaa00,
      cost: { iron: 10, bark: 6, amber: 4 },
      cosmeticDescription: 'Forged from volcanic caldera rubies. Blazing flame slash arc & rising ember trails.'
    },
    SKIN_FROST: {
      id: 'skin_frost',
      name: 'Frostmoon Crystal Saber',
      tier: 'Cosmetic Skin',
      isSkin: true,
      iconKey: 'sword_frost',
      damageMul: 1.0, // Pure cosmetic skin: no damage increase
      rangeMul: 1.0,
      effect: 'frost_moon',
      slashColor: 0x38e1ff,
      slashAccent: 0xe0f7fa,
      cost: { amber: 8, bark: 8, iron: 4 },
      cosmeticDescription: 'Carved from glacial lunar ice. Prismatic icy slash arc & sub-zero snowflake sparkles.'
    },
    SKIN_VERDANT: {
      id: 'skin_verdant',
      name: 'Verdant Jade Rapier',
      tier: 'Cosmetic Skin',
      isSkin: true,
      iconKey: 'sword_verdant',
      damageMul: 1.0, // Pure cosmetic skin: no damage increase
      rangeMul: 1.0,
      effect: 'verdant_bloom',
      slashColor: 0x44ff88,
      slashAccent: 0xa8ffb2,
      cost: { bark: 12, amber: 6, iron: 2 },
      cosmeticDescription: 'Infused with ancient forest flora. Glowing emerald slash arc & floating blossom petals.'
    }
  },

  PERKS: [
    { id: 'magnet', name: 'Gem Magnet', desc: '+15% Material Magnet Radius' },
    { id: 'haste', name: 'Sylva Breeze', desc: '+5% Sprint Movement Speed' },
    { id: 'luck', name: 'Amber Glow', desc: '+10% Higher Chance for Crate Amber' },
    { id: 'fortitude', name: 'Bark Shield', desc: '+0.5s Longer Invulnerability After Hit' }
  ],

  CHAPTERS: [
    {
      id: 1,
      title: 'Whispering Woods',
      biome: 'Lake & Forest',
      description: 'Lush greenery and lake shores overrun by wild boars and snails. Cleanse the first guardian obelisk.',
      targetObelisks: 1,
      bgTint: 0xffffff
    },
    {
      id: 2,
      title: 'The Hive Canopy',
      biome: 'Autumn Trees & Hive',
      description: 'Vertical ascents up ancient golden boughs swarming with aerial bees. Destroy honeycomb traps.',
      targetObelisks: 1,
      bgTint: 0xffe8aa
    },
    {
      id: 3,
      title: 'The Sunken Ruins',
      biome: 'Crypt of the Ancients',
      description: 'Forgotten crypts buried in moss and bone. Face Vorgath the Bone Sovereign and cleanse the Shrine.',
      targetObelisks: 1,
      bgTint: 0x99aacc
    },
    {
      id: 4,
      title: 'Obsidian Caldera',
      biome: 'Volcanic Deep & Lava Chambers',
      description: 'Scorching caverns flanked by bubbling magma and collapsing rock. Confront Ignis the Cinder Drake.',
      targetObelisks: 1,
      bgTint: 0xff6633
    },
    {
      id: 5,
      title: 'The Lunar Spire',
      biome: 'Shattered Moon Core & Cosmic Void',
      description: 'The pinnacle of the heavens where celestial fragments drift. Vanquish Umbra to restore the Moon.',
      targetObelisks: 1,
      bgTint: 0xccaaff
    }
  ],

  SURVIVAL: {
    INITIAL_LIVES: 3,
    PTS_PER_SECOND: 10,
    COMBO_INCREMENT: 0.2,
    MAX_COMBO: 4.0,
    DAILY_PRIZE_POOL: 1000,
    WAVE_FAILSAFE_SECONDS: 45,
    WAVE_CLEAR_BONUS: 100,
    HP_SCALE_PER_WAVE: 0.3,
    ENDLESS_HP_MUL_BASE: 2.4,
    ENDLESS_HP_ADD: 0.4,
  }
};

/**
 * Authoritative base canvas dimensions for Moonshard.
 * All Phaser scenes are designed for a 480x270 coordinate space.
 * Phaser Scale.FIT manages scaling cleanly to any screen aspect ratio.
 */
export function computeAdaptiveSize() {
  return { width: GAME_CONFIG.BASE_WIDTH, height: GAME_CONFIG.BASE_HEIGHT };
}

