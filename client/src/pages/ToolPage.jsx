import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, Download, RefreshCw, AlertCircle, CheckCircle2, ArrowLeft, FileText } from 'lucide-react';
import ToolIcon from '../components/ToolIcon.jsx';

const fmtBytes = b =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

function buildDefaultOptions(tool) {
  if (!tool.options) return {};
  return Object.fromEntries(tool.options.map(o => [o.name, o.default ?? '']));
}

export default function ToolPage({ tool }) {
  const [file,    setFile]    = useState(null);
  const [opts,    setOpts]    = useState(() => buildDefaultOptions(tool));
  const [status,  setStatus]  = useState('idle');   // idle | processing | done | error
  const [result,  setResult]  = useState(null);     // { url, filename, size }
  const [errMsg,  setErrMsg]  = useState('');
  const [drag,    setDrag]    = useState(false);
  const fileRef = useRef(null);

  function pick(f) {
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) { setErrMsg('File exceeds 100 MB limit'); return; }
    setFile(f);
    setStatus('idle');
    setResult(null);
    setErrMsg('');
  }

  function reset() {
    setFile(null);
    setStatus('idle');
    setResult(null);
    setErrMsg('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function process() {
    if (!file) return;
    setStatus('processing');
    setErrMsg('');

    const fd = new FormData();
    fd.append('file', file);

    // Build URL with params
    const allParams = { ...(tool.params || {}), ...opts };
    // Remove empty string params
    Object.keys(allParams).forEach(k => { if (allParams[k] === '') delete allParams[k]; });
    const qs = new URLSearchParams(allParams).toString();
    const url = `${tool.endpoint}${qs ? '?' + qs : ''}`;

    try {
      const res = await fetch(url, { method: 'POST', body: fd });
      if (!res.ok) {
        let err = 'Conversion failed';
        try { const t = await res.text(); err = (JSON.parse(t).error) || t || err; } catch { try { err = await res.text() || err; } catch {} }
        setErrMsg(err);
        setStatus('error');
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const cd = res.headers.get('Content-Disposition') || '';
      const m  = cd.match(/filename="?([^"]+)"?/);
      const base = file.name.replace(/\.[^.]+$/, '');
      const ext  = tool.params?.targetFormat || tool.endpoint.split('/').pop();
      const filename = m?.[1] || `${base}.${ext}`;
      setResult({ url: blobUrl, filename, size: blob.size,
        origSize: res.headers.get('X-Original-Size'),
        compSize: res.headers.get('X-Compressed-Size'),
      });
      setStatus('done');
    } catch (err) {
      setErrMsg(err.message || 'Unknown error');
      setStatus('error');
    }
  }

  function download() {
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.filename;
    a.click();
  }

  const canProcess = !!file && status !== 'processing';

  return (
    <div className="tool-pg">
      {/* Back nav */}
      <Link to="/" className="back-link">
        <ArrowLeft size={15} />
        All Tools
      </Link>

      {/* Tool header */}
      <div className="tool-pg-hd">
        <div className="tool-pg-icon" style={{ background: tool.bg, color: tool.color }}>
          <ToolIcon type={tool.icon} size={28} />
        </div>
        <div>
          <h1 className="tool-pg-title">{tool.name}</h1>
          <p className="tool-pg-desc">{tool.desc}</p>
        </div>
      </div>

      {/* Main card */}
      <div className="tool-pg-card">

        {status === 'done' ? (
          /* ── Success ── */
          <div className="result-panel">
            <div className="result-icon ok"><CheckCircle2 size={32} /></div>
            <h2 className="result-title">Done!</h2>
            <p className="result-filename">{result.filename}</p>
            <p className="result-size">{fmtBytes(result.size)}</p>
            {result.origSize && result.compSize && (
              <p className="result-compress-info">
                {fmtBytes(parseInt(result.origSize))} → {fmtBytes(parseInt(result.compSize))}
                {' '}· saved {Math.max(0, Math.round((1 - result.compSize / result.origSize) * 100))}%
              </p>
            )}
            <div className="result-actions">
              <button className="btn-download" onClick={download}>
                <Download size={16} />
                Download
              </button>
              <button className="btn-again" onClick={reset}>
                <RefreshCw size={15} />
                Process another
              </button>
            </div>
          </div>

        ) : status === 'processing' ? (
          /* ── Processing ── */
          <div className="processing-panel">
            <div className="spinner-lg" style={{ borderTopColor: tool.color }} />
            <p className="processing-text">Processing your file…</p>
          </div>

        ) : (
          /* ── Upload + options ── */
          <>
            {!file ? (
              /* Drop zone */
              <div
                className={`dropzone${drag ? ' drag-over' : ''}`}
                onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
                role="button" tabIndex={0} aria-label="Click or drag a file to upload"
              >
                <div className="dropzone-icon" style={{ color: tool.color, background: tool.bg }}>
                  <Upload size={24} />
                </div>
                <p className="dropzone-primary">Drop your file here</p>
                <p className="dropzone-sub">or <span style={{ color: tool.color }}>click to browse</span> · up to 100 MB</p>
                <p className="dropzone-formats">{tool.accept.split(',').map(e => e.replace('.','').toUpperCase()).join(' · ')}</p>
                <input type="file" accept={tool.accept} ref={fileRef}
                  onChange={e => pick(e.target.files?.[0])}
                  onClick={e => e.stopPropagation()} tabIndex={-1} />
              </div>

            ) : (
              /* File selected */
              <div className="file-row">
                <div className="file-info-box">
                  <div className="file-info-icon">
                    <FileText size={20} />
                  </div>
                  <div className="file-info-text">
                    <span className="file-name" title={file.name}>{file.name}</span>
                    <span className="file-size">{fmtBytes(file.size)}</span>
                  </div>
                  <button className="btn-remove" onClick={reset} aria-label="Remove">
                    <X size={15} />
                  </button>
                </div>

                {/* Options */}
                {tool.options?.length > 0 && (
                  <div className="options-box">
                    {tool.options.map(opt => (
                      <div key={opt.name} className="opt-row">
                        <label className="opt-label">{opt.label}</label>

                        {opt.type === 'select' && (
                          <select
                            className="opt-select"
                            value={opts[opt.name]}
                            onChange={e => setOpts(o => ({ ...o, [opt.name]: e.target.value }))}
                          >
                            {opt.choices.map(c => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        )}

                        {opt.type === 'text' && (
                          <>
                            <input
                              className="opt-input"
                              type="text"
                              placeholder={opt.placeholder}
                              value={opts[opt.name]}
                              onChange={e => setOpts(o => ({ ...o, [opt.name]: e.target.value }))}
                            />
                            {opt.hint && <p className="opt-hint">{opt.hint}</p>}
                          </>
                        )}

                        {opt.type === 'number' && (
                          <input
                            className="opt-input opt-input-sm"
                            type="number"
                            min={opt.min}
                            max={opt.max}
                            value={opts[opt.name]}
                            onChange={e => setOpts(o => ({ ...o, [opt.name]: e.target.value }))}
                          />
                        )}

                        {opt.type === 'range' && (
                          <div className="opt-range-row">
                            <input
                              type="range"
                              className="opt-range"
                              min={opt.min} max={opt.max} step={opt.step}
                              value={opts[opt.name]}
                              onChange={e => setOpts(o => ({ ...o, [opt.name]: e.target.value }))}
                            />
                            <span className="opt-range-val">
                              {opt.format ? opt.format(parseFloat(opts[opt.name])) : opts[opt.name]}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {status === 'error' && (
              <div className="err-banner">
                <AlertCircle size={15} />
                <span>{errMsg}</span>
                <button className="err-retry" onClick={process}>Retry</button>
              </div>
            )}

            {/* Action */}
            {file && (
              <button
                className="btn-process"
                style={{ background: tool.color }}
                onClick={process}
                disabled={!canProcess}
              >
                {tool.actionLabel}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
