import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Post = {
  id: string;
  text?: string | null;
  author_id?: string | null;
  author_followers?: number | null;
  scored_at: string;
  stance_label?: string;
  credibility_label?: string;
  summary?: string;
  reason?: string;
};

type Props = {
  posts: Post[];
  emptyMessage?: string;
};

export function PostList({ posts, emptyMessage = "No curated posts yet." }: Props) {
  if (!posts.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="grid gap-3">
      {posts.map((p) => (
        <Card key={p.id} className="border border-white/15 bg-white/5">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">{p.summary ?? p.text ?? "Post"}</CardTitle>
              <CardDescription>
                {p.reason ?? "Relevant signal"} • {new Date(p.scored_at).toLocaleString()}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {p.stance_label ? <Badge variant="secondary">{p.stance_label}</Badge> : null}
              {p.credibility_label ? <Badge variant="outline">{p.credibility_label}</Badge> : null}
            </div>
          </CardHeader>
          {p.text ? (
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{p.text}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Author: {p.author_id ?? "unknown"} • Followers: {p.author_followers ?? 0}
              </p>
            </CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

