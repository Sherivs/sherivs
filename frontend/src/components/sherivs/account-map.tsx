import { ACCOUNT_SURFACES } from "@/lib/sherivs/account";

/** Names the account controls that exist, and the ones that do not. */
export function AccountMap() {
  return (
    <section className="sv-account-map" aria-labelledby="account-map-heading">
      <h2 id="account-map-heading">Account</h2>
      <ul>
        {ACCOUNT_SURFACES.map((surface) => (
          <li key={surface.id} data-status={surface.status}>
            <span>{surface.label}</span>
            <em>{surface.status === "available" ? "Available" : "Not offered"}</em>
            <p>{surface.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
