import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TOOLS, CATEGORIES } from '../tools.js';
import ToolIcon from '../components/ToolIcon.jsx';

function ToolCard({ tool }) {
  return (
    <Link to={tool.route} className="tool-card">
      <div className="tool-card-icon" style={{ background: tool.bg, color: tool.color }}>
        <ToolIcon type={tool.icon} size={26} />
      </div>
      <div className="tool-card-body">
        <h3 className="tool-card-name">{tool.name}</h3>
        <p className="tool-card-desc">{tool.desc}</p>
      </div>
      <svg className="tool-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </Link>
  );
}

function CategorySection({ label, tools }) {
  if (!tools.length) return null;
  return (
    <section className="category-section">
      <h2 className="category-title">{label}</h2>
      <div className="tools-grid">
        {tools.map(t => <ToolCard key={t.id} tool={t} />)}
      </div>
    </section>
  );
}

export default function Home() {
  const [active, setActive] = useState('all');

  const filtered = active === 'all'
    ? TOOLS
    : TOOLS.filter(t => t.category === active);

  const grouped = active === 'all'
    ? CATEGORIES.filter(c => c.id !== 'all').map(c => ({
        ...c,
        tools: TOOLS.filter(t => t.category === c.id),
      }))
    : [{ id: active, label: CATEGORIES.find(c => c.id === active)?.label || '', tools: filtered }];

  return (
    <div className="home">
      {/* Hero */}
      <div className="hero">
        <h1 className="hero-title">Every PDF tool you need</h1>
        <p className="hero-sub">Merge, split, compress, convert and more — all locally processed, nothing leaves your machine</p>
      </div>

      {/* Category tabs */}
      <div className="cat-tabs">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            className={`cat-tab${active === c.id ? ' active' : ''}`}
            onClick={() => setActive(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Tool sections */}
      <div className="home-content">
        {grouped.map(g => (
          <CategorySection key={g.id} label={g.label} tools={g.tools} />
        ))}
      </div>
    </div>
  );
}
