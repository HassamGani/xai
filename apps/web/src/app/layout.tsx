import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";
import Link from "next/link";

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
          <div className="mx-auto max-w-6xl px-4 py-8">
            <header className="mb-8">
              <div className="glass-card rounded-xl px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Link href="/">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-primary font-semibold">
                          xPredict
                        </p>
                        <h1 className="text-lg font-semibold">xPredict</h1>
                      </div>
                    </div>
                  </Link>
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium uppercase tracking-wider">
                    Beta
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <Link
                    href="/experiments"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Experiments
                  </Link>
                  <ThemeToggle />
                </div>
              </div>
            </header>
            
            <main>{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
