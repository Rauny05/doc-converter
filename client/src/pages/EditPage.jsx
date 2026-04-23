import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const RENDER_SCALE = 1.5;
const FONTS = ['Helvetica', 'Times', 'Courier'];
const FONT_CSS = { Helvetica: 'system-ui, sans-serif', Times: 'Georgia, serif', Courier: '"Courier New", monospace' };

let idCounter = 0;
const uid = () => `id-${++idCounter}-${Date.now()}`;

export default function EditPage() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [textBoxes, setTextBoxes] = useState([]);
  const [whiteBoxes, setWhiteBoxes] = useState([]);
  const [activeTool, setActiveTool] = useState('text');
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [drawState, setDrawState] = useState(null);
  const [dropHover, setDropHover] = useState(false);
  const [loadStatus, setLoadStatus] = useState('idle');
  const [saveStatus, setSaveStatus] = useState('idle');
  const fileInputRef = useRef(null);

  // Font toolbar state
  const [fontFamily, setFontFamily] = useState('Helvetica');
  const [fontSize, setFontSize] = useState(14);
  const [fontColor, setFontColor] = useState('#000000');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);

  async function loadPdf(f) {
    setFile(f);
    setLoadStatus('loading');
    setPages([]);
    setTextBoxes([]);
    setWhiteBoxes([]);
    setSelectedId(null);
    setEditingId(null);

    try {
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const rendered = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: RENDER_SCALE });
        const vpPdf = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        rendered.push({ dataUrl: canvas.toDataURL(), cssW: vp.width, cssH: vp.height, pdfW: vpPdf.width, pdfH: vpPdf.height });
      }
      setPages(rendered);
      setLoadStatus('idle');
    } catch (e) {
      setLoadStatus('error');
    }
  }

  function handleFilePick(e) {
    const f = e.target.files?.[0];
    if (f) loadPdf(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDropHover(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === 'application/pdf') loadPdf(f);
  }

  // Click on a page background
  function handlePageMouseDown(e, pageIndex) {
    if (e.target.closest('[data-annotation]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === 'text') {
      const id = uid();
      setTextBoxes(prev => [...prev, { id, pageIndex, x, y, text: '', font: fontFamily, size: fontSize, color: fontColor, bold, italic }]);
      setEditingId(id);
      setSelectedId(id);
    } else if (activeTool === 'whiteout') {
      setDrawState({ pageIndex, startX: x, startY: y, x, y, w: 0, h: 0 });
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else {
      setSelectedId(null);
      setEditingId(null);
    }
  }

  function handlePageMouseMove(e, pageIndex) {
    if (!drawState || drawState.pageIndex !== pageIndex) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const rawW = cx - drawState.startX;
    const rawH = cy - drawState.startY;
    setDrawState(prev => ({
      ...prev,
      x: rawW < 0 ? cx : prev.startX,
      y: rawH < 0 ? cy : prev.startY,
      w: Math.abs(rawW),
      h: Math.abs(rawH),
    }));
  }

  function handlePageMouseUp(e, pageIndex) {
    if (drawState && drawState.pageIndex === pageIndex && drawState.w > 8 && drawState.h > 8) {
      const id = uid();
      setWhiteBoxes(prev => [...prev, { id, pageIndex: drawState.pageIndex, x: drawState.x, y: drawState.y, w: drawState.w, h: drawState.h }]);
      setSelectedId(id);
    }
    setDrawState(null);
  }

  // Drag text box or white box
  function startDrag(e, id, type) {
    e.stopPropagation();
    const item = type === 'text' ? textBoxes.find(b => b.id === id) : whiteBoxes.find(b => b.id === id);
    if (!item) return;
    setDragState({ id, type, startX: e.clientX - item.x, startY: e.clientY - item.y });
    setSelectedId(id);
    if (type === 'text') setEditingId(null);
  }

  useEffect(() => {
    if (!dragState) return;
    function onMove(e) {
      const x = Math.max(0, e.clientX - dragState.startX);
      const y = Math.max(0, e.clientY - dragState.startY);
      if (dragState.type === 'text') {
        setTextBoxes(prev => prev.map(b => b.id === dragState.id ? { ...b, x, y } : b));
      } else {
        setWhiteBoxes(prev => prev.map(b => b.id === dragState.id ? { ...b, x, y } : b));
      }
    }
    function onUp() { setDragState(null); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragState]);

  // Sync toolbar → selected text box
  useEffect(() => {
    if (!selectedId) return;
    setTextBoxes(prev => prev.map(b => b.id === selectedId ? { ...b, font: fontFamily, size: fontSize, color: fontColor, bold, italic } : b));
  }, [fontFamily, fontSize, fontColor, bold, italic]);

  function selectAnnotation(e, id, type) {
    e.stopPropagation();
    setSelectedId(id);
    if (type === 'text') {
      const box = textBoxes.find(b => b.id === id);
      if (box) {
        setFontFamily(box.font);
        setFontSize(box.size);
        setFontColor(box.color);
        setBold(box.bold);
        setItalic(box.italic);
      }
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    setTextBoxes(prev => prev.filter(b => b.id !== selectedId));
    setWhiteBoxes(prev => prev.filter(b => b.id !== selectedId));
    setSelectedId(null);
    setEditingId(null);
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && editingId !== selectedId) {
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === 'Escape') { setEditingId(null); setSelectedId(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, editingId]);

  async function savePdf() {
    if (!file || !pages.length) return;
    setSaveStatus('saving');
    try {
      const ops = [
        ...textBoxes.filter(b => b.text.trim()).map(b => {
          const p = pages[b.pageIndex];
          return { type: 'text', page: b.pageIndex, x: b.x / RENDER_SCALE, y: p.pdfH - (b.y / RENDER_SCALE) - b.size * 1.1, text: b.text, font: b.font, size: b.size, color: b.color, bold: b.bold, italic: b.italic };
        }),
        ...whiteBoxes.map(b => {
          const p = pages[b.pageIndex];
          return { type: 'rect', page: b.pageIndex, x: b.x / RENDER_SCALE, y: p.pdfH - ((b.y + b.h) / RENDER_SCALE), w: b.w / RENDER_SCALE, h: b.h / RENDER_SCALE };
        }),
      ];
      const fd = new FormData();
      fd.append('file', file);
      fd.append('ops', JSON.stringify(ops));
      const res = await fetch('/api/edit-pdf', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Server error');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, '_edited.pdf');
      a.click();
      URL.revokeObjectURL(url);
      setSaveStatus('done');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  const hasContent = textBoxes.some(b => b.text.trim()) || whiteBoxes.length > 0;
  const selectedIsText = selectedId && textBoxes.some(b => b.id === selectedId);

  if (!pages.length) {
    return (
      <div className="tool-shell">
        <div className="tool-header">
          <div className="tool-header-icon" style={{ background: '#ECFEFF', color: '#0891B2' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <div>
            <h1 className="tool-title">Edit PDF</h1>
            <p className="tool-subtitle">Add text, annotations, and white-out content on any page</p>
          </div>
        </div>

        <div
          className={`dropzone${dropHover ? ' hover' : ''}`}
          onDragOver={e => { e.preventDefault(); setDropHover(true); }}
          onDragLeave={() => setDropHover(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFilePick} />
          {loadStatus === 'loading' ? (
            <div className="dz-content">
              <div className="spinner" />
              <p className="dz-label">Rendering PDF pages…</p>
            </div>
          ) : (
            <div className="dz-content">
              <div className="dz-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p className="dz-label">Drop your PDF here or <span style={{ color: 'var(--primary)' }}>browse</span></p>
              <p className="dz-hint">PDF files only</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      {/* Toolbar */}
      <div className="editor-toolbar">
        <div className="editor-tools">
          <button className={`ed-tool${activeTool === 'select' ? ' active' : ''}`} onClick={() => setActiveTool('select')} title="Select / Move">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l14 9-7 1-4 7z"/></svg>
            Select
          </button>
          <button className={`ed-tool${activeTool === 'text' ? ' active' : ''}`} onClick={() => setActiveTool('text')} title="Add Text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            Add Text
          </button>
          <button className={`ed-tool${activeTool === 'whiteout' ? ' active' : ''}`} onClick={() => setActiveTool('whiteout')} title="White-Out (drag to draw)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            White-Out
          </button>
        </div>

        <div className="editor-font-bar">
          <select className="ed-select" value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
            {FONTS.map(f => <option key={f}>{f}</option>)}
          </select>
          <input className="ed-num" type="number" value={fontSize} min={6} max={96} onChange={e => setFontSize(Math.max(6, +e.target.value))} />
          <input className="ed-color" type="color" value={fontColor} onChange={e => setFontColor(e.target.value)} title="Text color" />
          <button className={`ed-fmt${bold ? ' active' : ''}`} onClick={() => setBold(v => !v)} title="Bold"><b>B</b></button>
          <button className={`ed-fmt${italic ? ' active' : ''}`} onClick={() => setItalic(v => !v)} title="Italic"><i>I</i></button>
        </div>

        <div className="editor-actions">
          {selectedId && (
            <button className="ed-delete" onClick={deleteSelected} title="Delete (Del)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              Delete
            </button>
          )}
          <button className="ed-change" onClick={() => { setFile(null); setPages([]); }} title="Load a different PDF">
            Change PDF
          </button>
          <button
            className={`btn-primary${saveStatus === 'done' ? ' success' : ''}`}
            onClick={savePdf}
            disabled={saveStatus === 'saving' || !hasContent}
            style={{ opacity: !hasContent ? 0.5 : 1 }}
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'done' ? '✓ Downloaded' : 'Download Edited PDF'}
          </button>
        </div>
      </div>

      {/* Hint bar */}
      <div className="editor-hint">
        {activeTool === 'text' && <span>Click anywhere on a page to place a text box · Double-click to type · Drag to reposition</span>}
        {activeTool === 'whiteout' && <span>Click and drag on the page to draw a white rectangle that covers existing content</span>}
        {activeTool === 'select' && <span>Click an annotation to select it · Drag to move · Press Delete to remove</span>}
        <span className="hint-file">{file?.name} · {pages.length} page{pages.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Pages */}
      <div className="editor-canvas-area" onMouseUp={() => setDrawState(null)}>
        {pages.map((page, pageIndex) => (
          <div key={pageIndex} className="editor-page-wrap">
            <div className="editor-page-label">Page {pageIndex + 1}</div>
            <div
              className="editor-page"
              style={{ width: page.cssW, height: page.cssH, cursor: activeTool === 'text' ? 'text' : activeTool === 'whiteout' ? 'crosshair' : 'default' }}
              onMouseDown={e => handlePageMouseDown(e, pageIndex)}
              onMouseMove={e => handlePageMouseMove(e, pageIndex)}
              onMouseUp={e => handlePageMouseUp(e, pageIndex)}
            >
              <img src={page.dataUrl} width={page.cssW} height={page.cssH} draggable={false} style={{ display: 'block', userSelect: 'none' }} />

              {/* White-out boxes */}
              {whiteBoxes.filter(b => b.pageIndex === pageIndex).map(b => (
                <div
                  key={b.id}
                  data-annotation="true"
                  className={`ann-whiteout${selectedId === b.id ? ' selected' : ''}`}
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                  onMouseDown={e => startDrag(e, b.id, 'white')}
                  onClick={e => selectAnnotation(e, b.id, 'white')}
                />
              ))}

              {/* Live draw preview */}
              {drawState?.pageIndex === pageIndex && drawState.w > 2 && (
                <div className="ann-draw-preview" style={{ left: drawState.x, top: drawState.y, width: drawState.w, height: drawState.h }} />
              )}

              {/* Text boxes */}
              {textBoxes.filter(b => b.pageIndex === pageIndex).map(b => {
                const isEditing = editingId === b.id;
                const isSelected = selectedId === b.id;
                return (
                  <div
                    key={b.id}
                    data-annotation="true"
                    className={`ann-text${isSelected ? ' selected' : ''}`}
                    style={{
                      left: b.x, top: b.y,
                      fontFamily: FONT_CSS[b.font] || 'sans-serif',
                      fontSize: b.size,
                      color: b.color,
                      fontWeight: b.bold ? 'bold' : 'normal',
                      fontStyle: b.italic ? 'italic' : 'normal',
                      cursor: isEditing ? 'text' : 'move',
                    }}
                    onMouseDown={e => !isEditing && startDrag(e, b.id, 'text')}
                    onClick={e => selectAnnotation(e, b.id, 'text')}
                    onDoubleClick={e => { e.stopPropagation(); setEditingId(b.id); setSelectedId(b.id); }}
                  >
                    {isEditing ? (
                      <textarea
                        autoFocus
                        value={b.text}
                        placeholder="Type here…"
                        onChange={e => setTextBoxes(prev => prev.map(tb => tb.id === b.id ? { ...tb, text: e.target.value } : tb))}
                        onBlur={() => setEditingId(null)}
                        onKeyDown={e => { if (e.key === 'Escape') setEditingId(null); e.stopPropagation(); }}
                        onMouseDown={e => e.stopPropagation()}
                        className="ann-textarea"
                        style={{ fontFamily: FONT_CSS[b.font], fontSize: b.size, color: b.color, fontWeight: b.bold ? 'bold' : 'normal', fontStyle: b.italic ? 'italic' : 'normal' }}
                      />
                    ) : (
                      <span className="ann-text-content">{b.text || (isSelected ? 'Double-click to type' : '')}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
