/**
 * The kanban board. Columns, order and colours come from the stage list it is
 * GIVEN — this component contains no stage names. Pass sales stages today,
 * delivery or installation stages in F3, same board.
 *
 * When the caller only has the PIPELINE_FALLBACK (API unreachable), it renders
 * the skeleton with whatever cards it was given — a board with its bones is
 * more useful than a blank page, and visibly degraded is honest.
 */
import type { ReactNode } from 'react';

export interface KanbanStage {
  key: string;
  label: string;
  order: number;
  color: string;
  terminal?: boolean;
}

export interface KanbanCard {
  id: string;
  stage: string;
  render: () => ReactNode;
}

interface Props {
  stages: KanbanStage[];
  cards: KanbanCard[];
  onCardClick?: (card: KanbanCard) => void;
}

export function KanbanBoard({ stages, cards, onCardClick }: Props) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);

  return (
    <div className="kanban">
      {ordered.map((stage) => {
        const inStage = cards.filter((c) => c.stage === stage.key);
        return (
          <section
            key={stage.key}
            className="kanban-col"
            style={{ '--col-color': stage.color } as React.CSSProperties}
            aria-label={`${stage.label} column`}
          >
            <header className="kanban-col-head">
              <span className="kanban-col-title">{stage.label}</span>
              <span className="kanban-count">{inStage.length}</span>
            </header>
            <div className="kanban-cards">
              {inStage.map((card) => (
                <article
                  key={card.id}
                  className="lead-card"
                  onClick={() => onCardClick?.(card)}
                >
                  {card.render()}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
