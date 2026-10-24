/** Shared public helpers. The hard-coded school site prototype was replaced by the website engine (SHERIVS-100). */
export function Initial({
  name,
  size = 40,
  className = "",
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const ch = (name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <div
      className={"grid place-items-center rounded-full font-bold text-white shrink-0 " + className}
      style={{
        width: size,
        height: size,
        background: "var(--tenant-primary, #3b82f6)",
        fontSize: size * 0.4,
      }}
    >
      {ch}
    </div>
  );
}
