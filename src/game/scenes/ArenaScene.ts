import Phaser from 'phaser';
import { EventBus } from '@/bridge/EventBus';
import { combatStore } from '@/state/combatStore';
import { legalTargets } from '@/game/combat/engine';
import { COMBAT_CONTENT } from '@/game/combat/content';
import type { CombatEvent, CombatState, CombatantId } from '@/game/combat/types';
import { AssetKeys, COMBATANT_FRAMES } from '../assets';

/**
 * Draws the battle: sprites, hit reactions, targeting highlights.
 *
 * Owns none of the rules and none of the interface. Cards, bars, statuses and
 * buttons are all React, over the top of this canvas.
 *
 * Animation is driven by `battle.events` — the structured list the engine
 * records for each transition — rather than by diffing state. A diff could tell
 * that someone lost 40 health, but not who hit them, whether it was a poison
 * tick, or whether Bleed doubled it. Because the enemy turn resolves one enemy
 * per store update, each attack arrives as its own event and is animated alone.
 *
 * The bottom slice of the screen is left empty for the React hand to sit over.
 */

/** Fraction of the screen height reserved for the React card UI. */
const UI_RESERVE = 0.46;

interface Slot {
  sprite: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Arc;
  baseY: number;
}

export class ArenaScene extends Phaser.Scene {
  private slots = new Map<CombatantId, Slot>();
  private unsubscribe: (() => void) | null = null;
  private teardown: Array<() => void> = [];

  constructor() {
    super({ key: 'ArenaScene' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#141a26');
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);

    const battle = combatStore.getState().battle;
    if (battle) this.buildSlots(battle);

    this.unsubscribe = combatStore.subscribe((state, prev) => {
      if (!state.battle) return;
      if (!prev.battle && state.battle) this.buildSlots(state.battle);
      this.syncTo(state.battle);
    });

    this.teardown.push(
      EventBus.on('arena:exit', () => {
        this.scene.switch('WorldScene');
      })
    );

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    this.events.on(Phaser.Scenes.Events.WAKE, () => {
      const current = combatStore.getState().battle;
      if (current) this.buildSlots(current);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    this.events.on(Phaser.Scenes.Events.SLEEP, () => this.clearSlots());

    EventBus.emit('arena:ready');
  }

  private dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const dispose of this.teardown) dispose();
    this.teardown = [];
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.clearSlots();
  }

  private clearSlots(): void {
    for (const slot of this.slots.values()) {
      slot.sprite.destroy();
      slot.glow.destroy();
    }
    this.slots.clear();
  }

  // ── Building ──────────────────────────────────────────────────────────────

  private buildSlots(battle: CombatState): void {
    this.clearSlots();

    for (const id of [...battle.enemyOrder, ...battle.playerOrder]) {
      if (!battle.combatants[id]) continue;

      // Drawn beneath the sprite; used for the targeting pulse.
      const glow = this.add.circle(0, 0, 30, 0xd8a657, 0);

      const sprite = this.add.sprite(0, 0, AssetKeys.combatants, COMBATANT_FRAMES[id] ?? 0);
      sprite.setOrigin(0.5, 1);
      sprite.setInteractive({ useHandCursor: true });

      // Tapping a sprite is the same action as tapping its React panel, so the
      // player can aim at whichever representation they're looking at.
      sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        const state = combatStore.getState();
        if (state.battle?.phase !== 'selectTarget') return;
        state.pickTarget(id);
      });

      this.slots.set(id, { sprite, glow, baseY: 0 });
    }

