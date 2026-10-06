#!/usr/bin/env python3
"""Build supabase/functions/_shared/knowledge-sfbb.ts from the FSA SFBB for Caterers PDF.

Usage:
  python3 scripts/build-sfbb-knowledge.py <path/to/sfbb-caterers-pack.pdf>

Source: https://www.food.gov.uk/business-guidance/safer-food-better-business-for-caterers
(Food Standards Agency, Open Government Licence v3.0). Needs `pdftotext` (poppler) on PATH
or at /opt/homebrew/bin/pdftotext. Output is deterministic for a given PDF.

Pipeline: per-page text (reading order) -> drop page furniture, blank forms and workbook
prompts -> paragraphs + headings -> chunks of ~120-300 words that never cross a page, each
labelled with its pack (section) and safe method.
"""
import json
import os
import re
import shutil
import subprocess
import sys

SOURCE_URL = 'https://www.food.gov.uk/business-guidance/safer-food-better-business-for-caterers'
OUT = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'functions', '_shared', 'knowledge-sfbb.ts')

# Pack (section) by page range, from the pack's own section cover pages.
PACKS = [(2, 10, 'Introduction'), (11, 26, 'Cross-contamination'), (27, 37, 'Cleaning'), (38, 47, 'Chilling'),
         (48, 63, 'Cooking'), (64, 79, 'Management'), (80, 100, 'Diary')]

# Pages dropped on purpose: cover, copyright, section cover pages (their text is repeated on the next page),
# the safe-method completion table, and the diary's blank forms (training/supplier/contact records,
# blank cleaning schedule, week-to-view grids, blank second 4-weekly review).
DROP_PAGES = {1, 7, 11, 27, 38, 48, 64, 79, 80, 84, 85, 86, 87, 88, 89, 90, 91, 92, 94, 95, 96, 97, 98, 100}
# Pages where yes/no prompts ARE the content (the 4-weekly review checklist).
KEEP_QUESTIONS = {99}

NOISE_LINES = {
    'food standards agency l food.gov.uk/sfbb', 'safety point', 'safety points', 'why?', 'why', 'how do you do this?',
    'how do you do this', 'tick if you', 'do this', 'tick if you do this', 'yes', 'no', 'do you do this?', 'do you do this? yes',
    'write any details here:', 'safe method:', 'safe method', 'what to do', 'how to do it', 'details of check', 'how often?',
    'write down what went wrong and what you did about it in your diary.', 'date', 'signature', 'initials', 'x',
    'other', 'weekly', 'daily', 'every shift', 'after use', 'item', 'frequency of cleaning', 'precautions', 'e.g. wear',
    'gloves or', 'goggles', 'method of cleaning', 'right', 'wrong', 'front', 'back', 'tick here if safe',
    'method not relevant', 'xx/xx/xx', 'xx/xx/xxxx', 'je', 'name:', 'signed:',
}
QUESTION_START = re.compile(r"^(do|does|did|have|has|are|is|was|were|how|which|what|where|who|if|can|could|will|would|describe|write|tick|when)\b", re.I)

CONNECT_END = re.compile(r'\b(THE|AND|OR|OF|TO|FOR|WITH|A|YOUR|IN)$')
CONNECT_START = re.compile(r'^(AND|OR|OF|TO|FOR|WITH|IN)\b')

STOP = set('the a an and or of to in on for is are do does i my we our how what when should can it be with at often much many you your need '
           'this that these those from by as if not into about any all'.split())


def pdftotext():
    exe = shutil.which('pdftotext') or '/opt/homebrew/bin/pdftotext'
    if not os.path.exists(exe):
        sys.exit('pdftotext not found (brew install poppler)')
    return exe


def page_text(exe, pdf, n):
    r = subprocess.run([exe, '-f', str(n), '-l', str(n), '-enc', 'UTF-8', pdf, '-'], capture_output=True, text=True)
    return r.stdout


