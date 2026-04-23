import { useState, useRef, useEffect } from 'react';

const FMT_LABEL = {
  docx:'DOCX', doc:'DOC', xlsx:'XLSX', xls:'XLS', pptx:'PPTX', ppt:'PPT',
  odt:'ODT', ods:'ODS', odp:'ODP', rtf:'RTF', pdf:'PDF', html:'HTML',
  md:'MD', txt:'TXT', csv:'CSV', json:'JSON', svg:'SVG',
  jpg:'JPG', jpeg:'JPEG', png:'PNG', gif:'GIF', webp:'WEBP', bmp:'BMP', zip:'ZIP',
};

const FMT_ICON = {
  docx:'📝', doc:'📝', odt:'📝', rtf:'📝',
  xlsx:'📊', xls:'📊', ods:'📊', csv:'📋', json:'{}',
  pptx:'📊', ppt:'📊', odp:'📊',
  pdf:'📄', html:'🌐', md:'#', txt:'📃',
  jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', webp:'🖼', bmp:'🖼', svg:'🖼',
  zip:'🗜',
};

const CONV_MAP = {
  docx:['pdf','txt','html'], doc:['pdf','txt','html'],
  xlsx:['pdf','csv','json'], xls:['pdf','csv','json'],
  pptx:['pdf'], ppt:['pdf'],
  odt:['pdf','docx','txt'], ods:['pdf','csv'], odp:['pdf'],
  rtf:['pdf','docx'],
  html:['pdf'], md:['pdf','html'], txt:['pdf'],
  csv:['xlsx','pdf'],
  jpg:['pdf','png','webp'], jpeg:['pdf','png','webp'],
  png:['pdf','jpg','webp'], gif:['pdf','png'],
  webp:['pdf','png','jpg'], bmp:['pdf','png'],
  svg:['pdf','png'],
  pdf:['docx','txt','png','xlsx'],
};

const MIME_EXT = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/msword':'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
  'application/vnd.ms-excel':'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
  'application/vnd.ms-powerpoint':'ppt',
  'application/pdf':'pdf', 'text/html':'html', 'text/markdown':'md',
  'text/plain':'txt', 'text/csv':'csv',
  'application/rtf':'rtf', 'text/rtf':'rtf',
  'application/vnd.oasis.opendocument.text':'odt',
  'application/vnd.oasis.opendocument.spreadsheet':'ods',
  'application/vnd.oasis.opendocument.presentation':'odp',
  'image/jpeg':'jpg', 'image/png':'png', 'image/gif':'gif',
  'image/webp':'webp', 'image/bmp':'bmp', 'image/svg+xml':'svg',
};

const HISTORY_KEY = 'cvt_history';
function loadHist() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'); } catch { return []; } }
function saveHist(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0,5))); }

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function detectFmt(file) {
  return MIME_EXT[file.type] || file.name.split('.').pop()?.toLowerCase() || 'unknown';
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}

