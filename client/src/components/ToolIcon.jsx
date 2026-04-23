export default function ToolIcon({ type, size = 26 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' };

  switch (type) {
    case 'merge':
      return <svg {...p}><rect x="2" y="2" width="9" height="12" rx="1.5"/><rect x="13" y="2" width="9" height="12" rx="1.5"/><path d="M6.5 14v2M17.5 14v2M6.5 16l5.5 4 5.5-4"/></svg>;
    case 'split':
      return <svg {...p}><rect x="3" y="2" width="18" height="14" rx="1.5"/><path d="M12 16v4M8 20h8"/><line x1="12" y1="8" x2="12" y2="14" strokeDasharray="2 1.5"/></svg>;
    case 'compress':
      return <svg {...p}><polyline points="4 14 2 14 2 20 8 20 8 18"/><polyline points="20 10 22 10 22 4 16 4 16 6"/><line x1="2" y1="20" x2="9" y2="13"/><line x1="22" y1="4" x2="15" y2="11"/></svg>;
    case 'rotate':
      return <svg {...p}><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
    case 'watermark':
      return <svg {...p}><rect x="3" y="2" width="18" height="20" rx="2"/><line x1="7" y1="16" x2="17" y2="8" strokeDasharray="3 1.5"/><line x1="7" y1="12" x2="13" y2="8" strokeDasharray="2 1.5" strokeWidth="1.2"/></svg>;
    case 'pagenum':
      return <svg {...p}><rect x="3" y="2" width="18" height="20" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/><circle cx="17" cy="17" r="3" fill="currentColor" stroke="none" opacity=".9"/><text x="17" y="19.5" textAnchor="middle" fontSize="4" stroke="none" fill="white" fontWeight="bold">1</text></svg>;
    case 'word':
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13l1.5 4 1.5-3 1.5 3L15 13"/></svg>;
    case 'excel':
      return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="3" x2="12" y2="21"/></svg>;
    case 'ppt':
      return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><polygon points="10 8 10 13 15 10.5" fill="currentColor" stroke="none" opacity=".8"/></svg>;
    case 'image':
      return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
    case 'html':
      return <svg {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
    case 'pdf-word':
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 14l1 3.5 1.5-2.5 1.5 2.5 1-3.5"/></svg>;
    case 'pdf-img':
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="9" cy="14" r="1.5"/><polyline points="7 20 10 16 13 18.5 16 14 20 20"/></svg>;
    case 'pdf-txt':
      return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="13" y2="17"/></svg>;
    case 'edit':
      return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>;
  }
}
