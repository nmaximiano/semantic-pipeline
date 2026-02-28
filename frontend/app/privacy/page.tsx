"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import SettingsMenu from "@/components/SettingsMenu";
import { flushCheckpoint } from "@/lib/duckdb";

export default function PrivacyPage() {
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
            <Image src="/logo.png" alt="Kwartz" width={32} height={32} />
            <span className="text-2xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight text-text">
              Kwartz
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
          Privacy Policy
        </h1>
        <p className="text-sm text-text-muted mb-10">
          Last updated: February 27, 2026
        </p>

        <div className="prose prose-neutral dark:prose-invert prose-headings:text-text prose-p:text-text-secondary prose-li:text-text-secondary prose-strong:text-text prose-a:text-accent max-w-none">
          <h2>1. Information We Collect</h2>
          <p>
            <strong>Account information:</strong> When you sign up, we collect
            your email address through Supabase Auth. We do not collect your
            name, phone number, or other personal details.
          </p>
          <p>
            <strong>Usage data:</strong> We collect basic usage information such
            as message credits consumed, datasets created, and feature usage to
            enforce plan limits and improve the Service.
          </p>
          <p>
            <strong>Datasets:</strong> You upload CSV datasets to the Service.
            Dataset contents are stored in our database to provide the Service to
            you.
          </p>

          <h2>2. How We Use Information</h2>
          <ul>
            <li>
              <strong>Authentication:</strong> Your email is used to create and
              secure your account.
            </li>
            <li>
              <strong>Billing:</strong> Your email and Stripe customer ID are
              used to process subscriptions and payments.
            </li>
            <li>
              <strong>Service delivery:</strong> Your datasets are processed to
              provide AI analysis, transformations, and enrichment as you
              request.
            </li>
            <li>
              <strong>Service improvement:</strong> Aggregate, anonymized usage
              data may be used to improve the platform.
            </li>
          </ul>

          <h2>3. Third-Party Services</h2>
          <p>We use the following third-party services to operate Kwartz:</p>
          <ul>
            <li>
              <strong>Supabase</strong> — Authentication and database hosting.
              Your email and dataset contents are stored in Supabase.
            </li>
            <li>
              <strong>Stripe</strong> — Payment processing. Stripe receives your
              email and payment information. See{" "}
              <a
                href="https://stripe.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Stripe&rsquo;s Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>OpenRouter (LLM provider)</strong> — AI processing. When
              you use agent features, relevant portions of your dataset contents
              are sent to a large language model via OpenRouter to generate
              responses and transformations. We do not control how OpenRouter
              processes data beyond their published terms.
            </li>
          </ul>

          <h2>4. Data Storage &amp; Security</h2>
          <p>
            Your data is stored in Supabase-hosted PostgreSQL databases. We use
            industry-standard security practices including encrypted connections
            (TLS), row-level access controls, and service-role authentication for
            database operations.
          </p>

          <h2>5. Cookies</h2>
          <p>
            Kwartz uses cookies solely for authentication purposes (Supabase
            Auth session cookies). We do not use tracking cookies, advertising
            cookies, or third-party analytics cookies.
          </p>

          <h2>6. Data Retention &amp; Deletion</h2>
          <p>
            Your data is retained as long as your account is active. You can
            delete individual datasets at any time from within the Service. If
            you wish to delete your entire account and all associated data,
            please contact us at{" "}
            <a href="mailto:support@kwartz.ai">support@kwartz.ai</a>.
          </p>

          <h2>7. Children&rsquo;s Privacy</h2>
          <p>
            Kwartz is not directed at children under the age of 13. We do not
            knowingly collect personal information from children under 13. If we
            learn that we have collected data from a child under 13, we will
            delete it promptly.
          </p>

          <h2>8. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify
            you of material changes by posting the updated policy on this page
            with a revised &quot;Last updated&quot; date. Continued use of the
            Service after changes constitutes acceptance.
          </p>

          <h2>9. Contact</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us
            at <a href="mailto:support@kwartz.ai">support@kwartz.ai</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
