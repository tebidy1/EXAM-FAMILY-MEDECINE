#!/usr/bin/env python3
"""Parse phase-0 verbatim recall records into structured JSON.
Field labels are in Arabic per the phase-0 extraction format.
"""
import json, re, sys, io, os

BASE = os.path.dirname(os.path.abspath(__file__))
PHASE0 = os.path.join(BASE, '..', 'docs', 'exam-recalls', 'phase0-extraction')

# phase0 file -> (original source file, kind) ; first batch first
BATCH1 = {
    'VIS_doc20240802.md': ('DOC-20240802-WA0000..pdf', 'printed'),
    'REC_M1.md': ('M1.docx', 'printed'),
    'REC_recallAug.md': ('recall- Aug_082054.pdf', 'printed'),
}
ALL_FILES = dict(BATCH1)
ALL_FILES.update({
    'VIS_newdoc0826.md': ('New Doc 2024-08-26 19.17.52 (1).pdf', 'handwritten'),
    'VIS_exam2.md': ('امتحان ٢ (1).pdf', 'handwritten'),
    'VIS_emerg2.md': ('امتحان طواريء  (1).pdf', 'handwritten'),
    'VIS_wa0090.md': ('DOC-20250613-WA0090.pdf', 'printed'),
    'REC_9ju.md': ('9 ju (1).docx', 'printed'),
    'REC_S1.md': ('S1.docx', 'printed'),
    'REC_امتحان_التاني.md': ('امتحان  التاني (2).docx', 'printed'),
    'REC_OBS.md': ('OBS (1).pdf', 'printed'),
})

BULLETS = ['النص كما ورد', 'الخيارات', 'الجواب', 'الشرح', 'النوع', 'درجة الاكتمال', 'ثقة الاستخراج', 'صورة/شكل']
KEYMAP = {
    'النص كما ورد': 'raw_text', 'الخيارات': 'raw_options', 'الجواب': 'raw_answer',
    'الشرح': 'raw_explanation', 'النوع': 'kind_raw', 'درجة الاكتمال': 'completeness',
    'ثقة الاستخراج': 'confidence', 'صورة/شكل': 'figure_note',
}

def parse_file(path, source_file, kind):
    with io.open(path, encoding='utf-8') as fh:
        content = fh.read()
    # drop everything before first record
    m = re.search(r'^### ', content, re.M)
    if not m:
        return []
    blocks = re.split(r'^### ', content[m.start():], flags=re.M)
    recs = []
    for b in blocks:
        if not b.strip():
            continue
        header, _, body = b.partition('\n')
        hm = re.match(r'سؤال\s+(.+?)\s*—\s*(.*)$', header.strip())
        serial, page = (hm.group(1).strip(), hm.group(2).strip()) if hm else (header.strip()[:40], '')
        pm = re.search(r'صفحة\s+([\d\u0660-\u0669،\-–\s]+)', page)
        page_n = pm.group(1).strip() if pm else ''
        # split body into labeled bullets
        cur, fields = None, {KEYMAP[k]: [] for k in BULLETS}
        for line in body.split('\n'):
            bm = re.match(r'^\s*-\s*\*\*(.+?)\*\*\s*[:：]?\s*(.*)$', line)
            if bm:
                label = bm.group(1).strip()
                key = next((k for k in BULLETS if label.startswith(k)), None)
                if key:
                    cur = KEYMAP[key]
                    fields[cur].append(bm.group(2).strip())
                    continue
            if cur:
                fields[cur].append(line.strip())

        def val(k):
            return '\n'.join([x for x in fields[k] if x]).strip()

        txt = val('raw_text').strip('`').strip()
        if not txt:
            continue  # blank/non-record block
        def num(k):
            m2 = re.search(r'\d+', val(k))
            return int(m2.group()) if m2 else None
        recs.append({
            'source_file': source_file,
            'serial': serial,
            'page': page_n,
            'kind_hint': kind,
            'kind_raw': val('kind_raw'),
            'raw_text': txt,
            'raw_options': val('raw_options'),
            'raw_answer': val('raw_answer'),
            'raw_explanation': val('raw_explanation'),
            'figure_note': val('figure_note'),
            'completeness': num('completeness') or 0,
            'confidence': num('confidence') if num('confidence') is not None else 5,
        })
    return recs

def main():
    out = []
    for fname, (src, kind) in ALL_FILES.items():
        p = os.path.join(PHASE0, fname)
        if not os.path.exists(p):
            print(f'MISSING: {fname}', file=sys.stderr)
            continue
        recs = parse_file(p, src, kind)
        batch = 1 if fname in BATCH1 else 2
        for r in recs:
            r['batch'] = batch
            r['id'] = f"{'R1' if batch == 1 else 'R2'}-{re.sub(r'[^a-zA-Z0-9\u0600-\u06FF]', '', src)[:14]}-{r['serial']}"
        out.extend(recs)
        print(f'{fname}: {len(recs)} records (batch {batch})')
    dest = os.path.join(PHASE0, 'parsed_records.json')
    with io.open(dest, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    b1 = sum(1 for r in out if r['batch'] == 1)
    print(f'TOTAL {len(out)} records; batch1={b1}, batch2={len(out)-b1} -> {dest}')

if __name__ == '__main__':
    main()
