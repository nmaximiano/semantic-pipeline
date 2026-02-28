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

  // Nav scroll effect
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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

  // Landing page needs body-level scrolling (globally disabled to prevent KaTeX overflow)
  useEffect(() => {
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
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
              <Image src="/logo.png" alt="Kwartz" width={32} height={32} />
              <span className="text-2xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight text-text">
                Kwartz
              </span>
            </Link>
            <div className="hidden sm:flex items-center gap-5 border-l border-border pl-6">
              <a href="#capabilities" className="text-sm text-text-secondary hover:text-text transition-colors">
                Capabilities
              </a>
              <a href="#use-cases" className="text-sm text-text-secondary hover:text-text transition-colors">
                Use cases
              </a>
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
                      : "border-border bg-surface-alt text-text-secondary hover:border-accent-border"
                  }`}
                >
                  {plan !== null ? (
                    plan === "pro" ? "Pro" : "Free"
                  ) : (
                    <span className="inline-block h-3 w-7 rounded bg-surface-hover animate-pulse" />
                  )}
                </Link>
                <Link
                  href="/dashboard"
                  className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
                >
                  Dashboard
                </Link>
                <SettingsMenu email={userEmail} onLogout={handleLogout} />
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
        {/* Faint radial glow behind hero */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.08)_0%,rgba(167,139,250,0.04)_40%,transparent_70%)] pointer-events-none" />

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
                    kwartz.ai/sessions/btc-analysis
                  </div>
                </div>
              </div>

              {/* Product screenshot */}
              <Image
                src="/hero-screenshot.png"
                alt="Kwartz session workspace"
                width={1920}
                height={933}
                className="w-full h-auto"
                priority
                unoptimized
              />
            </div>
          </motion.div>
          {/* Glow under screenshot */}
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-indigo-500/5 blur-3xl rounded-full pointer-events-none" />
        </motion.div>

        {/* Caption + CTAs below screenshot */}
        <div className="relative max-w-4xl mx-auto px-6 text-center mt-28">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="text-lg sm:text-xl text-text-secondary leading-relaxed max-w-2xl mx-auto"
          >
            Upload a dataset, open a session, and chat with an AI agent that
            analyzes, transforms, and enriches your data — no code required.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Link
              href={ctaHref}
              className="bg-accent text-white font-medium px-8 py-3.5 rounded-xl hover:bg-accent-hover transition-all shadow-lg shadow-indigo-500/20"
            >
              Get started free
            </Link>
            <a
              href="#capabilities"
              className="font-medium text-text-secondary hover:text-text px-6 py-3.5 rounded-xl border border-border hover:border-accent-border hover:bg-accent-light/50 transition-all"
            >
              See capabilities
            </a>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="mt-5 text-xs text-text-muted"
          >
            Free plan included &middot; No credit card required
          </motion.p>
        </div>

        {/* Spacer below hero */}
        <div className="h-20 sm:h-24" />
      </section>

      {/* ─── Capabilities — alternating full-width rows ─── */}
      <section id="capabilities" className="relative bg-surface">
        <div className="max-w-[90rem] mx-auto px-6 py-28 sm:py-36">
          <SectionHeader
            eyebrow="Capabilities"
            title="What the Agent Can Do"
            description="From AI-powered transforms to statistical analysis — describe what you need and watch it happen."
            center
          />

          <div className="mt-24 space-y-10">
            {/* Row 1 — AI Transforms */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6 }}
              className="grid lg:grid-cols-2 gap-0 rounded-3xl overflow-hidden border border-border bg-surface shadow-sm"
            >
              <div className="p-12 lg:p-20 flex flex-col justify-center">
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent mb-5">
                  <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  AI Transforms
                </div>
                <h3 className="text-3xl sm:text-4xl font-bold text-text tracking-tight">
                  Add Columns with AI
                </h3>
                <p className="mt-5 text-lg text-text-secondary leading-relaxed max-w-lg">
                  Classify sentiment, extract entities, translate languages, generate summaries — describe what you need in one sentence and the agent fills every row.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Sentiment</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Extraction</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Translation</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Summarization</span>
                </div>
              </div>
              <div className="bg-gradient-to-br from-accent/5 via-purple-500/5 to-surface p-10 lg:p-14 flex items-center border-l border-border">
                <div className="w-full rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-alt">
                        <th className="px-5 py-3 text-left font-semibold text-text-muted uppercase tracking-wider text-xs">review</th>
                        <th className="px-5 py-3 text-left font-semibold text-accent uppercase tracking-wider text-xs">
                          <span className="inline-flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                            sentiment
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Battery life is incredible and the screen is gorgeous", "Positive"],
                        ["Broke after two weeks, terrible build quality", "Negative"],
                        ["It works fine, nothing special about it though", "Neutral"],
                        ["Best purchase I've made this year, highly recommend", "Positive"],
                        ["Customer support was unhelpful and rude", "Negative"],
                      ].map(([review, sentiment], i) => (
                        <tr key={i} className="border-t border-surface-alt">
                          <td className="px-5 py-3 text-text-secondary truncate max-w-[300px]">{review}</td>
                          <td className="px-5 py-3">
                            <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                              sentiment === "Positive" ? "bg-emerald-500/10 text-emerald-500" :
                              sentiment === "Negative" ? "bg-red-500/10 text-red-500" :
                              "bg-amber-500/10 text-amber-500"
                            }`}>{sentiment}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>

            {/* Row 2 — Formulas & Analytics (reversed) */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6 }}
              className="grid lg:grid-cols-2 gap-0 rounded-3xl overflow-hidden border border-border bg-surface shadow-sm"
            >
              <div className="bg-gradient-to-bl from-blue-500/5 via-indigo-500/5 to-surface p-10 lg:p-14 flex items-center border-r border-border order-2 lg:order-1">
                <div className="w-full space-y-4">
                  {/* Chat bubble */}
                  <div className="flex justify-end">
                    <div className="bg-accent rounded-2xl rounded-br-sm px-5 py-3">
                      <p className="text-sm text-white">Add a 30-day moving average of Price</p>
                    </div>
                  </div>
                  {/* Result table */}
                  <div className="rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-alt">
                          <th className="px-5 py-3 text-left font-semibold text-text-muted uppercase tracking-wider text-xs">Date</th>
                          <th className="px-5 py-3 text-right font-semibold text-text-muted uppercase tracking-wider text-xs">Price</th>
                          <th className="px-5 py-3 text-right font-semibold text-accent uppercase tracking-wider text-xs">30d_MA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["2025-01-28", "$102,450", "$98,312"],
                          ["2025-01-29", "$101,800", "$98,540"],
                          ["2025-01-30", "$103,100", "$98,821"],
                          ["2025-01-31", "$104,200", "$99,180"],
                        ].map(([date, price, ma], i) => (
                          <tr key={i} className="border-t border-surface-alt">
                            <td className="px-5 py-3 text-text-secondary tabular-nums">{date}</td>
                            <td className="px-5 py-3 text-text text-right tabular-nums font-medium">{price}</td>
                            <td className="px-5 py-3 text-accent text-right tabular-nums font-semibold">{ma}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="p-12 lg:p-20 flex flex-col justify-center order-1 lg:order-2">
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent mb-5">
                  <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
                  </svg>
                  Formulas & Analytics
                </div>
                <h3 className="text-3xl sm:text-4xl font-bold text-text tracking-tight">
                  Compute in Plain English
                </h3>
                <p className="mt-5 text-lg text-text-secondary leading-relaxed max-w-lg">
                  Moving averages, percent changes, rolling windows, conditional logic — describe the calculation and the agent writes the formula, sorts the data, and fills every row.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Moving avg</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">% change</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">CASE/WHEN</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Custom formulas</span>
                </div>
              </div>
            </motion.div>

            {/* Row 3 — Multi-Dataset */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6 }}
              className="grid lg:grid-cols-2 gap-0 rounded-3xl overflow-hidden border border-border bg-surface shadow-sm"
            >
              <div className="p-12 lg:p-20 flex flex-col justify-center">
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent mb-5">
                  <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
                  </svg>
                  Multi-Dataset
                </div>
                <h3 className="text-3xl sm:text-4xl font-bold text-text tracking-tight">
                  One Workspace, Many Datasets
                </h3>
                <p className="mt-5 text-lg text-text-secondary leading-relaxed max-w-lg">
                  Open multiple datasets in a single session. Join tables on shared keys, compare columns side by side, and cross-reference data — the agent handles the merge logic.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Inner join</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Left join</span>
                  <span className="text-sm font-medium text-text-muted bg-surface-hover rounded-full px-4 py-1.5">Auto-rename</span>
                </div>
              </div>
              <div className="bg-gradient-to-br from-violet-500/5 via-indigo-500/5 to-surface p-10 lg:p-14 flex items-center border-l border-border">
                <div className="w-full space-y-4">
                  {/* Tab mockup */}
                  <div className="flex items-center gap-1 rounded-lg bg-surface-hover p-1.5">
                    <div className="px-4 py-2 text-xs font-medium text-text-secondary bg-surface rounded-md shadow-sm">BTC_data.csv</div>
                    <div className="px-4 py-2 text-xs font-medium text-text-muted">SPX_data.csv</div>
                    <div className="px-4 py-2 text-xs font-medium text-accent bg-surface rounded-md shadow-sm flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                      merged
                    </div>
                  </div>
                  {/* Merged table */}
                  <div className="rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-alt">
                          <th className="px-5 py-3 text-left font-semibold text-text-muted uppercase tracking-wider text-xs">Date</th>
                          <th className="px-5 py-3 text-right font-semibold text-blue-500 uppercase tracking-wider text-xs">BTC_Close</th>
                          <th className="px-5 py-3 text-right font-semibold text-violet-500 uppercase tracking-wider text-xs">SPX_Close</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["2025-01-28", "$102,450", "$6,040"],
                          ["2025-01-29", "$101,800", "$6,065"],
                          ["2025-01-30", "$103,100", "$6,012"],
                          ["2025-01-31", "$104,200", "$6,089"],
                        ].map(([date, btc, spx], i) => (
                          <tr key={i} className="border-t border-surface-alt">
                            <td className="px-5 py-3 text-text-secondary tabular-nums">{date}</td>
                            <td className="px-5 py-3 text-blue-600 text-right tabular-nums font-medium">{btc}</td>
                            <td className="px-5 py-3 text-violet-600 text-right tabular-nums font-medium">{spx}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── Use cases — clean grid ─── */}
      <section id="use-cases" className="relative bg-surface-alt">
        <div className="max-w-[90rem] mx-auto px-6 py-28 sm:py-36">
          <SectionHeader
            eyebrow="Use cases"
            title="See What's Possible"
            description="From column transforms to full analysis pipelines — describe what you need and let the agent handle it."
            center
          />

          <div className="mt-20 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {USE_CASES.map((uc, i) => (
              <motion.div
                key={uc.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.06, duration: 0.5 }}
                whileHover={{ y: -4, transition: { type: "spring", stiffness: 400, damping: 25 } }}
                className="group rounded-2xl bg-surface border border-border overflow-hidden cursor-default shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Top accent gradient */}
                <div className="h-1 bg-gradient-to-r from-indigo-500 via-purple-400 to-indigo-300" />

                <div className="p-6">
                  {/* Icon + title */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-accent-light flex items-center justify-center shrink-0 group-hover:bg-accent transition-colors">
                      <svg className="w-4.5 h-4.5 text-accent group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        {uc.icon}
                      </svg>
                    </div>
                    <h3 className="text-[15px] font-semibold text-text">{uc.title}</h3>
                  </div>

                  <p className="text-sm text-text-secondary leading-relaxed mb-5">{uc.description}</p>

                  {/* Input → Output demo strip */}
                  <div className="rounded-xl bg-surface-alt border border-border divide-y divide-border">
                    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-xs text-text-muted truncate flex-1">{uc.input}</span>
                      <svg className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                      <span className="text-xs font-bold text-text shrink-0">{uc.output}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="relative bg-surface">
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
              <Link
                href={isLoggedIn ? "/plans" : "/login"}
                className="mt-8 w-full bg-accent text-white font-medium py-3.5 rounded-xl hover:bg-accent-hover transition-colors block text-center text-base"
              >
                {isLoggedIn ? "Upgrade to Pro" : "Get started free"}
              </Link>
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
      <section className="relative overflow-hidden bg-surface-alt">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.06)_0%,transparent_70%)] pointer-events-none" />
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
      <footer className="border-t border-border bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center gap-2.5 shrink-0">
                <Image src="/logo.png" alt="Kwartz" width={24} height={24} />
                <span className="text-base font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] text-text">
                  Kwartz
                </span>
              </Link>
              <p className="text-sm text-text-muted hidden sm:block">AI-powered data agent.</p>
            </div>
            <div className="flex items-center gap-6 text-sm text-text-secondary">
              <a href="#capabilities" className="hover:text-text transition-colors">Capabilities</a>
              <a href="#use-cases" className="hover:text-text transition-colors">Use cases</a>
              <a href="#pricing" className="hover:text-text transition-colors">Pricing</a>
              <Link href={ctaHref} className="hover:text-text transition-colors">Dashboard</Link>
            </div>
          </div>
          <div className="mt-6 pt-5 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-text-muted">
            <span>&copy; 2026 Kwartz. All rights reserved.</span>
            <div className="flex items-center gap-2">
              <Link href="/terms" className="hover:text-text transition-colors">Terms</Link>
              <span>&middot;</span>
              <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Data ─── */

