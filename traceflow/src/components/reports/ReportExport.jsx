import { useState } from 'react';
import { Check, ChevronDown, Download } from 'lucide-react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { exportReport } from '@/lib/reportExport';

export default function ReportExport({ report }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const [includeDetails, setIncludeDetails] = useState(false);
  const download = (format) => exportReport(report, format, lang, { includeDetails });
  const itemClass = 'cursor-pointer rounded-lg px-3 py-2 text-[12px] outline-none focus:bg-secondary';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => download('pdf')} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#1B4968] px-4 py-2 text-[12px] font-medium text-white hover:bg-[#22557A]" data-testid="report-pdf"><Download className="h-3.5 w-3.5" />{fi ? 'Lataa PDF' : 'Download PDF'}</button>
      <Menu.Root>
        <Menu.Trigger asChild><button className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[12px]" data-testid="report-more-downloads">{fi ? 'Muut latausvaihtoehdot' : 'More download options'}<ChevronDown className="h-3.5 w-3.5" /></button></Menu.Trigger>
        <Menu.Portal><Menu.Content align="end" sideOffset={6} className="surface z-50 max-w-[calc(100vw-32px)] p-1.5 shadow-lg">
          <Menu.Item className={itemClass} onSelect={() => download('docx')}>{fi ? 'Lataa Word-tiedosto' : 'Download Word document'}</Menu.Item>
          {report.run_id && <Menu.Item className={itemClass} asChild><a href={api.workbookUrl(report.run_id)}>{fi ? 'Lataa laskennan Excel-erittely' : 'Download detailed Excel workbook'}</a></Menu.Item>}
          <Menu.Item className={itemClass} onSelect={() => download('txt')}>{fi ? 'Lataa tekstitiedosto' : 'Download text file'}</Menu.Item>
          <Menu.Item className={itemClass} onSelect={() => download('md')}>{fi ? 'Lataa Markdown-tiedosto' : 'Download Markdown file'}</Menu.Item>
          {report.technical_sections?.length > 0 && <><Menu.Separator className="my-1 h-px bg-border" /><Menu.CheckboxItem className={`${itemClass} flex items-center gap-2`} checked={includeDetails} onCheckedChange={(checked) => setIncludeDetails(checked === true)} onSelect={(event) => event.preventDefault()}><span className="flex h-4 w-4 items-center justify-center rounded border border-input"><Menu.ItemIndicator><Check className="h-3 w-3" /></Menu.ItemIndicator></span>{fi ? 'Sisällytä laskennan lisätiedot' : 'Include calculation details'}</Menu.CheckboxItem></>}
        </Menu.Content></Menu.Portal>
      </Menu.Root>
    </div>
  );
}
