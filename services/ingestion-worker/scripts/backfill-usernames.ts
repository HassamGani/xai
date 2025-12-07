import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  X_BEARER_TOKEN: z.string().min(1),
});

const env = envSchema.parse(process.env);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const userCache = new Map<string, { username: string | null; avatar: string | null; followers: number | null }>();

async function fetchProfile(authorId: string): Promise<{ username: string | null; avatar: string | null; followers: number | null } | null> {
  if (userCache.has(authorId)) return userCache.get(authorId)!;
  try {
    const res = await fetch(
      `https://api.twitter.com/2/users/${authorId}?user.fields=username,profile_image_url,public_metrics`,
      {
        headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      }
    );
    if (!res.ok) {
      console.warn("Failed fetch", authorId, res.status);
      return null;
    }
    const data = await res.json();
    const profile = {
      username: data?.data?.username || null,
      avatar: data?.data?.profile_image_url || null,
      followers: data?.data?.public_metrics?.followers_count ?? null,
    };
    userCache.set(authorId, profile);
    return profile;
  } catch (e) {
    console.warn("Fetch error", authorId, e);
    return null;
  }
}

async function main() {
  console.log("Starting backfill for missing author_username and avatars...");
  const { data: rows, error } = await supabase
    .from("raw_posts")
    .select("id, author_id, author_username, text")
    .is("author_username", null)
    .not("author_id", "is", null)
    .limit(30);

  if (error) {
    console.error("Query error", error);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const updates: Array<{ id: string; author_username: string; author_followers?: number | null }> = [];
  const avatarMap = new Map<string, { author_id: string; avatar_data: string; generation_prompt: string; sample_tweet: string | null }>();

  for (const row of rows) {
    const authorId = row.author_id as string;
    const profile = await fetchProfile(authorId);
    if (!profile) continue;
    // small delay to avoid hitting X rate limits too quickly
    await sleep(250);

    if (profile.username) {
      updates.push({ id: row.id, author_username: profile.username, author_followers: profile.followers });
    }
    if (profile.avatar) {
      avatarMap.set(authorId, {
        author_id: authorId,
        avatar_data: profile.avatar,
        generation_prompt: "X profile image url (backfill)",
        sample_tweet: (row.text as string | null)?.slice(0, 500) ?? null,
      });
    }
  }

  // Apply username updates individually (avoids NOT NULL conflicts on other columns)
  for (const u of updates) {
    const payload: Record<string, unknown> = { author_username: u.author_username };
    if (u.author_followers != null) payload.author_followers = u.author_followers;
    const { error: upErr } = await supabase.from("raw_posts").update(payload).eq("id", u.id);
    if (upErr) console.error("Update username error", { id: u.id, error: upErr });
  }
  if (updates.length > 0) console.log(`Updated ${updates.length} rows with usernames`);

  const avatarUpserts = Array.from(avatarMap.values());
  for (const chunk of chunkArray(avatarUpserts, 100)) {
    const { error: avErr } = await supabase.from("author_avatars").upsert(chunk, { onConflict: "author_id" });
    if (avErr) console.error("Upsert avatars error", avErr);
  }
  if (avatarUpserts.length > 0) console.log(`Upserted ${avatarUpserts.length} avatars`);

  console.log("Backfill complete.");
}

main().catch((e) => {
  console.error("Fatal", e);
  process.exit(1);
});

function chunkArray<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