def norm(s):
    s = s.replace('‘', "'").replace('’', "'").replace('“', '"').replace('”', '"')
    s = s.replace('–', '-').replace('—', '-').replace('⁰', '°').replace('­', '')
    s = s.replace('ﬁ', 'fi').replace('ﬂ', 'fl').replace(' ', ' ').replace('\x0c', '')
    s = re.sub(r'(\d)\s*⁰\s*C', r'\1 °C', s)
    s = re.sub(r'(\d)\s*°\s*C', r'\1 °C', s)
    return re.sub(r'[ \t]+', ' ', s).strip()


def is_heading(line):
    letters = [c for c in line if c.isalpha()]
    return len(letters) >= 3 and all(not c.islower() for c in letters) and len(line.split()) <= 10


def sentence_case(s):
    s = s.strip().rstrip(':').strip()
    if not s:
        return s
    out = s[0].upper() + s[1:].lower()
    for keep in ('FSA', 'HACCP', 'SFBB', 'E-cigarettes'):
        out = re.sub(re.escape(keep), keep, out, flags=re.I)
    return out


def pack_for(page):
    for a, b, name in PACKS:
        if a <= page <= b:
            return name
    return None


def blocks_for(text, page):
    """Return (method_from_page or None, list of ('h'|'p', text))."""
    lines = [norm(l) for l in text.split('\n')]
    # Paragraphs = runs of non-empty lines; headings are standalone upper-case lines.
    method = None
    if 'SAFE METHOD:' in [l for l in lines]:
        i = lines.index('SAFE METHOD:') + 1
        parts = []
        while i < len(lines) and (not lines[i] or is_heading(lines[i])):
            if lines[i]:
                parts.append(lines[i])
            elif parts:
                break
            i += 1
        method = sentence_case(' '.join(parts)) if parts else None
        lines = lines[:lines.index('SAFE METHOD:')] + [''] + lines[i:]
    out, para = [], []

    def flush():
        if para:
            t = ' '.join(para)
            t = re.sub(r'\s+', ' ', t).strip()
            out.append(('p', t))
            para.clear()

    for l in lines:
        low = l.lower()
        if not l:
            flush()
            continue
        if low in NOISE_LINES or re.fullmatch(r'[_\s]+|[MTWFS]|\d{1,2}', l):
            flush()
            continue
        if is_heading(l):
            flush()
            # Join wrapped multi-line headings ("HOW TO USE THE" / "SAFE METHODS"), not stacked ones.
            if out and out[-1][0] == 'h' and (CONNECT_END.search(out[-1][1]) or CONNECT_START.match(l)):
                out[-1] = ('h', out[-1][1] + ' ' + l)
            else:
                out.append(('h', l))
            continue
        para.append(l)
    flush()
    cleaned = []
    for kind, t in out:
        if kind == 'p' and page not in KEEP_QUESTIONS and t.endswith('?') and QUESTION_START.match(t) and len(t.split()) <= 30:
            continue  # workbook prompt ("Do you ...?") - not guidance
        if kind == 'p' and page not in KEEP_QUESTIONS and t.endswith(':') and len(t.split()) <= 12:
            continue  # form label ("Describe your staff's work clothes here:")
        if kind == 'h' and t.strip().upper() in ('SAFE METHOD', 'SAFE METHOD:'):
            continue
        cleaned.append((kind, t))
    # drop trailing headings with nothing after them
    while cleaned and cleaned[-1][0] == 'h':
        cleaned.pop()
    return method, cleaned


def words(s):
    return len(s.split())


def split_long(text, limit=280):
    sents = re.split(r'(?<=[.!?])\s+', text)
    out, cur = [], []
    for s in sents:
        if cur and words(' '.join(cur + [s])) > limit:
            out.append(' '.join(cur))
            cur = []
        cur.append(s)
    if cur:
        out.append(' '.join(cur))
    return out


