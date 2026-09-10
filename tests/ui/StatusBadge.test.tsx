import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StatusBadge } from '@/ui/combat/StatusBadge';
import { CombatantPanel } from '@/ui/combat/CombatantPanel';
import type { Combatant, StatusEntry } from '@/game/combat/types';

const poison = (stacks: number, remaining: number): StatusEntry => ({
  kind: 'poison',
  stacks,
  duration: { kind: 'turns', remaining },
});

const bleed = (stacks: number): StatusEntry => ({
  kind: 'bleed',
  stacks,
  duration: { kind: 'permanent' },
});

function combatant(statuses: StatusEntry[]): Combatant {
  return {
    id: 'foe',
    name: 'Foe',
    team: 'enemy',
    health: 100,
    maxHealth: 200,
    stamina: 60,
    maxStamina: 100,
    attack: 100,
    defense: 0,
    speed: 10,
    statuses,
    downed: false,
    resting: false,
  };
}

describe('StatusBadge', () => {
  it('shows the stack count', () => {
    const { container } = render(<StatusBadge entry={poison(3, 2)} />);
    expect(container.querySelector('.status__stacks')?.textContent).toBe('3');
  });

  it('shows turns remaining for a status that expires', () => {
    const { container } = render(<StatusBadge entry={poison(1, 2)} />);
    expect(container.querySelector('.status__turns')?.textContent).toBe('2');
  });

  it('omits the countdown for a status with no timer', () => {
    // Bleed waits until an attack consumes it, so a turn counter would be a lie.
    const { container } = render(<StatusBadge entry={bleed(2)} />);

    expect(container.querySelector('.status__turns')).toBeNull();
    expect(container.querySelector('.status__stacks')?.textContent).toBe('2');
  });

  it('renders an icon rather than text', () => {
    const { container } = render(<StatusBadge entry={poison(1, 2)} />);
    expect(container.querySelector('.status__icon svg')).not.toBeNull();
  });

  it('carries a readable label for screen readers', () => {
    render(<StatusBadge entry={poison(2, 3)} />);
    expect(screen.getByLabelText('Poison, 2 stacks, 3 turns remaining')).toBeInTheDocument();
  });

  it('uses singular wording for one stack and one turn', () => {
    render(<StatusBadge entry={poison(1, 1)} />);
    expect(screen.getByLabelText('Poison, 1 stack, 1 turn remaining')).toBeInTheDocument();
  });
});

describe('CombatantPanel statuses', () => {
  it('renders one badge per entry, not per kind', () => {
    // Two poison applications a turn apart expire a turn apart, so collapsing
    // them into one badge would force an invented countdown.
    const { container } = render(
      <CombatantPanel
        combatant={combatant([poison(1, 1), poison(2, 2)])}
        targetable={false}
        onSelect={() => {}}
      />
    );

    const badges = container.querySelectorAll('.status');
    expect(badges).toHaveLength(2);

    const turns = [...container.querySelectorAll('.status__turns')].map((n) => n.textContent);
    expect(turns).toEqual(['1', '2']);
  });

  it('shows mixed status kinds side by side', () => {
    const { container } = render(
      <CombatantPanel
        combatant={combatant([poison(2, 2), bleed(1)])}
        targetable={false}
        onSelect={() => {}}
      />
    );

    expect(container.querySelector('.status--poison')).not.toBeNull();
    expect(container.querySelector('.status--bleed')).not.toBeNull();
  });

  it('renders nothing in the status row when there are no statuses', () => {
    const { container } = render(
      <CombatantPanel combatant={combatant([])} targetable={false} onSelect={() => {}} />
    );

    expect(container.querySelectorAll('.status')).toHaveLength(0);
  });

  it('still flags a resting combatant', () => {
    const resting = { ...combatant([]), resting: true };
    const { container } = render(
      <CombatantPanel combatant={resting} targetable={false} onSelect={() => {}} />
    );

    const tags = container.querySelector('.unit__tags');
    expect(within(tags as HTMLElement).getByText('Resting')).toBeInTheDocument();
  });
});
