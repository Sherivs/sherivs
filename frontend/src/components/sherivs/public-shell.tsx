import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { FOOTER_NAV, PRIMARY_NAV, PROOF_ANCHORS } from "@/lib/sherivs/navigation";
import { SHERIVS_BRAND } from "@/lib/sherivs/brand";

/**
 * Public chrome shared by the Sherivs website and the capability proof page.
 * Landmarks, the account links, and the proof-page anchors live here so every
 * public route inherits one shell.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="sv-public">
      <header className="sv-header">
        <div className="sv-header-bar">
          <Link to="/" className="sv-wordmark">
            <SherivsMark />
            <span>{SHERIVS_BRAND.name}</span>
          </Link>

          <nav className="sv-nav-desktop" aria-label="Site">
            {PRIMARY_NAV.map((item) => (
              <a key={item.href} href={item.href} className="sv-nav-link">
                {item.label}
              </a>
            ))}
          </nav>

          <nav className="sv-account" aria-label="Account">
            <Link to="/auth" className="sv-link-quiet">
              Sign in
            </Link>
            <Link to="/auth" className="sv-link-solid">
              Create account
            </Link>
          </nav>

          <details className="sv-nav-disclosure">
            <summary>Menu</summary>
            <nav aria-label="Site mobile">
              {PRIMARY_NAV.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
              <Link to="/auth">Sign in</Link>
              <Link to="/auth">Create account</Link>
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content">{children}</main>

      <footer className="sv-footer">
        <div className="sv-footer-grid">
          <div>
            <p className="sv-wordmark sv-wordmark-static">
              <SherivsMark />
              <span>{SHERIVS_BRAND.name}</span>
            </p>
            <p className="sv-footer-lead">{SHERIVS_BRAND.tagline}</p>
            <p className="sv-footer-meta">{SHERIVS_BRAND.origin.replace("https://", "")}</p>
          </div>
          {FOOTER_NAV.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="sv-footer-label">{column.title}</p>
              <ul>
                {column.items.map((item) => (
                  <li key={item.href}>
                    <a href={item.href}>{item.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <nav className="sv-proof" aria-label="Capability proof">
          {PROOF_ANCHORS.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sv-footer-base">
          <p>
            © {new Date().getFullYear()} {SHERIVS_BRAND.name}
          </p>
          <p>No public social profile is listed because none is published.</p>
          <Link to="/status">Status</Link>
        </div>
      </footer>
    </div>
  );
}

function SherivsMark() {
  return (
    <svg className="sv-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1" />
      <path
        d="M7 16.5 V7.5 H12.2 C14.6 7.5 16.2 8.8 16.2 11 C16.2 13.2 14.6 14.5 12.2 14.5 H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M12 14.5 L16.5 16.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
