import { useState } from 'react';
import { EventBus } from '@/bridge/EventBus';
import { COMBAT_CONTENT } from '@/game/combat/content';
import { canPlayCard, cardDefOf, legalTargets } from '@/game/combat/engine';
import { discardsRequired, isEnemyTurn } from '@/state/combatStore';
import { getCombatActions, useCombatStore } from '@/state/useCombatStore';
import type { CombatState } from '@/game/combat/types';
import { CardDetail, type InspectedCard } from './CardDetail';
import { CardView } from './CardView';
import { cardRowProps } from './cardRows';
import { CombatantPanel } from './CombatantPanel';
import { SelectionStrip } from './SelectionStrip';

/**
 * The whole combat interface, drawn over the ArenaScene canvas.
 *
 * Everything that changes the battle is a tap: tap a card to pick it, tap a
 * combatant to aim it, tap End Turn to pass. The one held gesture reads rather
 * than acts — holding a card in hand blows it up so its rules text can be read,
 * and releasing puts it back without playing it.
 */
/** Which status label is showing. One at a time, screen-wide. */
interface OpenTip {
  combatantId: string;
  index: number;
}

export function CombatScreen() {
  const battle = useCombatStore((s) => s.battle);
  const [tip, setTip] = useState<OpenTip | null>(null);

  if (!battle) return null;

  // Opening one closes whatever was open, including itself.
  const toggleTip = (combatantId: string, index: number) =>
    setTip((open) =>
      open && open.combatantId === combatantId && open.index === index
        ? null
        : { combatantId, index },
    );

  return (
    <div className="combat">
      <EnemyRow battle={battle} tip={tip} onToggleTip={toggleTip} />
      <PartyRow battle={battle} tip={tip} onToggleTip={toggleTip} />
      <BottomBar battle={battle} />
      <SelectionStrip />
      <Banner battle={battle} />
    </div>
  );
}

// ── Rows of combatants ──────────────────────────────────────────────────────

interface RowProps {
  battle: CombatState;
  tip: OpenTip | null;
  onToggleTip: (combatantId: string, index: number) => void;
}

/** The open label's index for one combatant, or null if it isn't theirs. */
function tipFor(tip: OpenTip | null, combatantId: string): number | null {
  return tip && tip.combatantId === combatantId ? tip.index : null;
}

function targetSetFor(battle: CombatState): Set<string> {
  if (battle.phase !== 'selectTarget' || !battle.pendingCard) return new Set();
  return new Set(legalTargets(battle, COMBAT_CONTENT, battle.pendingCard));
}

function EnemyRow({ battle, tip, onToggleTip }: RowProps) {
  const targets = targetSetFor(battle);

  return (
    <div className="combat__enemies">
      {battle.enemyOrder.map((id) => {
        const combatant = battle.combatants[id];
        if (!combatant) return null;
        return (
          <CombatantPanel
            key={id}
            combatant={combatant}
            compact
            targetable={targets.has(id)}
            onSelect={(target) => getCombatActions().pickTarget(target)}
            openStatus={tipFor(tip, id)}
            onToggleStatus={(index) => onToggleTip(id, index)}
          />
        );
      })}
    </div>
  );
}

function PartyRow({ battle, tip, onToggleTip }: RowProps) {
  const targets = targetSetFor(battle);

  return (
    <div className="combat__party">
      {battle.playerOrder.map((id) => {
        const combatant = battle.combatants[id];
        if (!combatant) return null;
        return (
          <CombatantPanel
            key={id}
            combatant={combatant}
            targetable={targets.has(id)}
            onSelect={(target) => getCombatActions().pickTarget(target)}
            openStatus={tipFor(tip, id)}
            onToggleStatus={(index) => onToggleTip(id, index)}
          />
        );
      })}
    </div>
  );
}

// ── Hand, energy and turn controls ──────────────────────────────────────────

function BottomBar({ battle }: { battle: CombatState }) {
  const discardSelection = useCombatStore((s) => s.discardSelection);
  const needed = useCombatStore(discardsRequired);
  const [inspected, setInspected] = useState<InspectedCard | null>(null);

  const enemyActing = useCombatStore(isEnemyTurn);

  const isDiscarding = battle.phase === 'discarding';
  const isOver = battle.phase === 'victory' || battle.phase === 'defeat';
  if (isOver) return null;

  const actions = getCombatActions();
  const targeting = battle.phase === 'selectTarget';

  return (
    <div className="combat__bottom">
      <div className="combat__status">
        <span className="energy" aria-label={`${battle.energy} of ${battle.maxEnergy} energy`}>
          {Array.from({ length: battle.maxEnergy }, (_, i) => (
            <span key={i} className={i < battle.energy ? 'energy__pip energy__pip--full' : 'energy__pip'} />
          ))}
        </span>

        <span className="combat__round">Round {battle.round}</span>

        <span className="combat__piles">
          {battle.drawPile.length} draw · {battle.discardPile.length} discard
        </span>
      </div>

      {enemyActing && <div className="combat__enemy-turn">Enemy turn</div>}

      {targeting && (
        <div className="combat__prompt">
          <span>Choose a target</span>
          <button type="button" className="button button--ghost" onClick={() => actions.cancelTargeting()}>
            Cancel
          </button>
        </div>
      )}

      {isDiscarding && (
        <div className="combat__prompt">
          <span>
            Discard {Math.max(0, needed - discardSelection.length)} more
          </span>
          <button
            type="button"
            className="button"
            disabled={discardSelection.length < needed}
            onClick={() => actions.submitDiscards()}
          >
            Confirm
          </button>
        </div>
      )}

      <div {...cardRowProps('combat__hand', battle.hand.length)}>
        {battle.hand.map((instanceId) => {
          const def = cardDefOf(battle, COMBAT_CONTENT, instanceId);
          if (!def) return null;

          const check = canPlayCard(battle, COMBAT_CONTENT, instanceId);

          return (
            <CardView
              key={instanceId}
              card={def}
              playable={isDiscarding ? true : check.ok}
              blockedReason={isDiscarding ? undefined : check.reason}
              selected={battle.pendingCard === instanceId}
              markedForDiscard={discardSelection.includes(instanceId)}
              detail="compact"
              onInspect={setInspected}
              onClick={() => {
                if (isDiscarding) actions.toggleDiscard(instanceId);
                else actions.playCard(instanceId);
              }}
            />
          );
        })}
      </div>

      <CardDetail card={inspected} onDismiss={() => setInspected(null)} />

      {!isDiscarding && (
        <button
          type="button"
          className="button combat__end-turn"
          onClick={() => actions.endTurn()}
          disabled={targeting || enemyActing}
        >
          End turn
        </button>
      )}
    </div>
  );
}

// ── Victory / defeat ────────────────────────────────────────────────────────

function Banner({ battle }: { battle: CombatState }) {
  if (battle.phase !== 'victory' && battle.phase !== 'defeat') return null;
  const won = battle.phase === 'victory';

  return (
    <div className="combat__banner">
      <div className="combat__banner-panel">
        <h2>{won ? 'Victory' : 'Defeat'}</h2>
        <p>{won ? 'The arena falls quiet.' : 'Your team has fallen.'}</p>

        <button
          type="button"
          className="button"
          onClick={() => {
            getCombatActions().startBattle();
          }}
        >
          Fight again
        </button>

        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            getCombatActions().endBattle();
            EventBus.emit('arena:exit');
          }}
        >
          Leave arena
        </button>
      </div>
    </div>
  );
}
