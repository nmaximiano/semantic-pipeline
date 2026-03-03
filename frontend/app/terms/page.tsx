"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import SettingsMenu from "@/components/SettingsMenu";
import { flushCheckpoint } from "@/lib/duckdb";

export default function TermsPage() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
      if (session) setUserEmail(session.user?.email ?? "");
    });
  }, []);

  async function handleLogout() {
    await flushCheckpoint();
    await supabase.auth.signOut();
    setIsLoggedIn(false);
    setUserEmail("");
  }

  // Allow body scrolling for long content
  useEffect(() => {
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border bg-surface/90 backdrop-blur-md px-5 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-3xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight">
              <span className="text-accent font-bold">R</span><span className="text-text">·Base</span>
            </span>
          </Link>
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
            {isLoggedIn && (
              <>
                <Link
                  href="/dashboard"
                  className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
                >
                  Dashboard
                </Link>
                <SettingsMenu email={userEmail} onLogout={handleLogout} />
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-text tracking-tight mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-text-muted mb-10">
          Last updated: February 27, 2026
        </p>

        <div className="prose prose-neutral dark:prose-invert prose-headings:text-text prose-p:text-text-secondary prose-li:text-text-secondary prose-strong:text-text prose-a:text-accent max-w-none">
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using R·Base (&quot;the Service&quot;), operated by
            R·Base (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), you agree
            to be bound by these Terms of Service. If you do not agree, do not
            use the Service.
          </p>

          <h2>2. Description of Service</h2>
          <p>
            R·Base is an AI-powered data analysis platform. You upload datasets,
            open sessions, and interact with an AI agent that analyzes,
            transforms, and enriches your data through natural-language
            conversation.
          </p>

          <h2>3. Account Responsibilities</h2>
          <p>
            You are responsible for maintaining the confidentiality of your
            account credentials and for all activity under your account. You
            agree to provide accurate information when creating your account and
            to notify us immediately of any unauthorized use.
          </p>

          <h2>4. Subscriptions &amp; Billing</h2>
          <p>
            R·Base offers a free tier and a paid Pro subscription. Pro
            subscriptions are billed monthly through Stripe and auto-renew until
            cancelled. You can cancel or manage your subscription at any time
            through the Stripe customer portal accessible from your account
            settings. Refunds are handled in accordance with Stripe&rsquo;s
            policies.
          </p>
          <p>
            We reserve the right to change pricing with reasonable advance
            notice. Price changes will not apply to the current billing period.
          </p>

          <h2>5. User Data &amp; Intellectual Property</h2>
          <p>
            You retain full ownership of any data you upload to R·Base. We do
            not claim any intellectual property rights over your datasets or the
            outputs generated from them.
          </p>
          <p>
            We do not sell, share, or monetize your data. Your data is used
            solely to provide the Service to you.
          </p>

          <h2>6. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>
              Use the Service for any unlawful purpose or in violation of any
              applicable laws
            </li>
            <li>
              Upload datasets containing malicious code, malware, or content
              designed to exploit the system
            </li>
            <li>
              Attempt to gain unauthorized access to the Service, other
              accounts, or our infrastructure
            </li>
            <li>
              Interfere with or disrupt the Service or impose an unreasonable
              load on our systems
            </li>
            <li>
              Reverse-engineer, decompile, or disassemble any part of the
              Service
            </li>
            <li>
              Resell or redistribute the Service without our written consent
            </li>
          </ul>

          <h2>7. Disclaimers</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as
            available&quot; without warranties of any kind, express or implied.
            AI-generated outputs may contain errors or inaccuracies. You are
            responsible for reviewing and validating all results before relying
            on them for any purpose.
          </p>

          <h2>8. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, R·Base shall not be liable
            for any indirect, incidental, special, consequential, or punitive
            damages, or any loss of profits or data, arising from your use of
            the Service. Our total liability for any claim arising from the
            Service shall not exceed the amount you paid us in the twelve months
            preceding the claim.
          </p>

          <h2>9. Termination</h2>
          <p>
            We may suspend or terminate your access to the Service at any time
            for violation of these Terms or for any reason with reasonable
            notice. You may delete your account at any time. Upon termination,
            your data will be deleted in accordance with our Privacy Policy.
          </p>

          <h2>10. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. We will notify you of
            material changes by posting the updated Terms on this page with a
            revised &quot;Last updated&quot; date. Continued use of the Service
            after changes constitutes acceptance.
          </p>

          <h2>11. Contact</h2>
          <p>
            If you have questions about these Terms, please contact us at{" "}
            <a href="mailto:support@tryrbase.com">support@tryrbase.com</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
