"""Train LightGBM model for probability correction."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_squared_error
import joblib

from .config import config
from .db import get_supabase_client
from .features import prepare_market_features


def load_training_data() -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Load training data from parquet files."""
    markets_path = config.data_dir / "resolved_markets.parquet"
    posts_path = config.data_dir / "training_posts.parquet"
    
    if not markets_path.exists():
        raise FileNotFoundError(f"No training data found at {markets_path}. Run ETL first.")
    
    markets_df = pd.read_parquet(markets_path)
    
    posts_df = pd.DataFrame()
    if posts_path.exists():
        posts_df = pd.read_parquet(posts_path)
    
    return markets_df, posts_df


def prepare_market_level_dataset(markets_df: pd.DataFrame, posts_df: pd.DataFrame) -> pd.DataFrame:
    """Prepare market-level training dataset."""
    features_list = []
    
    for _, market in markets_df.iterrows():
        market_id = market["id"]
        
        # Get posts for this market
        market_posts = posts_df[posts_df["market_id"] == market_id] if not posts_df.empty else pd.DataFrame()
        
        # Compute features
        features = prepare_market_features(market.to_dict(), market_posts)
        
        # Add target: final probability error
        # For binary markets: target is difference between final prob and actual outcome (0 or 1)
        winning_outcome = market.get("resolved_outcome_id")
        final_probs = market.get("final_probabilities", {})
        if isinstance(final_probs, str):
            final_probs = json.loads(final_probs)
        
        if winning_outcome and final_probs:
            final_prob = final_probs.get(winning_outcome, 0.5)
            # Error: how far was prediction from 1.0 (correct answer)
            features["target_error"] = 1.0 - final_prob
            # Brier contribution for this market
            features["brier"] = (1.0 - final_prob) ** 2
        else:
            features["target_error"] = 0.0
            features["brier"] = 0.0
        
        features["market_id"] = market_id
        features["resolved_at"] = market.get("resolved_at")
        
        features_list.append(features)
    
    return pd.DataFrame(features_list)


def train_correction_model(
    X: pd.DataFrame,
    y: pd.Series,
    params: Optional[dict] = None,
    n_splits: int = 3
) -> Tuple[lgb.Booster, dict]:
    """Train LightGBM model with time-series cross-validation."""
    params = params or config.gbdt_params.copy()
    
    # Time series CV
    tscv = TimeSeriesSplit(n_splits=n_splits)
    
    fold_metrics = []
    best_model = None
    best_score = float("inf")
    
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
        
        train_data = lgb.Dataset(X_train, label=y_train)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)
        
        model = lgb.train(
            params,
            train_data,
            num_boost_round=params.get("num_rounds", 3000),
            valid_sets=[train_data, val_data],
            valid_names=["train", "val"],
            callbacks=[
                lgb.early_stopping(params.get("early_stopping_rounds", 50)),
                lgb.log_evaluation(100),
            ],
        )
        
        # Evaluate
        y_pred = model.predict(X_val)
        rmse = np.sqrt(mean_squared_error(y_val, y_pred))
        
        fold_metrics.append({
            "fold": fold,
            "rmse": rmse,
            "best_iteration": model.best_iteration,
        })
        
        if rmse < best_score:
            best_score = rmse
            best_model = model
    
    metrics = {
        "cv_folds": fold_metrics,
        "mean_rmse": np.mean([f["rmse"] for f in fold_metrics]),
        "std_rmse": np.std([f["rmse"] for f in fold_metrics]),
        "best_rmse": best_score,
    }
    
    return best_model, metrics


def get_feature_importances(model: lgb.Booster, feature_names: list) -> dict:
    """Extract feature importances from model."""
    importances = model.feature_importance(importance_type="gain")
    
    importance_dict = {}
    for name, imp in zip(feature_names, importances):
        importance_dict[name] = float(imp)
    
    # Sort by importance
    sorted_importances = dict(sorted(importance_dict.items(), key=lambda x: x[1], reverse=True))
    
    return sorted_importances


def save_model(
    model: lgb.Booster,
    name: str,
    version: str,
    metrics: dict,
    feature_importances: dict,
    hyperparameters: dict,
    train_size: int,
) -> str:
    """Save model and register in database."""
    model_id = str(uuid.uuid4())
    
    # Save model file
    model_dir = config.models_dir / name
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"{version}.pkl"
    
    joblib.dump(model, model_path)
    print(f"Saved model to {model_path}")
    
    # Register in database
    try:
        client = get_supabase_client()
        client.table("model_registry").insert({
            "model_id": model_id,
            "name": name,
            "version": version,
            "type": "gbdt",
            "path": str(model_path),
            "train_size": train_size,
            "metrics": metrics,
            "feature_importances": feature_importances,
            "hyperparameters": hyperparameters,
            "approved": False,
            "deployed": False,
        }).execute()
        print(f"Registered model in database: {model_id}")
    except Exception as e:
        print(f"Warning: Could not register model in database: {e}")
    
    return model_id


def train_and_save(version: Optional[str] = None) -> Optional[str]:
    """Full training pipeline."""
    print("=== Training Probability Correction Model (GBDT) ===")
    
    # Load data
    try:
        markets_df, posts_df = load_training_data()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Run ETL first: python -m src.etl --export")
        return None
    
    if len(markets_df) < config.min_resolved_markets_gbdt:
        print(f"Not enough resolved markets ({len(markets_df)} < {config.min_resolved_markets_gbdt})")
        print("Waiting for more data before training...")
        return None
    
    print(f"Training with {len(markets_df)} resolved markets")
    
    # Prepare dataset
    dataset = prepare_market_level_dataset(markets_df, posts_df)
    
    # Sort by resolution time for proper time-series CV
    if "resolved_at" in dataset.columns:
        dataset = dataset.sort_values("resolved_at")
    
    # Define features and target
    feature_cols = [
        col for col in dataset.columns 
        if col not in ["market_id", "resolved_at", "target_error", "brier"]
    ]
    
    X = dataset[feature_cols].fillna(0)
    y = dataset["target_error"]
    
    print(f"Features: {len(feature_cols)}")
    print(f"Samples: {len(X)}")
    
    # Train
    model, metrics = train_correction_model(X, y, config.gbdt_params)
    
    # Get feature importances
    feature_importances = get_feature_importances(model, feature_cols)
    print("\nTop 10 features:")
    for i, (feat, imp) in enumerate(list(feature_importances.items())[:10]):
        print(f"  {i+1}. {feat}: {imp:.2f}")
    
    # Generate version if not provided
    if not version:
        version = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save
    model_id = save_model(
        model=model,
        name="gbdt_correction",
        version=version,
        metrics=metrics,
        feature_importances=feature_importances,
        hyperparameters=config.gbdt_params,
        train_size=len(X),
    )
    
    # Generate report
    report = {
        "model_id": model_id,
        "version": version,
        "trained_at": datetime.now().isoformat(),
        "train_size": len(X),
        "metrics": metrics,
        "top_features": dict(list(feature_importances.items())[:20]),
    }
    
    report_path = config.reports_dir / f"gbdt_report_{version}.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to {report_path}")
    
    print("=== Training Complete ===")
    return model_id


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Train GBDT Correction Model")
    parser.add_argument("--version", type=str, help="Model version string")
    
    args = parser.parse_args()
    train_and_save(args.version)

