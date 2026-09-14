import { describe, expect, it } from 'vitest';
import { COMBAT_CONTENT, IGNIS, MARLO, SABER, HOLLIS } from '@/game/combat/content';
import { chooseTarget, createCombat, selectCard } from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import { computeDamage, effectiveDefense } from '@/game/combat/stats';
import type { Combatant, CombatContent, CombatState } from '@/game/combat/types';

function dummy(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'dummy',
    name: 'Dummy',
    team: 'enemy',
    health: 2000,
    maxHealth: 2000,
    stamina: 100,
    maxStamina: 100,
    attack: 50,
    defense: 0,
    speed: 1,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
    ...overrides,
  };
}

const CONTENT: CombatContent = {
  ...COMBAT_CONTENT,
  enemyActions: { ...COMBAT_CONTENT.enemyActions, dummy: [] },
};

/** A battle with `card` guaranteed in hand, whatever the shuffle dealt. */
function battleWith(combatants: Combatant[], deck: string[], card: string, seed = 7) {
  const state = createCombat({ combatants, deck, seed });
  const instance = Object.values(state.cards).find((c) => c.definitionId === card)!.instanceId;

  const hand = state.hand.filter((id) => id !== instance);
  const drawPile = state.drawPile.filter((id) => id !== instance);
  const discardPile = state.discardPile.filter((id) => id !== instance);

  return { state: { ...state, hand: [...hand, instance], drawPile, discardPile }, instance };
}

function play(state: CombatState, instance: string, target?: string): CombatState {
  const mid = selectCard(state, CONTENT, instance);
  return target ? chooseTarget(mid, CONTENT, target) : mid;
}

// ── Saber ───────────────────────────────────────────────────────────────────

describe('Sever', () => {
  it('bleeds about half the time, and the same way every time from one seed', () => {
    let bled = 0;
    const trials = 60;

    for (let seed = 1; seed <= trials; seed++) {
      const { state, instance } = battleWith([SABER, dummy()], Array(12).fill('saber.sever'), 'saber.sever', seed);
      const after = play(state, instance, 'dummy');
      const again = play(state, instance, 'dummy');

      const stacks = stacksOf(after.combatants['dummy']!.statuses, 'bleed');
      expect(stacksOf(again.combatants['dummy']!.statuses, 'bleed')).toBe(stacks);
      bled += stacks;
    }

    expect(bled).toBeGreaterThan(trials * 0.25);
    expect(bled).toBeLessThan(trials * 0.75);
  });
});

// ── Hollis ──────────────────────────────────────────────────────────────────

describe('Goad', () => {
  it('costs its stamina and grants Taunt and Defense Up', () => {
    const { state, instance } = battleWith([HOLLIS, dummy()], Array(12).fill('hollis.goad'), 'hollis.goad');
    const after = play(state, instance);

    expect(after.combatants['hollis']!.stamina).toBe(
      HOLLIS.maxStamina - COMBAT_CONTENT.cardDefs['hollis.goad']!.staminaCost
    );
    expect(stacksOf(after.combatants['hollis']!.statuses, 'taunt')).toBe(1);
    expect(stacksOf(after.combatants['hollis']!.statuses, 'defenseUp')).toBe(1);
  });
});

// ── Ignis ───────────────────────────────────────────────────────────────────

