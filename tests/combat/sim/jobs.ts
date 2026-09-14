import { CARD_DEFS, enemyTeamById } from '@/game/combat/content';
import type { DeckList } from '@/game/combat/deckbuilding';
import type { CardDefinition, Combatant, CombatState } from '@/game/combat/types';
import { createGreedy } from './greedy';
import { fight, playOut } from './play';
import { createPlanner, type PlannerOptions } from './planner';

/**
 * One battle, described in plain data so it can cross into a worker thread.
 */

export type AiKind = 'greedy' | 'planner';

/** The numbers on a card a probe may try other values for. */
export type CardOverride = Partial<Pick<CardDefinition, 'staminaCost'>>;

export interface Job {
  party: string[];
  teamId: string;
  seed: number;
  ai: AiKind;
  /** Plays this deck instead of the party's default one. */
  deck?: DeckList;
  /**
   * Card numbers to try for this battle only.
   *
   * Applied to the shared definitions and put back afterwards, which is safe
   * because a worker runs its jobs one at a time.
   */
  cardOverrides?: Record<string, CardOverride>;
  /** Adds a per-character breakdown of the battle to the outcome. */
  detail?: boolean;
  /**
   * Fights these instead of the team named by `teamId`, which then only labels
   * the job. For probe-only opponents that have no business in the game.
   */
  enemies?: Combatant[];
  /** Rounds allowed before the battle is stopped and counted as not won. */
  maxRounds?: number;
}

export interface Detail {
  /** Damage dealt by each party member, keyed by id. Poison is Ivy's. */
  damage: Record<string, number>;
  /** Times each party member went down. */
  downs: Record<string, number>;
  /** Times each card was played, keyed by card name. */
  plays: Record<string, number>;
}

export interface Outcome {
  win: boolean;
  rounds: number;
  survivors: number;
  /** Party health left as a fraction of its max, 0 on a loss. */
  hpLeft: number;
  /** Enemy health left as a fraction of the starting enemies' max, 0 on a win. */
  enemyHpLeft: number;
  detail?: Detail;
}

/**
 * Reads the breakdown off the battle log.
 *
 * The log is the one record that survives to the end of a battle — events are
 * replaced every transition — and every line it needs names its actor.
 */
function detailOf(state: CombatState): Detail {
  const idByName = new Map(
    state.playerOrder.flatMap((id) => {
      const c = state.combatants[id];
      return c ? [[c.name, id] as const] : [];
    })
  );

  const detail: Detail = { damage: {}, downs: {}, plays: {} };
  const add = (table: Record<string, number>, key: string, amount: number) => {
    table[key] = (table[key] ?? 0) + amount;
  };

  for (const line of state.log) {
    const hit = /^(.+?) hits .+ for (\d+)/.exec(line);
    if (hit) {
      const id = idByName.get(hit[1]!);
      if (id) add(detail.damage, id, Number(hit[2]));
      continue;
    }

    const poison = /^(.+?) takes (\d+) from poison\.$/.exec(line);
    if (poison && !idByName.has(poison[1]!) && idByName.has('Ivy')) {
      add(detail.damage, 'ivy', Number(poison[2]));
      continue;
    }

    const down = /^(.+?) is down!$/.exec(line);
    if (down) {
      const id = idByName.get(down[1]!);
      if (id) add(detail.downs, id, 1);
      continue;
    }

    const play = /^(.+?) plays (.+)\.$/.exec(line);
    if (play && idByName.has(play[1]!)) add(detail.plays, play[2]!, 1);
  }

  return detail;
}

function envNumber(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Planner strength from `PROBE_BEAM`, `PROBE_LEAVES` and `PROBE_SAMPLES`. */
export function plannerOptionsFromEnv(): Partial<PlannerOptions> {
  const options: Partial<PlannerOptions> = {};
  const beam = envNumber('PROBE_BEAM');
  const leaves = envNumber('PROBE_LEAVES');
  const samples = envNumber('PROBE_SAMPLES');
  if (beam) options.beam = beam;
  if (leaves) options.leaves = leaves;
  if (samples) options.samples = samples;
  return options;
}

export function runJob(job: Job): Outcome {
  const enemies = job.enemies ?? enemyTeamById(job.teamId)?.members;
  if (!enemies) throw new Error(`Unknown team ${job.teamId}`);

  const policy =
    job.ai === 'greedy'
      ? createGreedy()
      : createPlanner({ ...plannerOptionsFromEnv(), seed: job.seed * 7919 + 17 });

  const restore: [CardDefinition, CardOverride][] = [];
  for (const [cardId, override] of Object.entries(job.cardOverrides ?? {})) {
    const card = CARD_DEFS[cardId];
    if (!card) throw new Error(`Unknown card ${cardId}`);
    const previous: CardOverride = {};
    for (const key of Object.keys(override) as (keyof CardOverride)[]) previous[key] = card[key];
    restore.push([card, previous]);
    Object.assign(card, override);
  }

  let result: CombatState;
  try {
    result = playOut(fight(job.party, enemies, job.seed, job.deck), policy, job.maxRounds);
  } finally {
    for (const [card, previous] of restore) Object.assign(card, previous);
  }

  const party = result.playerOrder
    .map((id) => result.combatants[id])
    .filter((c) => c !== undefined);
  const max = party.reduce((sum, c) => sum + c.maxHealth, 0) || 1;
  const win = result.phase === 'victory';

  // Only the enemies that started the fight: summons come and go, and counting
  // them would make the same health removed read differently from run to run.
  const starters = enemies
    .map((enemy) => result.combatants[enemy.id])
    .filter((c) => c !== undefined);
  const enemyMax = starters.reduce((sum, c) => sum + c.maxHealth, 0) || 1;
  const enemyLeft = win ? 0 : starters.reduce((sum, c) => sum + c.health, 0) / enemyMax;

  return {
    win,
    rounds: result.round,
    survivors: party.filter((c) => !c.downed).length,
    hpLeft: win ? party.filter((c) => !c.downed).reduce((sum, c) => sum + c.health, 0) / max : 0,
    enemyHpLeft: enemyLeft,
    ...(job.detail ? { detail: detailOf(result) } : {}),
  };
}
