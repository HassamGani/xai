"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  marketId: string;
};

type AnalysisDepth = "shallow" | "medium" | "deep";

type Citation = {
  title: string;
  url: string;
  snippet?: string;
};

const DEPTH_CONFIG: Record<AnalysisDepth, { label: string; description: string; icon: string }> = {
  shallow: {
    label: "Quick",
    description: "~200 words, key points only",
    icon: "⚡"
  },
  medium: {
    label: "Standard",
    description: "~400 words, balanced analysis",
    icon: "📊"
  },
  deep: {
    label: "Deep Dive",
    description: "~800 words, comprehensive",
    icon: "🔬"
  }
};

export function GrokAnalysis({ marketId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDepth, setSelectedDepth] = useState<AnalysisDepth | null>(null);
  const [analysis, setAnalysis] = useState<string>("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchAnalysis = async (depth: AnalysisDepth) => {
    setSelectedDepth(depth);
    setLoading(true);
    setError(null);
    setAnalysis("");
    setCitations([]);
    setIsOpen(true);

    try {
      const res = await fetch(`/api/markets/${marketId}/analyze?depth=${depth}`);
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate analysis");
      }

      const data = await res.json();
      
      if (data.analysis) {
        // Set citations if available
        if (data.citations && data.citations.length > 0) {
          setCitations(data.citations);
        }
        
        // Typing effect
        const text = data.analysis;
        let index = 0;
        const typeSpeed = depth === "shallow" ? 3 : depth === "medium" ? 4 : 5;
        
        const typeWriter = () => {
          if (index < text.length) {
            setAnalysis(text.slice(0, index + 1));
            index++;
            setTimeout(typeWriter, typeSpeed);
          } else {
            setGeneratedAt(data.generated_at);
            setLoading(false);
          }
        };
        
        typeWriter();
      } else {
        throw new Error("No analysis received");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setLoading(false);
    }
  };

  // Auto-scroll as text appears
  useEffect(() => {
    if (contentRef.current && loading) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [analysis, loading]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) setIsOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [loading]);

  // Render formatted text with citation markers
  const renderAnalysis = (text: string) => {
    if (!text) return null;
    
    return text.split("\n").map((line, idx) => {
      const trimmed = line.trim();
      
      // Headers with ** **
      if (trimmed.match(/^\d+\.\s*\*\*.*\*\*/)) {
        const num = trimmed.match(/^\d+/)?.[0];
        const headerText = trimmed.replace(/^\d+\.\s*\*\*/, "").replace(/\*\*:?.*$/, "").trim();
        return (
          <h4 key={idx} className="font-semibold text-foreground mt-5 mb-2 first:mt-0 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold shrink-0">
              {num}
            </span>
            {headerText}
          </h4>
        );
      }
      
      if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        return (
          <h4 key={idx} className="font-semibold text-foreground mt-5 mb-2 first:mt-0">
            {trimmed.slice(2, -2).replace(/:/g, "")}
          </h4>
        );
      }
      
      // Bullet points
      if (trimmed.startsWith("-") || trimmed.startsWith("•") || trimmed.startsWith("*")) {
        const content = trimmed.replace(/^[-•*]\s*/, "");
        const formatted = formatInlineText(content);
        return (
          <div key={idx} className="flex gap-2 my-1.5 text-sm text-muted-foreground">
            <span className="text-primary mt-0.5">•</span>
            <span className="leading-relaxed">{formatted}</span>
          </div>
        );
      }
      
      // Regular paragraphs
      if (trimmed) {
        const formatted = formatInlineText(trimmed);
        return (
          <p key={idx} className="text-sm text-muted-foreground my-2 leading-relaxed">
            {formatted}
          </p>
        );
      }
      
      return <div key={idx} className="h-2" />;
    });
  };

  // Format inline text (bold, citations)
  const formatInlineText = (text: string) => {
    // Handle bold and citation markers like [1], [2]
    const parts = text.split(/(\*\*.*?\*\*|\[\d+\])/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="text-foreground">{part.slice(2, -2)}</strong>;
      }
      if (part.match(/^\[\d+\]$/)) {
        const num = part.slice(1, -1);
        const citation = citations[parseInt(num) - 1];
        if (citation) {
          return (
            <a
              key={i}
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors ml-0.5"
              title={citation.title}
            >
              {num}
            </a>
          );
        }
      }
      return part;
    });
  };

  return (
    <>
      {/* Trigger Buttons */}
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(DEPTH_CONFIG) as AnalysisDepth[]).map((depth) => {
          const config = DEPTH_CONFIG[depth];
          return (
            <button
              key={depth}
              onClick={() => fetchAnalysis(depth)}
              disabled={loading}
              className={`p-3 rounded-xl border transition-all text-left hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed ${
                selectedDepth === depth && isOpen
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card"
              }`}
            >
              <div className="text-lg mb-1">{config.icon}</div>
              <div className="font-medium text-sm text-foreground">{config.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{config.description}</div>
            </button>
          );
        })}
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => !loading && setIsOpen(false)}
        />
      )}

      {/* Side Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[520px] bg-background border-l border-border shadow-2xl z-50 transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-lg text-foreground">Grok Analysis</h2>
              <p className="text-xs text-muted-foreground">
                {selectedDepth && DEPTH_CONFIG[selectedDepth].label} • Web search enabled
              </p>
            </div>
          </div>
          <button
            onClick={() => !loading && setIsOpen(false)}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div 
          ref={contentRef}
          className="flex-1 overflow-y-auto p-5"
        >
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 text-destructive">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-medium">Analysis failed</p>
                <p className="text-sm opacity-80 mt-1">{error}</p>
              </div>
            </div>
          )}

          {loading && !analysis && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                <svg className="w-8 h-8 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-medium text-foreground">Searching & Analyzing...</p>
                <p className="text-sm text-muted-foreground mt-1">Grok is searching the web for context</p>
              </div>
            </div>
          )}

          {analysis && (
            <>
              <div className="prose prose-sm max-w-none">
                {renderAnalysis(analysis)}
                {loading && (
                  <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                )}
              </div>

              {/* Citations Section */}
              {citations.length > 0 && !loading && (
                <div className="mt-6 pt-4 border-t border-border">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Sources ({citations.length})
                  </h4>
                  <div className="space-y-2">
                    {citations.map((citation, idx) => (
                      <a
                        key={idx}
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-accent/50 transition-colors group"
                      >
                        <span className="w-5 h-5 rounded bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                            {citation.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {new URL(citation.url).hostname}
                          </p>
                          {citation.snippet && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {citation.snippet}
                            </p>
                          )}
                        </div>
                        <svg className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-card shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>xAI Grok + Web Search</span>
              {generatedAt && !loading && (
                <>
                  <span>•</span>
                  <span>{new Date(generatedAt).toLocaleTimeString()}</span>
                </>
              )}
            </div>
            {selectedDepth && (
              <Button
                onClick={() => fetchAnalysis(selectedDepth)}
                disabled={loading}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Analyzing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
