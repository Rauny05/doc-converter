'use strict';

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || process.env.VERCEL) return cb(null, true);
    const allowed = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
    cb(allowed.includes(origin) ? null : new Error('Not allowed by CORS'), allowed.includes(origin));
  },
}));
app.use(express.json());

const tmpDirs = new Set();

function log(msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function mkTmpDir(prefix) {
  const dir = path.join('/tmp', `${prefix}-${uuidv4()}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.add(dir);
  return dir;
}

function cleanDir(dir) {
  try { fs.rmSync(dir, { force: true, recursive: true }); } catch {}
  tmpDirs.delete(dir);
}

// ── LibreOffice detection ────────────────────────────────────────────────────

const SOFFICE_CANDIDATES = [
  'soffice',
  '/opt/homebrew/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
];

let _sofficePath = null;

function findSoffice() {
  if (_sofficePath) return _sofficePath;
  for (const p of SOFFICE_CANDIDATES) {
    try {
      require('child_process').execSync(`"${p}" --version`, { stdio: 'ignore', timeout: 5000 });
      _sofficePath = p;
      return p;
    } catch {}
  }
  return null;
}

// ── Format detection ─────────────────────────────────────────────────────────

const MIME_TO_FMT = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/pdf': 'pdf',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
};

function detectFormat(mimetype, originalname) {
  const ext = path.extname(originalname).toLowerCase().replace('.', '');
  return MIME_TO_FMT[mimetype] || ext || 'unknown';
}

const CONVERSION_MAP = {
  docx: ['pdf', 'txt', 'html'],
  doc:  ['pdf', 'txt', 'html'],
  xlsx: ['pdf', 'csv', 'json'],
  xls:  ['pdf', 'csv', 'json'],
  pptx: ['pdf'],
  ppt:  ['pdf'],
  odt:  ['pdf', 'docx', 'txt'],
  ods:  ['pdf', 'csv'],
  odp:  ['pdf'],
  rtf:  ['pdf', 'docx'],
  html: ['pdf'],
  md:   ['pdf', 'html'],
  txt:  ['pdf'],
  csv:  ['xlsx', 'pdf'],
  jpg:  ['pdf', 'png', 'webp'],
  jpeg: ['pdf', 'png', 'webp'],
  png:  ['pdf', 'jpg', 'webp'],
  gif:  ['pdf', 'png'],
  webp: ['pdf', 'png', 'jpg'],
  bmp:  ['pdf', 'png'],
  svg:  ['pdf', 'png'],
  pdf:  ['docx', 'txt', 'png', 'xlsx'],
};

// ── Multer ───────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = mkTmpDir('uploads');
    req._uploadDir = dir;
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `input${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(req, file, cb) { cb(null, true); },
});

// Multi-file multer for merge
const storageMulti = multer.diskStorage({
  destination(req, file, cb) {
    if (!req._uploadDir) req._uploadDir = mkTmpDir('merge');
    cb(null, req._uploadDir);
  },
  filename(req, file, cb) {
    req._fileIdx = (req._fileIdx || 0) + 1;
    const ext = path.extname(file.originalname);
    cb(null, `file-${String(req._fileIdx).padStart(3, '0')}${ext}`);
  },
});
const uploadMulti = multer({ storage: storageMulti, limits: { fileSize: 100 * 1024 * 1024 } });

// Page range parser for split
function parsePageRanges(input, total) {
  const set = new Set();
  for (const part of input.split(',').map(s => s.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = Math.max(1, a); i <= Math.min(b, total); i++) set.add(i - 1);
    } else {
      const n = Number(part);
      if (n >= 1 && n <= total) set.add(n - 1);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// Ghostscript detection for compress
const GS_CANDIDATES = ['gs', '/opt/homebrew/bin/gs', '/usr/bin/gs', '/usr/local/bin/gs'];
let _gsPath = null;
function findGs() {
  if (_gsPath !== null) return _gsPath;
  for (const p of GS_CANDIDATES) {
    try {
      require('child_process').execSync(`"${p}" --version`, { stdio: 'ignore', timeout: 3000 });
      _gsPath = p; return p;
    } catch {}
  }
  _gsPath = ''; return '';
}

// ── Conversion helpers ───────────────────────────────────────────────────────

async function libreOffice(inputPath, targetFmt, outDir, infilter = null) {
  const soffice = findSoffice();
  if (!soffice) {
    const err = new Error('LibreOffice is not available in this environment. Document conversion requires a self-hosted instance.');
    err.code = 'NO_LIBREOFFICE';
    throw err;
  }
  const args = ['--headless', '--norestore'];
  if (infilter) args.push(`--infilter=${infilter}`);
  args.push('--convert-to', targetFmt, '--outdir', outDir, inputPath);

  try {
    await execFileAsync(soffice, args, { timeout: 120000 });
  } catch (err) {
    throw new Error(`LibreOffice failed: ${err.stderr || err.message}`);
  }

  const base = path.basename(inputPath, path.extname(inputPath));
  const candidate = path.join(outDir, `${base}.${targetFmt}`);
  if (fs.existsSync(candidate)) return candidate;

  const files = fs.readdirSync(outDir).filter(f => f.endsWith(`.${targetFmt}`));
  if (files.length) return path.join(outDir, files[0]);

  throw new Error(`LibreOffice did not produce a .${targetFmt} file`);
}

async function imageToPdf(inputPath) {
  const sharp = require('sharp');
  const { PDFDocument } = require('pdf-lib');
  const pngBuf = await sharp(inputPath).png().toBuffer();
  const meta = await sharp(pngBuf).metadata();
  const pdfDoc = await PDFDocument.create();
  const img = await pdfDoc.embedPng(pngBuf);
  const page = pdfDoc.addPage([meta.width, meta.height]);
  page.drawImage(img, { x: 0, y: 0, width: meta.width, height: meta.height });
  return Buffer.from(await pdfDoc.save());
}

async function imageConvert(inputPath, targetMime) {
  const sharp = require('sharp');
  const pipeline = sharp(inputPath);
  if (targetMime === 'png') return pipeline.png().toBuffer();
  if (targetMime === 'jpg') return pipeline.jpeg({ quality: 92 }).toBuffer();
  if (targetMime === 'webp') return pipeline.webp({ quality: 90 }).toBuffer();
  throw new Error(`Unsupported image target: ${targetMime}`);
}

async function htmlToPdf(inputPath) {
  const puppeteer = require('puppeteer');
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.goto(`file://${inputPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
  } finally {
    await browser.close();
  }
}

async function markdownToPdf(inputPath, workDir) {
  const md = await fsPromises.readFile(inputPath, 'utf8');
  const escaped = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222;}
    pre{background:#f4f4f4;padding:12px;border-radius:4px;overflow:auto;}
    code{font-family:monospace;font-size:0.9em;}
    </style></head><body>${escaped}</body></html>`;
  const htmlPath = path.join(workDir, 'input.html');
  await fsPromises.writeFile(htmlPath, html, 'utf8');
  return htmlToPdf(htmlPath);
}

async function txtToPdf(inputPath, workDir) {
  const text = await fsPromises.readFile(inputPath, 'utf8');
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:monospace;white-space:pre-wrap;padding:40px;font-size:13px;line-height:1.6;color:#222;}
    </style></head><body>${escaped}</body></html>`;
  const htmlPath = path.join(workDir, 'input.html');
  await fsPromises.writeFile(htmlPath, html, 'utf8');
  return htmlToPdf(htmlPath);
}

async function pdfToText(inputPath) {
  const pdfParse = require('pdf-parse');
  const buf = await fsPromises.readFile(inputPath);
  const data = await pdfParse(buf);
  return data.text;
}

async function docxToText(inputPath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: inputPath });
  return result.value;
}

async function docxToHtml(inputPath) {
  const mammoth = require('mammoth');
  const result = await mammoth.convertToHtml({ path: inputPath });
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;}</style>
    </head><body>${result.value}</body></html>`;
}

function xlsxToCsv(inputPath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(inputPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(ws);
}

function xlsxToJson(inputPath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(inputPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return JSON.stringify(XLSX.utils.sheet_to_json(ws), null, 2);
}

function csvToXlsx(inputPath, outPath) {
  const XLSX = require('xlsx');
  const content = fs.readFileSync(inputPath, 'utf8');
  const ws = XLSX.utils.aoa_to_sheet(content.split('\n').map(r => r.split(',')));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, outPath);
}

// ── Merge ────────────────────────────────────────────────────────────────────

app.post('/api/merge', uploadMulti.array('files', 20), async (req, res) => {
  const uploadDir = req._uploadDir;
  const workDir   = mkTmpDir('work');
  const cleanup   = () => [uploadDir, workDir].filter(Boolean).forEach(cleanDir);
  res.on('finish', cleanup); res.on('close', cleanup);

  const files = req.files;
  if (!files || files.length < 2)
    return res.status(400).json({ error: 'Upload at least 2 PDF files' });

  const t0 = Date.now();
  try {
    const { PDFDocument } = require('pdf-lib');
    const merged = await PDFDocument.create();
    for (const f of files) {
      const bytes = await fsPromises.readFile(f.path);
      const doc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const buf     = Buffer.from(await merged.save());
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log(`MERGE ${files.length} files → ${buf.length} bytes in ${elapsed}s`);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="merged.pdf"',
      'X-Conversion-Time': elapsed,
    });
    res.send(buf);
  } catch (err) {
    log(`ERROR merge: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Split ────────────────────────────────────────────────────────────────────

app.post('/api/split', upload.single('file'), async (req, res) => {
  const uploadDir = req._uploadDir;
  const workDir   = mkTmpDir('work');
  const cleanup   = () => [uploadDir, workDir].filter(Boolean).forEach(cleanDir);
  res.on('finish', cleanup); res.on('close', cleanup);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const t0 = Date.now();
  try {
    const { PDFDocument } = require('pdf-lib');
    const bytes   = await fsPromises.readFile(req.file.path);
    const srcDoc  = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const total   = srcDoc.getPageCount();
    const param   = (req.query.pages || '').trim();
    const indices = param ? parsePageRanges(param, total) : Array.from({ length: total }, (_, i) => i);
    if (!indices.length) return res.status(400).json({ error: 'No valid pages specified' });

    const outDoc = await PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, indices);
    copied.forEach(p => outDoc.addPage(p));
    const buf     = Buffer.from(await outDoc.save());
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    const base    = path.basename(req.file.originalname, '.pdf');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${base}-extracted.pdf"`,
      'X-Conversion-Time': elapsed,
    });
    res.send(buf);
  } catch (err) {
    log(`ERROR split: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Rotate ───────────────────────────────────────────────────────────────────

app.post('/api/rotate', upload.single('file'), async (req, res) => {
  const uploadDir = req._uploadDir;
  const workDir   = mkTmpDir('work');
  const cleanup   = () => [uploadDir, workDir].filter(Boolean).forEach(cleanDir);
  res.on('finish', cleanup); res.on('close', cleanup);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const deg = parseInt(req.query.degrees || '90', 10);
  const t0  = Date.now();
  try {
    const { PDFDocument, degrees } = require('pdf-lib');
    const bytes = await fsPromises.readFile(req.file.path);
    const doc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (const page of doc.getPages()) {
      page.setRotation(degrees((page.getRotation().angle + deg) % 360));
    }
    const buf     = Buffer.from(await doc.save());
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    const base    = path.basename(req.file.originalname, '.pdf');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${base}-rotated.pdf"`,
      'X-Conversion-Time': elapsed,
    });
    res.send(buf);
  } catch (err) {
    log(`ERROR rotate: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Watermark ─────────────────────────────────────────────────────────────────

app.post('/api/watermark', upload.single('file'), async (req, res) => {
  const uploadDir = req._uploadDir;
  const workDir   = mkTmpDir('work');
  const cleanup   = () => [uploadDir, workDir].filter(Boolean).forEach(cleanDir);
  res.on('finish', cleanup); res.on('close', cleanup);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const text    = (req.query.text || 'CONFIDENTIAL').slice(0, 60);
  const opacity = Math.min(1, Math.max(0.05, parseFloat(req.query.opacity || '0.25')));
  const t0      = Date.now();
  try {
    const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
    const bytes = await fsPromises.readFile(req.file.path);
    const doc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font  = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const fontSize = Math.min(width, height) * 0.09;
      const tw       = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, {
        x: width / 2 - tw / 2,
        y: height / 2 - fontSize / 2,
        size: fontSize, font,
        color: rgb(0.4, 0.4, 0.4),
        opacity,
        rotate: degrees(35),
      });
    }
    const buf     = Buffer.from(await doc.save());
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    const base    = path.basename(req.file.originalname, '.pdf');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${base}-watermarked.pdf"`,
      'X-Conversion-Time': elapsed,
    });
    res.send(buf);
  } catch (err) {
    log(`ERROR watermark: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Compress ─────────────────────────────────────────────────────────────────

app.post('/api/compress', upload.single('file'), async (req, res) => {
  const uploadDir = req._uploadDir;
  const workDir   = mkTmpDir('work');
  const cleanup   = () => [uploadDir, workDir].filter(Boolean).forEach(cleanDir);
  res.on('finish', cleanup); res.on('close', cleanup);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const t0       = Date.now();
  const origSize = req.file.size;
  const base     = path.basename(req.file.originalname, '.pdf');
  const outPath  = path.join(workDir, `${base}-compressed.pdf`);

  try {
    // Try Ghostscript first (best compression)
    const gs = findGs();
    if (gs) {
      try {
        await execFileAsync(gs, [
          '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5',
          '-dPDFSETTINGS=/ebook',
          '-dNOPAUSE', '-dQUIET', '-dBATCH',
          `-sOutputFile=${outPath}`, req.file.path,
        ], { timeout: 120000 });
        if (fs.existsSync(outPath)) {
          const elapsed  = ((Date.now() - t0) / 1000).toFixed(2);
          const compSize = fs.statSync(outPath).size;
          log(`COMPRESS gs: ${origSize} → ${compSize} bytes in ${elapsed}s`);
          res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${base}-compressed.pdf"`,
            'X-Conversion-Time': elapsed,
            'X-Original-Size': origSize,
            'X-Compressed-Size': compSize,
          });
          return res.sendFile(outPath);
        }
      } catch {}
    }

    // Fallback: pdf-lib re-save with object streams
    const { PDFDocument } = require('pdf-lib');
    const bytes = await fsPromises.readFile(req.file.path);
    const doc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const buf   = Buffer.from(await doc.save({ useObjectStreams: true }));
    await fsPromises.writeFile(outPath, buf);
    const elapsed  = ((Date.now() - t0) / 1000).toFixed(2);
    const compSize = buf.length;
    log(`COMPRESS pdf-lib: ${origSize} → ${compSize} bytes in ${elapsed}s`);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${base}-compressed.pdf"`,
      'X-Conversion-Time': elapsed,
      'X-Original-Size': origSize,
      'X-Compressed-Size': compSize,
    });
    res.sendFile(outPath);
  } catch (err) {
    log(`ERROR compress: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Page Numbers ─────────────────────────────────────────────────────────────

app.post('/api/page-numbers', upload.single('file'), async (req, res) => {
  const uploadDir = req._uploadDir;
  const workDir   = mkTmpDir('work');
  const cleanup   = () => [uploadDir, workDir].filter(Boolean).forEach(cleanDir);
  res.on('finish', cleanup); res.on('close', cleanup);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const position = req.query.position || 'bottom-center';
  const startAt  = Math.max(1, parseInt(req.query.startAt || '1', 10));
  const t0       = Date.now();
  try {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const bytes = await fsPromises.readFile(req.file.path);
    const doc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font  = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;
    const margin   = 24;
    doc.getPages().forEach((page, i) => {
      const { width, height } = page.getSize();
      const label = String(i + startAt);
      const tw    = font.widthOfTextAtSize(label, fontSize);
      const [vert, horiz = 'center'] = position.split('-');
      const y = vert === 'top' ? height - margin - fontSize : margin;
      const x = horiz === 'right' ? width - margin - tw : horiz === 'left' ? margin : width / 2 - tw / 2;
      page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.3, 0.3, 0.3) });
    });
    const buf     = Buffer.from(await doc.save());
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    const base    = path.basename(req.file.originalname, '.pdf');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${base}-numbered.pdf"`,
      'X-Conversion-Time': elapsed,
    });
    res.send(buf);
  } catch (err) {
    log(`ERROR page-numbers: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Edit PDF ──────────────────────────────────────────────────────────────────

app.post('/api/edit-pdf', upload.single('file'), async (req, res) => {
  const uploadDir = req._uploadDir;
  const cleanup   = () => [uploadDir].filter(Boolean).forEach(cleanDir);
  res.on('finish', cleanup); res.on('close', cleanup);

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let ops = [];
  try { ops = JSON.parse(req.body.ops || '[]'); } catch { return res.status(400).json({ error: 'Invalid ops JSON' }); }

  try {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const bytes  = await fsPromises.readFile(req.file.path);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages  = pdfDoc.getPages();

    const fontCache = {};
    async function getFont(family, bold, italic) {
      const key = `${family}-${!!bold}-${!!italic}`;
      if (fontCache[key]) return fontCache[key];
      let name;
      if (family === 'Times') {
        if (bold && italic) name = StandardFonts.TimesRomanBoldItalic;
        else if (bold)       name = StandardFonts.TimesRomanBold;
        else if (italic)     name = StandardFonts.TimesRomanItalic;
        else                 name = StandardFonts.TimesRoman;
      } else if (family === 'Courier') {
        if (bold && italic) name = StandardFonts.CourierBoldOblique;
        else if (bold)       name = StandardFonts.CourierBold;
        else if (italic)     name = StandardFonts.CourierOblique;
        else                 name = StandardFonts.Courier;
      } else {
        if (bold && italic) name = StandardFonts.HelveticaBoldOblique;
        else if (bold)       name = StandardFonts.HelveticaBold;
        else if (italic)     name = StandardFonts.HelveticaOblique;
        else                 name = StandardFonts.Helvetica;
      }
      fontCache[key] = await pdfDoc.embedFont(name);
      return fontCache[key];
    }

    function hexToRgb(hex) {
      hex = (hex || '#000000').replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      return rgb(parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255);
    }

    for (const op of ops) {
      const page = pages[op.page];
      if (!page) continue;
      if (op.type === 'text' && op.text) {
        const font = await getFont(op.font || 'Helvetica', op.bold, op.italic);
        page.drawText(String(op.text), { x: op.x, y: op.y, size: op.size || 14, font, color: hexToRgb(op.color) });
      } else if (op.type === 'rect') {
        page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color: rgb(1,1,1) });
      }
    }

    const buf  = Buffer.from(await pdfDoc.save());
    const base = path.basename(req.file.originalname, '.pdf');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${base}-edited.pdf"` });
    res.send(buf);
  } catch (err) {
    log(`ERROR edit-pdf: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Convert (general) ────────────────────────────────────────────────────────

app.post('/api/convert', upload.single('file'), async (req, res) => {
  const uploadDir = req._uploadDir;
  const workDir = mkTmpDir('work');

  function cleanup() {
    [uploadDir, workDir].filter(Boolean).forEach(cleanDir);
  }
  res.on('finish', cleanup);
  res.on('close', cleanup);

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded', statusCode: 400 });
  }

  const inputPath = req.file.path;
  const inputFmt = detectFormat(req.file.mimetype, req.file.originalname);
  const targetFormat = (req.query.targetFormat || '').toLowerCase()
    || (CONVERSION_MAP[inputFmt] || [])[0];

  if (!targetFormat) {
    return res.status(400).json({
      error: `No conversion available for format: ${inputFmt}`,
      statusCode: 400,
    });
  }

  log(`START ${req.file.originalname} [${inputFmt}] → ${targetFormat}`);
  const t0 = Date.now();

  try {
    let outputPath, contentType, outputFilename;
    const base = path.basename(req.file.originalname, path.extname(req.file.originalname));

    // ── Office/document → PDF ──────────────────────────────────────────────
    if (['docx','doc','odt','rtf','pptx','ppt','odp'].includes(inputFmt) && targetFormat === 'pdf') {
      outputPath = await libreOffice(inputPath, 'pdf', workDir);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    } else if (['xlsx','xls','ods'].includes(inputFmt) && targetFormat === 'pdf') {
      outputPath = await libreOffice(inputPath, 'pdf', workDir);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    // ── Office interop ─────────────────────────────────────────────────────
    } else if (['odt','rtf'].includes(inputFmt) && targetFormat === 'docx') {
      outputPath = await libreOffice(inputPath, 'docx', workDir);
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      outputFilename = `${base}.docx`;

    } else if (inputFmt === 'ods' && targetFormat === 'csv') {
      outputPath = await libreOffice(inputPath, 'csv', workDir);
      contentType = 'text/csv';
      outputFilename = `${base}.csv`;

    // ── DOCX → text / html ─────────────────────────────────────────────────
    } else if (['docx','doc','odt'].includes(inputFmt) && targetFormat === 'txt') {
      const text = await docxToText(inputPath);
      outputPath = path.join(workDir, `${base}.txt`);
      await fsPromises.writeFile(outputPath, text, 'utf8');
      contentType = 'text/plain';
      outputFilename = `${base}.txt`;

    } else if (['docx','doc'].includes(inputFmt) && targetFormat === 'html') {
      const html = await docxToHtml(inputPath);
      outputPath = path.join(workDir, `${base}.html`);
      await fsPromises.writeFile(outputPath, html, 'utf8');
      contentType = 'text/html';
      outputFilename = `${base}.html`;

    // ── XLSX → csv / json ──────────────────────────────────────────────────
    } else if (['xlsx','xls'].includes(inputFmt) && targetFormat === 'csv') {
      const csv = xlsxToCsv(inputPath);
      outputPath = path.join(workDir, `${base}.csv`);
      await fsPromises.writeFile(outputPath, csv, 'utf8');
      contentType = 'text/csv';
      outputFilename = `${base}.csv`;

    } else if (['xlsx','xls'].includes(inputFmt) && targetFormat === 'json') {
      const json = xlsxToJson(inputPath);
      outputPath = path.join(workDir, `${base}.json`);
      await fsPromises.writeFile(outputPath, json, 'utf8');
      contentType = 'application/json';
      outputFilename = `${base}.json`;

    // ── CSV → xlsx ─────────────────────────────────────────────────────────
    } else if (inputFmt === 'csv' && targetFormat === 'xlsx') {
      outputPath = path.join(workDir, `${base}.xlsx`);
      csvToXlsx(inputPath, outputPath);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      outputFilename = `${base}.xlsx`;

    } else if (inputFmt === 'csv' && targetFormat === 'pdf') {
      const XLSX = require('xlsx');
      const content = fs.readFileSync(inputPath, 'utf8');
      const rows = content.split('\n').map(r => `<tr>${r.split(',').map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;font-size:12px;}
        body{font-family:sans-serif;padding:20px;}</style></head>
        <body><table>${rows}</table></body></html>`;
      const hp = path.join(workDir, 'input.html');
      await fsPromises.writeFile(hp, html, 'utf8');
      const pdfBuf = await htmlToPdf(hp);
      outputPath = path.join(workDir, `${base}.pdf`);
      await fsPromises.writeFile(outputPath, pdfBuf);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    // ── HTML / Markdown / TXT → PDF ────────────────────────────────────────
    } else if (inputFmt === 'html' && targetFormat === 'pdf') {
      const pdfBuf = await htmlToPdf(inputPath);
      outputPath = path.join(workDir, `${base}.pdf`);
      await fsPromises.writeFile(outputPath, pdfBuf);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    } else if (inputFmt === 'md' && targetFormat === 'pdf') {
      const pdfBuf = await markdownToPdf(inputPath, workDir);
      outputPath = path.join(workDir, `${base}.pdf`);
      await fsPromises.writeFile(outputPath, pdfBuf);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    } else if (inputFmt === 'md' && targetFormat === 'html') {
      const md = await fsPromises.readFile(inputPath, 'utf8');
      const escaped = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${escaped}</body></html>`;
      outputPath = path.join(workDir, `${base}.html`);
      await fsPromises.writeFile(outputPath, html, 'utf8');
      contentType = 'text/html';
      outputFilename = `${base}.html`;

    } else if (inputFmt === 'txt' && targetFormat === 'pdf') {
      const pdfBuf = await txtToPdf(inputPath, workDir);
      outputPath = path.join(workDir, `${base}.pdf`);
      await fsPromises.writeFile(outputPath, pdfBuf);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    // ── Images → PDF ───────────────────────────────────────────────────────
    } else if (['jpg','jpeg','png','gif','webp','bmp'].includes(inputFmt) && targetFormat === 'pdf') {
      const pdfBuf = await imageToPdf(inputPath);
      outputPath = path.join(workDir, `${base}.pdf`);
      await fsPromises.writeFile(outputPath, pdfBuf);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    // ── SVG → PDF / PNG ────────────────────────────────────────────────────
    } else if (inputFmt === 'svg' && targetFormat === 'pdf') {
      const pdfBuf = await htmlToPdf(inputPath);
      outputPath = path.join(workDir, `${base}.pdf`);
      await fsPromises.writeFile(outputPath, pdfBuf);
      contentType = 'application/pdf';
      outputFilename = `${base}.pdf`;

    } else if (inputFmt === 'svg' && targetFormat === 'png') {
      const sharp = require('sharp');
      const buf = await sharp(inputPath).png().toBuffer();
      outputPath = path.join(workDir, `${base}.png`);
      await fsPromises.writeFile(outputPath, buf);
      contentType = 'image/png';
      outputFilename = `${base}.png`;

    // ── Image ↔ Image ──────────────────────────────────────────────────────
    } else if (['jpg','jpeg','png','gif','webp','bmp'].includes(inputFmt) &&
               ['png','jpg','webp'].includes(targetFormat)) {
      const buf = await imageConvert(inputPath, targetFormat);
      outputPath = path.join(workDir, `${base}.${targetFormat}`);
      await fsPromises.writeFile(outputPath, buf);
      const mimeMap = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
      contentType = mimeMap[targetFormat];
      outputFilename = `${base}.${targetFormat}`;

    // ── PDF → DOCX ─────────────────────────────────────────────────────────
    } else if (inputFmt === 'pdf' && targetFormat === 'docx') {
      outputPath = await libreOffice(inputPath, 'docx', workDir, 'writer_pdf_import');
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      outputFilename = `${base}.docx`;

    // ── PDF → XLSX ─────────────────────────────────────────────────────────
    } else if (inputFmt === 'pdf' && targetFormat === 'xlsx') {
      outputPath = await libreOffice(inputPath, 'xlsx', workDir, 'calc_pdf_import');
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      outputFilename = `${base}.xlsx`;

    // ── PDF → TXT ──────────────────────────────────────────────────────────
    } else if (inputFmt === 'pdf' && targetFormat === 'txt') {
      const text = await pdfToText(inputPath);
      outputPath = path.join(workDir, `${base}.txt`);
      await fsPromises.writeFile(outputPath, text, 'utf8');
      contentType = 'text/plain';
      outputFilename = `${base}.txt`;

    // ── PDF → PNG ──────────────────────────────────────────────────────────
    } else if (inputFmt === 'pdf' && targetFormat === 'png') {
      outputPath = await libreOffice(inputPath, 'png', workDir);
      const outFiles = fs.readdirSync(workDir).filter(f => f.endsWith('.png'));
      if (!outFiles.length) throw new Error('LibreOffice did not produce PNG output');
      if (outFiles.length === 1) {
        outputPath = path.join(workDir, outFiles[0]);
        contentType = 'image/png';
        outputFilename = `${base}.png`;
      } else {
        const zip = path.join(workDir, `${base}-pages.zip`);
        await zipFiles(outFiles.map(f => path.join(workDir, f)), zip);
        outputPath = zip;
        contentType = 'application/zip';
        outputFilename = `${base}-pages.zip`;
      }

    } else {
      return res.status(400).json({
        error: `Conversion from ${inputFmt} to ${targetFormat} is not supported`,
        statusCode: 400,
      });
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log(`END ${outputFilename} in ${elapsed}s`);

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${outputFilename}"`,
      'X-Conversion-Time': elapsed,
    });
    res.sendFile(outputPath);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, statusCode: 500 });
    }
  }
});

// ── Formats endpoint (used by frontend) ─────────────────────────────────────

app.get('/api/formats', (req, res) => {
  res.json(CONVERSION_MAP);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', libreoffice: !!findSoffice(), timestamp: new Date().toISOString() });
});

// ── Zip helper ───────────────────────────────────────────────────────────────

async function zipFiles(files, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const chunks = [];
    output.on('finish', resolve);
    output.on('error', reject);
    const ZipStream = (() => {
      try { return require('archiver'); } catch { return null; }
    })();
    if (!ZipStream) {
      // Fallback: just return first file
      fs.copyFileSync(files[0], outPath);
      return resolve();
    }
    const archive = ZipStream('zip');
    archive.pipe(output);
    for (const f of files) archive.file(f, { name: path.basename(f) });
    archive.finalize();
  });
}

// ── Server ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  const server = app.listen(PORT, () => {
    log(`Server on http://localhost:${PORT} | LibreOffice: ${findSoffice() || 'not found'}`);
  });
  function gracefulShutdown() {
    log('Shutdown: cleaning temp files');
    for (const d of tmpDirs) cleanDir(d);
    server.close(() => process.exit(0));
  }
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

module.exports = app;
