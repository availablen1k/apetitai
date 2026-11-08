import { Link, useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import DatasetTable from '@/components/dq/DatasetTable';
import EvidencePanel from '@/components/dq/EvidencePanel';
import AuditTrail from '@/components/AuditTrail';
import { useI18n } from '@/lib/i18n';

export default function DataPlatform() {
  const { t, lang } = useI18n();
  const fi = lang === 'fi';
  const navigate = useNavigate();
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  return (
    <div>
      <PageHeader
        title={fi ? 'Tietoalusta' : 'Data platform'}
        description={fi ? 'Tarkastele aineistojen kattavuutta, tallennettuja sarakeyhdistämisiä ja tuontihistoriaa.' : 'Browse dataset coverage, saved column mappings and import history.'}
        actions={<Link to="/data-quality?tab=import" className="inline-flex items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2.5 text-[12.5px] font-medium text-[#EFF6FC] hover:bg-[#22557A]"><Upload className="h-4 w-4" />{fi ? 'Tuo tiedostoja' : 'Upload files'}</Link>}
      />
      <DatasetTable />
      <details id="documents" open={hash === '#documents' || undefined} className="mt-4 scroll-mt-24 rounded-xl border border-border bg-card">
        <summary className="cursor-pointer px-5 py-3.5 text-[12.5px] font-medium">{fi ? 'Asiakirjat ja muut tiedostot' : 'Documents and other files'}</summary>
        <div className="border-t border-border p-4"><EvidencePanel onQueued={() => navigate('/data-quality?tab=import')} /></div>
      </details>
      <details id="history" open={hash === '#history' || undefined} className="mt-4 scroll-mt-24 rounded-xl border border-border bg-card" data-testid="change-history">
        <summary className="cursor-pointer px-5 py-3.5 text-[12.5px] font-medium">{t('dq.audit')}</summary>
        <div className="border-t border-border"><AuditTrail limit={100} /></div>
      </details>
    </div>
  );
}
