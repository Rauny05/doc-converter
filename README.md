# doc-converter

Local full-stack document converter — runs entirely on localhost, nothing leaves your machine.

## Supported Conversions

| Input | Output |
|-------|--------|
| DOCX/DOC | PDF, TXT |
| XLSX/XLS | PDF, CSV |
| PPTX/PPT | PDF |
| HTML | PDF |
| JPG/PNG/GIF/WEBP/BMP | PDF |
| PDF | DOCX, TXT, PNG |

## Requirements

- Node.js 18+
- LibreOffice (for Office ↔ PDF conversions)

### Install LibreOffice

**macOS:**
```bash
brew install --cask libreoffice
```

**Ubuntu/Debian:**
```bash
sudo apt install libreoffice
```

**Note:** Puppeteer will auto-download Chromium (~200MB) on first `npm install` in `server/`. This is required for HTML → PDF conversion.

## Setup & Run

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Start backend (port 3000)

```bash
cd server && npm start
```

### 3. Start frontend (port 5173)

```bash
cd client && npm run dev
```

### 4. Open browser

```
http://localhost:5173
```

## Architecture

```
doc-converter/
├── server/
│   ├── index.js        # Express API + all conversion logic
│   └── package.json
└── client/
    ├── src/
    │   ├── App.jsx     # Main React component
    │   ├── index.css   # Global styles (Cormorant + DM Sans)
    │   └── main.jsx    # React entry point
    ├── index.html
    ├── vite.config.js  # Dev server + proxy to :3000
    └── package.json
```

## Testing

To quickly test, use any file from your system:
- Upload a `.docx` file → convert to PDF
- Upload a `.png` image → convert to PDF
- Upload a `.pdf` → extract to TXT

## Troubleshooting

**"LibreOffice is not installed"** — Install via brew or apt (see above).

**"Failed to connect"** — Ensure `npm start` is running in `server/`.

**HTML → PDF fails** — Puppeteer needs network access on first run to download Chromium. After that it works offline.

**Large files time out** — The 100MB limit is enforced client-side. Very large PDFs with many pages may take 30–60s.
