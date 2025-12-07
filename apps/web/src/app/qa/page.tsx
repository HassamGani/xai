import { QaPanel } from "@/components/qa/qa-panel";

export default function QaPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-4 p-4">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Ask in natural language</p>
        <h1 className="text-2xl font-semibold">Market Q&A</h1>
        <p className="text-sm text-muted-foreground">
          Grok interprets your question, pulls market data, and summarizes with links.
        </p>
      </header>
      <QaPanel />
    </div>
  );
}
