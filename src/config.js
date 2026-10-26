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
      cost: { bark: 15, iron: 8, amber: 10 },
      bane: { realm: 'woods', mul: 1.3 }
    },
    // Past the Glaive a blade needs a level reached in Endless (`minLevel`, the server's best-level count), forest materials earned
    // there, and a G$ fee (server/config.js GAME.SHOP). Foes get tougher level by level (SURVIVAL.LEVELS); these keep pace. Each of
    // them, and the Glaive for the woods, is forged for one realm: against the beasts that live there (engine/levels.js BEASTS
    // `home`) it hits `bane.mul` times harder still.
    MOONSTEEL_BLADE: {
      id: 'moonsteel_blade',
      name: 'Moonsteel Blade',
      tier: 'Tier 3 (Crafted)',
      damageMul: 1.8,
      rangeMul: 1.45,
      effect: 'moon_shimmer',
      cost: { bark: 20, iron: 12, amber: 12 },
      requires: 'forest_glaive',
      minLevel: 8,
      bane: { realm: 'hive', mul: 1.3 }
    },
    STARFORGED_EDGE: {
      id: 'starforged_edge',
      name: 'Starforged Edge',
      tier: 'Tier 4 (Crafted)',
      damageMul: 2.2,
      rangeMul: 1.55,
      effect: 'star_embers',
      cost: { bark: 30, iron: 18, amber: 18 },
      requires: 'moonsteel_blade',
      minLevel: 15,
      bane: { realm: 'ruins', mul: 1.3 }
    },
    CINDERBRAND: {
      id: 'cinderbrand',
      name: 'Cinderbrand',
      tier: 'Tier 5 (Crafted)',
      damageMul: 2.45,
      rangeMul: 1.6,
      effect: 'cinder_embers',
      cost: { bark: 35, iron: 22, amber: 22 },
      requires: 'starforged_edge',
      minLevel: 20,
      bane: { realm: 'caldera', mul: 1.3 }
    },
    VOIDGLASS_REAVER: {
      id: 'voidglass_reaver',
      name: 'Voidglass Reaver',
      tier: 'Tier 6 (Crafted)',
      damageMul: 2.7,
      rangeMul: 1.65,
      effect: 'void_shards',
      cost: { bark: 40, iron: 26, amber: 26 },
      requires: 'cinderbrand',
      minLevel: 25,
      bane: { realm: 'spire', mul: 1.3 }
    },
    GOLDEN_ALBATROSS: {
      id: 'golden_albatross',
      name: 'Golden Solar Blade',
      tier: 'Celestial Blade',
      damageMul: 1.5, // Fair Non-P2W: identical combat power
      rangeMul: 1.35,
      bane: { realm: 'woods', mul: 1.3 }, // the Glaive's, so a look never trades power for style
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
      bane: { realm: 'woods', mul: 1.3 },
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

  /*
   * Armour, two slots. Every piece is forged the way the blades past the Glaive are: forest materials earned in play, a G$ fee
   * (server/config.js GAME.SHOP) and, from the second tier of each slot, an Endless level reached (`minLevel`): G$ alone buys no
   * piece. A helmet turns aside blows from foes that come at the hero (`contact`); a shield turns aside what they throw (`ranged`:
   * spores, spit, stingers, magma, bombs, moonlight). `cut` is the share of that damage taken off (0.14 is 14%); a hit still costs
   * at least 1. Each tier is the realm's own, and asks for the level its blade does. The materials, fees and cuts are placeholders
   * the owner has not confirmed, and no person has played them.
   */
  ARMOUR: {
    LEATHER_CAP: {
      id: 'leather_cap', name: 'Leather Cap', slot: 'helm', realm: 'woods', tier: 'Tier 1', cut: 0.08,
      cost: { bark: 8, amber: 0, iron: 3 }
    },
    CHITIN_HELM: {
      id: 'chitin_helm', name: 'Chitin Helm', slot: 'helm', realm: 'hive', tier: 'Tier 2', cut: 0.14,
      cost: { bark: 12, amber: 6, iron: 6 }, requires: 'leather_cap', minLevel: 8
    },
    WARDENS_HELM: {
      id: 'wardens_helm', name: "Warden's Helm", slot: 'helm', realm: 'ruins', tier: 'Tier 3', cut: 0.2,
      cost: { bark: 18, amber: 10, iron: 10 }, requires: 'chitin_helm', minLevel: 15
    },
    CINDER_HELM: {
      id: 'cinder_helm', name: 'Cinder Helm', slot: 'helm', realm: 'caldera', tier: 'Tier 4', cut: 0.26,
      cost: { bark: 24, amber: 14, iron: 14 }, requires: 'wardens_helm', minLevel: 20
    },
    MOONBORN_CROWN: {
      id: 'moonborn_crown', name: 'Moonborn Crown', slot: 'helm', realm: 'spire', tier: 'Tier 5', cut: 0.32,
      cost: { bark: 30, amber: 18, iron: 18 }, requires: 'cinder_helm', minLevel: 25
    },
    OAK_BUCKLER: {
      id: 'oak_buckler', name: 'Oak Buckler', slot: 'shield', realm: 'woods', tier: 'Tier 1', cut: 0.12,
      cost: { bark: 10, amber: 2, iron: 2 }
    },
    HONEYCOMB_SHIELD: {
      id: 'honeycomb_shield', name: 'Honeycomb Shield', slot: 'shield', realm: 'hive', tier: 'Tier 2', cut: 0.22,
      cost: { bark: 12, amber: 8, iron: 4 }, requires: 'oak_buckler', minLevel: 8
    },
    BONE_BULWARK: {
      id: 'bone_bulwark', name: 'Bone Bulwark', slot: 'shield', realm: 'ruins', tier: 'Tier 3', cut: 0.32,
      cost: { bark: 18, amber: 10, iron: 10 }, requires: 'honeycomb_shield', minLevel: 15
    },
    OBSIDIAN_AEGIS: {
      id: 'obsidian_aegis', name: 'Obsidian Aegis', slot: 'shield', realm: 'caldera', tier: 'Tier 4', cut: 0.42,
      cost: { bark: 24, amber: 14, iron: 14 }, requires: 'bone_bulwark', minLevel: 20
    },
    LUNAR_BASTION: {
      id: 'lunar_bastion', name: 'Lunar Bastion', slot: 'shield', realm: 'spire', tier: 'Tier 5', cut: 0.52,
      cost: { bark: 30, amber: 18, iron: 18 }, requires: 'obsidian_aegis', minLevel: 25
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
    // Endless is a ladder of numbered levels (engine/levels.js). The first five are the hand-built waves (engine/PRNG.js), which
    // keep HP_SCALE_PER_WAVE and WAVE_CLEAR_BONUS above; every level after them is built from these. server/config.js
    // SCORE_MODEL copies the numbers its score ceiling needs, and server/test/runs.plausibility.test.js fails if these outgrow it.
    LEVELS: {
      SCRIPTED: 5,
      BOSS_EVERY: 5,
      SCRIPTED_CONCURRENT: [2, 3, 3, 4, 4], // foes in the arena at once in each hand-built wave
      MAX_CONCURRENT: 4, // and in every level after them; the arena never holds more (the score ceiling counts on it)
      HP_STEP: 0.1, // foe HP grows this much a level after the scripted ones, up to HP_CAP times the base
      HP_CAP: 6,
      // What a walker's speed would grow by a level, up to SPEED_CAP times. Planned, not applied: the scene scales a `walkSpeed`
      // that no beast of the arena has (their speeds are constants in their own classes), so foes move at their own pace at every level.
      SPEED_STEP: 0.05,
      SPEED_CAP: 1.4,
      FOES_BASE: 20, // foes in the first built level (the sixth); one more every FOES_EVERY levels, up to FOES_CAP
      FOES_EVERY: 2,
      FOES_CAP: 34,
      // Clearing a level pays WAVE_CLEAR_BONUS + CLEAR_STEP a level (up to CLEAR_STEPS_MAX steps), plus a speed bonus for beating the
      // level's par time: the scripted waves' par is 30 s + 10 s a wave, a built level's is PAR_SEC_PER_FOE a foe up to PAR_CAP_SEC.
      CLEAR_STEP: 50,
      CLEAR_STEPS_MAX: 10,
      SCRIPTED_PAR_SEC: 30,
      SCRIPTED_PAR_STEP_SEC: 10,
      SCRIPTED_SPEED_PTS_PER_SEC: 20,
      ELITE_SHARE_PER_LAP: 0.2, // coming round to a realm again, this much more of its foes are the tough beasts of the deeper realms...
      ELITE_SHARE_MAX: 0.3, // ...up to this share
      PAR_SEC_PER_FOE: 2.4,
      PAR_CAP_SEC: 80,
      SPEED_PTS_PER_SEC: 10,
      MIN_SPEED_BONUS: 25, // paid when the par time was missed
    },
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

