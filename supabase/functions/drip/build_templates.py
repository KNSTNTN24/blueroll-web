#!/usr/bin/env python3
"""Regenerate templates.ts from templates/*.html (Deno.readTextFile does not
work in deployed edge functions, so the HTML is embedded as strings)."""
import json
from pathlib import Path

here = Path(__file__).parent
out = ['// GENERATED from templates/*.html — regenerate with build_templates.py; do not hand-edit.',
       'export const TEMPLATES: Record<number, string> = {']
for n in (1, 2, 3):
    html = (here / 'templates' / f'email{n}.html').read_text()
    out.append(f'  {n}: {json.dumps(html)},')
out.append('}')
(here / 'templates.ts').write_text('\n'.join(out) + '\n')
print('templates.ts regenerated')
