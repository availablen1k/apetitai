import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Expand, MousePointer2, RotateCcw, X } from 'lucide-react';
import { connectedFootprintPath, layoutFootprintFlow } from '@/lib/footprintFlowLayout';
import { Button } from '@/components/ui/button';

export const FLOW_COLORS = { scope1: '#34759B', scope2: '#B68235', scope3: '#E3765D', flag: '#36866B', unclassified: '#8B929B' };
const color = (item) => item.color || FLOW_COLORS[item.land] || FLOW_COLORS[item.scope] || '#8B929B';
const shorten = (name, max) => name.length > max ? name.slice(0, max - 1) + '…' : name;

function FlowCanvas({ graph, lang, format, focus, onFocus, variant }) {
  const fi = lang === 'fi';
  const incidents = variant === 'incidents';
  const unit = incidents ? fi ? 'havaintoa' : 'incidents' : 'tCO₂e';
  const yearName = (year) => year === 'undated' ? fi ? 'Ilman vuotta' : 'Undated' : year;
  const root = useRef(null);
  const [width, setWidth] = useState(1000);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const resize = new ResizeObserver(([entry]) => setWidth(Math.max(960, Math.floor(entry.contentRect.width))));
    if (root.current) resize.observe(root.current);
    return () => resize.disconnect();
  }, []);
  const rows = Math.max(...['group', 'source', 'scope'].map((kind) => graph.nodes.filter((n) => n.kind === kind).length));
  const plotHeight = rows <= 3 ? 360 : rows <= 6 ? 480 : 580;
  const layout = useMemo(() => layoutFootprintFlow(graph, width, plotHeight), [graph, width, plotHeight]);
  const active = useMemo(() => connectedFootprintPath(graph, hover?.nodeId || focus, hover?.linkIndex), [graph, hover?.nodeId, hover?.linkIndex, focus]);
  const total = graph.nodes.filter((n) => n.kind === 'scope').reduce((sum, n) => sum + n.value, 0);
  const share = (value) => new Intl.NumberFormat(fi ? 'fi-FI' : 'en-GB', { style: 'percent', maximumFractionDigits: value / total < 0.01 ? 2 : 1 }).format(total ? value / total : 0);
  const compact = (value) => new Intl.NumberFormat(fi ? 'fi-FI' : 'en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const show = (event, item) => {
    const bounds = root.current.getBoundingClientRect();
    const target = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || target.x + target.width / 2;
    const y = event.clientY || target.y;
    const hovered = item.linkIndex != null ? graph.links[item.linkIndex] : graph.nodes.find((n) => n.id === item.nodeId);
    const tooltipHeight = 148 + (hovered.yearly.length > 1 ? hovered.yearly.length * 21 : 0);
    setHover({ ...item, x: Math.max(8, Math.min(bounds.width - 310, x - bounds.x + 14)), y: Math.max(8, Math.min(plotHeight + 38 - tooltipHeight, y - bounds.y + 18)) });
  };
  const tooltip = hover?.linkIndex != null ? graph.links[hover.linkIndex] : graph.nodes.find((n) => n.id === hover?.nodeId);
  return <div ref={root} className="relative min-w-0" onMouseLeave={() => setHover(null)}>
    <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-[#DFE7EB] bg-[#FCFDFE]" tabIndex={0} role="region" aria-label={incidents ? fi ? 'Havaintojen yhteydet. Vieritä tarvittaessa sivusuunnassa.' : 'Incident connections. Scroll sideways on small screens.' : fi ? 'Päästövirrat. Pienellä näytöllä voit vierittää sivusuunnassa.' : 'Emissions flow. Scroll sideways on small screens.'} data-testid={incidents ? 'incident-sankey' : 'footprint-sankey'} onKeyDown={(e) => { if (e.key === 'Escape') { onFocus(null); setHover(null); } }}>
      <div style={{ width, minWidth: 960 }}>
        <svg width={width} height={plotHeight + 48} role="group" aria-label={incidents ? fi ? 'Vuorovaikutteinen havaintojen Sankey-kaavio' : 'Interactive incident Sankey diagram' : fi ? 'Vuorovaikutteinen päästöjen Sankey-kaavio' : 'Interactive emissions Sankey diagram'}>
          <g fill="#657A88" fontSize={10} fontWeight={600} letterSpacing="1.1" aria-hidden="true">
            <text x={18} y={24}>{incidents ? fi ? 'LÄHDEAINEISTOT' : 'SOURCE DATASETS' : fi ? 'PÄÄSTÖLÄHTEET' : 'SOURCE GROUPS'}</text>
            <text x={width / 2 - 32} y={24}>{incidents ? fi ? 'HAVAINTOTYYPIT' : 'INCIDENT TYPES' : fi ? 'MATERIAALIT JA TOIMINTA' : 'MATERIALS & ACTIVITIES'}</text>
            <text x={width - 210} y={24}>{incidents ? fi ? 'KRIITTISYYS' : 'CRITICALITY' : fi ? 'SCOPE JA FLAG' : 'SCOPE & FLAG'}</text>
          </g>
          <g transform="translate(0,36)">
            <g className="flow-ribbons" aria-hidden="true">
              {layout.links.map((link) => <path key={link.index} d={link.path} fill="none" stroke={color(link)} strokeWidth={link.width} strokeOpacity={active.active ? active.links.has(link.index) ? 0.66 : 0.035 : 0.27} className="pointer-events-none transition-[stroke-opacity] duration-200 motion-reduce:transition-none" data-testid="flow-ribbon" data-active={active.links.has(link.index)} />)}
            </g>
            <g className="flow-link-targets">
              {layout.links.map((link) => <path key={link.index} d={link.path} fill="none" stroke="transparent" strokeWidth={Math.max(14, link.width)} className="cursor-pointer" onMouseEnter={(e) => show(e, { linkIndex: link.index })} onMouseMove={(e) => show(e, { linkIndex: link.index })} onMouseLeave={() => setHover(null)} onClick={() => { onFocus(link.targetNode.id); setHover(null); }} data-testid="flow-link-target" />)}
            </g>
            <g className="flow-nodes">
              {layout.nodes.map((node) => {
                const selected = focus === node.id;
                const dimmed = active.active && !active.nodes.has(node.index);
                const left = node.kind === 'group';
                const labelX = left ? node.x - 14 : node.x + node.width + 12;
                const labelWidth = left ? 174 : node.kind === 'scope' ? 184 : Math.max(160, Math.min(210, width / 2 - 236));
                const cy = node.y + node.height / 2;
                const maxChars = Math.floor(labelWidth / 6.2);
                return <g key={node.id} role="button" tabIndex={0} aria-pressed={selected} aria-label={`${node.label[lang]}: ${format(node.value)} ${unit}, ${share(node.value)}. ${fi ? 'Valitse virta' : 'Pin this flow'}`} data-testid="flow-node" data-node-id={node.id} data-kind={node.kind} data-active={active.nodes.has(node.index)} data-ai-context={JSON.stringify({ node_id: node.id, label: node.label[lang] })}
                  onClick={() => { onFocus(selected ? null : node.id); setHover(null); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(selected ? null : node.id); setHover(null); } }}
                  onMouseEnter={(e) => show(e, { nodeId: node.id })} onMouseMove={(e) => show(e, { nodeId: node.id })} onMouseLeave={() => setHover(null)} onFocus={(e) => show(e, { nodeId: node.id })} onBlur={() => setHover(null)}
                  className="cursor-pointer outline-none transition-opacity duration-200 focus-visible:[&>.flow-bar]:stroke-[#102F44] motion-reduce:transition-none" style={{ opacity: dimmed ? 0.24 : 1 }}>
                  <rect x={node.x - 6} y={node.y - 12} width={node.width + 12} height={Math.max(28, node.height + 24)} fill="transparent" />
                  <rect className="flow-bar" x={node.x} y={node.y} width={node.width} height={Math.max(0.75, node.height)} rx={3} fill={color(node)} stroke={selected ? '#143E56' : 'transparent'} strokeWidth={3} />
                  <g>
                    <rect x={left ? labelX - labelWidth : labelX - 4} y={cy - 18} width={labelWidth + 4} height={35} rx={5} fill="#FCFDFE" fillOpacity={0.94} />
                    <text x={labelX} y={cy - 3} textAnchor={left ? 'end' : 'start'} fill="#233E50" fontSize={12} fontWeight={selected || node.kind === 'scope' ? 650 : 500}>{shorten(node.label[lang], maxChars)}</text>
                    <text x={labelX} y={cy + 13} textAnchor={left ? 'end' : 'start'} fill="#71838E" fontSize={10.5}>{compact(node.value)} {unit} · {share(node.value)}</text>
                  </g>
                </g>;
              })}
            </g>
          </g>
        </svg>
      </div>
    </div>
    {tooltip && <div role="tooltip" data-testid="flow-tooltip" className="pointer-events-none absolute z-20 w-[294px] max-w-[calc(100%-16px)] rounded-xl border border-[#D7E3E9] bg-white p-4 text-[12px] shadow-xl" style={{ left: hover.x, top: hover.y }}>
      <p className="font-semibold leading-relaxed text-[#213F51]">{hover.linkIndex != null ? `${graph.nodes[tooltip.source].label[lang]} → ${graph.nodes[tooltip.target].label[lang]}` : tooltip.label[lang]}</p>
      <p className="mt-2 text-[19px] font-semibold tabular-nums text-[#1B4968]">{format(tooltip.value)} <span className="text-[11px] font-normal text-muted-foreground">{unit}</span></p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{share(tooltip.value)} {incidents ? fi ? 'valituista havainnoista' : 'of selected incidents' : fi ? 'valinnan positiivisista päästöistä' : 'of selected positive emissions'}</p>
      {tooltip.yearly.length > 1 && <div className="mt-3 space-y-1.5 border-t border-border pt-2.5">{tooltip.yearly.map((year) => <div key={year.year} className="flex justify-between gap-3 text-[11px]"><span className="text-muted-foreground">{yearName(year.year)}</span><span className="tabular-nums">{format(year.value)} {unit}</span></div>)}</div>}
      <p className="mt-3 text-[10.5px] text-muted-foreground">{fi ? 'Valitse pitääksesi virran korostettuna.' : 'Click to pin and explore this flow.'}</p>
    </div>}
  </div>;
}

