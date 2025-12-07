import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "X Grok Probability Ticker",
  description: "Kalshi-like probabilities powered by X + Grok"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Background Patterns */}
          <div className="fixed inset-0 z-[-1] bg-background bg-dot-pattern" />
          <div className="fixed inset-0 z-[-1] bg-gradient-to-tr from-primary/5 via-transparent to-accent/5 pointer-events-none" />

          <div className="mx-auto max-w-6xl px-4 py-8">
            <header className="mb-8">
              <div className="glass-card rounded-2xl px-6 py-5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-xl font-bold tracking-tight">Prediction Ticker</h1>
                    <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-mono uppercase tracking-wider">
                      Beta
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Real-time market probabilities derived from X & Grok
                  </p>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground/80 font-mono">
                    <span>X_STREAM</span>
                    <span className="text-emerald-500">•</span>
                    <span>GROK_INFERENCE</span>
                  </div>
                  <ThemeToggle />
                </div>
              </div>
            </header>
            
            <main className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
