type PromptChipProps = {
  text: string;
  onSelect?: (text: string) => void;
  disabled?: boolean;
};

export function PromptChip({ text, onSelect, disabled }: PromptChipProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(text)}
      disabled={disabled}
      className="rounded-full border border-border bg-card/70 px-3 py-2 text-sm text-foreground shadow-sm text-left transition hover:border-primary/60 hover:shadow disabled:opacity-50"
    >
      {text}
    </button>
  );
}
