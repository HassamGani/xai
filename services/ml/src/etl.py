"""ETL Pipeline: Extract training data from Supabase."""

import json
import math
from datetime import datetime
from typing import Optional
import pandas as pd
import numpy as np
from .db import get_supabase_client
from .config import config


def extract_resolved_markets(limit: Optional[int] = None) -> pd.DataFrame:
    """Extract resolved markets with their features."""
    client = get_supabase_client()
    
    query = client.table("markets").select("*").eq("status", "resolved")
    if limit:
        query = query.limit(limit)
    
    result = query.execute()
    
    if not result.data:
        print("No resolved markets found")
        return pd.DataFrame()
    
    df = pd.DataFrame(result.data)
    print(f"Extracted {len(df)} resolved markets")
    return df


def extract_training_posts(market_ids: Optional[list] = None, limit: Optional[int] = None) -> pd.DataFrame:
    """Extract training posts with features."""
    client = get_supabase_client()
    
    # First try training_posts table
    query = client.table("training_posts").select("*")
    if market_ids:
        query = query.in_("market_id", market_ids)
    if limit:
        query = query.limit(limit)
    
    result = query.execute()
    
    if result.data:
        df = pd.DataFrame(result.data)
        print(f"Extracted {len(df)} training posts from training_posts table")
        return df
    
    # Fallback: Join scored_posts with raw_posts
    print("No training_posts found, extracting from scored_posts + raw_posts...")
    return extract_posts_from_source(market_ids, limit)


def extract_posts_from_source(market_ids: Optional[list] = None, limit: Optional[int] = None) -> pd.DataFrame:
    """Extract posts directly from scored_posts and raw_posts tables."""
    client = get_supabase_client()
    
    # Get scored posts
    query = client.table("scored_posts").select("*")
    if market_ids:
        query = query.in_("market_id", market_ids)
    if limit:
        query = query.limit(limit)
    
    scored_result = query.execute()
    if not scored_result.data:
        return pd.DataFrame()
    
    scored_df = pd.DataFrame(scored_result.data)
    
    # Get raw posts
    raw_ids = scored_df["raw_post_id"].unique().tolist()
    raw_result = client.table("raw_posts").select("*").in_("id", raw_ids).execute()
    raw_df = pd.DataFrame(raw_result.data) if raw_result.data else pd.DataFrame()
    
    # Merge
    if not raw_df.empty:
        merged = scored_df.merge(
            raw_df, 
            left_on="raw_post_id", 
            right_on="id", 
            suffixes=("_scored", "_raw")
        )
    else:
        merged = scored_df
    
    print(f"Extracted {len(merged)} posts from source tables")
    return merged


def extract_probability_snapshots(market_id: str) -> pd.DataFrame:
    """Extract probability time series for a market."""
    client = get_supabase_client()
    
    result = client.table("probability_snapshots")\
        .select("*")\
        .eq("market_id", market_id)\
        .order("timestamp")\
        .execute()
    
    if not result.data:
        return pd.DataFrame()
    
    return pd.DataFrame(result.data)


