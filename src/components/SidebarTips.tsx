export function SidebarTips({
  title,
  steps,
  imageSrc,
  imageAlt,
}: {
  title: string;
  steps: string[];
  imageSrc?: string;
  imageAlt?: string;
}) {
  return (
    <aside className="col-span-12 flex flex-col gap-8 lg:col-span-4">
      <div className="rounded-lg bg-background/50 p-6 ring-1 ring-border/5">
        <h3 className="mb-4 text-sm font-medium">{title}</h3>
        <ul className="space-y-4">
          {steps.map((t, i) => (
            <li key={i} className="flex gap-3">
              <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-border text-[10px]">
                {i + 1}
              </div>
              <p className="text-sm text-secondary-foreground text-pretty">{t}</p>
            </li>
          ))}
        </ul>
      </div>

      {imageSrc && (
        <img
          src={imageSrc}
          alt={imageAlt ?? ""}
          width={800}
          height={608}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-lg object-cover outline-1 -outline-offset-1 outline-border/5"
        />
      )}
    </aside>
  );
}
