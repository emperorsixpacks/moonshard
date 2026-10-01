import Phaser from 'phaser';
import { GAME_CONFIG } from '../config.js';
import { sound } from '../engine/Audio.js';
import { storage } from '../engine/Storage.js';
import { pauseService } from '../engine/PauseService.js';
import confetti from 'canvas-confetti';

export default class ForgeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ForgeScene' });
  }

  create() {
    const w = GAME_CONFIG.WIDTH;
    const h = GAME_CONFIG.HEIGHT;

    pauseService.detachScene();
    sound.playBGM('title');

    if (typeof window !== 'undefined' && window.touchController) {
      window.touchController.hide();
    }

    // Background
    this.add.tileSprite(0, 0, w, h, 'env_bg').setOrigin(0, 0).setTint(0x445544);

    // Header
    this.add.text(w / 2, 18, 'ANCIENT HIGH FOREST FORGE', {
      fontFamily: 'Press Start 2P',
      fontSize: '10px',
      color: '#f6c026'
    }).setOrigin(0.5);

    this.add.text(w / 2, 31, 'Equip Sword Skins & Craft Blades with Forest Materials', {
      fontFamily: 'Press Start 2P',
      fontSize: '5px',
      color: '#a0c4a0'
    }).setOrigin(0.5);

    // Live Materials Bar
    this.matsText = this.add.text(w / 2, 44, '', {
      fontFamily: 'Press Start 2P',
      fontSize: '5.5px',
      color: '#98ff20'
    }).setOrigin(0.5);
    this.updateHeaderBar();

    // Tab Navigation: 'free', 'skins', or 'nim'
    this.currentTab = 'skins'; // Default to sword skins tab to immediately showcase new skins
    this.createTabs(w);

    // Content container
    this.contentContainer = this.add.container(0, 0);

    // Bottom Navigation Bar
    const backBtn = this.add.rectangle(48, h - 16, 72, 20, 0x1a2e1a)
      .setStrokeStyle(1, 0x3d5c3d)
      .setInteractive({ useHandCursor: true });
    this.add.text(48, h - 16, '◄ MENU', {
      fontFamily: 'Press Start 2P',
      fontSize: '6px',
      color: '#fff'
    }).setOrigin(0.5);
    backBtn.on('pointerdown', () => {
      sound.playCoin();
      this.scene.start('MenuScene');
    });

    // Equipped gear preview container at bottom right
    this.createHeroPreview(w, h);

    // Render active tab items
    this.renderTabContent(w, h);
  }

  updateHeaderBar() {
    const mats = storage.getMaterials();
    this.matsText.setText(`🌲Bark: ${mats.bark} | 🍯Amber: ${mats.amber} | ⚙️Iron: ${mats.iron}`);
  }

  createTabs(w) {
    const tabY = 60;
    const tabW = 126;
    const tabH = 18;

    // Tab 1: Standard Blades
    this.tabFree = this.add.rectangle(85, tabY, tabW, tabH, 0x142414)
      .setStrokeStyle(1, 0x4a7d4a)
      .setInteractive({ useHandCursor: true });
    this.txtTabFree = this.add.text(85, tabY, 'STANDARD BLADES', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#8cb38c'
    }).setOrigin(0.5);

    // Tab 2: Sword Skins
    this.tabSkins = this.add.rectangle(240, tabY, tabW, tabH, 0x3a2010)
      .setStrokeStyle(1, 0xff7733)
      .setInteractive({ useHandCursor: true });
    this.txtTabSkins = this.add.text(240, tabY, '⚔️ SWORD SKINS (3)', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#ff9944'
    }).setOrigin(0.5);

    // Tab 3: Celestial Blades & Satchel Pet
    this.tabNim = this.add.rectangle(395, tabY, tabW, tabH, 0x241d0a)
      .setStrokeStyle(1, 0x8a7024)
      .setInteractive({ useHandCursor: true });
    this.txtTabNim = this.add.text(395, tabY, 'CELESTIAL & PET', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#bfa770'
    }).setOrigin(0.5);

    this.tabFree.on('pointerdown', () => {
      this.currentTab = 'free';
      sound.playSlash(1);
      this.refreshTabs();
      this.renderTabContent(w, GAME_CONFIG.HEIGHT);
    });

    this.tabSkins.on('pointerdown', () => {
      this.currentTab = 'skins';
      sound.playSlash(1);
      this.refreshTabs();
      this.renderTabContent(w, GAME_CONFIG.HEIGHT);
    });

    this.tabNim.on('pointerdown', () => {
      this.currentTab = 'nim';
      sound.playSlash(1);
      this.refreshTabs();
      this.renderTabContent(w, GAME_CONFIG.HEIGHT);
    });

    this.refreshTabs();
  }

  refreshTabs() {
    // Tab 1
    const isFree = this.currentTab === 'free';
    this.tabFree.setFillStyle(isFree ? 0x2d522d : 0x142414);
    this.tabFree.setStrokeStyle(1, isFree ? 0x98ff20 : 0x3d5c3d);
    this.txtTabFree.setColor(isFree ? '#ffffff' : '#8cb38c');

    // Tab 2
    const isSkins = this.currentTab === 'skins';
    this.tabSkins.setFillStyle(isSkins ? 0x5a2e10 : 0x241508);
    this.tabSkins.setStrokeStyle(1, isSkins ? 0xff8833 : 0x6a3818);
    this.txtTabSkins.setColor(isSkins ? '#ffffff' : '#ff9944');

    // Tab 3
    const isNim = this.currentTab === 'nim';
    this.tabNim.setFillStyle(isNim ? 0x524214 : 0x241d0a);
    this.tabNim.setStrokeStyle(1, isNim ? 0xe9b213 : 0x66501a);
    this.txtTabNim.setColor(isNim ? '#ffffff' : '#bfa770');
  }

  createHeroPreview(w, h) {
    this.previewContainer = this.add.container(w - 75, h - 18);

    // Small subtle background panel
    const pBg = this.add.rectangle(0, 0, 130, 26, 0x111c14, 0.85)
      .setStrokeStyle(1, 0x2e4e2e);
    this.previewContainer.add(pBg);

    // Hero idle sprite
    this.heroPreview = this.add.sprite(-44, 0, 'char_idle').setScale(0.9);
    this.heroPreview.play('player_idle');
    this.previewContainer.add(this.heroPreview);

    // Equipped weapon icon
    this.previewIcon = this.add.image(-18, 0, 'sword_flame').setDisplaySize(18, 18).setVisible(false);
    this.previewContainer.add(this.previewIcon);

    // Equipped weapon text
    this.previewText = this.add.text(-4, 0, '', {
      fontFamily: 'Press Start 2P',
      fontSize: '4.5px',
      color: '#98ff20'
    }).setOrigin(0, 0.5);
    this.previewContainer.add(this.previewText);

    this.updateHeroPreview();
  }

  updateHeroPreview() {
    const equippedId = storage.getEquippedWeapon();
    const weap = Object.values(GAME_CONFIG.WEAPONS).find(w => w.id === equippedId) || GAME_CONFIG.WEAPONS.STARTER;

    if (weap.iconKey && this.textures.exists(weap.iconKey)) {
      this.previewIcon.setTexture(weap.iconKey).setVisible(true);
      this.previewText.setX(0);
    } else {
      this.previewIcon.setVisible(false);
      this.previewText.setX(-24);
    }

    // Short name if necessary
    const shortName = weap.name.length > 15 ? weap.name.substring(0, 14) + '…' : weap.name;
    this.previewText.setText(shortName);

    if (weap.slashColor) {
      this.heroPreview.setTint(weap.slashAccent || 0xffffff);
    } else {
      this.heroPreview.clearTint();
    }
  }

  renderTabContent(w, h) {
    this.contentContainer.removeAll(true);
    const equipped = storage.getEquippedWeapon();

    if (this.currentTab === 'skins') {
      // DEDICATED COSMETIC SWORD SKINS TAB
      const skins = [
        GAME_CONFIG.WEAPONS.SKIN_FLAME,
        GAME_CONFIG.WEAPONS.SKIN_FROST,
        GAME_CONFIG.WEAPONS.SKIN_VERDANT
      ];

      skins.forEach((weap, idx) => {
        const y = 92 + idx * 46;
        const unlocked = storage.isWeaponUnlocked(weap.id);
        const isEquipped = equipped === weap.id;

        // Card Container
        const cardBg = this.add.rectangle(w / 2, y, 420, 41, 0x121820, 0.94)
          .setStrokeStyle(1.5, isEquipped ? 0x98ff20 : (weap.slashColor || 0x3d5c3d));
        this.contentContainer.add(cardBg);

        // Weapon Thumbnail Frame & Icon
        const iconBox = this.add.rectangle(w / 2 - 180, y, 32, 32, 0x0a0e14)
          .setStrokeStyle(1, weap.slashColor || 0xffaa00);
        this.contentContainer.add(iconBox);

        if (this.textures.exists(weap.iconKey)) {
          const iconImg = this.add.image(w / 2 - 180, y, weap.iconKey).setDisplaySize(28, 28);
          this.contentContainer.add(iconImg);
        }

        // Title
        const titleTxt = this.add.text(w / 2 - 152, y - 12, weap.name, {
          fontFamily: 'Press Start 2P',
          fontSize: '6.5px',
          color: isEquipped ? '#98ff20' : (weap.slashColor ? '#' + weap.slashColor.toString(16).padStart(6, '0') : '#ffffff')
        });
        this.contentContainer.add(titleTxt);

        // Cosmetic & Fair play badge
        const badgeTxt = this.add.text(w / 2 - 152, y - 2, 'Pure Cosmetic Skin • Dmg: x1.0 (Zero P2W)', {
          fontFamily: 'Press Start 2P',
          fontSize: '4.5px',
          color: '#ffd166'
        });
        this.contentContainer.add(badgeTxt);

        // Lore & FX Description
        const descTxt = this.add.text(w / 2 - 152, y + 8, weap.cosmeticDescription, {
          fontFamily: 'Press Start 2P',
          fontSize: '4px',
          color: '#a0b0b8',
          wordWrap: { width: 236 }
        });
        this.contentContainer.add(descTxt);

        // Action Button
        let btnText = 'EQUIP';
        let btnColor = 0x1d3f58;
        let strokeColor = 0x38e1ff;

        if (isEquipped) {
          btnText = 'EQUIPPED';
          btnColor = 0x163416;
          strokeColor = 0x98ff20;
        } else if (!unlocked && weap.cost) {
          btnText = `CRAFT\n(${weap.cost.bark || 0}B/${weap.cost.amber || 0}A/${weap.cost.iron || 0}I)`;
          btnColor = 0x472810;
          strokeColor = 0xff9933;
        }

        const btn = this.add.rectangle(w / 2 + 152, y, 92, 26, btnColor)
          .setStrokeStyle(1.2, strokeColor)
          .setInteractive({ useHandCursor: !isEquipped });
        this.contentContainer.add(btn);

        const btnLbl = this.add.text(w / 2 + 152, y, btnText, {
          fontFamily: 'Press Start 2P',
          fontSize: '4.5px',
          color: '#ffffff',
          align: 'center',
          lineSpacing: 2
        }).setOrigin(0.5);
        this.contentContainer.add(btnLbl);

        if (!isEquipped) {
          btn.on('pointerdown', () => {
            if (unlocked) {
              storage.equipWeapon(weap.id);
              sound.playCoin();
              this.updateHeroPreview();
              this.renderTabContent(w, h);
            } else if (weap.cost) {
              const spent = storage.spendMaterials(weap.cost);
              if (spent) {
                storage.unlockWeapon(weap.id);
                storage.equipWeapon(weap.id);
                sound.playVictory();
                try { confetti({ particleCount: 50, spread: 60 }); } catch (e) {}
                this.updateHeaderBar();
                this.updateHeroPreview();
                this.renderTabContent(w, h);
              } else {
                sound.playHit();
                const reqParts = [];
                if (weap.cost.bark) reqParts.push(`${weap.cost.bark} Bark`);
                if (weap.cost.amber) reqParts.push(`${weap.cost.amber} Amber`);
                if (weap.cost.iron) reqParts.push(`${weap.cost.iron} Iron`);
                alert(`Not enough materials gathered from Forest yet!\nRequires: ${reqParts.join(', ')}`);
              }
            }
          });
        }
      });
    } else if (this.currentTab === 'free') {
      // STANDARD BLADES
      const freeWeapons = [
        GAME_CONFIG.WEAPONS.STARTER,
        GAME_CONFIG.WEAPONS.IRON_BROADSWORD,
        GAME_CONFIG.WEAPONS.FOREST_GLAIVE
      ];

      freeWeapons.forEach((weap, idx) => {
        const y = 92 + idx * 46;
        const unlocked = storage.isWeaponUnlocked(weap.id);
        const isEquipped = equipped === weap.id;

        const card = this.add.rectangle(w / 2, y, 420, 40, 0x122212, 0.9)
          .setStrokeStyle(1, isEquipped ? 0x98ff20 : 0x2e4e2e);
        this.contentContainer.add(card);

        const name = this.add.text(w / 2 - 190, y - 10, weap.name, {
          fontFamily: 'Press Start 2P',
          fontSize: '7px',
          color: isEquipped ? '#98ff20' : '#ffffff'
        });
        this.contentContainer.add(name);

        const stats = this.add.text(w / 2 - 190, y + 4, `Dmg: x${weap.damageMul} • Reach: x${weap.rangeMul} • ${weap.tier}`, {
          fontFamily: 'Press Start 2P',
          fontSize: '5px',
          color: '#8cb38c'
        });
        this.contentContainer.add(stats);

        // Action Button
        let btnText = 'EQUIP';
        let btnColor = 0x2a542a;

        if (isEquipped) {
          btnText = 'EQUIPPED';
          btnColor = 0x183318;
        } else if (!unlocked && weap.cost) {
          btnText = `CRAFT (${weap.cost.bark || 0}B/${weap.cost.iron || 0}I)`;
          btnColor = 0x3d4414;
        }

        const btn = this.add.rectangle(w / 2 + 152, y, 92, 24, btnColor)
          .setStrokeStyle(1, isEquipped ? 0x98ff20 : 0x4a7d4a)
          .setInteractive({ useHandCursor: !isEquipped });
        this.contentContainer.add(btn);

        const btnLbl = this.add.text(w / 2 + 152, y, btnText, {
          fontFamily: 'Press Start 2P',
          fontSize: '5px',
          color: '#ffffff'
        }).setOrigin(0.5);
        this.contentContainer.add(btnLbl);

        if (!isEquipped) {
          btn.on('pointerdown', () => {
            if (unlocked) {
              storage.equipWeapon(weap.id);
              sound.playCoin();
              this.updateHeroPreview();
              this.renderTabContent(w, h);
            } else if (weap.cost) {
              const spent = storage.spendMaterials(weap.cost);
              if (spent) {
                storage.unlockWeapon(weap.id);
                storage.equipWeapon(weap.id);
                sound.playVictory();
                try { confetti({ particleCount: 50, spread: 60 }); } catch (e) {}
                this.updateHeaderBar();
                this.updateHeroPreview();
                this.renderTabContent(w, h);
              } else {
                sound.playHit();
                alert('Not enough materials gathered from Forest yet!');
              }
            }
          });
        }
      });
    } else {
      // Celestial Blades, Companions & Perk Re-roll
      const prestigeItems = [
        {
          id: GAME_CONFIG.WEAPONS.GOLDEN_ALBATROSS.id,
          name: 'Golden Solar Blade',
          desc: 'Sun-forged golden sword trail & sparkling embers.',
          cost: { amber: 8, iron: 6 },
          costLabel: '8 Amber, 6 Iron',
          type: 'weapon'
        },
        {
          id: GAME_CONFIG.WEAPONS.CORRUPTED_VOID.id,
          name: 'Corrupted Void Edge',
          desc: 'Ancient twilight essence. Dark obsidian shadow slashes.',
          cost: { amber: 10, iron: 8 },
          costLabel: '10 Amber, 8 Iron',
          type: 'weapon'
        },
        {
          id: 'satchel_pet',
          name: 'Moon Sprite Satchel (Sylva)',
          desc: 'Cosmetic Moon Sprite fairy hovering by your shoulder in trials.',
          cost: { bark: 8, amber: 6 },
          costLabel: '8 Bark, 6 Amber',
          type: 'satchel'
        },
        {
          id: 'relic_reroll',
          name: 'Stat Catalyst Re-roll',
          desc: `Current Perk: ${storage.getActivePerk().toUpperCase()}. Re-roll relic perk.`,
          cost: { bark: 2, amber: 2 },
          costLabel: '2 Bark, 2 Amber',
          type: 'reroll'
        }
      ];

      prestigeItems.forEach((item, idx) => {
        const y = 88 + idx * 36;
        const unlocked = item.type === 'weapon' ? storage.isWeaponUnlocked(item.id) :
                         (item.type === 'satchel' ? storage.data.satchelUnlocked : false);
        const isEquipped = item.type === 'weapon' ? (equipped === item.id) :
                           (item.type === 'satchel' ? storage.isCompanionActive() : false);

        const card = this.add.rectangle(w / 2, y, 420, 30, 0x221d0f, 0.9).setStrokeStyle(1, 0x5a4818);
        this.contentContainer.add(card);

        const name = this.add.text(w / 2 - 190, y - 8, item.name, {
          fontFamily: 'Press Start 2P',
          fontSize: '5.5px',
          color: '#f6c026'
        });
        this.contentContainer.add(name);

        const desc = this.add.text(w / 2 - 190, y + 4, item.desc, {
          fontFamily: 'Press Start 2P',
          fontSize: '4.5px',
          color: '#bfa770'
        });
        this.contentContainer.add(desc);

        // Button label
        let btnText = `CRAFT (${item.costLabel})`;
        if (unlocked && item.type === 'weapon') {
          btnText = isEquipped ? 'EQUIPPED' : 'EQUIP';
        } else if (unlocked && item.type === 'satchel') {
          btnText = isEquipped ? 'PET ON' : 'PET OFF';
        } else if (item.type === 'reroll') {
          btnText = `REROLL (${item.costLabel})`;
        }

        const btn = this.add.rectangle(w / 2 + 152, y, 92, 22, isEquipped ? 0x1e3a1e : 0x4a3a14)
          .setStrokeStyle(1, 0xe9b213)
          .setInteractive({ useHandCursor: true });
        this.contentContainer.add(btn);

        const btnLbl = this.add.text(w / 2 + 152, y, btnText, {
          fontFamily: 'Press Start 2P',
          fontSize: '4.5px',
          color: '#ffffff'
        }).setOrigin(0.5);
        this.contentContainer.add(btnLbl);

        btn.on('pointerdown', () => {
          if (unlocked && item.type === 'weapon') {
            storage.equipWeapon(item.id);
            sound.playCoin();
            this.updateHeroPreview();
            this.renderTabContent(w, h);
          } else if (unlocked && item.type === 'satchel') {
            storage.toggleCompanion();
            sound.playCoin();
            this.renderTabContent(w, h);
          } else {
            // Material craft / unlock
            const success = storage.spendMaterials(item.cost);
            if (success) {
              sound.playVictory();
              try { confetti({ particleCount: 40, spread: 50 }); } catch (e) {}

              if (item.type === 'weapon') {
                storage.unlockWeapon(item.id);
                storage.equipWeapon(item.id);
                this.updateHeroPreview();
              } else if (item.type === 'satchel') {
                storage.unlockSatchel();
              } else if (item.type === 'reroll') {
                const perks = GAME_CONFIG.PERKS;
                const current = storage.getActivePerk();
                const others = perks.filter(p => p.id !== current);
                const nextPerk = Phaser.Utils.Array.GetRandom(others);
                storage.setActivePerk(nextPerk.id);
                alert(`Relic Perk Re-rolled! Now equipped with: ${nextPerk.name} (${nextPerk.desc})`);
              }

              this.updateHeaderBar();
              this.renderTabContent(w, h);
            } else {
              sound.playHit();
              alert(`Not enough materials gathered! Requires: ${item.costLabel}`);
            }
          }
        });
      });
    }
  }
}
