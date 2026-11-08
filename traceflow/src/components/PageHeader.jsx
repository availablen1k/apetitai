import { useI18n } from '@/lib/i18n';

export default function PageHeader({ eyebrow = undefined, title, description = undefined, actions = undefined, children = undefined }) {
  const { t } = useI18n();
  const showEyebrow = eyebrow && eyebrow !== t('app.name');
  return (
    <div className="mb-6 animate-fade">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          {showEyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
          <h1 className="font-heading text-[26px] leading-[1.15] tracking-tight text-foreground sm:text-[32px]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="min-w-0 max-w-full shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
