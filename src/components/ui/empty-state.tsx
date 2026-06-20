type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
};

export function EmptyState({ title, description, actionLabel }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-ink-950/18 bg-white/70 px-6 py-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-mint-100 text-lg font-semibold text-mint-600">
        VZ
      </div>
      <h2 className="mt-4 text-lg font-semibold text-ink-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-600">{description}</p>
      {actionLabel ? (
        <button
          type="button"
          disabled
          className="hub-action hub-action-secondary mt-5 rounded-md px-4 py-2.5 text-sm font-semibold opacity-60"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
