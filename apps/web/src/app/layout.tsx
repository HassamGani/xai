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
          <div className="mx-auto max-w-6xl px-4 py-8">
            <header className="mb-8">
              <div className="glass-card rounded-xl px-5 py-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-0.5">
                    <h1 className="text-lg font-semibold">Prediction Ticker</h1>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium uppercase tracking-wider">
                      Beta
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Real-time probabilities from X + Grok
                  </p>
                </div>
                <ThemeToggle />
              </div>
            </header>
            
            <main>{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
