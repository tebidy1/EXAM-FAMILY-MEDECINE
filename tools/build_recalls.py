#!/usr/bin/env python3
"""Merge batch-1 parsed recall records with verdict files into data/recalls.json.
Validates: id alignment, state enum, allowed source domains, query links present.
"""
import json, io, os, re, sys
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(BASE, '..')
PHASE0 = os.path.join(ROOT, 'data', 'recalls_verdicts')
VD = os.path.join(ROOT, 'data', 'recalls_verdicts')

ALLOWED = ('ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov',
           'wikem.org', 'merckmanuals.com', 'msdmanuals.com', 'litfl.com', 'cdc.gov',
           'who.int', 'ahajournals.org', 'resus.org.uk', 'radiopaedia.org', 'acog.org',
           'lifeinthefastlane.com')
STATES = ('confirmed', 'probable', 'unresolved')
UNRESOLVED_TEXT = 'لم نتمكن من تثبيت جواب علمي موثق لهذا البند — استخدم زر البحث للتحقق.'

# slice file -> verdict file (same record order)
PAIRS = [
    ('slice_doc20240802.json', 'verdicts_doc20240802.json'),
    ('slice_m1_a.json', 'verdicts_m1_a.json'),
    ('slice_m1_b.json', 'verdicts_m1_b.json'),
    ('slice_recall_a.json', 'verdicts_recall_a.json'),
    ('slice_recall_b.json', 'verdicts_recall_b.json'),
]

def bad(url, why):
    print(f'  !! {why}: {url}', file=sys.stderr)

def check_verdict(v, rid):
    errs = 0
    if v.get('id') != rid:
        print(f'  !! id mismatch: {v.get("id")} != {rid}', file=sys.stderr); errs += 1
    st = v['verdict']['state']
    if st not in STATES:
        bad(rid, f'illegal state {st}'); errs += 1
    q = v.get('queries') or {}
    if not q.get('google', '').startswith('https://www.google.com/search?q='):
        bad(rid, 'missing/bad google query'); errs += 1
    if not q.get('pubmed', '').startswith('https://pubmed.ncbi.nlm.nih.gov/?term='):
        bad(rid, 'missing/bad pubmed query'); errs += 1
    for s in v['verdict'].get('sources') or []:
        host = urlparse(s['url']).hostname or ''
        if not any(host == d or host.endswith('.' + d) for d in ALLOWED):
            bad(rid, f'disallowed source domain {host}'); errs += 1
        if not s['url'].startswith('http'):
            bad(rid, f'bad url {s["url"]}'); errs += 1
    if st == 'unresolved' and v['verdict'].get('sources'):
        pass  # tolerated but unusual
    return errs

def main():
    parsed = json.load(io.open(os.path.join(PHASE0, 'parsed_records.json'), encoding='utf-8'))
    by_id = {r['id']: r for r in parsed}
    out, errs, missing = [], 0, 0
    order = 0
    for slice_f, verdict_f in PAIRS:
        vpath = os.path.join(VD, verdict_f)
        spath = os.path.join(VD, slice_f)
        if not os.path.exists(vpath):
            print(f'-- verdict file missing, skipping: {verdict_f}', file=sys.stderr)
            missing += len(json.load(io.open(spath, encoding='utf-8')))
            continue
        verdicts = json.load(io.open(vpath, encoding='utf-8'))
        recs = json.load(io.open(spath, encoding='utf-8'))
        if len(verdicts) != len(recs):
            print(f'!! {verdict_f}: {len(verdicts)} verdicts vs {len(recs)} records', file=sys.stderr); errs += len(recs)
            continue
        for r, v in zip(recs, verdicts):
            errs += check_verdict(v, r['id'])
            p = by_id[r['id']]
            vd = v['verdict']
            out.append({
                'id': r['id'],
                'order': order,
                'source_file': p['source_file'],
                'serial': p['serial'],
                'page': p['page'],
                'type': p['kind_hint'],
                'raw_text': p['raw_text'],
                'raw_options': p['raw_options'] or None,
                'raw_answer': p['raw_answer'] or None,
                'raw_explanation': p['raw_explanation'] or None,
                'extraction_confidence': p['confidence'],
                'completeness': p['completeness'],
                'topic': v.get('topic') or '',
                'state': vd['state'],
                'answer': vd.get('answer'),
                'justification': vd.get('justification') or '',
                'sources': vd.get('sources') or [],
                'google_url': (v.get('queries') or {}).get('google'),
                'pubmed_url': (v.get('queries') or {}).get('pubmed'),
            })
            order += 1
    # sort: by source file then original serial order (slices already carry it)
    out.sort(key=lambda x: (x['source_file'], x['order']))
    for i, r in enumerate(out):
        r['order'] = i
    dest = os.path.join(ROOT, 'data', 'recalls.json')
    json.dump(out, io.open(dest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    states = {}
    for r in out:
        states[r['state']] = states.get(r['state'], 0) + 1
    print(f'wrote {len(out)} records -> {dest}; states={states}; errors={errs}; not-yet-covered={missing}')
    if errs:
        sys.exit(1)

if __name__ == '__main__':
    main()
