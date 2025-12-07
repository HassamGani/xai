"""Feature engineering utilities."""

import math
from typing import Optional
import pandas as pd
import numpy as np


def prepare_market_features(market: dict, posts_df: pd.DataFrame) -> dict:
    """Compute all market-level features for ML training."""
    features = {}
    
    # === Basic Market Features ===
    features["K"] = 2  # Binary markets for now
    
    # Duration
    if market.get("created_at") and market.get("resolved_at"):
        try:
            created = pd.to_datetime(market["created_at"])
            resolved = pd.to_datetime(market["resolved_at"])
            duration = (resolved - created).total_seconds()
            features["duration_hours"] = duration / 3600
            features["duration_days"] = duration / 86400
        except:
            features["duration_hours"] = 0
            features["duration_days"] = 0
    
    # === Post Aggregate Features ===
    if not posts_df.empty:
        features["num_posts"] = len(posts_df)
        
        # Posts per hour
        if features.get("duration_hours", 0) > 0:
            features["posts_per_hour"] = features["num_posts"] / features["duration_hours"]
        else:
            features["posts_per_hour"] = 0
        
        # Score aggregates
        for col in ["relevance", "stance", "strength", "credibility", "confidence", "semantic_strength"]:
            if col in posts_df.columns:
                values = posts_df[col].dropna()
                if len(values) > 0:
                    features[f"mean_{col}"] = values.mean()
                    features[f"std_{col}"] = values.std()
                    features[f"max_{col}"] = values.max()
                    features[f"min_{col}"] = values.min()
        
        # Stance distribution
        if "stance" in posts_df.columns:
            stance = posts_df["stance"].dropna()
            if len(stance) > 0:
                features["stance_positive_ratio"] = (stance > 0).mean()
                features["stance_negative_ratio"] = (stance < 0).mean()
                features["stance_neutral_ratio"] = (stance == 0).mean()
                features["mean_abs_stance"] = stance.abs().mean()
        
        # Author diversity
        if "author_id" in posts_df.columns:
            author_counts = posts_df["author_id"].value_counts()
            features["num_unique_authors"] = len(author_counts)
            
            # Herfindahl-Hirschman Index (concentration)
            if len(author_counts) > 0:
                shares = author_counts / author_counts.sum()
                features["author_hhi"] = (shares ** 2).sum()
                features["top_author_share"] = shares.iloc[0] if len(shares) > 0 else 0
        
        # Author quality
        if "log_followers" in posts_df.columns:
            features["mean_log_followers"] = posts_df["log_followers"].mean()
            features["max_log_followers"] = posts_df["log_followers"].max()
        
        if "author_verified" in posts_df.columns:
            features["verified_ratio"] = posts_df["author_verified"].mean()
        
        # Engagement
        for col in ["log_likes", "log_reposts", "log_replies", "log_quotes"]:
            if col in posts_df.columns:
                features[f"mean_{col}"] = posts_df[col].mean()
                features[f"max_{col}"] = posts_df[col].max()
        
        # Flags
        for col in ["is_sarcasm", "is_question", "is_rumor"]:
            if col in posts_df.columns:
                features[f"{col}_ratio"] = posts_df[col].mean()
        
        # Text features
        if "text_length" in posts_df.columns:
            features["mean_text_length"] = posts_df["text_length"].mean()
        
        for col in ["has_url", "has_hashtag", "has_mention", "has_numeric"]:
            if col in posts_df.columns:
                features[f"{col}_ratio"] = posts_df[col].mean()
        
        # Temporal features
        if "hours_before_resolution" in posts_df.columns:
            hbr = posts_df["hours_before_resolution"].dropna()
            if len(hbr) > 0:
                features["mean_hours_before_resolution"] = hbr.mean()
                features["min_hours_before_resolution"] = hbr.min()
                
                # Recent posts ratio (within last 24 hours)
                features["recent_posts_ratio"] = (hbr <= 24).mean()
        
        # Label distribution (if labeled)
        if "moved_toward_truth" in posts_df.columns:
            mtt = posts_df["moved_toward_truth"].dropna()
            if len(mtt) > 0:
                features["moved_toward_truth_ratio"] = mtt.mean()
    else:
        # No posts
        features["num_posts"] = 0
        features["posts_per_hour"] = 0
    
    return features


