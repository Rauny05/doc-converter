import { Link, useLocation } from 'react-router-dom';
import { Shield } from 'lucide-react';

export default function Header() {
  const { pathname } = useLocation();
  const isHome = pathname === '/';

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="logo">
          <span className="logo-text">PDF<em>tools</em></span>
        </Link>

        <div className="header-right">
          <div className="privacy-badge">
            <Shield size={13} />
            <span>100% local &amp; private</span>
          </div>
          {!isHome && (
            <Link to="/" className="header-all-tools">
              All Tools
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