    this.layout();
    this.syncTo(battle);
  }

  /**
   * Positions everyone: enemies across the top, party across the middle, and
   * the bottom `UI_RESERVE` of the screen left clear for the React hand.
   */
  private layout(): void {
    const battle = combatStore.getState().battle;
    if (!battle) return;

    const { width, height } = this.scale.gameSize;
    const arenaHeight = height * (1 - UI_RESERVE);

    const place = (ids: CombatantId[], y: number, scale: number) => {
      const step = width / (ids.length + 1);

      ids.forEach((id, index) => {
        const slot = this.slots.get(id);
        if (!slot) return;

        const x = step * (index + 1);
        slot.baseY = y;
        slot.sprite.setPosition(x, y);
        slot.sprite.setScale(scale);
        slot.glow.setPosition(x, y - 18 * scale);
        slot.glow.setRadius(26 * scale);
      });
    };

    place(battle.enemyOrder, arenaHeight * 0.46, 1.5);
    place(battle.playerOrder, arenaHeight * 0.97, 1.7);
  }

  // ── Reacting to state ─────────────────────────────────────────────────────

  private syncTo(battle: CombatState): void {
    const targetable =
      battle.phase === 'selectTarget' && battle.pendingCard
        ? new Set(legalTargets(battle, COMBAT_CONTENT, battle.pendingCard))
        : new Set<CombatantId>();

    for (const [id, slot] of this.slots) {
      const combatant = battle.combatants[id];
      if (!combatant) continue;

      if (combatant.downed) {
        slot.sprite.setAlpha(0.28);
        slot.sprite.setAngle(90);
      } else {
        slot.sprite.setAlpha(combatant.resting ? 0.55 : 1);
        slot.sprite.setAngle(0);
      }

      // Only pulse the glow when this combatant is a legal target right now.
      const isTarget = targetable.has(id);
      slot.glow.setFillStyle(0xd8a657, isTarget ? 0.3 : 0);
      this.tweens.killTweensOf(slot.glow);
      if (isTarget) {
        slot.glow.setScale(1);
        this.tweens.add({
          targets: slot.glow,
          scale: 1.25,
          alpha: 0.6,
          duration: 520,
          yoyo: true,
          repeat: -1,
        });
      } else {
        slot.glow.setScale(1);
        slot.glow.setAlpha(1);
      }
    }

    // Started last, so the pass above — which resets angle and alpha — cannot
    // immediately stomp a tween this kicks off.
    this.playEvents(battle.events);
  }

  /**
   * Plays one transition's worth of events.
   *
   * The enemy turn resolves one enemy per store update, so this is called once
   * per attack and each lunge is seen on its own.
   */
  private playEvents(events: readonly CombatEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'attack': {
          this.playLunge(event.sourceId, event.targetId);
          const slot = this.slots.get(event.targetId);
          if (slot) this.playHit(slot, event.bleed);
          break;
        }
        case 'poison': {
          const slot = this.slots.get(event.targetId);
          if (slot) this.playPoison(slot);
          break;
        }
        case 'heal': {
          const slot = this.slots.get(event.targetId);
          if (slot) this.playHeal(slot);
          break;
        }
        case 'drain': {
          const slot = this.slots.get(event.targetId);
          if (slot && event.emptied) this.playStagger(slot);
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Steps the attacker toward its target and back.
   *
   * Reading direction off the actual sprite positions means the same code works
   * for an enemy striking downward and an ally striking up, and keeps working if
   * the layout changes.
   */
  private playLunge(sourceId: CombatantId, targetId: CombatantId): void {
    const attacker = this.slots.get(sourceId);
    const target = this.slots.get(targetId);
    if (!attacker || !target) return;

    const dx = target.sprite.x - attacker.sprite.x;
    const dy = target.baseY - attacker.baseY;
    const distance = Math.hypot(dx, dy) || 1;

    // A fixed step toward the target, not the whole distance — the attacker
    // should read as committing to a blow, not teleporting across the arena.
    const reach = 18;

    this.tweens.killTweensOf(attacker.sprite);
    this.tweens.add({
      targets: attacker.sprite,
      x: attacker.sprite.x + (dx / distance) * reach,
      y: attacker.baseY + (dy / distance) * reach,
      duration: 110,
      ease: 'Quad.easeOut',
      yoyo: true,
      hold: 40,
      onComplete: () => {
        // Snap back exactly: repeated tweens accumulate rounding drift and the
        // row slowly loses its alignment over a long fight.
        attacker.sprite.y = attacker.baseY;
      },
    });
  }

  private playHit(slot: Slot, bleed = false): void {
    // Phaser 4 replaced setTintFill(colour) with an explicit tint mode; FILL
    // replaces the texture colour while respecting its alpha, which is what
    // gives the flat white hit flash.
    slot.sprite.setTint(bleed ? 0xff6b6b : 0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(bleed ? 130 : 70, () => {
      slot.sprite.clearTint();
      slot.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
    });

    // A short recoil rather than a long one — combat resolves a card at a time,
    // and a slow animation would make the whole turn feel sluggish.
    this.tweens.add({
      targets: slot.sprite,
      y: slot.baseY + (bleed ? 12 : 6),
      duration: 60,
      yoyo: true,
      repeat: bleed ? 1 : 0,
      ease: 'Quad.easeOut',
      onComplete: () => {
        slot.sprite.y = slot.baseY;
      },
    });
  }

  /** Green pulse for a poison tick — no recoil, since nothing struck them. */
  private playPoison(slot: Slot): void {
    slot.sprite.setTint(0x7fd18f);
    this.time.delayedCall(260, () => slot.sprite.clearTint());

    this.tweens.add({
      targets: slot.sprite,
      scaleX: slot.sprite.scaleX * 1.06,
      duration: 130,
      yoyo: true,
      ease: 'Sine.easeInOut',
    });
  }

  /** A wobble for a combatant whose stamina was just emptied. */
  private playStagger(slot: Slot): void {
    this.tweens.killTweensOf(slot.sprite);
    this.tweens.add({
      targets: slot.sprite,
      angle: { from: -7, to: 7 },
      duration: 70,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        slot.sprite.setAngle(0);
      },
    });
  }

  private playHeal(slot: Slot): void {
    slot.sprite.setTint(0x9fe0a8);
    this.time.delayedCall(180, () => slot.sprite.clearTint());

    this.tweens.add({
      targets: slot.sprite,
      y: slot.baseY - 8,
      duration: 140,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }
}
