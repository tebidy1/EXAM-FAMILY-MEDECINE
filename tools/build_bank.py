#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the app's question bank from the extraction output.

  python tools/build_bank.py [path/to/questions_v54.jsonl]

Reads the unique-question file written by the extraction pipeline, files every
usable question under one of the twelve sections of the SCFHS Family Medicine
blueprint, and writes data/questions/*.json, data/sections.json and
data/blueprint.json. Run tools/validate_data.js afterwards.

A question is usable when it has four or five complete options and an answer
letter. Everything else (no answer, missing options, flagged for review) is
counted in data/bank_report.json and left out.

The section is decided by keyword scoring (SECTION_RULES). It is a first pass:
bank_report.json lists the score margin so weak calls can be reviewed.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DEFAULT_SRC = Path(r"D:\PREP\telegram_monitor\_extraction_v54\questions_v54.jsonl")

# id, file, English, Arabic, icon, blueprint weight (SCFHS FM blueprint, all three exams)
SECTIONS = [
    ("family-medicine", "FamilyMedicine", "Family Medicine", "طب الأسرة", "👨‍👩‍👧", 19),
    ("internal-medicine", "InternalMedicine", "Internal Medicine", "الباطنة", "🩺", 11),
    ("pediatrics", "Pediatrics", "Pediatrics", "الأطفال", "🧒", 10),
    ("obgyn", "OBGYN", "Obstetrics & Gynecology", "النساء والولادة", "🤰", 10),
    ("emergency", "Emergency", "Emergency Medicine", "الطوارئ", "🚑", 10),
    ("psychiatry", "Psychiatry", "Psychiatry", "الطب النفسي", "🧠", 9),
    ("surgery", "Surgery", "General Surgery", "الجراحة العامة", "🩹", 6),
    ("dermatology", "Dermatology", "Dermatology", "الجلدية", "🧴", 5),
    ("orthopedics", "Orthopedics", "Orthopedics & MSK", "العظام والعضلات", "🦴", 5),
    ("ophthalmology", "Ophthalmology", "Ophthalmology", "العيون", "👁️", 5),
    ("ent", "ENT", "Otolaryngology", "الأنف والأذن والحنجرة", "👂", 5),
    ("radiology", "Radiology", "Radiology", "الأشعة", "🩻", 5),
]

# keyword -> weight. Matched as whole-word prefixes on lower-cased text.
SECTION_RULES = {
    "pediatrics": {
        r"\d+[\s-]*(day|week|wk|month|mo)s?[\s-]*old": 4, r"\b([1-9]|1[0-2])[\s-]*(year|yr|y)s?[\s-]*old": 3,
        "infant": 4, "neonat": 4, "newborn": 4, "toddler": 4, "child": 3, "boy": 2, "girl": 2,
        "pediatric": 4, "his mother": 2, "her mother": 2, "brought by": 1, "milestone": 4,
        "breastfe": 1, "kawasaki": 4, "croup": 4, "bronchiolitis": 4, "intussusception": 4,
        "pyloric stenosis": 4, "enuresis": 3, "febrile seizure": 4, "growth chart": 4,
        "failure to thrive": 4, "well baby": 4, "school": 1, "adhd": 3, "autism": 3,
    },
    "obgyn": {
        "pregnan": 4, "gestation": 4, r"\bg\d+\s?p\d+": 4, "antenatal": 4, "prenatal": 4, "postpartum": 4,
        "postnatal": 3, "labor": 2, "labour": 3, "deliver": 2, "cesarean": 4, r"\bc/s\b": 3, "menstru": 4,
        "menses": 4, "amenorrh": 4, "dysmenorrh": 4, "menopaus": 4, "contracept": 4, r"\bocp\b": 4,
        r"\biud\b": 4, "vagin": 3, "cervi(x|cal cancer|cal smear)": 3, "pap smear": 4, "ovar": 3,
        "uter": 3, "endometri": 4, "pcos": 4, "polycystic ovar": 4, "infertil": 3, "eclampsia": 4,
        "placenta": 4, "miscarriage": 4, "abortion": 3, "ectopic": 4, "gdm": 4, "lactat": 2, "fibroid": 4,
        "hormone replacement": 4, "trimester": 4, "fetal": 4, "fetus": 4,
    },
    "psychiatry": {
        "depress": 4, "anxiety": 4, "schizo": 4, "bipolar": 4, "psychosis": 4, "psychotic": 4, "suicid": 4,
        "ssri": 4, "antidepress": 4, "antipsychotic": 4, "panic": 4, r"\bocd\b": 4, "obsess": 4, "ptsd": 4,
        "personality disorder": 4, "delusion": 4, "hallucinat": 3, "mania": 4, "manic": 4, "insomnia": 3,
        "anorexia nervosa": 4, "bulimi": 4, "bereave": 4, "grief": 4, "phobia": 4, "somati": 4,
        "conversion disorder": 4, "low mood": 4, "psychiatr": 3, "delirium": 3, "dementia": 2,
        "alzheimer": 2, "substance": 2, "alcohol withdraw": 3, "lithium": 4, "fluoxetine": 4,
        "sertraline": 4, "adjustment disorder": 4, "hypochondria": 4, "illness anxiety": 4,
    },
    "dermatology": {
        "rash": 3, "skin lesion": 4, "acne": 4, "eczema": 4, "psoria": 4, "dermatitis": 4, "urticaria": 4,
        "scabies": 4, "tinea": 4, "melanoma": 4, "vitiligo": 4, "prurit": 3, "itch": 3, "wart": 4,
        "alopecia": 4, "hair loss": 3, "nail": 2, "nev(us|i)": 4, "mole": 3, "papule": 4, "plaque": 2, "vesicle": 3, "macule": 4,
        "pityriasis": 4, "lichen": 4, "impetigo": 4, "cellulitis": 2, "rosacea": 4, "seborrh": 4,
        "molluscum": 4, "basal cell": 4, "squamous cell carcinoma": 3, "topical steroid": 3, "isotretinoin": 4,
        "erythema (nodosum|multiforme|migrans)": 4, "herpes zoster": 3, "shingles": 3, "dermat": 3,
    },
    "ophthalmology": {
        r"\beyes?\b": 3, "vision": 3, "visual": 3, "conjunctiv": 4, "glaucoma": 4, "cataract": 4,
        "retin": 4, "cornea": 4, "uveitis": 4, "fundus": 3, "fundoscop": 3, "red eye": 4, "diplopia": 4,
        "eyelid": 4, "chalazion": 4, "stye": 4, "blephar": 4, "strabismus": 4, "amblyopia": 4,
        "optic": 3, "macular": 4, "ophthalm": 4, "photophobia": 3, "intraocular": 4, "pterygium": 4,
    },
    "ent": {
        r"\bears?\b": 3, "hearing": 4, "otitis": 4, "tinnitus": 4, "vertigo": 3, "sinusitis": 4,
        "tonsil": 4, "epistaxis": 4, "hoarse": 4, "nasal": 3, "tympan": 4, "pharyngitis": 3,
        "rhinitis": 4, "sore throat": 3, "rinne": 4, "weber": 4, "audiogra": 4, "cholesteatoma": 4,
        "meniere": 4, "presbycusis": 4, "nose": 3, "laryn": 4, "adenoid": 4, "dysphonia": 4,
        "neck mass": 2, "peritonsillar": 4, "epiglott": 3, "wax": 3, "cerumen": 4,
    },
    "orthopedics": {
        "fracture": 4, "joint": 2, "knee": 3, "shoulder": 3, "back pain": 4, "sprain": 4,
        "osteoarthritis": 4, "gout": 3, "carpal tunnel": 4, "tendon": 3, "tendin": 4, "scoliosis": 4,
        r"\bhip\b": 3, "osteoporosis": 3, "ankle": 3, "dislocat": 4, "limp": 3, "wrist": 3, "elbow": 3,
        "meniscus": 4, "menisc": 4, "ligament": 4, "rotator cuff": 4, "plantar fasciitis": 4,
        "scaphoid": 4, "sciatica": 4, "disc (prolapse|herniat)": 4, "cast": 2, "splint": 2,
        "rheumatoid": 2, "ankylosing": 3, "fibromyalgia": 3, "bursitis": 4, "musculoskeletal": 3,
        "osteomyelitis": 3, "septic arthritis": 3, "ddh": 4, "perthes": 4, "slipped capital": 4,
    },
    "radiology": {
        "x-ray shows": 2, "x-ray": 2, "xray": 2, "radiograph": 3, "ct scan": 2, r"\bmri\b": 2,
        "ultrasound": 1, "imaging modality": 5, "best imaging": 5, "radiolog": 4, "contrast": 2,
        "which imaging": 5, "imaging of choice": 5, "most appropriate imaging": 5, "radiation dose": 5,
        "chest film": 4, "barium": 3, "mammogra": 2, "dexa": 2, "bone scan": 3,
    },
    "emergency": {
        "trauma": 3, r"\brta\b": 4, "accident": 3, "unconscious": 4, "shock": 3, "poison": 4,
        "overdose": 4, "anaphyla": 4, "burn": 3, "cardiac arrest": 4, r"\bcpr\b": 4, "resuscitat": 4,
        "emergency (department|room)": 2, r"\ber\b": 2, r"\bed\b": 1, "intubat": 4, "bite": 3, "sting": 3,
        "triage": 4, "ingest": 3, "toxic": 2, "antidote": 4, "paracetamol toxic": 4, "acetaminophen overdose": 4,
        "status epilepticus": 4, "tension pneumothorax": 4, "gcs": 4, "airway": 3, "drowning": 4,
        "heat stroke": 4, "hypotherm": 4, "foreign body": 3, "choking": 4, "stab": 4, "gunshot": 4,
        "hemodynamically unstable": 3, "unstable": 2, "organophosph": 4, "carbon monoxide": 4,
    },
    "surgery": {
        "appendic": 4, "hernia": 4, "cholecyst": 4, "gallstone": 4, "biliary colic": 4,
        "bowel obstruction": 4, "postoperative": 3, "post-op": 3, "preoperative": 3, "surgical": 2,
        "thyroid nodule": 3, "breast (lump|mass)": 4, "hemorrhoid": 4, "anal fissure": 4, "varicose": 4,
        "abscess": 2, "pilonidal": 4, "diverticul": 3, "pancreatitis": 2, "laparo": 3, "colorectal cancer": 2,
        "perianal": 4, "fistula": 3, "bariatric": 4, "gastric bypass": 4, "wound": 2, "lipoma": 3,
        "testicular torsion": 4, "hydrocele": 4, "varicocele": 4, "scrotal": 3, "peritonitis": 3,
        "aortic aneurysm": 3, "peripheral (arterial|vascular) disease": 3, "claudication": 3,
    },
    "family-medicine": {
        "screening": 4, "uspstf": 5, "prevent": 2, "vaccin": 2, "immuniz": 2, "counsel": 3,
        "smoking cessation": 5, "quit smoking": 5, "ethic": 5, "confidential": 5, "consent": 4,
        "autonomy": 5, "breaking bad news": 5, "sensitivity": 3, "specificity": 3, "study design": 5,
        "type of study": 5, "cohort": 4, "case[- ]control": 5, "randomi[sz]ed": 3, "p[- ]value": 5,
        "odds ratio": 5, "relative risk": 5, "number needed to treat": 5, r"\bnnt\b": 5, "prevalence": 4,
        "incidence": 3, "bias": 3, "confidence interval": 5, "evidence[- ]based": 4, "meta-analysis": 4,
        "patient[- ]centered": 5, "communication": 3, "open[- ]ended": 5, "active listening": 5,
        "health promotion": 5, "periodic health": 5, "lifestyle": 2, "obesity": 2, "bmi": 1,
        "primary (health )?care": 3, "family (medicine|physician)": 4, "genogram": 5, "family life cycle": 5,
        "palliative": 4, "home visit": 5, "geriatric": 3, "elderly": 1, "fall": 1, "quality improvement": 5,
        "audit": 4, "medical error": 5, "patient safety": 5, "premarital": 5, "travel": 3, "hajj": 5,
        "ramadan": 4, "fasting": 1, "referral letter": 4, "consultation": 2, "research": 3, "null hypothesis": 5,
        "likelihood ratio": 5, "predictive value": 5, "standard deviation": 5, "primary prevention": 5,
        "secondary prevention": 5, "tertiary prevention": 5, "doctor[- ]patient": 4, "angry patient": 4,
    },
    "internal-medicine": {
        "diabet": 3, "hba1c": 3, "insulin": 3, "metformin": 3, "hypertens": 3, "thyroid": 3, "asthma": 3,
        "copd": 4, "anemia": 3, "anaemia": 3, "renal": 3, "kidney": 3, "ckd": 4, "hepat": 3, "cirrhosis": 4,
        "heart failure": 4, "myocardial": 4, "angina": 4, "atrial fibrillation": 4, "ecg": 2, "statin": 3,
        "cholesterol": 3, "lipid": 3, "pneumonia": 3, "tubercul": 3, "gerd": 3, "peptic ulcer": 4,
        "h\\. ?pylori": 4, "ibs": 3, "crohn": 4, "ulcerative colitis": 4, "celiac": 4, "lupus": 4, r"\bsle\b": 4,
        "stroke": 3, "tia": 2, "headache": 3, "migraine": 4, "epilep": 3, "seizure": 2, "parkinson": 4,
        "multiple sclerosis": 4, "neuropath": 3, "thalassemia": 4, "sickle": 4, "leukemia": 4, "lymphoma": 4,
        "dvt": 4, "pulmonary embol": 4, "warfarin": 4, "anticoag": 4, "hypothyroid": 4, "hyperthyroid": 4,
        "cushing": 4, "addison": 4, "hyponatremia": 4, "hyperkalemia": 4, "uti": 2, "urinary tract": 2,
        "hiv": 3, "brucell": 4, "malaria": 4, "electrolyte": 3, "hematuria": 3, "proteinuria": 3,
        "nephrotic": 4, "gout": 1, "osteoporosis": 1, "b12": 3, "iron deficiency": 4, "g6pd": 4,
    },
}
PRIORITY = ["family-medicine", "obgyn", "pediatrics", "psychiatry", "dermatology", "ophthalmology", "ent",
            "orthopedics", "emergency", "surgery", "radiology", "internal-medicine"]
COMPILED = {s: [(re.compile((k if k.startswith(r"\b") or k[0] == "\\" else r"\b" + k), re.I), w)
                for k, w in rules.items()] for s, rules in SECTION_RULES.items()}


# A book or a topic folder about one specialty is strong evidence for its questions.
# Family-medicine and internal-medicine books span every specialty, so they give no prior.
SOURCE_PRIOR = [
    (r"psychiat|نفسي", "psychiatry"), (r"emergency", "emergency"), (r"pedia|peds\b", "pediatrics"),
    (r"ob[\s_-]*gyn|obstetric|gyne|obyg", "obgyn"), (r"surgery", "surgery"),
    (r"derma", "dermatology"), (r"ophtha|optha", "ophthalmology"), (r"\bent\b|otolaryn", "ent"),
    (r"ortho", "orthopedics"), (r"radio|x-?ray", "radiology"),
    (r"preventive|biostat|epidemiol|research|ethic", "family-medicine"),
]
SOURCE_PRIOR = [(re.compile(p, re.I), s) for p, s in SOURCE_PRIOR]
ANY = {s: re.compile("|".join("(?:" + p.pattern + ")" for p, _ in pats), re.I) for s, pats in COMPILED.items()}


def classify(stem, options, explanation, source=""):
    opt_text = " ".join(o["text"] for o in options)
    scores = Counter()
    name = source.replace("\\", "/").split("/_manual_import/")[-1]
    for pat, sec in SOURCE_PRIOR:
        if pat.search(name):
            scores[sec] += 8
            break
    whole = stem + " " + opt_text + " " + (explanation or "")[:400]
    for sec, pats in COMPILED.items():
        if not ANY[sec].search(whole):
            continue
        for pat, w in pats:
            if pat.search(stem):
                scores[sec] += w * 2
            elif pat.search(opt_text):
                scores[sec] += w
            elif explanation and pat.search(explanation[:400]):
                scores[sec] += w * 0.5
    if not scores:
        return "internal-medicine", 0.0
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], PRIORITY.index(kv[0])))
    margin = ranked[0][1] - (ranked[1][1] if len(ranked) > 1 else 0)
    return ranked[0][0], margin


# the stem points at a picture the app cannot show yet
NEEDS_IMAGE = re.compile(
    r"\b(picture|pic|image|photo(graph)?|figure|slide|as shown|shown (below|above|here|in the)|"
    r"(x-?ray|ecg|ekg|ct|mri|film|graph|chart|rash|lesion) (is )?(attached|shown|below|above)|attached|"
    r"see (the )?(image|picture|figure|photo)|the following (image|picture|ecg|ekg|x-?ray|graph|figure))\b", re.I)

EXAM_LABEL = {"part1": "Part 1", "final": "Final", "promotion": "Promotion"}


def topic_line(q):
    exams = [EXAM_LABEL[e] for e in q.get("exams", []) if e in EXAM_LABEL]
    parts = []
    if exams:
        parts.append(" / ".join(exams))
    if q.get("years"):
        parts.append(", ".join(str(y) for y in q["years"]))
    if q.get("n_appearances", 1) >= 2:
        parts.append(f"seen ×{q['n_appearances']}")
    return " · ".join(parts) or None


# ---- residue the sources leave in the text -------------------------------------------------
EXPL_HEAD = re.compile(r"^\s*(?:and\s+)?Discussion\s*\|\s*", re.I)
ITEM_HEAD = re.compile(r"^\s*(?:\d{1,3}\s+)?(?:Item\s*#?\d+\s*(?:\d{1,3}\s+(?=Item))?)+")
ITEM_TAIL = re.compile(r"\s+Item\s*#?\d+\s*$")
FOOTER_ONLY = re.compile(r"^.{0,70}\b\d+ of \d+\s*$")
SPLIT_WORD = re.compile(r"\b([A-Za-z]{2,})- ([a-z]{2,})\b")
ORPHAN = re.compile(r"\bthis (patient|child|woman|man|infant|boy|girl|condition|disorder|case|illness|disease|lesion)\b|"
                    r"\bdescribed (here|above)\b|\babove[- ]mentioned\b", re.I)
WORD = re.compile(r"[a-z]{3,}")
HYPH = re.compile(r"[a-z]{2,}-[a-z]{2,}")


def letters_dropped(text):
    """a font the PDF could not map: every 'o' (and friends) is missing — «hem dialysis»"""
    t = re.sub(r"[^a-z]", "", text.lower())
    return len(t) > 150 and t.count("o") / len(t) < 0.03


def orphan_stem(stem):
    """«What is the diagnosis in this patient?» with no patient in sight"""
    return len(stem) < 140 and bool(ORPHAN.search(stem))


class Mender:
    """«dis- eases» is a word the page broke; «well- child» is a compound. The bank itself says which:
    whichever spelling it uses elsewhere wins, and a pair it never uses is left alone."""

    def __init__(self, texts):
        self.words, self.hyph = Counter(), Counter()
        for t in texts:
            low = t.lower()
            self.words.update(WORD.findall(low))
            self.hyph.update(HYPH.findall(low))
        self.fixed = 0

    def _join(self, m):
        a, b = m.group(1), m.group(2)
        joined, dashed = (a + b).lower(), (a + "-" + b).lower()
        if self.words[joined] >= 3 and self.words[joined] >= self.hyph[dashed]:
            self.fixed += 1
            return a + b
        if self.hyph[dashed] >= 2:
            self.fixed += 1
            return a + "-" + b
        return m.group(0)

    def __call__(self, text):
        return SPLIT_WORD.sub(self._join, text)


def clean_explanation(e):
    e = ITEM_HEAD.sub("", EXPL_HEAD.sub("", e)).strip()
    # a paragraph break in the middle of a sentence is where the page turned, page number and all
    e = re.sub(r"(?<![.?!:])\n\n(?:\d{1,4} )?(?=[a-z])", " ", e)
    return "" if FOOTER_ONLY.match(e) else e


# what the reference round decided must stay out until a physician looks at it
HELD_BY_REFERENCE = {"broken": "question_itself_is_broken", "disagrees": "reference_disagrees_with_key",
                     "dispute_unresolved": "answer_disputed_no_reference"}

# a question a resident remembered from the exam, as against one printed in a review book
RECALL_FOLDERS = {"MCQs", "MCQs by topics", "MCQs by specialty", "Family Medicine_3"}
BOOK_FILE = re.compile(r"bratton|swanson|pretest|pre-test|abfm", re.I)
PAGE_NO = re.compile(r"^\d{1,4}\s+(?=[a-z])")
TOKEN = re.compile(r"[a-z0-9]{3,}")


def from_exam(q):
    return q["folder"] in RECALL_FOLDERS and not BOOK_FILE.search(q["appearances"][0]["file"])


def lettered(q):
    return [o["letter"] + ". " + o["text"] for o in q["options"] if o["text"]]


def squash(s):
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def answer_text(q):
    return squash(next((o["text"] for o in q["options"] if o["letter"] == q["answer_letter"]), ""))


def absorb(keep, other):
    """the same question met again under another wording: its sightings count, its text does not"""
    seen = {(a["file"], a["no"]) for a in keep["appearances"]}
    keep["appearances"] += [a for a in other["appearances"] if (a["file"], a["no"]) not in seen]
    keep["exams"] = sorted({a["exam"] for a in keep["appearances"]})
    keep["years"] = sorted({a["year"] for a in keep["appearances"] if a["year"]})
    keep["n_appearances"] = len(keep["appearances"])


def two_keys(qs):
    """The same recalled question written down twice with two different answers: each answer is one
    of the other's options. Nobody but a physician can say which key is right, so both wait."""
    pool = [q for q in qs.values() if q["status"] in ("ready", "answer_uncertain") and from_exam(q) and answer_text(q)]
    toks = [set(TOKEN.findall(q["stem"].lower())) for q in pool]
    ans = [answer_text(q) for q in pool]
    opts = [{squash(o["text"]) for o in q["options"]} for q in pool]
    where = defaultdict(list)
    for i, t in enumerate(toks):
        for w in t:
            where[w].append(i)
    pairs = []
    for i, t in enumerate(toks):
        if len(t) < 5:
            continue
        shared = Counter(j for w in t if len(where[w]) < 400 for j in where[w] if j > i)
        for j, n in shared.items():
            if n / len(t | toks[j]) >= 0.6 and ans[i] != ans[j] and ans[i] in opts[j] and ans[j] in opts[i]:
                pairs.append((pool[i]["id"], pool[j]["id"]))
    return pairs


def merge_near_duplicates(qs, src_dir, left_out):
    """near_duplicates.jsonl / twin_matches.jsonl come from a separate similarity pass (>= 0.90).
    Two ready questions are merged only when their correct answers read the same — similar stems with
    different answers are different questions (naltrexone vs disulfiram) and both stay."""
    usable = {i for i, q in qs.items() if q["status"] in ("ready", "answer_uncertain")}
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            x = parent[x]
        return x

    near = src_dir / "near_duplicates.jsonl"
    if near.exists():
        with near.open(encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                a, b = d["id_a"], d["id_b"]
                if a in usable and b in usable and answer_text(qs[a]) and answer_text(qs[a]) == answer_text(qs[b]):
                    parent[find(a)] = find(b)
    groups = defaultdict(list)
    for i in usable:
        if i in parent or any(v == i for v in parent.values()):
            groups[find(i)].append(i)
    for ids in groups.values():
        ids.sort(key=lambda i: (-qs[i]["n_appearances"], -len(qs[i]["explanation"]), i))
        for other in ids[1:]:
            absorb(qs[ids[0]], qs[other])
            del qs[other]
            left_out["near_duplicate_merged"] += 1
    twins = src_dir / "twin_matches.jsonl"
    if twins.exists():
        with twins.open(encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                a, b = d["incomplete_id"], d["complete_id"]
                if a in qs and b in qs and qs[a]["status"] not in ("ready", "answer_uncertain") and b in usable:
                    absorb(qs[b], qs[a])
                    left_out["twin_sightings_added"] += 1


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    by_section, left_out, weak = defaultdict(list), Counter(), 0
    with src.open(encoding="utf-8") as f:
        qs = {q["id"]: q for q in map(json.loads, f)}
    merge_near_duplicates(qs, src.parent, left_out)
    overlay_file = ROOT / "tools" / "reference_overlay.json"
    overlay = json.loads(overlay_file.read_text(encoding="utf-8")) if overlay_file.exists() else {}
    rivals = two_keys(qs)
    rival_of = {a: b for a, b in rivals} | {b: a for a, b in rivals}
    review, recalls = [], []

    def hold(q, reason, **more):
        left_out[reason] += 1
        review.append({"id": q["id"], "reason": reason, "question": q["stem"], "options": lettered(q),
                       "key": q["answer_letter"], "source_file": q["appearances"][0]["file"], **more})

    mend = Mender(t for q in qs.values() if q["status"] in ("ready", "answer_uncertain")
                  for t in [q["stem"], q["explanation"], *(o["text"] for o in q["options"])])
    if True:
        for q in qs.values():
            if q["status"] not in ("ready", "answer_uncertain"):
                left_out[q["status"]] += 1
                continue
            ref = overlay.get(q["id"], {})
            if ref.get("verdict") in HELD_BY_REFERENCE:
                hold(q, HELD_BY_REFERENCE[ref["verdict"]],
                     **{k: ref[k] for k in ("quote", "source", "source_supports", "note") if k in ref})
                continue
            if q["id"] in rival_of:
                hold(q, "same_question_two_keys", other_id=rival_of[q["id"]])
                continue
            if letters_dropped(q["stem"] + " " + " ".join(o["text"] for o in q["options"])):
                left_out["letters_dropped_by_pdf_font"] += 1
                continue
            if orphan_stem(q["stem"]):
                left_out["refers_to_a_case_it_does_not_carry"] += 1
                continue
            q["stem"] = mend(q["stem"])
            q["explanation"] = mend(clean_explanation(q["explanation"]))
            for o in q["options"]:
                o["text"] = mend(ITEM_TAIL.sub("", o["text"]))
            opts = {o["letter"]: o["text"] for o in q["options"] if o["text"]}
            if q["answer_letter"] not in opts:
                left_out["answer_not_in_options"] += 1
                continue
            if NEEDS_IMAGE.search(q["stem"]):
                left_out["needs_image"] += 1
                continue
            sec, margin = classify(q["stem"], q["options"], q["explanation"], q["appearances"][0]["file"])
            weak += margin < 2
            expl = q["explanation"].strip()
            note = (q.get("answer_note") or "").strip()
            carries_on = note[-1:] not in ".?!:" and re.match(r"(?:\d{1,4}\s+)?[a-z]", expl)
            if EXPL_HEAD.match(note) or (note and carries_on):
                # «Answer and Discussion | E. The incidence…»: the note is the first line of the explanation
                expl = (EXPL_HEAD.sub("", note) + " " + PAGE_NO.sub("", expl)).strip()
            elif note and note.lower() not in expl.lower() and note.lower() != opts[q["answer_letter"]].lower():
                expl = (note + "\n\n" + expl).strip()
            if ref.get("verdict") in ("supported", "partial"):
                lead = "Reference" if ref["verdict"] == "supported" else "Related reference (does not settle the answer on its own)"
                source = re.sub(r"[ _]*[.]pdf$", "", ref["source"]).strip()
                cite = lead + ": “" + ref["quote"] + "”\n— " + source
                expl = (expl + "\n\n" + cite).strip() if len(expl) >= 15 else cite
            if ref.get("verdict") == "no_reference":
                # the library could not back the remembered answer: read-only archive, not the practice bank
                left_out["no_reference_moved_to_recalls"] += 1
                recalls.append({
                    "id": q["id"], "state": "unresolved", "topic": next(s[2] for s in SECTIONS if s[0] == sec),
                    "raw_text": q["stem"], "options": [k + ". " + v for k, v in opts.items()],
                    "raw_answer": q["answer_letter"] + ". " + opts[q["answer_letter"]],
                    "type": "typed", "source_file": re.split(r"[\\/]", q["appearances"][0]["file"])[-1],
                    "google_url": "https://www.google.com/search?q=" + quote_plus(q["stem"][:220]),
                })
                continue
            by_section[sec].append({
                "reference": ref.get("verdict"),
                "origin": "exam" if from_exam(q) else "study",
                "id": q["id"],
                "subject": next(s[2] for s in SECTIONS if s[0] == sec),
                "topic": topic_line(q),
                # a second number left by the source ("187. In the United States…")
                "question": re.sub(r"^[\s.\-–:)]*(?:\d{1,3}\s*[.)\-:]\s+)?", "", q["stem"]),
                "options": opts,
                "correct_answer": q["answer_letter"],
                "explanation": expl,
                "answer_certainty": q["answer_certainty"],
                "exams": q.get("exams", []),
                "years": q.get("years", []),
                "appearances": q.get("n_appearances", 1),
                "source_file": q["appearances"][0]["file"],
                "source_folder": q["folder"],
                "section_margin": margin,
            })

    qdir = DATA / "questions"
    qdir.mkdir(parents=True, exist_ok=True)
    for old in qdir.glob("*.json"):
        old.unlink()
    sections = []
    for sid, fname, name, name_ar, icon, _ in SECTIONS:
        items = sorted(by_section[sid], key=lambda x: (-x["appearances"], x["id"]))
        (qdir / f"{fname}.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
        sections.append({"id": sid, "name": name, "nameAr": name_ar, "icon": icon,
                         "file": f"data/questions/{fname}.json", "count": len(items),
                         "fromExam": sum(x["origin"] == "exam" for x in items)})
    recalls.sort(key=lambda r: (r["topic"], r["id"]))
    (DATA / "recalls.json").write_text(json.dumps(recalls, ensure_ascii=False, indent=1), encoding="utf-8")
    review.sort(key=lambda r: (r["reason"], r["id"]))
    (ROOT / "tools" / "review_queue.json").write_text(json.dumps(review, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "sections.json").write_text(
        json.dumps({"sections": sections}, ensure_ascii=False, indent=2), encoding="utf-8")

    blueprint = {
        "exam": {
            "code": "SBFM", "name": "Saudi Board Family Medicine", "nameAr": "البورد السعودي لطب الأسرة",
            "authority": "SCFHS", "source": "SCFHS Family Medicine blueprint (Promotion / Part One / Final)",
            "questions": 100, "minutes": 150,
            "format": "100 single best answer MCQs",
            "note": "Section weights are the official ones. The 150-minute length is provisional.",
        },
        "milestoneTests": [
            {"id": 1, "unlockAt": 150, "size": 40, "minutes": 60, "mix": {"covered": 0.75, "fresh": 0.25}},
            {"id": 2, "unlockAt": 500, "size": 50, "minutes": 75, "mix": {"covered": 0.75, "fresh": 0.25}},
            {"id": 3, "unlockAt": 1200, "size": 50, "minutes": 75, "mix": {"covered": 0.75, "fresh": 0.25}},
        ],
        "simulations": [
            {"id": 1, "unlockAtCoverage": 0.05, "size": 100, "minutes": 150, "seed": "sbfm-sim-1-v1"},
        ],
        # The resident picks a year; the year names the exam ahead. Question counts and
        # pass marks are SCFHS's. Minutes are provisional (90 seconds a question).
        "tracks": [
            {"id": "r1", "label": "R1", "exam": "promotion", "code": "PROMO", "examName": "Promotion Exam",
             "format": "100 سؤال", "questions": 100, "minutes": 150, "pass": 60,
             "simulations": [
                 {"id": 11, "name": "Promotion Simulation 1", "unlockAtCoverage": 0.03, "size": 100, "minutes": 150, "seed": "sbfm-promo-a"},
                 {"id": 12, "name": "Promotion Simulation 2", "unlockAtCoverage": 0.08, "size": 100, "minutes": 150, "seed": "sbfm-promo-b"}]},
            {"id": "r2", "label": "R2", "exam": "part1", "code": "PART 1", "examName": "Part One",
             "format": "150 سؤالاً", "questions": 150, "minutes": 225, "pass": 65,
             "simulations": [
                 {"id": 21, "name": "Part One Simulation 1", "unlockAtCoverage": 0.05, "size": 150, "minutes": 225, "seed": "sbfm-part1-a"},
                 {"id": 22, "name": "Part One Simulation 2", "unlockAtCoverage": 0.10, "size": 150, "minutes": 225, "seed": "sbfm-part1-b"}]},
            {"id": "r3", "label": "R3", "exam": "promotion", "code": "PROMO", "examName": "Promotion Exam",
             "format": "100 سؤال", "questions": 100, "minutes": 150, "pass": 60,
             "simulations": [
                 {"id": 31, "name": "Promotion Simulation 1", "unlockAtCoverage": 0.03, "size": 100, "minutes": 150, "seed": "sbfm-promo-c"},
                 {"id": 32, "name": "Promotion Simulation 2", "unlockAtCoverage": 0.08, "size": 100, "minutes": 150, "seed": "sbfm-promo-d"}]},
            {"id": "r4", "label": "R4", "exam": "final", "code": "FINAL", "examName": "Final Written Exam",
             "format": "ورقتان × 100 سؤال", "questions": 200, "minutes": 300, "pass": 70,
             "simulations": [
                 {"id": 41, "name": "Final — Paper 1", "unlockAtCoverage": 0.05, "size": 100, "minutes": 150, "seed": "sbfm-final-p1"},
                 {"id": 42, "name": "Final — Paper 2", "unlockAtCoverage": 0.05, "size": 100, "minutes": 150, "seed": "sbfm-final-p2"}]},
        ],
        "domains": [{"name": s[2], "weight": s[5], "sections": [s[0]]} for s in SECTIONS],
    }
    (DATA / "blueprint.json").write_text(json.dumps(blueprint, ensure_ascii=False, indent=2), encoding="utf-8")

    total = sum(s["count"] for s in sections)
    report = {
        "source": str(src), "in_bank": total, "from_exam": sum(s["fromExam"] for s in sections),
        "recalls_archive": len(recalls), "left_out": left_out, "weak_section_calls": weak,
        "sections": [{"id": s["id"], "count": s["count"], "share_pct": round(s["count"] * 100 / total, 1),
                      "from_exam": s["fromExam"],
                      "blueprint_pct": next(x[5] for x in SECTIONS if x[0] == s["id"])} for s in sections],
    }
    (DATA / "bank_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
