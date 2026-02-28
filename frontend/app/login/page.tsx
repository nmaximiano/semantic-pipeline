"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { useTheme } from "@/lib/useTheme";


export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const searchParams = useSearchParams();

  // Show errors passed from OAuth callback
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) setError(urlError);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        // If no session came back, email confirmation is required
        if (!data.session) {
          setCheckEmail(true);
          setLoading(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push("/dashboard");
    } catch (e: any) {
      setError(e.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Kwartz" width={32} height={32} />
            <span className="text-2xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight text-text">
              Kwartz
            </span>
          </Link>
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
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center bg-surface px-4 relative overflow-hidden">
        {/* Background glows */}
        <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.07)_0%,rgba(167,139,250,0.03)_40%,transparent_70%)] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[300px] bg-[radial-gradient(ellipse,rgba(16,185,129,0.05)_0%,transparent_70%)] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-sm relative"
        >
          {checkEmail ? (
            <>
              <div className="text-center mb-8">
                <h1
                  className="text-3xl font-[family-name:var(--font-clash)] tracking-tight text-text"
                  style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
                >
                  Check your email
                </h1>
                <p className="mt-2 text-sm text-text-muted">
                  We sent a confirmation link to <span className="font-medium text-text">{email}</span>
                </p>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="rounded-2xl border border-border bg-surface shadow-lg shadow-black/[0.03] dark:shadow-black/20 p-7 text-center"
              >
                <div className="mx-auto mb-5 w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                </div>
                <p className="text-sm text-text-muted mb-5">
                  Click the link in the email to activate your account, then come back here to sign in.
                </p>
                <button
                  onClick={() => { setCheckEmail(false); setIsSignUp(false); }}
                  className="text-sm text-accent font-medium hover:text-accent-hover transition-colors"
                >
                  Back to sign in
                </button>
              </motion.div>
            </>
          ) : (
            <>
          <div className="text-center mb-8">
            <h1
              className="text-3xl font-[family-name:var(--font-clash)] tracking-tight text-text"
              style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
            >
              {isSignUp ? "Create an account" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              {isSignUp ? "Sign up to start analyzing data" : "Sign in to continue"}
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="rounded-2xl border border-border bg-surface shadow-lg shadow-black/[0.03] dark:shadow-black/20 p-7"
          >
            {error && (
              <div className="mb-5 flex items-center gap-3 bg-error-bg border border-error-border text-error rounded-xl px-4 py-3 text-sm">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              disabled={googleLoading}
              onClick={async () => {
                setError("");
                setGoogleLoading(true);
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                  },
                });
                if (error) {
                  setError(error.message);
                  setGoogleLoading(false);
                }
              }}
              className="w-full flex items-center justify-center gap-3 border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-text hover:bg-surface-alt hover:border-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4.5 h-4.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l3.56-2.77.01-.54z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {googleLoading ? "Redirecting..." : "Continue with Google"}
            </button>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface px-3 text-text-muted">or</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full border border-border rounded-lg px-3.5 py-2 text-sm text-text bg-surface-alt placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full border border-border rounded-lg px-3.5 py-2 text-sm text-text bg-surface-alt placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              {!isSignUp && (
                <div className="flex justify-end -mt-1">
                  <Link
                    href="/reset-password"
                    className="text-xs text-text-muted hover:text-accent transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-accent text-white py-2.5 px-6 rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-accent/20"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                    {isSignUp ? "Creating account..." : "Signing in..."}
                  </span>
                ) : (
                  isSignUp ? "Create account" : "Sign in"
                )}
              </button>
            </form>

            <div className="mt-5 text-center">
              <button
                onClick={() => { setIsSignUp(!isSignUp); setError(""); }}
                className="text-sm text-text-muted hover:text-text transition-colors"
              >
                {isSignUp ? (
                  <>Already have an account? <span className="text-accent font-medium">Sign in</span></>
                ) : (
                  <>Don&apos;t have an account? <span className="text-accent font-medium">Sign up</span></>
                )}
              </button>
            </div>
          </motion.div>

          <p className="mt-6 text-center text-xs text-text-muted/50">
            By continuing, you agree to our{" "}
            <Link href="/terms" className="hover:text-text-muted transition-colors underline underline-offset-2">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="hover:text-text-muted transition-colors underline underline-offset-2">Privacy Policy</Link>
          </p>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}
