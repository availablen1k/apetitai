import { useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Menu } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { NAV_GROUPS, PAGE_TITLES } from '@/lib/nav';
import { api } from '@/api/client';
import { SheetTrigger } from '@/components/ui/sheet';

export default function AppTopBar() {
  const { t, lang, setLang } = useI18n();
  const { pathname } = useLocation();
  const fi = lang === 'fi';
  const titleKey = PAGE_TITLES[pathname] || (pathname.startsWith('/farms/') ? 'nav.farms' : 'nav.overview');
  const group = NAV_GROUPS.find((item) => item.items.some((page) => page.path === pathname || (page.path === '/farms' && pathname.startsWith('/farms/'))));
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30000, retry: 0 });
  const apiDown = health.isError;

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex min-h-[64px] w-full max-w-[1360px] items-center gap-3 px-4 sm:px-6 lg:px-10">
        <SheetTrigger asChild>
          <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground lg:hidden" aria-label={t('nav.openMenu')} data-testid="open-navigation">
            <Menu className="h-4 w-4" />
          </button>
        </SheetTrigger>

        <nav aria-label={t('nav.location')} className="min-w-0 flex-1 text-[12px]">
          <ol className="flex min-w-0 items-center gap-2">
            {group && <li className="hidden shrink-0 items-center gap-2 text-muted-foreground sm:flex">{t(`nav.group.${group.id}`)}<ChevronRight aria-hidden="true" className="h-3 w-3 text-muted-foreground/60" /></li>}
            <li aria-current="page" className="truncate font-medium text-foreground">{t(titleKey)}</li>
          </ol>
        </nav>

        {apiDown && <Link to="/settings" role="status" className="max-w-[130px] text-[11px] font-medium text-[#8C3B2E]">{fi ? 'Yhteys katkennut' : 'Connection unavailable'}</Link>}

        <div role="group" aria-label={t('nav.language')} className="flex shrink-0 items-center rounded-full border border-border bg-card p-0.5">
          {['fi', 'en'].map((code) => (
            <button
              key={code}
              type="button"
              aria-label={code === 'fi' ? 'Suomi' : 'English'}
              aria-pressed={lang === code}
              onClick={() => setLang(code)}
              className={`h-9 min-w-10 rounded-full px-3 text-[11.5px] font-semibold uppercase tracking-wide transition-colors ${
                lang === code ? 'bg-[#1B4968] text-[#EFF6FC]' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {code}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
