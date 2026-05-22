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
      <div className="rounded-[12px] bg-neutral-50/50 p-6 ring-1 ring-black/5">
        <h3 className="mb-4 text-sm font-medium">{title}</h3>
        <ul className="space-y-4">
          {steps.map((t, i) => (
            <li key={i} className="flex gap-3">
              <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px]">
                {i + 1}
              </div>
              <p className="text-sm text-neutral-600 text-pretty">{t}</p>
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
          className="aspect-[4/3] w-full rounded-[12px] object-cover outline-1 -outline-offset-1 outline-black/5"
        />
      )}
    </aside>
  );
}