export default function App() {
  const [file, setFile]           = useState(null);
  const [inFmt, setInFmt]         = useState('');
  const [outFmt, setOutFmt]       = useState('');
  const [status, setStatus]       = useState('idle');
  const [resultUrl, setResultUrl] = useState(null);
  const [resultFile, setResultFile] = useState('');
  const [convTime, setConvTime]   = useState(null);
  const [errMsg, setErrMsg]       = useState('');
  const [dragOver, setDragOver]   = useState(false);
  const [history, setHistory]     = useState(loadHist);
  const [histOpen, setHistOpen]   = useState(false);
  const fileRef = useRef(null);

  const outOpts = CONV_MAP[inFmt] || [];

  function pick(f) {
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) { setStatus('error'); setErrMsg('File exceeds 100MB limit'); return; }
    const fmt = detectFmt(f);
    setFile(f); setInFmt(fmt);
    setOutFmt((CONV_MAP[fmt]||[])[0]||'');
    setStatus('idle'); setResultUrl(null); setErrMsg('');
  }

  function clear() {
    setFile(null); setInFmt(''); setOutFmt('');
    setStatus('idle'); setResultUrl(null); setErrMsg('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function convert() {
    if (!file || !outFmt) return;
    setStatus('converting'); setErrMsg(''); setResultUrl(null);

    const fd = new FormData();
    fd.append('file', file);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 120000);
    const t0 = Date.now();

    try {
      const API = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${API}/api/convert?targetFormat=${outFmt}`, {
        method: 'POST', body: fd, signal: ctrl.signal,
      });
      clearTimeout(tid);

      const elapsed = parseFloat(
        res.headers.get('X-Conversion-Time') || ((Date.now()-t0)/1000).toFixed(2)
      );

      if (!res.ok) {
        let err = 'Conversion failed';
        try { const raw = await res.text(); try { err = JSON.parse(raw).error||raw||err; } catch { err = raw||err; } } catch {}
        setStatus('error'); setErrMsg(err); return;
      }

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const cd   = res.headers.get('Content-Disposition')||'';
      const m    = cd.match(/filename="?([^"]+)"?/);
      const fname = m?.[1] || `converted.${outFmt}`;

      setResultUrl(url); setResultFile(fname); setConvTime(elapsed); setStatus('success');

      const entry = { inputName: file.name, outputFmt: outFmt.toUpperCase(), convTime: elapsed, ts: Date.now() };
      const nh = [entry, ...history].slice(0,5);
      setHistory(nh); saveHist(nh);

    } catch (err) {
      clearTimeout(tid);
      if (err.name === 'AbortError') { setStatus('error'); setErrMsg('Conversion timed out. Try a smaller file.'); }
      else if (err.message?.toLowerCase().includes('fetch'))
        { setStatus('error'); setErrMsg('Cannot connect to backend. Make sure it\'s running on port 3000.'); }
      else { setStatus('error'); setErrMsg(err.message||'Unknown error'); }
    }
  }

  function download() {
    const a = document.createElement('a');
    a.href = resultUrl; a.download = resultFile; a.click();
  }

  function histClick(e) {
    clear();
    setOutFmt(e.outputFmt.toLowerCase());
  }

  const canConvert = file && outFmt && status !== 'converting';

  const SUPPORTED = Object.entries(CONV_MAP).map(([from, tos]) => ({ from, tos }));

  return (
    <div className="app" style={{display:'flex',flexDirection:'column',minHeight:'100vh'}}>

      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <h1>Convert<em>.</em></h1>
          <span className="header-badge">{Object.keys(CONV_MAP).length} formats</span>
        </div>
        <span className="header-sub">Local · Private · No uploads</span>
      </header>

      {/* ── Body ── */}
      <div className="body">

        {/* Left: converter */}
        <main className="main" aria-label="File converter">

          {!file ? (
            <>
              <div
                className={`drop-zone${dragOver?' over':''}`}
                onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key==='Enter'||e.key===' ') fileRef.current?.click(); }}
                role="button" tabIndex={0}
                aria-label="Click or drag a file to upload"
              >
                <div className="drop-zone-icon"><UploadIcon /></div>
                <h2>Drag file here or click to browse</h2>
                <p>Up to 100MB · all formats supported</p>
                <input type="file" accept="*/*" ref={fileRef}
                  onChange={e => pick(e.target.files?.[0])}
                  onClick={e => e.stopPropagation()} tabIndex={-1}
                  aria-label="File upload" />
              </div>

              <div>
                <p className="fmt-grid-label" style={{marginBottom:10}}>Supported conversions</p>
                <div className="fmt-pills">
                  {Object.keys(CONV_MAP).map(f => (
                    <span key={f} className="fmt-pill">{FMT_LABEL[f]||f.toUpperCase()}</span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="file-card">
              {/* File header */}
              <div className="file-card-top">
                <div className="file-icon">{FMT_ICON[inFmt]||'📄'}</div>
                <div className="file-meta">
                  <div className="file-name" title={file.name}>{file.name}</div>
                  <div className="file-size">{fmtBytes(file.size)} · {FMT_LABEL[inFmt]||inFmt.toUpperCase()}</div>
                </div>
                <button className="btn-x" onClick={clear} aria-label="Remove file">×</button>
              </div>

              {/* Format selectors */}
              <div className="fmt-row">
                <div className="fmt-col">
                  <span className="fmt-lbl">From</span>
                  <div className="sel-wrap">
                    <select value={inFmt} disabled aria-label="Input format">
                      <option value={inFmt}>{FMT_LABEL[inFmt]||inFmt.toUpperCase()}</option>
                    </select>
                  </div>
                </div>
                <div className="fmt-arrow">→</div>
                <div className="fmt-col">
                  <span className="fmt-lbl">To</span>
                  <div className="sel-wrap">
                    <select value={outFmt} onChange={e=>setOutFmt(e.target.value)}
                      disabled={status==='converting'} aria-label="Output format">
                      {outOpts.length===0 && <option value="">Not supported</option>}
                      {outOpts.map(f=>(
                        <option key={f} value={f}>{FMT_LABEL[f]||f.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="card-actions">
                <button className="btn-convert" onClick={convert} disabled={!canConvert}
                  aria-label={status==='converting'?'Converting...':'Convert file'}>
                  {status==='converting'
                    ? <><span className="spin" aria-hidden="true"/>Converting…</>
                    : `Convert to ${(FMT_LABEL[outFmt]||outFmt||'…').toUpperCase()}`}
                </button>

                {status==='converting' && (
                  <div className="progress" role="progressbar" aria-label="Conversion progress">
                    <div className="progress-bar"/>
                  </div>
                )}

                {status==='success' && (
                  <div className="result ok" role="status">
                    <span className="result-icon">✓</span>
                    <div className="result-body">
                      <div className="result-title">Done in {convTime}s</div>
                      <div className="result-sub">{resultFile}</div>
                    </div>
                    <button className="btn-dl" onClick={download} aria-label={`Download ${resultFile}`}>
                      Download
                    </button>
                  </div>
                )}

                {status==='error' && (
                  <div className="result err" role="alert">
                    <span className="result-icon">✕</span>
                    <div className="result-body">
                      <div className="result-title">Failed</div>
                      <div className="result-sub">{errMsg}</div>
                    </div>
                    <button className="btn-retry" onClick={convert} aria-label="Retry conversion">
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Right: history sidebar */}
        <aside className="aside" aria-label="Conversion history">

          {/* Desktop header — hidden on mobile via CSS */}
          <div className="aside-title">
            <span>History</span>
            {history.length>0 && (
              <button className="btn-clr" onClick={()=>{setHistory([]);saveHist([]);}} aria-label="Clear history">
                Clear
              </button>
            )}
          </div>

          {/* Desktop list — always visible on desktop, hidden on mobile via CSS */}
          <div className="hist-list" style={{flex:1}}>
            {history.length===0
              ? <p className="hist-empty">No conversions yet</p>
              : history.map((e,i)=>(
                <button key={i} className="hist-item" onClick={()=>histClick(e)}
                  aria-label={`Retry ${e.inputName} to ${e.outputFmt}`}>
                  <div className="hist-main">
                    {e.inputName.length>22 ? e.inputName.slice(0,20)+'…' : e.inputName}
                    <span className="arr">→</span>{e.outputFmt}
                  </div>
                  <div className="hist-sub">{e.convTime}s · {fmtTime(e.ts)}</div>
                </button>
              ))
            }
          </div>

          {/* Desktop format reference */}
          <div className="fmt-grid">
            <p className="fmt-grid-label">All conversions</p>
            <div className="fmt-grid-rows">
              {SUPPORTED.map(({from,tos})=>(
                <div key={from} className="fmt-grid-row">
                  <span className="fmt-grid-from">{FMT_LABEL[from]||from.toUpperCase()}</span>
                  <span className="fmt-grid-sep">→</span>
                  <span className="fmt-grid-tos">
                    {tos.map(t=><span key={t} className="fmt-grid-to">{FMT_LABEL[t]||t.toUpperCase()}</span>)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile: collapsible toggle */}
          <button className="hist-toggle" onClick={()=>setHistOpen(o=>!o)}
            aria-expanded={histOpen} aria-controls="hist-slide">
            <span>Recent ({history.length})</span>
            <span className={`hist-toggle-icon${histOpen?' open':''}`} aria-hidden="true">▾</span>
          </button>
          <div id="hist-slide" className={`hist-slide${histOpen?' open':''}`}>
            <div style={{height:10}}/>
            {history.length===0
              ? <p className="hist-empty">No conversions yet</p>
              : history.map((e,i)=>(
                <button key={i} className="hist-item" onClick={()=>histClick(e)}
                  aria-label={`Retry ${e.inputName} to ${e.outputFmt}`}
                  style={{marginBottom:6}}>
                  <div className="hist-main">
                    {e.inputName.length>22 ? e.inputName.slice(0,20)+'…' : e.inputName}
                    <span className="arr">→</span>{e.outputFmt}
                  </div>
                  <div className="hist-sub">{e.convTime}s · {fmtTime(e.ts)}</div>
                </button>
              ))
            }
          </div>
        </aside>
      </div>
    </div>
  );
}
