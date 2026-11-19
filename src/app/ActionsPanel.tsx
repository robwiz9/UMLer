import type { ReactNode } from "react";

export interface ActionItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

interface ActionsPanelProps {
  readonly actions: readonly ActionItem[];
}

export const ActionsPanel = ({ actions }: ActionsPanelProps) => (
  <section className="panel actions-panel" aria-label="Actions">
    <div className="panel-heading">
      <span>Actions</span>
    </div>
    {actions.length === 0 ? (
      <div className="actions-empty"><p>Select a compatible object to see actions.</p></div>
    ) : (
      <div className="actions-list">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="action-row"
            onClick={action.onClick}
          >
            <span className="action-icon" aria-hidden="true">
              {action.icon}
            </span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    )}
  </section>
);

export const VoltageActionIcon = () => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
    <path
      d="M2 11C5 4 12 4 15 9"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M11.05 8.7 16 11.05l-.18-5.56"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CurrentActionIcon = () => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
    <path
      d="M2 8h14"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="m12 4.6 4 3.4-4 3.4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const LoopCurrentActionIcon = () => (
  <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
    <path
      d="M9 13a6 6 0 1 0-6-6"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M3 4.2 3 7l2.8-.2"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