describe('Fireball Barrage', () => {
  const deck = [
    ...Array(4).fill('ignis.fireball'),
    'ignis.barrage',
    ...Array(15).fill('team.regroup'),
  ];

  it('casts every Fireball in the draw pile plus one, and discards those copies', () => {
    const { state, instance } = battleWith([IGNIS, dummy(), dummy({ id: 'dummy2', name: 'Dummy 2' })], deck, 'ignis.barrage');
    const content: CombatContent = { ...CONTENT, enemyActions: { ...CONTENT.enemyActions, dummy2: [] } };

    const waiting = state.drawPile.filter((id) => state.cards[id]!.definitionId === 'ignis.fireball');
    const inHand = state.hand.filter((id) => state.cards[id]!.definitionId === 'ignis.fireball');

    const after = selectCard(state, content, instance);
    const hit = computeDamage(IGNIS, dummy(), 30);

    expect(after.drawPile.some((id) => after.cards[id]!.definitionId === 'ignis.fireball')).toBe(false);
    for (const id of waiting) expect(after.discardPile).toContain(id);
    // Copies already in hand stay there.
    for (const id of inHand) expect(after.hand).toContain(id);

    const casts = waiting.length + 1;
    expect(2000 - after.combatants['dummy']!.health).toBe(hit * casts);
    expect(2000 - after.combatants['dummy2']!.health).toBe(hit * casts);
  });

  it('still casts once with no Fireballs left to pull', () => {
    const { state, instance } = battleWith([IGNIS, dummy()], ['ignis.barrage', ...Array(15).fill('team.regroup')], 'ignis.barrage');
    const after = play(state, instance);

    expect(2000 - after.combatants['dummy']!.health).toBe(computeDamage(IGNIS, dummy(), 30));
  });
});

// ── Marlo ───────────────────────────────────────────────────────────────────

describe('Marlo', () => {
  const enemies = () => [dummy({ defense: 50 }), dummy({ id: 'dummy2', name: 'Dummy 2', defense: 50 })];
  const content: CombatContent = { ...CONTENT, enemyActions: { ...CONTENT.enemyActions, dummy2: [] } };

  it('Expose lowers every enemy Defense, and cancels against Defense Up', () => {
    const [first, second] = enemies();
    const braced = { ...second!, statuses: [{ kind: 'defenseUp' as const, stacks: 1, duration: { kind: 'permanent' as const } }] };
    const { state, instance } = battleWith([MARLO, first!, braced], Array(12).fill('marlo.expose'), 'marlo.expose');

    const after = selectCard(state, content, instance);

    expect(stacksOf(after.combatants['dummy']!.statuses, 'defenseDown')).toBe(1);
    expect(effectiveDefense(after.combatants['dummy']!)).toBeCloseTo(35);
    expect(after.combatants['dummy2']!.statuses).toEqual([]);
  });

  it('Demoralize weakens every enemy', () => {
    const { state, instance } = battleWith([MARLO, ...enemies()], Array(12).fill('marlo.demoralize'), 'marlo.demoralize');
    const after = selectCard(state, content, instance);

    expect(stacksOf(after.combatants['dummy']!.statuses, 'weakness')).toBe(1);
    expect(stacksOf(after.combatants['dummy2']!.statuses, 'weakness')).toBe(1);
  });

  it('Rally and Fortify buff the chosen ally', () => {
    const deck = [...Array(6).fill('marlo.rally'), ...Array(6).fill('marlo.fortify')];
    const rally = battleWith([MARLO, SABER, dummy()], deck, 'marlo.rally');
    const rallied = play(rally.state, rally.instance, 'saber');

    expect(stacksOf(rallied.combatants['saber']!.statuses, 'strength')).toBe(1);

    const fortify = battleWith([MARLO, SABER, dummy()], deck, 'marlo.fortify');
    const fortified = play(fortify.state, fortify.instance, 'saber');
    expect(stacksOf(fortified.combatants['saber']!.statuses, 'defenseUp')).toBe(1);
  });

  it('Resupply refills the whole team and wakes the exhausted', () => {
    const tired = { ...SABER, stamina: 0, resting: true };
    const { state, instance } = battleWith([MARLO, tired, dummy()], Array(12).fill('marlo.resupply'), 'marlo.resupply');

    const after = play(state, instance);

    expect(after.combatants['saber']!.stamina).toBe(SABER.maxStamina);
    expect(after.combatants['saber']!.resting).toBe(false);
    expect(after.combatants['marlo']!.stamina).toBe(MARLO.maxStamina);
  });
});
