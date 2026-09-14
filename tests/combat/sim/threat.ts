import { effectiveAttack, fatigueMultiplier, SUPPORT_EFFECT_POWER } from '@/game/combat/stats';
import type { Combatant, CombatContent, CombatState, EnemyAction } from '@/game/combat/types';

/**
 * How dangerous an enemy is, in raw damage per turn.
 *
 * Read straight off the move list rather than written per enemy, so a new
 * archetype is scored the moment it has actions — nothing here names a foe.
 * "Raw" means before the party's Defense: the evaluator applies mitigation once,
 * on the whole party, rather than guessing who each blow lands on.
 */

/** Attack a support effect is priced at, since shields and curses have no Attack of their own. */
const REFERENCE_ATTACK = 100;

/** Lifesteal is worth a little on top of the hit: it undoes the party's work. */
const LIFESTEAL_VALUE = 0.5;

/** Summons arrive after the enemy queue is built, so their first hit is a turn late. */
const SUMMON_DELAY = 0.5;

/** A resting enemy loses its next action, but only its next one. */
const RESTING_THREAT = 0.5;

/** Fatigue makes an enemy rest sooner; the square root keeps that from dominating. */
const FATIGUE_THREAT_EXPONENT = 0.5;

function livingCount(state: CombatState, order: readonly string[]): number {
  return order.filter((id) => state.combatants[id]?.downed === false).length;
}

/** Damage-only value of a move list at a given Attack, for summon templates. */
function hitPerTurn(actions: readonly EnemyAction[], attack: number): number {
  let total = 0;
  let weights = 0;

  for (const action of actions) {
    weights += action.weight;
    for (const effect of action.effects) {
      if (effect.type === 'damage') total += action.weight * attack * (effect.power / 100);
    }
  }

  return weights > 0 ? total / weights : 0;
}

function actionValue(
  state: CombatState,
  content: CombatContent,
  enemy: Combatant,
  action: EnemyAction
): number {
  const attack = effectiveAttack(enemy);
  const targets =
    action.target === 'allEnemies'
      ? livingCount(state, state.playerOrder)
      : action.target === 'allAllies'
        ? livingCount(state, state.enemyOrder)
        : 1;

  let value = 0;

  for (const effect of action.effects) {
    switch (effect.type) {
      case 'damage':
        value += attack * (effect.power / 100) * targets * (1 + (effect.lifesteal ?? 0) * LIFESTEAL_VALUE);
        break;

      case 'chainDamage': {
        const expectedHits = Math.min(effect.maxHits, 1 / (1 - effect.continueChance));
        value += attack * (effect.power / 100) * expectedHits;
        break;
      }

      case 'summon': {
        const template = content.summonable?.[effect.archetype];
        if (!template) break;
        const actions = content.enemyActions[template.archetype ?? template.id] ?? [];
        const copies = Math.min(effect.count, effect.max);
        value += copies * hitPerTurn(actions, template.attack) * SUMMON_DELAY;
        break;
      }

      default:
        value += REFERENCE_ATTACK * (SUPPORT_EFFECT_POWER / 100) * targets;
        break;
    }
  }

  return value;
}

/** Expected raw damage per turn this enemy is worth, weighted by its move odds. */
export function threatOf(state: CombatState, content: CombatContent, enemy: Combatant): number {
  if (enemy.downed) return 0;

  const actions = content.enemyActions[enemy.archetype ?? enemy.id] ?? [];
  let total = 0;
  let weights = 0;

  for (const action of actions) {
    weights += action.weight;
    total += action.weight * actionValue(state, content, enemy, action);
  }

  if (weights <= 0) return 0;

  let threat = total / weights;
  if (enemy.resting) threat *= RESTING_THREAT;
  threat /= fatigueMultiplier(enemy.statuses) ** FATIGUE_THREAT_EXPONENT;

  return threat;
}