def chunk_page(blocks, lo=120, hi=300):
    """Group blocks into chunks; returns list of (first_heading or None, [lines])."""
    chunks, cur, cur_h, n = [], [], None, 0

    def flush():
        nonlocal cur, cur_h, n
        if cur and any(k == 'p' for k, _ in cur):
            chunks.append([cur_h, cur])
        cur, cur_h, n = [], None, 0

    for kind, t in blocks:
        if kind == 'h':
            if n >= lo:
                flush()
            if cur_h is None and n < 40:
                cur_h = t
            cur.append(('h', t))
            continue
        for piece in split_long(t):
            w = words(piece)
            if n + w > hi and n >= lo:
                flush()
            cur.append(('p', piece))
            n += w
    flush()
    # merge a small tail into the previous chunk on the same page
    if len(chunks) >= 2 and sum(words(t) for _, t in chunks[-1][1]) < 60:
        tail = chunks.pop()
        chunks[-1][1].extend(tail[1])
    return chunks


def tags_for(*names):
    seen = []
    for n in names:
        for w in re.findall(r"[a-z0-9-]+", (n or '').lower()):
            if len(w) > 2 and w not in STOP and w not in seen:
                seen.append(w)
    return seen[:10]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pdf = sys.argv[1]
    exe = pdftotext()
    n_pages = int(re.search(r'Pages:\s+(\d+)', subprocess.run([exe.replace('pdftotext', 'pdfinfo'), pdf], capture_output=True, text=True).stdout).group(1)) \
        if os.path.exists(exe.replace('pdftotext', 'pdfinfo')) else 100
    result = []
    current = {}  # pack -> current safe method
    for page in range(1, n_pages + 1):
        pack = pack_for(page)
        if pack is None or page in DROP_PAGES:
            continue
        method, blocks = blocks_for(page_text(exe, pdf, page), page)
        if method:
            current[pack] = method
        elif pack in ('Introduction', 'Diary'):
            # These pages are not safe methods: name them after their first heading.
            first = next((t for k, t in blocks if k == 'h'), None)
            current[pack] = sentence_case(first) if first else current.get(pack, pack)
            if blocks and blocks[0][0] == 'h' and sentence_case(blocks[0][1]) == current[pack]:
                blocks = blocks[1:]
        elif pack not in current:
            current[pack] = 'Introduction'
        name = current[pack]
        if sum(words(t) for k, t in blocks if k == 'p') < 30:
            continue
        for i, (h, body) in enumerate(chunk_page(blocks), start=1):
            sub = sentence_case(h) if h and sentence_case(h).lower() != name.lower() else None
            title = f'{pack} — {name}' + (f': {sub}' if sub else '')
            text = '\n'.join((sentence_case(t) + ':') if k == 'h' else t for k, t in body)
            text = re.sub(r'::$', ':', text, flags=re.M)
            result.append({
                'id': f'sfbb-p{page}-{i}',
                'title': title,
                'source': f'Safer food, better business (SFBB) for caterers — {pack}: {name}, p.{page} (FSA, Open Government Licence v3.0)',
                'tags': tags_for(pack, name, sub),
                'text': text,
            })
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// supabase/functions/_shared/knowledge-sfbb.ts\n')
        f.write('// GENERATED — do not edit by hand. Regenerate with:\n')
        f.write('//   python3 scripts/build-sfbb-knowledge.py <sfbb-caterers-pack.pdf>\n')
        f.write(f'// Source: FSA "Safer food, better business for caterers", {SOURCE_URL}\n')
        f.write('// © Crown copyright, Food Standards Agency. Contains public sector information licensed under the\n')
        f.write('// Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).\n')
        f.write('// Type-only import — loaded by Deno and Vitest.\n')
        f.write("import type { KnowledgeChunk } from './knowledge.ts'\n\n")
        f.write('export const SFBB_KNOWLEDGE: KnowledgeChunk[] = [\n')
        for c in result:
            f.write('  ' + json.dumps(c, ensure_ascii=False) + ',\n')
        f.write(']\n')
    total = sum(words(c['text']) for c in result)
    print(f'{len(result)} chunks, {total} words, {os.path.getsize(OUT)} bytes -> {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
