import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';
import { CardColumns } from './card-columns';

const cards = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length fixture
    <div key={i} data-testid={`card-${i}`}>
      Card {i}
    </div>
  ));

const columnOf = (testId: string) =>
  screen.getByTestId(testId).closest('div.flex.flex-col') as HTMLElement;

describe('CardColumns', () => {
  /*
   * The placement contract. A two-column grid lays children out row-major —
   * first left, second right, third left — so dealing evens and odds keeps
   * every card exactly where it already was. Only the row-height coupling
   * that left holes under short cards is gone.
   */
  it('puts the same cards in the same columns a two-column grid did', () => {
    render(<CardColumns>{cards(5)}</CardColumns>);

    const left = columnOf('card-0');
    const right = columnOf('card-1');

    expect(left).not.toBe(right);
    expect(left).toContainElement(screen.getByTestId('card-2'));
    expect(left).toContainElement(screen.getByTestId('card-4'));
    expect(right).toContainElement(screen.getByTestId('card-3'));
  });

  /* A conditional card yields `false`, which must not take a slot. */
  it('ignores a card that was not rendered at all', () => {
    render(
      <CardColumns>
        <div data-testid="first">first</div>
        {false && <div data-testid="skipped">skipped</div>}
        <div data-testid="second">second</div>
      </CardColumns>,
    );

    expect(screen.queryByTestId('skipped')).not.toBeInTheDocument();
    // Without the skip, "second" would land in the left column behind a hole.
    expect(columnOf('first')).not.toBe(columnOf('second'));
  });

  /* One card should not leave an empty second column taking half the width. */
  it('renders a single column when there is nothing to put beside it', () => {
    const { container } = render(
      <CardColumns>
        <div data-testid="only">only</div>
      </CardColumns>,
    );

    expect(container.querySelectorAll('div.flex.flex-col')).toHaveLength(1);
  });
});