const USE_CASES = [
  {
    title: "Sentiment analysis",
    description: "Classify customer feedback, reviews, or support tickets at scale using AI.",
    input: "Broke after two weeks, terrible",
    output: "Negative",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
    ),
  },
  {
    title: "Data enrichment",
    description: "Generate new columns from existing data — product descriptions, summaries, tags.",
    input: "Wireless noise-canceling headphones",
    output: "Silence the world. Hear what matters.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    ),
  },
  {
    title: "Filtering & cleanup",
    description: "Remove duplicates, fix formatting, standardize values across columns.",
    input: "(555) 123-4567",
    output: "+15551234567",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
    ),
  },
  {
    title: "Classification",
    description: "Categorize rows into custom labels — spam detection, topic tagging, lead scoring.",
    input: "Exclusive offer just for you...",
    output: "Sales pitch",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
    ),
  },
  {
    title: "Translation",
    description: "Translate entire columns across languages with a single prompt.",
    input: "Merci pour votre aide",
    output: "Thank you for your help",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C13.18 6.061 14.133 6.802 15 7.662m-6.666-2.298C7.32 6.06 6.367 6.802 5.5 7.662" />
    ),
  },
  {
    title: "Reusable transformations",
    description: "Chain steps into repeatable workflows. Replay with one click after updates.",
    input: "Translate → Classify → Summarize",
    output: "1-click replay",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
    ),
  },
];

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
