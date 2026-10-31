import { useEffect, useState } from "react";
import { Fingerprint, ScanFace } from "lucide-react";
import { ShellGlassIcon } from "@/components/app-shell/glass-icon";
import { Switch } from "@/components/ui/switch";
import {
  PASSKEY_DEVICE_HELP,
  deletePasskey,
  loadPasskeyOnboardingState,
  loadPasskeys,
  platformPasskeyAvailable,
  registerPasskey,
  savePasskeyFirstPreference,
  savePasskeyLabel,
  type PasskeyListItem,
} from "@/lib/auth/webauthn-client";
import { WEBAUTHN_PUBLIC_ERROR } from "@/lib/auth/webauthn-policy";

type Variant = "app-shell" | "console";

function formatWhen(iso: string | null): string {
  if (!iso) return "Not used yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function PasskeyManager({ variant }: { variant: Variant }) {
  const [items, setItems] = useState<PasskeyListItem[] | null>(null);
  const [platformReady, setPlatformReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"register" | string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [passkeyFirst, setPasskeyFirst] = useState(true);

  async function refresh() {
    setItems(await loadPasskeys());
    try {
      const state = await loadPasskeyOnboardingState();
      setPasskeyFirst(state.passkeyFirst);
    } catch {
      /* preference table may be unapplied */
    }
  }

  useEffect(() => {
    void platformPasskeyAvailable().then(setPlatformReady);
    void refresh().catch(() => setMessage(WEBAUTHN_PUBLIC_ERROR.unavailable));
  }, []);

  async function handleRegister() {
    setMessage(null);
    setBusy("register");
    try {
      const created = await registerPasskey();
      setItems((current) => [created, ...(current ?? []).filter((row) => row.id !== created.id)]);
      setMessage("Passkey saved. You can use it the next time you sign in.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : WEBAUTHN_PUBLIC_ERROR.register_failed);
    } finally {
      setBusy(null);
    }
  }

  async function handleRename(id: string) {
    setBusy(id);
    setMessage(null);
    try {
      const updated = await savePasskeyLabel(id, draft);
      setItems((current) => (current ?? []).map((row) => (row.id === id ? updated : row)));
      setEditingId(null);
      setMessage("Passkey name updated.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : WEBAUTHN_PUBLIC_ERROR.rename_failed);
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(id: string, label: string) {
    const confirmed =
      typeof window === "undefined"
        ? false
        : window.confirm(
            `Remove “${label}” from this account? You will need another sign-in method.`,
          );
    if (!confirmed) return;
    setBusy(id);
    setMessage(null);
    try {
      await deletePasskey(id);
      setItems((current) => (current ?? []).filter((row) => row.id !== id));
      setMessage("Passkey removed.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : WEBAUTHN_PUBLIC_ERROR.remove_failed);
    } finally {
      setBusy(null);
    }
  }

  const shell = variant === "app-shell";

  return (
    <div
      className={shell ? "app-shell-passkeys" : "sherivs-console-passkeys"}
      data-testid="passkey-manager"
    >
      {shell ? (
        <div className="app-shell-cards">
          <div className="app-shell-card">
            <ShellGlassIcon>
              <Fingerprint />
            </ShellGlassIcon>
            <div>
              <p>Passkeys</p>
              <small>
                {platformReady
                  ? "This device can create a passkey with the unlock method it already uses."
                  : platformReady === false
                    ? "This browser has no platform authenticator. A security key can still be used."
                    : "Checking this device…"}
              </small>
            </div>
          </div>
          <div className="app-shell-card">
            <ShellGlassIcon>
              <ScanFace />
            </ShellGlassIcon>
            <div>
              <p>How verification works</p>
              <small>{PASSKEY_DEVICE_HELP}</small>
            </div>
          </div>
        </div>
      ) : (
        <p className="sherivs-console-empty">{PASSKEY_DEVICE_HELP}</p>
      )}

      <label className={shell ? "app-shell-passkey-item" : "sherivs-console-row"}>
        <div>
          <strong>Offer passkey first</strong>
          <small>
            Changes the sign-in layout on this account. It does not prove a passkey exists.
          </small>
        </div>
        <Switch
          checked={passkeyFirst}
          disabled={busy !== null}
          onCheckedChange={(next) => {
            setPasskeyFirst(next);
            void savePasskeyFirstPreference(next).catch(() => {
              setPasskeyFirst(!next);
              setMessage(WEBAUTHN_PUBLIC_ERROR.preference_failed);
            });
          }}
          aria-label="Offer passkey first when signing in"
          data-testid="passkey-first-toggle"
        />
      </label>
      <button
        type="button"
        className={shell ? "app-shell-primary" : "sherivs-console-btn"}
        disabled={busy !== null}
        onClick={() => void handleRegister()}
        data-testid="passkey-register"
      >
        {busy === "register" ? "Waiting for this device…" : "Register a passkey"}
      </button>

      {items === null ? (
        <p className={shell ? "app-shell-empty" : "sherivs-console-empty"} role="status">
          Loading passkeys…
        </p>
      ) : items.length === 0 ? (
        <p className={shell ? "app-shell-empty" : "sherivs-console-empty"}>
          No passkeys on this account yet. Password and Google sign-in still work.
        </p>
      ) : (
        <ul className={shell ? "app-shell-passkey-list" : "sherivs-console-list"}>
          {items.map((item) => (
            <li
              key={item.id}
              className={shell ? "app-shell-passkey-item" : "sherivs-console-row"}
              data-testid="passkey-item"
            >
              {editingId === item.id ? (
                <form
                  className={shell ? "app-shell-form" : undefined}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleRename(item.id);
                  }}
                >
                  <label>
                    Passkey name
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={80}
                      autoComplete="off"
                      aria-label="Passkey name"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy === item.id}
                    className={shell ? undefined : "sherivs-console-btn"}
                  >
                    {busy === item.id ? "Saving…" : "Save name"}
                  </button>
                  <button
                    type="button"
                    className={shell ? "app-shell-secondary" : "sherivs-console-btn secondary"}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div>
                    <strong>{item.label}</strong>
                    <small>
                      Added {formatWhen(item.createdAt)} · {formatWhen(item.lastUsedAt)}
                      {item.backedUp ? " · Synced" : ""}
                    </small>
                  </div>
                  <div className={shell ? "app-shell-passkey-actions" : "sherivs-console-actions"}>
                    <button
                      type="button"
                      className={shell ? "app-shell-secondary" : "sherivs-console-btn secondary"}
                      disabled={busy !== null}
                      onClick={() => {
                        setEditingId(item.id);
                        setDraft(item.label);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className={shell ? "app-shell-secondary" : "sherivs-console-btn secondary"}
                      disabled={busy !== null}
                      onClick={() => void handleRemove(item.id, item.label)}
                      data-testid="passkey-remove"
                    >
                      {busy === item.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {message ? (
        <p
          className={shell ? "app-shell-empty" : "sherivs-console-empty"}
          role="status"
          data-testid="passkey-message"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
