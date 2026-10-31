import { Link } from "@tanstack/react-router";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import {
  ACCOUNT_INVITATION_COPY,
  ORGANIZATION_ACCESS_DENIED,
} from "@/lib/auth/organization-access";

type Props = {
  onSignOut: () => Promise<void> | void;
};

export function OrganizationAccessDenied({ onSignOut }: Props) {
  return (
    <div className="auth-shell app-entry app-entry-login" data-testid="organization-access-denied">
      <div className="auth-card uos-card app-entry-login-card">
        <SherivsLogo size={32} wordmarkClassName="text-lg" />
        <h1 className="app-entry-login-title">Access denied</h1>
        <p className="app-entry-login-invite">{ORGANIZATION_ACCESS_DENIED}</p>
        <p className="app-entry-login-invite">{ACCOUNT_INVITATION_COPY}</p>
        <button type="button" className="app-entry-login-google" onClick={() => void onSignOut()}>
          Sign out
        </button>
        <Link
          to="/"
          className="block mt-4 text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Back to site
        </Link>
      </div>
    </div>
  );
}
