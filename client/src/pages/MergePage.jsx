import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, Download, RefreshCw, AlertCircle, CheckCircle2, ArrowLeft, GripVertical, FileText } from 'lucide-react';
import ToolIcon from '../components/ToolIcon.jsx';

const fmtBytes = b =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

export default function MergePage() {
  const [files,   setFiles]   = useState([]);
  const [status,  setStatus]  = useState('idle');
  const [result,  setResult]  = useState(null);
  const [errMsg,  setErrMsg]  = useState('');
  const [drag,    setDrag]    = useState(false);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const fileRef = useRef(null);

  const tool = { icon: 'merge', color: '#DC2626', bg: '#FEF2F2' };

  function addFiles(newFiles) {
    const pdfs = [...newFiles].filter(f => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf');
    if (!pdfs.length) return;
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      const fresh = pdfs.filter(f => !existing.has(f.name + f.size));
      return [...prev, ...fresh].slice(0, 20);
    });
    setStatus('idle');
    setResult(null);
    setErrMsg('');
  }

  function remove(idx) {
    setFiles(f => f.filter((_, i) => i !== idx));
  }

  function reset() {
    setFiles([]);
    setStatus('idle');
    setResult(null);
    setErrMsg('');
    if (fileRef.current) fileRef.current.value = '';
  }

  // Simple drag-to-reorder
  function onDragStart(e, idx) {
    setDraggingIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, idx) {
    e.preventDefault();
    if (draggingIdx === null || draggingIdx === idx) return;
    setFiles(prev => {
      const arr = [...prev];
      const [item] = arr.splice(draggingIdx, 1);
      arr.splice(idx, 0, item);
      setDraggingIdx(idx);
      return arr;
    });
  }

  function onDragEnd() { setDraggingIdx(null); }

  async function merge() {
    if (files.length < 2) { setErrMsg('Add at least 2 PDF files'); return; }
    setStatus('processing');
    setErrMsg('');

    const fd = new FormData();
    files.forEach(f => fd.append('files', f));

    try {
      const res = await fetch('/api/merge', { method: 'POST', body: fd });
      if (!res.ok) {
        let err = 'Merge failed';
        try { const t = await res.text(); err = JSON.parse(t).error || t || err; } catch {}
        setErrMsg(err); setStatus('error'); return;
      }
      const blob = await res.blob();
      setResult({ url: URL.createObjectURL(blob), filename: 'merged.pdf', size: blob.size });
      setStatus('done');
    } catch (err) {
      setErrMsg(err.message || 'Unknown error');
      setStatus('error');
    }
  }

  function download() {
    const a = document.createElement('a');
    a.href = result.url; a.download = result.filename; a.click();
  }

  return (
    <div className="tool-pg">
      <Link to="/" className="back-link"><ArrowLeft size={15} />All Tools</Link>

      <div className="tool-pg-hd">
        <div className="tool-pg-icon" style={{ background: tool.bg, color: tool.color }}>
          <ToolIcon type="merge" size={28} />
        </div>
        <div>
          <h1 className="tool-pg-title">Merge PDF</h1>
          <p className="tool-pg-desc">Combine multiple PDFs into one document — drag to reorder</p>
        </div>
      </div>

      <div className="tool-pg-card">

        {status === 'done' ? (
          <div className="result-panel">
            <div className="result-icon ok"><CheckCircle2 size={32} /></div>
            <h2 className="result-title">Merged successfully!</h2>
            <p className="result-filename">{result.filename}</p>
            <p className="result-size">{fmtBytes(result.size)} · {files.length} files combined</p>
            <div className="result-actions">
              <button className="btn-download" onClick={download}><Download size={16} />Download</button>
              <button className="btn-again" onClick={reset}><RefreshCw size={15} />Merge more</button>
            </div>
          </div>

        ) : status === 'processing' ? (
          <div className="processing-panel">
            <div className="spinner-lg" style={{ borderTopColor: tool.color }} />
            <p className="processing-text">Merging {files.length} files…</p>
          </div>

        ) : (
          <>
            {/* Drop zone (always visible when < 20 files) */}
            {files.length < 20 && (
              <div
                className={`dropzone merge-dropzone${drag ? ' drag-over' : ''}`}
                onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
                role="button" tabIndex={0}
              >
                <div className="dropzone-icon" style={{ color: tool.color, background: tool.bg }}>
                  <Upload size={24} />
                </div>
                <p className="dropzone-primary">{files.length === 0 ? 'Drop PDF files here' : 'Add more PDFs'}</p>
                <p className="dropzone-sub">or <span style={{ color: tool.color }}>click to browse</span> · PDF only · up to 20 files</p>
                <input type="file" accept=".pdf" multiple ref={fileRef}
                  onChange={e => addFiles(e.target.files)}
                  onClick={e => e.stopPropagation()} tabIndex={-1} />
              </div>
            )}

            {/* File list */}
            {files.length > 0 && (
              <div className="merge-list">
                <div className="merge-list-hd">
                  <span>{files.length} file{files.length !== 1 ? 's' : ''} · drag to reorder</span>
                </div>
                {files.map((f, i) => (
                  <div
                    key={f.name + f.size}
                    className={`merge-item${draggingIdx === i ? ' dragging' : ''}`}
                    draggable
                    onDragStart={e => onDragStart(e, i)}
                    onDragOver={e => onDragOver(e, i)}
                    onDragEnd={onDragEnd}
                  >
                    <GripVertical size={14} className="drag-handle" />
                    <span className="merge-num">{i + 1}</span>
                    <FileText size={16} className="merge-file-icon" />
                    <span className="merge-name" title={f.name}>{f.name}</span>
                    <span className="merge-sz">{fmtBytes(f.size)}</span>
                    <button className="btn-remove" onClick={() => remove(i)} aria-label="Remove">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {status === 'error' && (
              <div className="err-banner">
                <AlertCircle size={15} />
                <span>{errMsg}</span>
                <button className="err-retry" onClick={merge}>Retry</button>
              </div>
            )}

            {files.length >= 2 && (
              <button className="btn-process" style={{ background: tool.color }} onClick={merge}>
                Merge {files.length} PDFs
              </button>
            )}

            {files.length === 1 && (
              <p className="merge-hint">Add at least one more PDF to merge</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
