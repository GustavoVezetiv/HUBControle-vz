type SectionCardProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="hub-card rounded-lg border border-ink-950/10 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-ink-950 dark:text-slate-100">{title}</h2>
      {description ? <p className="mt-1 text-sm leading-6 text-ink-600 dark:text-slate-300">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