export default function FlowDiagram({ graph, lang, format, focus, onFocus, onExplore, onRecords, variant = 'emissions' }) {
  const fi = lang === 'fi';
  const incidents = variant === 'incidents';
  const unit = incidents ? fi ? 'havaintoa' : 'incidents' : 'tCO₂e';
  const dialog = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const selected = graph.nodes.find((node) => node.id === focus);
  useEffect(() => { if (expanded) dialog.current?.showModal(); }, [expanded]);
  const explore = (node, member) => {
    if (incidents) onExplore({ kind: node.kind, id: member?.id || node.id, node_id: node.id });
    else if (node.kind === 'scope') onExplore({ flow_scope: node.scope, flow_land: node.land, flow_group: '', flow_source: '' });
    else onExplore(node.kind === 'group' ? { flow_group: member.id, flow_source: '' } : { flow_source: member.id, flow_group: '' });
    if (expanded) dialog.current?.close();
  };
  const canvas = <FlowCanvas graph={graph} lang={lang} format={format} focus={focus} onFocus={onFocus} variant={variant} />;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground"><MousePointer2 className="h-3.5 w-3.5 shrink-0" />{fi ? 'Osoita virtaa. Valitse palkki tutkiaksesi tarkemmin.' : 'Hover to trace a path. Click a bar to explore it.'}</p>
      <div className="flex items-center gap-2">{focus && <button className="inline-flex items-center gap-1.5 text-[11.5px] text-[#2E7099] hover:underline" data-testid="flow-clear-focus" onClick={() => onFocus(null)}><RotateCcw className="h-3 w-3" />{fi ? 'Poista korostus' : 'Clear selection'}</button>}<Button variant="outline" size="sm" onClick={() => setExpanded(true)} data-testid="flow-expand"><Expand className="mr-1.5 h-3.5 w-3.5" />{fi ? 'Suurenna' : 'Expand'}</Button></div>
    </div>
    {canvas}
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">{incidents ? fi ? 'Pienet ryhmät on yhdistetty Muut-ryhmiin. Jokainen havainto lasketaan kerran. Rajaa ryhmään tutkiaksesi tarkemmin.' : 'Small groups are combined into Other. Each incident is counted once. Isolate a group to explore it in detail.' : fi ? 'Pienet lähteet on yhdistetty Muut-ryhmiin. Kaikki päästöt ovat mukana. Rajaa ryhmään tai materiaaliin nähdäksesi sen pienemmätkin virrat.' : 'Small sources are grouped into Other. All emissions remain included. Isolate a group or material to see its smaller flows at a readable scale.'}</p>
    {selected && <div className="rounded-xl border border-[#CCDEE8] bg-[#F3F8FB] p-4" data-testid="flow-selection">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#668091]">{fi ? 'Valittu virta' : 'Selected flow'}</p><h3 className="mt-1 text-[15px] font-semibold text-[#21475F]">{selected.label[lang]}</h3><p className="mt-1 text-[13px] tabular-nums">{format(selected.value)} {unit}</p></div><div className="flex flex-wrap gap-2">{selected.members.length <= 1 && <Button size="sm" variant="outline" data-testid="flow-isolate" onClick={() => explore(selected, selected.members[0])}>{fi ? 'Rajaa tähän' : 'Isolate this flow'}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>}<Button size="sm" variant="outline" onClick={() => { if (expanded) dialog.current?.close(); onRecords(); }} data-testid="flow-show-records">{incidents ? fi ? 'Näytä havainnot' : 'View incidents' : fi ? 'Näytä lähderivit' : 'View source records'}</Button></div></div>
      {selected.yearly.length > 1 && <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">{selected.yearly.map((year) => <span key={year.year}>{year.year === 'undated' ? fi ? 'Ilman vuotta' : 'Undated' : year.year}: <span className="font-medium tabular-nums text-foreground">{format(year.value)} {unit}</span></span>)}</div>}
      {selected.members.length > 1 && <details className="mt-3 text-[12px]" open={selected.kind === 'group'}><summary className="cursor-pointer font-medium text-[#2E7099]">{fi ? 'Tutki ryhmän lähteitä' : 'Explore the sources inside'} ({selected.members.length})</summary><div className="mt-2 grid max-h-[240px] gap-1 overflow-y-auto sm:grid-cols-2">{selected.members.map((member) => <button key={member.id} onClick={() => explore(selected, member)} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-white" data-testid="flow-explore-member"><span>{member.label[lang]}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#2E7099]" /></button>)}</div></details>}
    </div>}
    <dialog ref={dialog} onClose={() => setExpanded(false)} className="max-h-[94vh] w-[min(1500px,calc(100vw-24px))] max-w-none rounded-2xl border border-border bg-white p-4 shadow-2xl backdrop:bg-[#122E40]/45 sm:p-6" aria-label={incidents ? fi ? 'Suurempi havaintokaavio' : 'Expanded incident flow' : fi ? 'Suurempi päästövirtakaavio' : 'Expanded emissions flow'} data-testid="flow-dialog">
      <div className="mb-4 flex items-center justify-between gap-4"><h3 className="font-heading text-xl text-[#1B4968]">{incidents ? fi ? 'Miten havainnot liittyvät toisiinsa' : 'How incidents connect' : fi ? 'Mistä päästömme syntyvät' : 'Where our carbon comes from'}</h3><Button variant="outline" size="sm" onClick={() => dialog.current?.close()} aria-label={fi ? 'Sulje suurempi kaavio' : 'Close expanded chart'}><X className="h-4 w-4" /></Button></div>
      {expanded && canvas}
      <p className="mt-3 text-[12px] text-muted-foreground">{fi ? 'Osoita virtaa tai valitse palkki. Sulje palataksesi valinnan tietoihin.' : 'Hover to trace paths or click to pin a flow. Close to explore the selected flow below the chart.'}</p>
    </dialog>
  </div>;
}
