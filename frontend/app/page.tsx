"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import SettingsMenu from "@/components/SettingsMenu";
import { API } from "@/lib/api";
import { flushCheckpoint } from "@/lib/duckdb";

export default function LandingPage() {
  const { theme, toggle: toggleTheme } = useTheme();

  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [plan, setPlan] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
      if (session) {
        setUserEmail(session.user?.email ?? "");
        fetch(`${API}/account`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) setPlan(data.plan);
          })
          .catch(() => {});
      }
    });
  }, []);

  // Parallax for hero screenshot
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const screenshotY = useTransform(scrollYProgress, [0, 1], [0, 80]);

  async function handleLogout() {
    await flushCheckpoint();
    await supabase.auth.signOut();
    setIsLoggedIn(false);
    setUserEmail("");
    setPlan(null);
  }

  // Restore body scrolling (globally hidden to prevent KaTeX overflow on other pages).
  // Must also override height:100% so the *window* scrolls, not body internally.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = "auto";
    html.style.height = "auto";
    body.style.overflow = "auto";
    body.style.height = "auto";

    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      html.style.overflow = "";
      html.style.height = "";
      body.style.overflow = "";
      body.style.height = "";
    };
  }, []);

  const ctaHref = isLoggedIn ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen bg-surface">
      {/* ─── Nav ─── */}
      <nav
        className={`fixed top-0 inset-x-0 z-50 px-5 py-4 transition-all duration-300 ${
          scrolled
            ? "bg-surface/90 backdrop-blur-md border-b border-border/60 shadow-sm"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-10">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="text-4xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight">
                <span className="text-accent font-bold">R</span><span className="text-text">·Base</span>
              </span>
            </Link>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] font-medium tracking-widest text-accent border border-accent/40 rounded px-1.5 py-0.5 leading-none">
              BETA
            </span>
            <div className="hidden sm:flex items-center gap-5 border-l border-border pl-6">
              <button className="text-sm text-text-secondary hover:text-text transition-colors">
                Watch Demo
              </button>
              <a href="#pricing" className="text-sm text-text-secondary hover:text-text transition-colors">
                Pricing
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>
            {isLoggedIn === null ? (
              <div className="flex items-center gap-3">
                <div className="h-[22px] w-11 rounded-full bg-surface-hover animate-pulse" />
                <div className="h-[26px] w-20 rounded-lg bg-surface-hover animate-pulse" />
              </div>
            ) : isLoggedIn ? (
              <>
                <Link
                  href="/plans"
                  className={`text-xs font-medium rounded-full px-2.5 py-1 border inline-flex items-center transition-colors ${
                    plan === "pro"
                      ? "pro-badge"
                      : plan === "beta"
                        ? "beta-badge"
                        : "border-border bg-surface-alt text-text-secondary hover:border-accent-border"
                  }`}
                >
                  {plan !== null ? (
                    plan === "pro" ? "Pro" : plan === "beta" ? "Beta" : "Free"
                  ) : (
                    <span className="inline-block h-3 w-7 rounded bg-surface-hover animate-pulse" />
                  )}
                </Link>
                {plan === "beta" && (
                  <Link
                    href="/feedback"
                    className="text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg shadow-sm shadow-accent/20"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                    Give Feedback
                  </Link>
                )}
                <Link
                  href="/dashboard"
                  className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
                >
                  Dashboard
                </Link>
                <SettingsMenu email={userEmail} onLogout={handleLogout} plan={plan ?? undefined} />
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login" className="text-xs text-text-secondary hover:text-text transition-colors">
                  Sign in
                </Link>
                <Link
                  href="/login"
                  className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
                >
                  Get started
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>
      {/* ─── Hero ─── */}
      <section ref={heroRef} className="relative pt-32 pb-0 overflow-hidden">
        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative text-center font-[family-name:var(--font-clash)] text-6xl sm:text-7xl lg:text-8xl tracking-tight text-text leading-[1.08] px-6"
          style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
        >
          Your Data, One Conversation Away
        </motion.h1>

        {/* ── Product screenshot / demo placeholder ── */}
        <motion.div
          style={{ y: screenshotY }}
          className="relative mt-14 mx-auto max-w-[96rem] px-6"
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
            className="relative"
            style={{ perspective: "1200px" }}
          >
            <div
              className="rounded-2xl border border-border bg-surface shadow-2xl shadow-text/10 overflow-hidden"
              style={{ transform: "rotateX(2deg) rotateY(-1deg)" }}
            >
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 bg-surface-alt border-b border-border">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 ml-3">
                  <div className="max-w-md mx-auto bg-surface rounded-md border border-border px-3 py-1 text-xs text-text-muted text-center">
                    tryrbase.com/sessions/btc-analysis
                  </div>
                </div>
              </div>

              {/* Product screenshot */}
              <Image
                src="/hero-screenshot.png"
                alt="R·Base session workspace"
                width={1920}
                height={933}
                className="w-full h-auto"
                priority
                unoptimized
              />
            </div>
          </motion.div>
        </motion.div>

        {/* Caption + CTAs below screenshot */}
        <div className="relative max-w-4xl mx-auto px-6 text-center mt-28">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="text-2xl sm:text-3xl text-text leading-snug max-w-3xl mx-auto"
          >
            <span className="font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] text-3xl sm:text-4xl"><span className="text-accent font-bold">R</span>·Base</span>
            <span className="mx-3 text-text-muted">—</span>
            The IDE for <span className="underline decoration-purple-400/50 decoration-2 underline-offset-6">AI-Powered</span> Data Science
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              href={ctaHref}
              className="relative bg-accent text-white font-semibold text-base px-10 py-4 rounded-xl hover:bg-accent-hover transition-all shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 hover:scale-[1.02] active:scale-[0.98]"
            >
              <span className="absolute inset-0 rounded-xl bg-white/10 animate-pulse pointer-events-none" />
              Get Started for Free!
            </Link>
            <button
              className="font-medium text-base text-text-secondary hover:text-text px-8 py-4 rounded-xl border border-border hover:border-accent-border hover:bg-accent-light/50 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Watch Demo
            </button>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="mt-5 text-sm text-text-muted"
          >
            No credit card required &middot; Free forever
          </motion.p>
        </div>

        {/* Spacer below hero */}
        <div className="h-20 sm:h-24" />
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="relative bg-surface-alt">
        <div className="max-w-7xl mx-auto px-6 py-28 sm:py-36">
          <SectionHeader
            eyebrow="Pricing"
            title="Simple, Transparent Pricing"
            description="Start free, upgrade when you need more power."
            center
          />
          <div className="mt-20 max-w-3xl mx-auto grid md:grid-cols-2 gap-6">
            {/* Free */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5 }}
              className="rounded-2xl border border-border bg-surface p-8 relative overflow-hidden"
            >
              <div className="text-center pt-2">
                <p className="text-sm font-medium text-text-secondary">Free</p>
                <p className="mt-3 text-5xl font-bold text-text tracking-tight">$0</p>
                <p className="mt-2 text-base text-text-muted">forever</p>
              </div>
              <div className="mt-8 space-y-4">
                <CheckItem text="50 message credits per week" />
                <CheckItem text="5 datasets" />
                <CheckItem text="100K rows per dataset" />
                <CheckItem text="50 MB storage" />
                <CheckItem text="No credit card required" />
              </div>
              <Link
                href={ctaHref}
                className="mt-8 w-full py-3.5 rounded-xl font-medium border border-border text-text-secondary hover:bg-surface-alt transition-colors block text-center text-base"
              >
                {isLoggedIn ? "Go to dashboard" : "Get started free"}
              </Link>
            </motion.div>

            {/* Pro */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="rounded-2xl border border-accent-border bg-surface shadow-xl shadow-indigo-500/5 p-8 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-400 to-indigo-500" />
              {/* Recommended badge */}
              <div className="absolute top-4 right-4">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white bg-accent rounded-full px-2.5 py-1">
                  Popular
                </span>
              </div>
              <div className="text-center pt-2">
                <p className="text-sm font-medium text-accent">Pro</p>
                <p className="mt-3 text-5xl font-bold text-text tracking-tight">$9</p>
                <p className="mt-2 text-base text-text-muted">per month</p>
              </div>
              <div className="mt-8 space-y-4">
                <CheckItem text="500 message credits per week" />
                <CheckItem text="Unlimited datasets" />
                <CheckItem text="500K rows per dataset" />
                <CheckItem text="1 GB storage" />
                <CheckItem text={<><strong>LLM transforms</strong></>} />
              </div>
              <div className="mt-8 w-full py-3.5 rounded-xl font-medium border border-border text-text-muted text-center text-base">
                Coming soon
              </div>
            </motion.div>
          </div>

          {/* Comparison strip */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-8 max-w-3xl mx-auto text-center text-sm text-text-muted"
          >
            Free: 50 msgs/week, 5 datasets &nbsp;&middot;&nbsp; Pro: 500 msgs/week, unlimited datasets, LLM transforms
          </motion.div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="relative overflow-hidden bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-28 sm:py-36 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-4xl sm:text-5xl font-bold text-text tracking-tight">
              Start Transforming Your Data
            </h2>
            <p className="mt-5 text-lg text-text-secondary max-w-lg mx-auto leading-relaxed">
              Free to start. No credit card required.
            </p>
            <Link
              href={ctaHref}
              className="mt-10 inline-block bg-accent text-white font-medium px-10 py-4 rounded-xl hover:bg-accent-hover transition-colors text-base shadow-lg shadow-indigo-500/20"
            >
              {isLoggedIn ? "Go to dashboard" : "Get started free"}
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border bg-surface-alt">
        <div className="max-w-7xl mx-auto px-6 pt-14 pb-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-10">
            {/* Brand column */}
            <div className="col-span-2 sm:col-span-1">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="text-2xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)]">
                  <span className="text-accent font-bold">R</span><span className="text-text">·Base</span>
                </span>
              </Link>
              <p className="mt-3 text-sm text-text-muted leading-relaxed max-w-[220px]">
                In-browser R IDE with an integrated AI agent. No setup required.
              </p>
            </div>

            {/* Product column */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-4">Product</h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href={ctaHref} className="text-text-secondary hover:text-text transition-colors">Dashboard</Link></li>
                <li><a href="#pricing" className="text-text-secondary hover:text-text transition-colors">Pricing</a></li>
                <li><button className="text-text-secondary hover:text-text transition-colors">Watch Demo</button></li>
              </ul>
            </div>

            {/* Stack column */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-4">Built With</h4>
              <ul className="space-y-2.5 text-sm text-text-secondary">
                <li>WebR</li>
                <li>DuckDB-WASM</li>
                <li>ggplot2</li>
                <li>Next.js</li>
              </ul>
            </div>

            {/* Legal column */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-4">Legal</h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/terms" className="text-text-secondary hover:text-text transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="text-text-secondary hover:text-text transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text-muted">
            <span>&copy; 2026 R·Base. All rights reserved.</span>
            <span>Data stays in your browser. Always.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}


/* ─── Components ─── */

function SectionHeader({
  eyebrow,
  title,
  description,
  center,
}: {
  eyebrow: string;
  title: string;
  description: string;
  center?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5 }}
      className={center ? "text-center" : ""}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-accent mb-4">{eyebrow}</p>
      <h2
        className="text-5xl sm:text-6xl lg:text-7xl font-[family-name:var(--font-clash)] text-text tracking-tight"
        style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
      >{title}</h2>
      <p className={`mt-6 text-lg sm:text-xl text-text-secondary leading-relaxed ${center ? "max-w-2xl mx-auto" : "max-w-2xl"}`}>
        {description}
      </p>
    </motion.div>
  );
}

function CheckItem({ text }: { text: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <span className="text-text">{text}</span>
    </div>
  );
}
