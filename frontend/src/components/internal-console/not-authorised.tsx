import { Link } from "@tanstack/react-router";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { CANONICAL_CONSOLE_HOST } from "@/lib/experience/experience-host";
import { useApp } from "@/contexts/app-context";
import { ConsoleAtmosphere } from "./console-primitives";
import "./console.css";

export function ConsoleNotAuthorised() {
  const app = useApp();
  return (
    <ConsoleAtmosphere>
      <section className="sherivs-console-card" data-testid="console-not-authorised">
        <SherivsLogo size={32} />
        <h1>Not authorised</h1>
        <p>
          This host is the Sherivs Internal Console. Access is limited to active Sherivs staff.
          Signing in with an organization account does not grant console access.
        </p>
        <div className="sherivs-console-actions" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="sherivs-console-btn secondary"
            onClick={() => void app.signOut()}
          >
            Sign out
          </button>
        </div>
      </section>
    </ConsoleAtmosphere>
  );
}

export function ConsoleElsewhere() {
  return (
    <ConsoleAtmosphere>
      <section className="sherivs-console-card" data-testid="console-elsewhere">
        <SherivsLogo size={32} />
        <h1>Internal Console lives on its own host</h1>
        <p>
          The Sherivs Internal Console is served at {CANONICAL_CONSOLE_HOST}. This application host
          is for organization workspaces.
        </p>
        <div className="sherivs-console-actions" style={{ marginTop: "1rem" }}>
          <Link to="/" className="sherivs-console-btn secondary">
            Back
          </Link>
          <a className="sherivs-console-btn" href={`https://${CANONICAL_CONSOLE_HOST}/console`}>
            Open console host
          </a>
        </div>
      </section>
    </ConsoleAtmosphere>
  );
}
