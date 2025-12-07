import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ExperimentsPanel, type Experiment } from "@/components/experiments/experiments-panel";
import { ExperimentsHero } from "@/components/experiments/experiments-hero";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const supabase = getSupabaseAdmin() || getSupabaseServer();
  const experiments: Experiment[] =
    supabase
      ? (
          await supabase
            .from("experiment_markets")
            .select("id, question, normalized_question, resolution_outcome, resolved_at, created_at")
            .order("created_at", { ascending: false })
            .limit(50)
        ).data ?? []
      : [];

  return (
    <div className="space-y-6">
      <ExperimentsHero />
      <ExperimentsPanel experiments={experiments} />
    </div>
  );
}

