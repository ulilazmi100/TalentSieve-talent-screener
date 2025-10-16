#!/usr/bin/env bash
set -euo pipefail

# scripts/decode_sample_pdfs.sh
# Robust demo PDF setup:
# 1) If there are real PDF files in ./uploads (size > 2KB), copy two of them to tests/sample_data/
# 2) Otherwise attempt to generate PDFs using Node + pdfkit
# 3) If pdfkit missing, print install instructions

OUT_DIR="tests/sample_data"
mkdir -p "$OUT_DIR"

echo "Looking for real PDFs in uploads/ ..."
mapfile -t CANDIDATES < <(find uploads -type f -size +2k -print 2>/dev/null || true)

if [ "${#CANDIDATES[@]}" -ge 2 ]; then
  echo "Found ${#CANDIDATES[@]} candidate(s) in uploads/ — copying two into $OUT_DIR"
  cp "${CANDIDATES[0]}" "$OUT_DIR/sample_cv.pdf"
  cp "${CANDIDATES[1]}" "$OUT_DIR/sample_project.pdf"
  echo "Copied:"
  echo "  ${CANDIDATES[0]} -> $OUT_DIR/sample_cv.pdf"
  echo "  ${CANDIDATES[1]} -> $OUT_DIR/sample_project.pdf"
  exit 0
fi

echo "Not enough real PDFs found in uploads/ (found ${#CANDIDATES[@]}). Will try to generate sample PDFs using Node + pdfkit."

# Check if node is available
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found in PATH. Install Node.js (18+) and try again."
  exit 2
fi

# Check if pdfkit is installed (local node_modules)
NODE_CHECK_SCRIPT="try{require('pdfkit'); console.log('OK')}catch(e){console.log('NO')}"
HAS_PDFKIT=$(node -e "$NODE_CHECK_SCRIPT" 2>/dev/null || echo "NO")
if [ "$HAS_PDFKIT" != "OK" ]; then
  echo ""
  echo "pdfkit is not installed in this project. Install it with (dev dependency):"
  echo ""
  echo "  npm install --save-dev pdfkit"
  echo ""
  echo "We have added pdfkit to devDependencies; run 'npm install' then re-run this script."
  echo ""
  exit 3
fi

# Generate two sample PDFs using pdfkit
GEN_SCRIPT=$(cat <<'NODE'
const fs = require('fs');
const PDFDocument = require('pdfkit');

function generate(path, title, lines=120) {
  return new Promise((res, rej) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = fs.createWriteStream(path);
    doc.pipe(stream);
    // create several pages
    const perPage = 30;
    let created = 0;
    while (created < lines) {
      doc.addPage({ size: 'A4', margin: 50 });
      doc.fontSize(14).text(title, { underline: true });
      doc.moveDown(0.5);
      for (let i = 0; i < perPage && created < lines; i++, created++) {
        doc.fontSize(11).text(`${created + 1}. This is a sample line to emulate CV/project content. It demonstrates text extraction and chunking.`, { paragraphGap: 2 });
      }
    }
    doc.end();
    stream.on('finish', () => res(true));
    stream.on('error', e => rej(e));
  });
}

(async () => {
  const out = process.argv[2];
  const out2 = process.argv[3];
  try {
    await generate(out, 'Sample CV — Full Name\nContact: sample@example.com', 120);
    await generate(out2, 'Sample Project Report — Case Study\nProject: Demo', 90);
    console.log('Generated PDFs:', out, out2);
    process.exit(0);
  } catch (e) {
    console.error('PDF generation error', e);
    process.exit(4);
  }
})();
NODE
)

TMP_JS="$(mktemp 2>/dev/null || echo /tmp/tmpfile.js)"
echo "$GEN_SCRIPT" > "$TMP_JS"
node "$TMP_JS" "$OUT_DIR/sample_cv.pdf" "$OUT_DIR/sample_project.pdf"
rm -f "$TMP_JS"

echo "Generated valid PDFs at:"
echo "  $OUT_DIR/sample_cv.pdf"
echo "  $OUT_DIR/sample_project.pdf"
exit 0
