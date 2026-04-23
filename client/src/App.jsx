import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header.jsx';
import Home from './pages/Home.jsx';
import ToolPage from './pages/ToolPage.jsx';
import MergePage from './pages/MergePage.jsx';
import EditPage from './pages/EditPage.jsx';
import { TOOLS } from './tools.js';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/merge" element={<MergePage />} />
            <Route path="/edit-pdf" element={<EditPage />} />
            {TOOLS.filter(t => !t.multi && !t.editor).map(tool => (
              <Route
                key={tool.id}
                path={tool.route}
                element={<ToolPage tool={tool} />}
              />
            ))}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
