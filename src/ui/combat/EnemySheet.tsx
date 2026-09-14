import { COMBAT_CONTENT } from '@/game/combat/content';
import { effectiveAttack, effectiveDefense, mitigation } from '@/game/combat/stats';
import type { Combatant, EnemyAction } from '@/game/combat/types';
import { cardRowProps } from './cardRows';
import { KeywordList } from './KeywordList';
import { MoveCard } from './MoveCard';
import { cardKeywords, type Keyword } from './keywords';

interface Props {
  /** The enemy being read, or null when the sheet is closed. */
  combatant: Combatant | null;
  onDismiss: () => void;
}

/**
 * Everything the player can know about one enemy: its stats, and its moves as
 * cards.
 *
 * The enemy panels in the arena are deliberately thin — a name, two bars and
 * whatever it is currently suffering — because that is all that changes turn to
 * turn and a phone has no room for the rest. This is the rest: the numbers that
 * hold still, and the list of things the enemy can do.
 *
 * It shows what the enemy *can* do, never what it is *about* to. The engine
 * picks each enemy's action at the moment it acts and publishes nothing ahead
 * of time, and this screen does not change that — the odds beside each move are
 * the shape of the list, not a prediction.
 *
 * Keywords are explained once underneath the whole list rather than per card.
 * A card in hand can afford its own glossary because only one is ever held at a
 * time; a sheet showing four moves that all apply Weakness would print the same
 * paragraph four times.
 */
export function EnemySheet({ combatant, onDismiss }: Props) {
  if (!combatant) return null;

  const actions = COMBAT_CONTENT.enemyActions[combatant.archetype ?? combatant.id] ?? [];
  const totalWeight = actions.reduce((sum, action) => sum + action.weight, 0);

  return (
    <div className="sheet" role="presentation" onPointerDown={onDismiss}>
      {/*
        The panel swallows presses so the sheet survives a tap on its own
        contents — it is scrollable, and a flick that lands on a card should not
        close what the player is reading. Only the backdrop dismisses.
      */}
      <div className="sheet__panel" onPointerDown={(event) => event.stopPropagation()}>
        <header className="sheet__head">
          <h2 className="sheet__title">{combatant.name}</h2>
          <span className="sheet__hp">
            {combatant.health}/{combatant.maxHealth} HP
          </span>
        </header>

        <StatLine combatant={combatant} />

        {combatant.damageTakenWithAllies !== undefined && (
          <p className="sheet__label">
            Takes {Math.round(combatant.damageTakenWithAllies * 100)}% damage from attacks while
            an ally stands
          </p>
        )}

        <div className="sheet__scroll">
          <p className="sheet__label">
            {actions.length === 1 ? 'Its one move' : `Its ${actions.length} moves`}
            {actions.length > 1 && <span className="sheet__note">chance per turn</span>}
          </p>

          <div {...cardRowProps('sheet__moves', actions.length)}>
            {actions.map((action) => (
              <MoveCard
                key={action.id}
                action={action}
                share={totalWeight > 0 ? action.weight / totalWeight : 0}
              />
            ))}
          </div>

          <KeywordList keywords={moveKeywords(actions)} />
        </div>

        <button type="button" className="button button--secondary" onClick={onDismiss}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Every keyword the enemy's moves touch, each named once.
 *
 * Deduplicated by kind and left in glossary order, so two moves that both
 * inflict Weakness explain it once and the list reads the same way on every
 * enemy.
 */
function moveKeywords(actions: readonly EnemyAction[]): Keyword[] {
  const seen = new Map<string, Keyword>();

  for (const action of actions) {
    for (const keyword of cardKeywords(action)) seen.set(keyword.kind, keyword);
  }

  return [...seen.values()];
}

/**
 * The stats the arena panel has no room for.
 *
 * Attack and Defense are shown *after* statuses, not as printed on the sheet,
 * because the question being asked is "what am I up against right now" — a
 * Weakened Ogre that still advertises ATK 110 is answering a question nobody
 * asked. A stat bent by a status says so, and the badges on the panel say why.
 *
 * Defense is the one number in the game that means nothing on its own: the
 * curve behind it is 50/(50+DEF), so DEF 40 and DEF 80 sound twice as far apart
 * as they play. It gets its damage-taken figure spelled out beside it.
 */
function StatLine({ combatant }: { combatant: Combatant }) {
  const attack = Math.round(effectiveAttack(combatant));
  const defense = Math.round(effectiveDefense(combatant));
  const taken = Math.round(mitigation(effectiveDefense(combatant)) * 100);

  return (
    <dl className="sheet__stats">
      <Stat label="ATK" value={attack} base={combatant.attack} />
      <Stat label="DEF" value={defense} base={combatant.defense} note={`takes ${taken}%`} />
      <Stat label="SPD" value={combatant.speed} base={combatant.speed} />
      <Stat label="STAM" value={combatant.stamina} base={combatant.maxStamina} />
    </dl>
  );
}

function Stat({
  label,
  value,
  base,
  note,
}: {
  label: string;
  value: number;
  base: number;
  note?: string;
}) {
  // Stamina passes its max as the baseline, which is the one stat where being
  // under it is normal — so a drained bar is left unmarked rather than flagged
  // as a debuff.
  const shift = label === 'STAM' ? 0 : Math.sign(value - Math.round(base));

  return (
    <div className={`sheet__stat${shift > 0 ? ' sheet__stat--up' : ''}${shift < 0 ? ' sheet__stat--down' : ''}`}>
      <dt>{label}</dt>
      <dd>
        {label === 'STAM' ? `${value}/${base}` : value}
        {note && <span className="sheet__stat-note">{note}</span>}
      </dd>
    </div>
  );
}
