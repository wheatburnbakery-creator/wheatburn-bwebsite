"""Inline <style> CSS class rules into presentation styles on each element.

Why: LibreOffice's SVG import ignores CSS class selectors, so a class-styled SVG
converts to PDF as unstyled black shapes. Inlining the declarations makes the file
render identically in converters that lack CSS support.

Usage: python3 scripts/svg_inline_styles.py in.svg out.svg
"""
import re
import sys
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG)

FONT_MAP = {
    'system-ui': 'DejaVu Sans',
    'sans-serif': 'DejaVu Sans',
    'ui-monospace': 'DejaVu Sans Mono',
}

def parse_css(css_text):
    """Return {'.class': {prop: value}} from simple class-based CSS."""
    rules = {}
    for block in re.finditer(r'([^{}]+)\{([^}]*)\}', css_text):
        selectors, body = block.group(1), block.group(2)
        decls = {}
        for decl in body.split(';'):
            if ':' not in decl:
                continue
            prop, _, val = decl.partition(':')
            prop, val = prop.strip(), val.strip()
            if prop == 'font':                      # expand shorthand
                parts = val.split()
                weight = size = family = None
                for p in parts:
                    if re.fullmatch(r'\d{3}', p):
                        weight = p
                    elif re.fullmatch(r'[\d.]+px', p):
                        size = p
                    elif p not in ('normal', 'italic'):
                        family = (family + ', ' + p) if family else p
                if weight:
                    decls['font-weight'] = weight
                if size:
                    decls['font-size'] = size
                if family:
                    fams = [FONT_MAP.get(f.strip(), f.strip()) for f in family.split(',')]
                    decls['font-family'] = ', '.join(fams)
                continue
            if prop == 'font-family':
                fams = [FONT_MAP.get(f.strip(), f.strip()) for f in val.split(',')]
                decls['font-family'] = ', '.join(fams)
                continue
            decls[prop] = val
        for sel in selectors.split(','):
            sel = sel.strip()
            if sel.startswith('.'):
                rules.setdefault(sel[1:], {}).update(decls)
    return rules

def style_attr(decls):
    return ''.join(f'{k}:{v};' for k, v in decls.items())

def main(src, dst):
    tree = ET.parse(src)
    root = tree.getroot()

    style_el = root.find(f'{{{SVG}}}style')
    rules = parse_css(style_el.text or '') if style_el is not None else {}

    for el in root.iter():
        cls = el.get('class')
        if not cls or not rules:
            continue
        merged = {}
        for name in cls.split():
            merged.update(rules.get(name, {}))
        if not merged:
            continue
        existing = el.get('style', '')
        el.set('style', existing + style_attr(merged))
        del el.attrib['class']

    if style_el is not None:
        root.remove(style_el)

    tree.write(dst, encoding='UTF-8', xml_declaration=True)
    print(f'wrote {dst}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])