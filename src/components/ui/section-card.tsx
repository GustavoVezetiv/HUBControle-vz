type SectionCardProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="hub-card rounded-lg border border-ink-950/10 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-ink-950">{title}</h2>
      {description ? <p className="mt-1 text-sm leading-6 text-ink-600">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
