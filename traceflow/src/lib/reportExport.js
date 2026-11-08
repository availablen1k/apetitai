import { jsPDF } from 'jspdf';
import { shortDate } from '@/lib/format';

const STATUS = {
  draft: { fi: 'luonnos', en: 'draft' },
  review: { fi: 'katselmoinnissa', en: 'in review' },
  approved: { fi: 'hyväksytty', en: 'approved' },
};

const statusLabel = (s, fi) => (STATUS[s] ? STATUS[s][fi ? 'fi' : 'en'] : s || '');

const slug = (title) =>
  (title || 'report')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'report';

const download = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const metaLine = (r, fi) => {
  const bits = [`${fi ? 'Kausi' : 'Period'}: ${r.period || '—'}`, `${fi ? 'Tila' : 'Status'}: ${statusLabel(r.status, fi)}`];
  if (r.approved_by) {
    const when = r.approved_at ? ` ${shortDate(r.approved_at)}` : '';
    bits.push(`${fi ? 'Hyväksynyt' : 'Approved by'}: ${r.approved_by}${when}`);
  }
  return bits.join(' · ');
};

const citationText = (c) => {
  if (!c || typeof c !== 'object') return String(c || '');
  const ref = c.ref || c.id;
  return [c.label, c.source, ref].filter(Boolean).join(' · ');
};

// jsPDF's core fonts cover Latin-1 only, so map the few typographic characters used in reports.
const latin = (s) =>
  String(s ?? '')
    .replace(/₂/g, '2')
    .replace(/[–—−]/g, '-')
    .replace(/→/g, '->')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/·/g, '|')
    .replace(/[^\x00-\xFF]/g, '');

export const reportToMarkdown = (r, lang = 'fi') => {
  const fi = lang === 'fi';
  const out = [`# ${r.title || ''}`, '', `**${metaLine(r, fi)}**`, ''];
  (r.sections || []).forEach((s) => {
    out.push(`## ${s.heading || ''}`, '', s.body || '', '');
    if (s.citations?.length) out.push(`_${fi ? 'Lähteet' : 'Sources'}: ${s.citations.join(', ')}_`, '');
  });
  if (r.citations?.length) {
    out.push(`## ${fi ? 'Lähteet' : 'Sources'}`, '');
    r.citations.forEach((c) => out.push(`- ${citationText(c)}`));
  }
  return out.join('\n');
};

export const reportToText = (r, lang = 'fi') => {
  const fi = lang === 'fi';
  const out = [(r.title || '').toUpperCase(), metaLine(r, fi), ''];
  (r.sections || []).forEach((s) => {
    out.push(s.heading || '', '-'.repeat(Math.min(60, (s.heading || '').length || 10)), s.body || '', '');
    if (s.citations?.length) out.push(`${fi ? 'Lähteet' : 'Sources'}: ${s.citations.join(', ')}`, '');
  });
  if (r.citations?.length) {
    out.push(fi ? 'LÄHTEET' : 'SOURCES', '');
    r.citations.forEach((c) => out.push(`  - ${citationText(c)}`));
  }
  return out.join('\n');
};

export const reportToDocHtml = (r, lang = 'fi') => {
  const fi = lang === 'fi';
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const sections = (r.sections || [])
    .map(
      (s) => `<h2>${esc(s.heading)}</h2>
<p>${esc(s.body).replace(/\n/g, '<br />')}</p>
${s.citations?.length ? `<p class="cite">${fi ? 'Lähteet' : 'Sources'}: ${esc(s.citations.join(', '))}</p>` : ''}`
    )
    .join('\n');
  const refs = r.citations?.length
    ? `<h2>${fi ? 'Lähteet' : 'Sources'}</h2><ul>${r.citations.map((c) => `<li>${esc(citationText(c))}</li>`).join('')}</ul>`
    : '';

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8" /><title>${esc(r.title)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1a2630; line-height: 1.5; }
  h1 { font-size: 22pt; color: #1b4968; margin: 0 0 6pt; }
  .meta { font-size: 9.5pt; color: #6b7c8c; margin-bottom: 18pt; }
  h2 { font-size: 13pt; color: #1b4968; margin: 18pt 0 4pt; }
  p { margin: 0 0 8pt; }
  .cite { font-size: 9pt; color: #6b7c8c; }
  ul { margin: 0 0 8pt 16pt; } li { font-size: 10pt; color: #3d4c59; }
</style></head>
<body>
<h1>${esc(r.title)}</h1>
<p class="meta">${esc(metaLine(r, fi))}</p>
${sections}
${refs}
</body></html>`;
};

export const reportToPdf = (r, lang = 'fi') => {
  const fi = lang === 'fi';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const maxWidth = width - margin * 2;
  let y = margin;

  const write = (text, { size = 10, bold = false, color = [26, 38, 48], gap = 6, indent = 0 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(latin(text), maxWidth - indent);
    lines.forEach((line) => {
      if (y + size + 2 > height - margin - 18) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin + indent, y);
      y += size + 4;
    });
    y += gap;
  };

  write(r.title, { size: 18, bold: true, color: [27, 73, 104], gap: 4 });
  write(metaLine(r, fi), { size: 9, color: [107, 124, 140], gap: 16 });

  (r.sections || []).forEach((s) => {
    write(s.heading, { size: 12.5, bold: true, color: [27, 73, 104], gap: 3 });
    write(s.body,{size:s.key==='result'?11.5:10,gap:8});
    if (s.citations?.length) write(`${fi ? 'Lähteet' : 'Sources'}: ${s.citations.join(', ')}`, { size: 8.5, color: [107, 124, 140], gap: 12 });
  });

  if (r.citations?.length) {
    write(fi ? 'Lähteet' : 'Sources', { size: 12.5, bold: true, color: [27, 73, 104], gap: 3 });
    r.citations.forEach((c) => write(`• ${citationText(c)}`, { size: 9.5, color: [61, 76, 89], gap: 2, indent: 8 }));
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 162, 172);
    doc.text(`${p} / ${pages}`, width - margin, height - 24, { align: 'right' });
  }

  doc.save(`${slug(r.title)}.pdf`);
};

// Drafts store both language versions; the export follows the interface language.
export const localizeReport = (r, lang = 'fi') => {
  const alt = lang === 'en' ? r.sections_en : r.sections_fi;
  return {
    ...r,
    title: (lang === 'en' ? r.title_en : r.title_fi) || r.title,
    summary: r.reader_version && alt?.length ? alt.find((section) => section.key === 'result')?.body || r.summary : r.summary,
    sections: Array.isArray(alt) && alt.length ? alt : r.sections || [],
    technical_sections: (lang === 'en' ? r.technical_sections_en : r.technical_sections_fi) || r.technical_sections || [],
  };
};

export const exportReport = (report, format, lang = 'fi', options = {}) => {
  const content = localizeReport(report, lang);
  const localized = { ...content, sections: [...content.sections, ...(options.includeDetails ? content.technical_sections : [])] };
  const name = slug(localized.title);
  if (format === 'pdf') return reportToPdf(localized, lang);
  if (format === 'docx') {
    return download(new Blob([reportToDocHtml(localized, lang)], { type: 'application/msword;charset=utf-8' }), `${name}.doc`);
  }
  if (format === 'md') {
    return download(new Blob([reportToMarkdown(localized, lang)], { type: 'text/markdown;charset=utf-8' }), `${name}.md`);
  }
  return download(new Blob([reportToText(localized, lang)], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
};