def compute_market_features(market: dict, posts_df: pd.DataFrame, snapshots_df: pd.DataFrame) -> dict:
    """Compute market-level features for ML training."""
    features = {}
    
    # Basic stats
    features["K"] = len(market.get("outcomes", [])) or 2  # Number of outcomes
    
    # Duration
    created_at = pd.to_datetime(market.get("created_at"))
    resolved_at = pd.to_datetime(market.get("resolved_at"))
    if created_at and resolved_at:
        features["duration_hours"] = (resolved_at - created_at).total_seconds() / 3600
        features["duration_days"] = features["duration_hours"] / 24
    
    # Post statistics
    if not posts_df.empty:
        features["num_posts"] = len(posts_df)
        features["avg_posts_per_hour"] = features["num_posts"] / max(features.get("duration_hours", 1), 1)
        
        # Author concentration (Herfindahl index)
        author_counts = posts_df["author_id"].value_counts()
        total = author_counts.sum()
        if total > 0:
            shares = (author_counts / total) ** 2
            features["author_hhi"] = shares.sum()
            features["num_unique_authors"] = len(author_counts)
        
        # Average scores
        for col in ["relevance", "strength", "credibility"]:
            if col in posts_df.columns:
                features[f"avg_{col}"] = posts_df[col].mean()
                features[f"max_{col}"] = posts_df[col].max()
        
        # Verified ratio
        if "author_verified" in posts_df.columns:
            features["verified_ratio"] = posts_df["author_verified"].mean()
    
    # Probability volatility from snapshots
    if not snapshots_df.empty and "probabilities" in snapshots_df.columns:
        try:
            # Extract first outcome probability series
            probs = snapshots_df["probabilities"].apply(
                lambda x: list(x.values())[0] if isinstance(x, dict) and x else 0.5
            )
            features["prob_volatility"] = probs.std()
            features["prob_range"] = probs.max() - probs.min()
            
            # Early momentum (first 10% of snapshots)
            early_n = max(1, len(probs) // 10)
            if len(probs) > early_n:
                features["early_momentum"] = probs.iloc[early_n] - probs.iloc[0]
        except Exception:
            pass
    
    return features


def compute_post_features(row: dict) -> dict:
    """Compute derived features for a single post."""
    features = {}
    
    # Extract Grok scores
    scores = row.get("scores", {}) or {}
    if isinstance(scores, str):
        try:
            scores = json.loads(scores)
        except:
            scores = {}
    
    relevance = float(scores.get("relevance", 0))
    stance = float(scores.get("stance", 0))
    strength = float(scores.get("strength", 0))
    credibility = float(scores.get("credibility", 0))
    confidence = float(scores.get("confidence", 0))
    
    features["relevance"] = relevance
    features["stance"] = stance
    features["strength"] = strength
    features["credibility"] = credibility
    features["confidence"] = confidence
    
    # Derived scores
    features["semantic_strength"] = relevance * strength * credibility
    features["abs_stance"] = abs(stance)
    features["signed_signal"] = stance * features["semantic_strength"]
    
    # Author features
    followers = row.get("author_followers") or 0
    features["log_followers"] = math.log1p(followers)
    features["author_verified"] = bool(row.get("author_verified"))
    
    # Engagement features
    metrics = row.get("metrics", {}) or {}
    if isinstance(metrics, str):
        try:
            metrics = json.loads(metrics)
        except:
            metrics = {}
    
    features["log_likes"] = math.log1p(metrics.get("like_count", 0))
    features["log_reposts"] = math.log1p(metrics.get("retweet_count", 0))
    features["log_replies"] = math.log1p(metrics.get("reply_count", 0))
    features["log_quotes"] = math.log1p(metrics.get("quote_count", 0))
    
    # Text features
    text = row.get("text", "") or ""
    features["text_length"] = len(text)
    features["has_url"] = "http" in text.lower()
    features["has_hashtag"] = "#" in text
    features["has_mention"] = "@" in text
    features["has_cashtag"] = "$" in text
    features["has_numeric"] = any(c.isdigit() for c in text)
    
    # Flags
    flags = row.get("flags", {}) or {}
    if isinstance(flags, str):
        try:
            flags = json.loads(flags)
        except:
            flags = {}
    
    features["is_sarcasm"] = bool(flags.get("is_sarcasm"))
    features["is_question"] = bool(flags.get("is_question"))
    features["is_rumor"] = bool(flags.get("is_rumor"))
    
    return features


def label_posts_with_truth(posts_df: pd.DataFrame, winning_outcome_id: str, snapshots_df: pd.DataFrame) -> pd.DataFrame:
    """Add moved_toward_truth labels to posts."""
    if posts_df.empty:
        return posts_df
    
    posts_df = posts_df.copy()
    
    # Sort by scored_at
    if "scored_at" in posts_df.columns:
        posts_df = posts_df.sort_values("scored_at")
    
    # Get probability at each snapshot
    if not snapshots_df.empty:
        snapshots_df = snapshots_df.sort_values("timestamp")
        
        def get_prob_at_time(timestamp, outcome_id):
            """Get probability for outcome at given timestamp."""
            relevant = snapshots_df[snapshots_df["timestamp"] <= str(timestamp)]
            if relevant.empty:
                return 0.5  # Prior
            last = relevant.iloc[-1]["probabilities"]
            if isinstance(last, str):
                last = json.loads(last)
            return last.get(outcome_id, 0.5)
        
        # Calculate prob_before and prob_after for each post
        prob_befores = []
        prob_afters = []
        
        for i, row in posts_df.iterrows():
            scored_at = row.get("scored_at")
            if scored_at:
                # Find snapshot just before and just after
                before_snaps = snapshots_df[snapshots_df["timestamp"] < str(scored_at)]
                after_snaps = snapshots_df[snapshots_df["timestamp"] >= str(scored_at)]
                
                prob_before = 0.5
                prob_after = 0.5
                
                if not before_snaps.empty:
                    probs = before_snaps.iloc[-1]["probabilities"]
                    if isinstance(probs, str):
                        probs = json.loads(probs)
                    prob_before = probs.get(winning_outcome_id, 0.5)
                
                if not after_snaps.empty:
                    probs = after_snaps.iloc[0]["probabilities"]
                    if isinstance(probs, str):
                        probs = json.loads(probs)
                    prob_after = probs.get(winning_outcome_id, 0.5)
                
                prob_befores.append(prob_before)
                prob_afters.append(prob_after)
            else:
                prob_befores.append(0.5)
                prob_afters.append(0.5)
        
        posts_df["prob_before"] = prob_befores
        posts_df["prob_after"] = prob_afters
        posts_df["delta_prob"] = posts_df["prob_after"] - posts_df["prob_before"]
        
        # moved_toward_truth: True if delta_prob > 0 (moved toward winning outcome)
        posts_df["moved_toward_truth"] = posts_df["delta_prob"] > 0
    
    return posts_df


def export_training_data(output_dir: Optional[str] = None, limit: Optional[int] = None):
    """Export all training data to parquet files."""
    output_dir = output_dir or str(config.data_dir)
    
    print("=== Exporting Training Data ===")
    
    # Extract resolved markets
    markets_df = extract_resolved_markets(limit)
    if markets_df.empty:
        print("No resolved markets to export. ML training requires resolved markets.")
        return
    
    markets_df.to_parquet(f"{output_dir}/resolved_markets.parquet", index=False)
    print(f"Saved {len(markets_df)} markets to resolved_markets.parquet")
    
    # Extract and process posts for each market
    all_posts = []
    
    for _, market in markets_df.iterrows():
        market_id = market["id"]
        winning_outcome = market.get("resolved_outcome_id")
        
        if not winning_outcome:
            continue
        
        # Get posts for this market
        posts = extract_posts_from_source([market_id])
        if posts.empty:
            continue
        
        # Get snapshots
        snapshots = extract_probability_snapshots(market_id)
        
        # Compute features for each post
        post_features = []
        for _, row in posts.iterrows():
            features = compute_post_features(row.to_dict())
            features["market_id"] = market_id
            features["raw_post_id"] = row.get("raw_post_id")
            features["scored_post_id"] = row.get("id")
            features["scored_at"] = row.get("scored_at")
            post_features.append(features)
        
        posts_with_features = pd.DataFrame(post_features)
        
        # Label with ground truth
        posts_labeled = label_posts_with_truth(posts_with_features, winning_outcome, snapshots)
        
        all_posts.append(posts_labeled)
    
    if all_posts:
        training_posts_df = pd.concat(all_posts, ignore_index=True)
        training_posts_df.to_parquet(f"{output_dir}/training_posts.parquet", index=False)
        print(f"Saved {len(training_posts_df)} training posts to training_posts.parquet")
    else:
        print("No training posts to export")
    
    print("=== Export Complete ===")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="ETL Pipeline for ML Training Data")
    parser.add_argument("--export", action="store_true", help="Export training data")
    parser.add_argument("--limit", type=int, help="Limit number of markets")
    parser.add_argument("--output", type=str, help="Output directory")
    
    args = parser.parse_args()
    
    if args.export:
        export_training_data(args.output, args.limit)
    else:
        print("Use --export to export training data")

