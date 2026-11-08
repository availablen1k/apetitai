"""Versioned package documents, source pointers and explicit method-evidence context."""
import hashlib
import json
import re

DOCUMENTS=['07_frameworks/framework_digest.md','../docs/NATURE_SBTN.md',
           '../docs/METHODOLOGY.md','../docs/SIMULATION_DESIGN.md']
REGISTRY='07_frameworks/source_registry.csv'


def identity(prefix,text):return prefix+hashlib.sha256(text.encode()).hexdigest()[:20]


def sections(text):
    lines=text.splitlines(keepends=True)
    headings=[]
    for i,line in enumerate(lines):
        match=re.match(r'^(#{1,6})\s+(.+?)\s*$',line.rstrip('\r\n'))
        if match:headings.append((i,len(match[1]),match[2]))
    if not headings:headings=[(0,1,'Document')]
    for pos,(start,level,heading) in enumerate(headings):
        end=headings[pos+1][0] if pos+1<len(headings) else len(lines)
        yield dict(heading=heading,heading_level=level,start_line=start+1,end_line=end,section_text=''.join(lines[start:end]))


def load_frameworks(b,config):
    db=b.db
    db.execute('INSERT INTO transformation VALUES(?,?)',('package_evidence','Retain local text, line ranges and registry pointers; no external retrieval, claim verification or certification. Explicit curated method-evidence links.'))
    references={}
    for row,raw in b.csv(REGISTRY):
        rid=identity('R',row['source']+'\n'+row['url'])
        eid=b.insert('reference_source',[rid],dict(row,reference_id=rid,verification_status='not_fetched_or_verified'),raw,'package_evidence')
        if eid:references[row['source']]=rid
    section_ids={}
    for path in DOCUMENTS:
        sid=b.source(path);text=(b.data/path).read_text(encoding='utf-8')
        did=identity('D',path)
        raw=b.raw(sid,'document',{'text':text})
        title=next((line.lstrip('# ').strip() for line in text.splitlines() if line.startswith('#')) ,path)
        b.insert('evidence_document',[did],dict(document_id=did,source_id=sid,relative_path=path,title=title,full_text=text,
                 verification_status='package_provided_not_independently_verified'),raw,'package_evidence')
        for part in sections(text):
            section_id=did+':L'+str(part['start_line'])
            record=b.raw(sid,f'lines:{part["start_line"]}-{part["end_line"]}',part)
            eid=b.insert('evidence_section',[section_id],dict(part,section_id=section_id,document_id=did),record,'package_evidence')
            b.dependency(eid,'evidence_document',[did],'exact line-range slice of versioned local document')
            section_ids[(path,part['heading'])]=section_id
    methods=json.loads(config.read_text())
    for method in methods:
        mid=method['method_id']
        b.insert('method_context',[mid],dict(method,review_status='unreviewed'))
        for table in method['tables']:
            db.execute('INSERT INTO model_method_link VALUES(?,?,?)',(table,mid,method['interpretation']))
        for evidence in method['evidence']:
            section_id=section_ids[(evidence['path'],evidence['heading'])]
            reference_id=references[evidence['reference']] if evidence.get('reference') else None
            key=identity('E',mid+section_id+str(reference_id))
            eid=b.insert('method_evidence',[key],dict(evidence_id=key,method_id=mid,section_id=section_id,
                         reference_id=reference_id,evidence_role=evidence['role'],note=evidence['note']))
            b.dependency(eid,'method_context',[mid],'explicit method interpretation; status retained')
            b.dependency(eid,'evidence_section',[section_id],'curated evidence/context link; role is not automatic validation')
            if reference_id:b.dependency(eid,'reference_source',[reference_id],'unfetched external reference pointer')
    for table in ['reference_source','evidence_document','evidence_section','method_context','method_evidence']:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            expr=REGISTRY+':'+col['name'] if table=='reference_source' else 'versioned local Markdown + line segmentation' if table in ('evidence_document','evidence_section') else 'model/nature/knowledge_map.json: explicit curated context'
            if table=='reference_source' and col['name']=='reference_id':expr='R + truncated SHA-256(source + newline + url); original source/url retained'
            if col['name']=='verification_status':expr='explicit not-fetched/not-independently-verified status'
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],expr,'package_evidence'))
