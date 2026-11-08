import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { shortDate } from '@/lib/format';

const ACTOR_TONE = { reviewer: 'text-[#1C5B85]', system: 'text-muted-foreground', ai: 'text-[#8A5A1E]' };

export default function AuditTrail({ limit = 50, entityType = undefined, entityId = undefined }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', limit, entityType, entityId],
    queryFn: () => api.auditEvents({ limit, entity_type: entityType, entity_id: entityId }),
  });
  if (isLoading) return <p className="p-4 text-[12.5px] text-muted-foreground">{fi ? 'Ladataan…' : 'Loading…'}</p>;
  if (error) return <p className="p-4 text-[12.5px] text-[#8C3B2E]">{error.message}</p>;
  const items = data?.items || [];
  if (!items.length) return <p className="p-4 text-[12.5px] text-muted-foreground">{fi ? 'Ei tapahtumia vielä.' : 'No events yet.'}</p>;
  return (
    <div>
      <ul className="divide-y divide-border/60">
        {items.map((e) => (
          <li key={e.id} className="px-4 py-2.5 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10.5px] text-muted-foreground">#{e.seq}</span>
              <span className="font-medium">{e.event_type}</span>
              <span className={ACTOR_TONE[e.actor_kind] || ''}>{e.actor_kind}: {e.actor_label}</span>
              <span className="text-muted-foreground">{e.entity_type} {e.entity_id}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{shortDate(e.at)} {String(e.at).slice(11, 19)}</span>
            </div>
            {(e.reason || e.after) && (
              <p className="mt-0.5 line-clamp-2 font-mono text-[10.5px] text-muted-foreground">
                {e.reason ? `${fi ? 'perustelu' : 'reason'}: ${e.reason} · ` : ''}{e.after ? JSON.stringify(e.after).slice(0, 220) : ''}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {fi
          ? `${data.total} tapahtumaa. Loki on vain lisättävä (tietokanta estää muokkauksen ja poiston). Tarkastajien nimet ovat kirjoitettuja nimiä ilman kirjautumista, eivät todennettuja henkilöllisyyksiä.`
          : `${data.total} events. The log is append-only (the database rejects updates and deletes). Reviewer names are typed labels without login, not verified identities.`}
      </p>
    </div>
  );
}
