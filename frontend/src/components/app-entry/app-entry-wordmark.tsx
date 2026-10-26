/**
 * Owner-supplied splash wordmark (lowercase geometric “sherivs”).
 * Raster keeps the exact letterforms from the supplied lockup.
 */
export function AppEntryWordmark() {
  return (
    <h1 className="app-entry-wordmark">
      <img
        src="/brand/sherivs-app-wordmark.png"
        alt="Sherivs"
        decoding="async"
        draggable={false}
      />
    </h1>
  );
}
