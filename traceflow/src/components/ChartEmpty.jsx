export default function ChartEmpty({ title, hint }) {
  return (
    <div className="flex h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 text-center">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}