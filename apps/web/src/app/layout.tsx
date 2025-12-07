import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "X Grok Probability Ticker",
  description: "Kalshi-like probabilities powered by X + Grok"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-foreground">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <header className="mb-10">
            <div className="glass-strong rounded-2xl px-6 py-5 border border-white/10">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    X • Kalshi • Polymarket vibes
                  </p>
                  <h1 className="text-2xl font-semibold">Prediction Ticker</h1>
                  <p className="text-sm text-muted-foreground">
                    Real-time probabilities from X + Grok. No raw firehose shown.
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-sky-500/70 via-emerald-400/70 to-indigo-500/70 blur-[1px]" />
                  <div className="text-xs text-muted-foreground">
                    Glassmorphic UI • Streaming evidence • Softmax engine
                  </div>
                </div>
              </div>
            </div>
          </header>
          <main className="space-y-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

