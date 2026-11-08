import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { NAV_GROUPS } from '@/lib/nav';
import { contextLink } from '@/lib/decisions';
import AppTopBar from '@/components/AppTopBar';
import FloatingAssistant from '@/components/assistant/FloatingAssistant';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

function NavItem({ item, onNavigate }) {
  const { t } = useI18n();
  const Icon = item.icon;
  const location=useLocation();
  return (
    <NavLink
      to={contextLink(item.path,location.search)}
      end={item.path === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group flex min-h-10 items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors focus-visible:outline-white ${
          isActive
            ? 'bg-[#EFF6FC] font-semibold text-[#1B4968] shadow-[0_1px_0_rgba(255,255,255,0.4)]'
            : 'text-[#D7E5F1] hover:bg-white/10 hover:text-white'
        }`
      }
    >
      <Icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={1.8} />
      <span className="truncate">{t(item.labelKey)}</span>
    </NavLink>
  );
}

function SidebarContent({ onNavigate = undefined, mobile = false }) {
  const { t } = useI18n();
  const location=useLocation();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 px-5 pb-6 pt-6">
        <Link to={contextLink('/',location.search)} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-white">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#1B4968]">
            <img src="/logo.png" alt="" width="56" height="56" className="h-14 w-14" />
          </div>
          <div className="min-w-0">
            <div className="font-heading text-[17px] leading-tight text-[#EFF6FC]">{t('app.name')}</div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-[#AFC4D5]">{t('app.tagline')}</div>
          </div>
        </Link>
        {mobile && <SheetClose asChild><button type="button" aria-label={t('nav.closeMenu')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#D7E5F1] hover:bg-white/10 focus-visible:outline-white"><X className="h-4 w-4" /></button></SheetClose>}
      </div>

      <nav aria-label={t('nav.main')} className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => {
          const items = group.items;
          return (
            <div key={group.id}>
              <div className="px-3 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9DB4C9]">
                {t(`nav.group.${group.id}`)}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavItem key={item.page} item={item} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-3 py-3">
        <Link to="/demo" onClick={onNavigate} className="flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[12px] text-[#C4D6E4] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-white"><BookOpen className="h-4 w-4" />{t('nav.guide')}</Link>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
    <div className="min-h-screen bg-background">
      <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-24 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground focus:translate-y-0">{t('nav.skip')}</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] bg-[#1B4968] lg:block">
        <SidebarContent />
      </aside>

      <SheetContent side="left" className="w-[min(320px,88vw)] border-0 bg-[#1B4968] p-0 [&>button]:hidden">
        <SheetTitle className="sr-only">{t('nav.main')}</SheetTitle>
        <SheetDescription className="sr-only">{t('app.name')}</SheetDescription>
        <SidebarContent mobile onNavigate={() => setOpen(false)} />
      </SheetContent>

      <div className="lg:pl-[264px]">
        <AppTopBar />
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1360px] px-4 pb-12 pt-7 outline-none sm:px-6 lg:px-10 lg:pt-8">
          <Outlet />
        </main>
      </div>
      <FloatingAssistant />
    </div>
    </Sheet>
  );
}
