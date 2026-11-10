// Copies the pdf.js worker and its standard fonts into public/ so the browser can draw statements.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
if (!fs.existsSync(src)) process.exit(0);
// public/ may not exist yet: the Docker image installs packages before copying the rest of the project
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.copyFileSync(path.join(src, 'legacy', 'build', 'pdf.worker.min.mjs'), path.join(root, 'public', 'pdf.worker.min.mjs'));
const fonts = path.join(root, 'public', 'pdf-fonts');
fs.mkdirSync(fonts, { recursive: true });
for (const f of fs.readdirSync(path.join(src, 'standard_fonts'))) fs.copyFileSync(path.join(src, 'standard_fonts', f), path.join(fonts, f));
