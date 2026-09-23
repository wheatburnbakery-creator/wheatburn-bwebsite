"""Prepare diagram SVGs for PDF conversion.

For each input SVG:
  1. inline the CSS class rules (LibreOffice ignores CSS classes), and
  2. wrap it on a uniform A4-landscape canvas (842 x 595 pt) with a white background,
     so every page of a merged print PDF has the same size.

Usage: python3 scripts/build_print_pdfs.py out_dir in1.svg in2.svg ...
"""
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).parent))
from svg_inline_styles import parse_css, style_attr  # noqa: E402

SVG = 'http://www.w3.org/2000/svg'
# A4 landscape in SVG user units (px). LibreOffice maps px -> pt at 0.75, so
# 1122.67 x 793.33 px becomes exactly 842 x 595 pt (A4 landscape) in the PDF.
A4_W, A4_H = 1122.67, 793.33
ET.register_namespace('', SVG)

def inline(src_svg_text):
    """Return SVG text with class-based CSS folded into per-element style attributes."""
    root = ET.fromstring(src_svg_text)
    style_el = root.find(f'{{{SVG}}}style')
    rules = parse_css(style_el.text or '') if style_el is not None else {}
    for el in root.iter():
        cls = el.get('class')
        if not cls or not rules:
            continue
        merged = {}
        for name in cls.split():
            merged.update(rules.get(name, {}))
        if merged:
            el.set('style', el.get('style', '') + style_attr(merged))
            del el.attrib['class']
    if style_el is not None:
        root.remove(style_el)
    return root

def wrap_a4(root):
    """Centre the drawing on an A4-landscape white page."""
    vb = (root.get('viewBox') or '').split()
    w, h = (float(vb[2]), float(vb[3])) if len(vb) == 4 else (760.0, 420.0)
    dx, dy = (A4_W - w) / 2, (A4_H - h) / 2
    page = ET.Element(f'{{{SVG}}}svg', {
        'width': str(A4_W), 'height': str(A4_H),
        'viewBox': f'0 0 {A4_W} {A4_H}',
    })
    ET.SubElement(page, f'{{{SVG}}}rect', {
        'x': '0', 'y': '0', 'width': str(A4_W), 'height': str(A4_H), 'fill': '#FFFFFF',
    })
    inner = ET.SubElement(page, f'{{{SVG}}}svg', {
        'x': f'{dx:g}', 'y': f'{dy:g}', 'width': f'{w:g}', 'height': f'{h:g}',
        'viewBox': f'0 0 {w:g} {h:g}',
    })
    for child in list(root):
        inner.append(child)
    return page

def main(out_dir, sources):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for src in sources:
        src_path = Path(src)
        root = inline(src_path.read_text())
        page = wrap_a4(root)
        dst = out / (src_path.stem + '.print.svg')
        ET.ElementTree(page).write(dst, encoding='UTF-8', xml_declaration=True)
        print('prepared', dst)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])