import { Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";

function splitHref(href: string): { to: string; hash?: string; external?: boolean } {
  if (href.startsWith("mailto:") || href.startsWith("http://") || href.startsWith("https://")) {
    return { to: href, external: true };
  }
  const hashIndex = href.indexOf("#");
  if (hashIndex === 0) return { to: "/", hash: href.slice(1) };
  if (hashIndex > 0) {
    return { to: href.slice(0, hashIndex) || "/", hash: href.slice(hashIndex + 1) };
  }
  return { to: href };
}

export function PublicLink({
  href,
  className,
  children,
  onNavigate,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onNavigate?: () => void;
}) {
  const parsed = splitHref(href);
  const handleClick = (_event: MouseEvent<HTMLAnchorElement>) => {
    onNavigate?.();
  };

  if (parsed.external) {
    return (
      <a href={parsed.to} className={className} onClick={handleClick}>
        {children}
      </a>
    );
  }

  return (
    <Link to={parsed.to as never} hash={parsed.hash} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
