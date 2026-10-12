import React from "react";
import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";

interface SherivsSymbolProps {
  size?: number | string;
  className?: string;
  luminous?: boolean;
}

export function SherivsSymbol({
  size = 28,
  className = "",
  luminous = true,
}: SherivsSymbolProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform duration-300 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sherivs-prism-a" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="50%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id="sherivs-prism-b" x1="16" y1="4" x2="16" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.2" />
        </linearGradient>
        {luminous && (
          <filter id="sherivs-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        )}
      </defs>

      {/* Hexagonal Outer Facet */}
      <path
        d="M16 2.5L28 9.5V22.5L16 29.5L4 22.5V9.5L16 2.5Z"
        stroke="url(#sherivs-prism-a)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="rgba(12, 16, 25, 0.7)"
        filter={luminous ? "url(#sherivs-glow)" : undefined}
      />

      {/* Isometric Internal Lattice / Sovereign Core */}
      <path
        d="M16 2.5V16M16 16L28 9.5M16 16L4 9.5M16 16V29.5M16 16L28 22.5M16 16L4 22.5"
        stroke="rgba(255, 255, 255, 0.25)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />

      {/* Central Intelligence Node */}
      <circle cx="16" cy="16" r="3.25" fill="#00f0ff" className="drop-shadow-[0_0_8px_#00f0ff]" />
      <circle cx="16" cy="16" r="1.5" fill="#ffffff" />
    </svg>
  );
}

interface SherivsLogoProps {
  size?: "sm" | "md" | "lg" | "hero";
  showTagline?: boolean;
  className?: string;
  href?: string;
  lockupRuntime?: string | null;
}

export function SherivsLogo({
  size = "md",
  showTagline = false,
  className = "",
  href = "/",
  lockupRuntime = null,
}: SherivsLogoProps) {
  const pixelSizes = {
    sm: 22,
    md: 28,
    lg: 36,
    hero: 48,
  };

  const textSizes = {
    sm: "text-base tracking-tight",
    md: "text-lg tracking-tight",
    lg: "text-2xl tracking-tighter",
    hero: "text-3xl sm:text-4xl tracking-tighter",
  };

  const content = (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <SherivsSymbol size={pixelSizes[size]} luminous />
      <div className="flex flex-col leading-none">
        <div className="flex items-center gap-2">
          <span className={`font-display font-extrabold uppercase text-foreground ${textSizes[size]}`}>
            {PLATFORM_NAME}
          </span>
          {lockupRuntime && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <span className="text-border">/</span>
              <span className="text-foreground/90">{lockupRuntime}</span>
            </span>
          )}
        </div>
        {showTagline && (
          <span className="text-[10px] tracking-widest uppercase font-semibold text-muted-foreground mt-0.5">
            {PLATFORM_TAGLINE}
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-lg transition-opacity hover:opacity-95"
      >
        {content}
      </Link>
    );
  }

  return content;
}
