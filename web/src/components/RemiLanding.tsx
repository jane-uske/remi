"use client";

import Image from "next/image";

interface RemiLandingProps {
  onEnter: () => void;
}

export function RemiLanding({ onEnter }: RemiLandingProps) {
  return (
    <main className="remi-app-shell relative flex flex-col items-center justify-center overflow-hidden px-6">
      {/* breathing glow behind portrait */}
      <div
        aria-hidden
        className="remi-breath-glow pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: "min(420px, 80vw)",
          height: "min(420px, 80vw)",
          background:
            "radial-gradient(circle, rgba(45,212,191,0.18) 0%, rgba(45,212,191,0.04) 50%, transparent 70%)",
        }}
      />

      {/* content */}
      <div className="relative z-10 flex flex-col items-center text-center">
        {/* portrait */}
        <figure className="remi-portrait-figure remi-fade-in-up mb-6 md:mb-8">
          <Image
            src="/avatar/assets/remi-selected-portrait.png"
            alt="Remi"
            width={192}
            height={192}
            priority
            className="h-32 w-32 rounded-full object-cover shadow-lg ring-1 ring-white/10 md:h-48 md:w-48"
          />
        </figure>

        {/* headline */}
        <h1
          className="remi-fade-in-up mb-3 text-2xl font-light tracking-wide md:text-3xl"
          style={{
            color: "var(--foreground)",
            animationDelay: "0.15s",
          }}
        >
          睡不着的时候，来找她
        </h1>

        {/* sub */}
        <p
          className="remi-fade-in-up mb-10 text-sm md:text-base"
          style={{
            color: "var(--remi-dim)",
            animationDelay: "0.3s",
          }}
        >
          Remi 会记住你说的每一句话
        </p>

        {/* CTA */}
        <button
          onClick={onEnter}
          className="remi-fade-in-up remi-landing-cta cursor-pointer rounded-full px-8 py-3 text-base font-medium md:px-10 md:py-3.5 md:text-lg"
          style={{ animationDelay: "0.45s" }}
        >
          和 Remi 聊聊
        </button>
      </div>

      {/* footer */}
      <footer
        className="remi-fade-in-up absolute bottom-6 text-xs tracking-widest"
        style={{
          color: "var(--remi-dim)",
          animationDelay: "0.6s",
        }}
      >
        Remi · AI Companion
      </footer>
    </main>
  );
}