def prepare_post_features(post: dict) -> dict:
    """Compute features for a single post for per-post model."""
    features = {}
    
    # === Grok Scores ===
    features["relevance"] = post.get("relevance", 0)
    features["stance"] = post.get("stance", 0)
    features["strength"] = post.get("strength", 0)
    features["credibility"] = post.get("credibility", 0)
    features["confidence"] = post.get("confidence", 0)
    
    # Derived
    features["semantic_strength"] = post.get("semantic_strength", 0)
    features["abs_stance"] = abs(features["stance"])
    features["signed_signal"] = post.get("signed_signal", 0)
    
    # === Author Features ===
    features["log_followers"] = post.get("log_followers", 0)
    features["author_verified"] = int(post.get("author_verified", False))
    
    # === Engagement ===
    features["log_likes"] = post.get("log_likes", 0)
    features["log_reposts"] = post.get("log_reposts", 0)
    features["log_replies"] = post.get("log_replies", 0)
    features["log_quotes"] = post.get("log_quotes", 0)
    features["total_log_engagement"] = (
        features["log_likes"] + features["log_reposts"] + 
        features["log_replies"] + features["log_quotes"]
    )
    
    # === Text Features ===
    features["text_length"] = post.get("text_length", 0)
    features["has_url"] = int(post.get("has_url", False))
    features["has_hashtag"] = int(post.get("has_hashtag", False))
    features["has_mention"] = int(post.get("has_mention", False))
    features["has_numeric"] = int(post.get("has_numeric", False))
    
    # === Flags ===
    features["is_sarcasm"] = int(post.get("is_sarcasm", False))
    features["is_question"] = int(post.get("is_question", False))
    features["is_rumor"] = int(post.get("is_rumor", False))
    
    # === Timing ===
    features["hours_before_resolution"] = post.get("hours_before_resolution", 0)
    features["is_recent"] = int(features["hours_before_resolution"] <= 24)
    
    # === Interaction Features ===
    features["stance_x_followers"] = features["stance"] * features["log_followers"]
    features["strength_x_credibility"] = features["strength"] * features["credibility"]
    features["signal_x_followers"] = features["signed_signal"] * features["log_followers"]
    
    # === Probability Context ===
    features["prob_before"] = post.get("prob_before", 0.5)
    features["prob_uncertainty"] = 1 - abs(features["prob_before"] - 0.5) * 2  # Max at 0.5
    
    return features


def get_market_feature_names() -> list:
    """Get list of market-level feature names."""
    return [
        # Basic
        "K", "duration_hours", "duration_days",
        # Post stats
        "num_posts", "posts_per_hour",
        # Score aggregates
        "mean_relevance", "std_relevance", "max_relevance", "min_relevance",
        "mean_stance", "std_stance", "max_stance", "min_stance",
        "mean_strength", "std_strength", "max_strength", "min_strength",
        "mean_credibility", "std_credibility", "max_credibility", "min_credibility",
        "mean_semantic_strength", "std_semantic_strength", "max_semantic_strength",
        # Stance distribution
        "stance_positive_ratio", "stance_negative_ratio", "stance_neutral_ratio", "mean_abs_stance",
        # Author
        "num_unique_authors", "author_hhi", "top_author_share",
        "mean_log_followers", "max_log_followers", "verified_ratio",
        # Engagement
        "mean_log_likes", "max_log_likes",
        "mean_log_reposts", "max_log_reposts",
        # Flags
        "is_sarcasm_ratio", "is_question_ratio", "is_rumor_ratio",
        # Text
        "mean_text_length", "has_url_ratio", "has_hashtag_ratio",
        # Temporal
        "mean_hours_before_resolution", "min_hours_before_resolution", "recent_posts_ratio",
    ]


def get_post_feature_names() -> list:
    """Get list of post-level feature names."""
    return [
        # Grok scores
        "relevance", "stance", "strength", "credibility", "confidence",
        # Derived
        "semantic_strength", "abs_stance", "signed_signal",
        # Author
        "log_followers", "author_verified",
        # Engagement
        "log_likes", "log_reposts", "log_replies", "log_quotes", "total_log_engagement",
        # Text
        "text_length", "has_url", "has_hashtag", "has_mention", "has_numeric",
        # Flags
        "is_sarcasm", "is_question", "is_rumor",
        # Timing
        "hours_before_resolution", "is_recent",
        # Interactions
        "stance_x_followers", "strength_x_credibility", "signal_x_followers",
        # Context
        "prob_before", "prob_uncertainty",
    ]

