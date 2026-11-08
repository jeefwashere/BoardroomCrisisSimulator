"""Explicit demo PDF authoring, model download, indexing and retrieval benchmark."""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .pdf_memory import CATALOG, ROOT, PDFMemory, _write_json

PACKS = ROOT / "playtest/fixtures/participant-packs.json"
NAMES = {"T01": "demo-t01-service-outage.pdf", "T02": "demo-t02-fundraising.pdf",
         "T03": "demo-t03-succession-payroll.pdf"}


def create_demo_pdfs():
    """Use only participant released data. Never read the controller reference."""
    from html import escape
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether
    from pypdf import PdfReader

    data = json.loads(PACKS.read_text())
    out = ROOT / "output/pdf"
    out.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="PackTitle", fontName="Helvetica-Bold", fontSize=25, leading=29,
                              textColor=colors.HexColor("#123349"), spaceAfter=16))
    styles.add(ParagraphStyle(name="PackLabel", fontName="Helvetica-Bold", fontSize=9, leading=12,
                              textColor=colors.HexColor("#157F83"), spaceAfter=9))
    styles.add(ParagraphStyle(name="PackSection", fontName="Helvetica-Bold", fontSize=13, leading=16,
                              textColor=colors.HexColor("#123349"), spaceBefore=13, spaceAfter=8))
    styles.add(ParagraphStyle(name="PackBody", fontName="Helvetica", fontSize=10, leading=13.5,
                              textColor=colors.HexColor("#253A43"), spaceAfter=7))
    styles.add(ParagraphStyle(name="PackID", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
                              textColor=colors.HexColor("#157F83"), spaceAfter=2))
    styles.add(ParagraphStyle(name="Rule", fontName="Helvetica", fontSize=8.7, leading=11.5,
                              textColor=colors.HexColor("#253A43"), spaceAfter=5))
    catalog = []
    def clean(s):
        return escape(s.replace("–", "-").replace("—", "-").replace("‑", "-")
                      .replace("“", '"').replace("”", '"').replace("’", "'"))
    for pack in data["packs"]:
        path = out / NAMES[pack["id"]]
        story = [Paragraph("REHEARSAL / PARTICIPANT REFERENCE / " + pack["id"], styles["PackLabel"]),
                 Paragraph(clean(pack["title"]), styles["PackTitle"]),
                 Paragraph("Fictional exercise material. Public participant information only. These documents support preparation; they do not establish live application voting rules or reveal future events.", styles["PackBody"])]
        # The first page carries the substantive public documents. The second
        # holds the opening update and the full common participant instructions.
        for doc in pack["documents"][:-1]:
            story.append(Paragraph(clean(doc["title"]), styles["PackSection"]))
            for clause in doc["clauses"]:
                story.append(KeepTogether([Paragraph(clean(clause["id"]), styles["PackID"]),
                                          Paragraph(clean(clause["text"]), styles["PackBody"])]))
        story.append(PageBreak())
        story.extend([Paragraph(pack["id"] + " / OPENING INFORMATION", styles["PackLabel"]),
                      Paragraph("Facts and exercise rules", styles["PackTitle"])])
        doc = pack["documents"][-1]
        story.append(Paragraph(clean(doc["title"]), styles["PackSection"]))
        for clause in doc["clauses"]:
            story.append(KeepTogether([Paragraph(clean(clause["id"]), styles["PackID"]),
                                      Paragraph(clean(clause["text"]), styles["PackBody"])]))
        story.append(Paragraph("Shared participant instructions", styles["PackSection"]))
        for number, rule in enumerate(data["common_rules"].splitlines(), 1):
            story.append(Paragraph(f"{number}. " + clean(rule.lstrip("- ")), styles["Rule"]))
        story.append(Spacer(1, 12))
        story.append(Paragraph("Reference scope: this is a preparation pack, not a fully implemented timed scenario. Unknowns remain unknown. Use page numbers and clause IDs when citing evidence.", styles["Rule"]))
        def chrome(canvas, document, pack_id=pack["id"]):
            width, height = A4
            canvas.setStrokeColor(colors.HexColor("#157F83"))
            canvas.setLineWidth(2)
            canvas.line(44, height-28, width-44, height-28)
            canvas.setFont("Helvetica", 8)
            canvas.setFillColor(colors.HexColor("#536A76"))
            canvas.drawString(44, 25, "REHEARSAL  |  Fictional participant pack  |  " + pack_id)
            canvas.drawRightString(width-44, 25, f"Page {document.page}")
        SimpleDocTemplate(str(path), pagesize=A4, leftMargin=44, rightMargin=44, topMargin=44,
                          bottomMargin=44, title=pack["title"], author="Rehearsal demo").build(story, onFirstPage=chrome, onLaterPages=chrome)
        catalog.append({"id": pack["id"], "title": pack["title"], "filename": path.name,
                        "path": str(path.relative_to(ROOT)), "pages": len(PdfReader(path).pages),
                        "kind": "demo", "source": "playtest/fixtures/participant-packs.json"})
    _write_json(CATALOG, {"documents": catalog})
    return catalog


def evaluate(memory):
    probes = [
        ("T01", "What must IT verify before we promise when service will return?", "backup usability"),
        ("T02", "Can the treasurer approve a review of transactions involving his printing company?", "must not vote"),
        ("T03", "Does appointing an acting director immediately let them release payroll?", "does not provision"),
    ]
    report = []
    for document_id, question, expected in probes:
        start = time.perf_counter()
        matches = memory.search(question, [document_id], 3)
        report.append({"document_id": document_id, "question": question,
                       "latency_ms": round((time.perf_counter()-start)*1000, 1),
                       "expected_phrase_in_top3": any(expected in m["text"] for m in matches),
                       "matches": matches})
    _write_json(memory.cache_dir / "evaluation.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-demo-pdfs", action="store_true")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--index", action="store_true")
    parser.add_argument("--evaluate", action="store_true")
    args = parser.parse_args()
    if args.create_demo_pdfs:
        print(json.dumps(create_demo_pdfs(), indent=2))
    memory = PDFMemory()
    if args.download:
        memory.download_model()
    if args.index:
        start = time.perf_counter()
        print(json.dumps({**memory.build_index(), "index_ms": round((time.perf_counter()-start)*1000, 1)}))
    if args.evaluate:
        print(json.dumps(evaluate(memory), indent=2))
    print(json.dumps(memory.status(), indent=2))


if __name__ == "__main__":
    main()
