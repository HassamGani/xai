"""Train LightGBM model for post usefulness prediction."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score, accuracy_score, precision_recall_fscore_support
import joblib

from .config import config
from .db import get_supabase_client
from .features import prepare_post_features, get_post_feature_names


def load_post_training_data() -> pd.DataFrame:
    """Load post-level training data."""
    posts_path = config.data_dir / "training_posts.parquet"
    
    if not posts_path.exists():
        raise FileNotFoundError(f"No training data found at {posts_path}. Run ETL first.")
    
    df = pd.read_parquet(posts_path)
    
    # Filter to labeled posts only
    if "moved_toward_truth" not in df.columns:
        raise ValueError("Training data missing 'moved_toward_truth' labels")
    
    df = df.dropna(subset=["moved_toward_truth"])
    
    return df


def prepare_post_dataset(posts_df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Prepare post-level dataset for training."""
    # Compute features for each post
    features_list = []
    
    for _, row in posts_df.iterrows():
        features = prepare_post_features(row.to_dict())
        features_list.append(features)
    
    X = pd.DataFrame(features_list)
    y = posts_df["moved_toward_truth"].astype(int)
    groups = posts_df["market_id"]  # For grouped CV
    
    return X, y, groups


def train_post_usefulness_model(
    X: pd.DataFrame,
    y: pd.Series,
    groups: pd.Series,
    params: Optional[dict] = None,
    n_splits: int = 3
) -> Tuple[lgb.Booster, dict]:
    """Train LightGBM classifier with grouped cross-validation."""
    params = params or config.post_model_params.copy()
    
    # Group K-Fold (don't leak posts from same market across folds)
    gkf = GroupKFold(n_splits=n_splits)
    
    fold_metrics = []
    best_model = None
    best_auc = 0
    
    for fold, (train_idx, val_idx) in enumerate(gkf.split(X, y, groups)):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
        
        # Handle class imbalance
        pos_weight = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
        params_fold = params.copy()
        params_fold["scale_pos_weight"] = pos_weight
        
        train_data = lgb.Dataset(X_train, label=y_train)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)
        
        model = lgb.train(
            params_fold,
            train_data,
            num_boost_round=params.get("num_rounds", 2000),
            valid_sets=[train_data, val_data],
            valid_names=["train", "val"],
            callbacks=[
                lgb.early_stopping(50),
                lgb.log_evaluation(100),
            ],
        )
        
        # Evaluate
        y_pred_proba = model.predict(X_val)
        y_pred = (y_pred_proba > 0.5).astype(int)
        
        auc = roc_auc_score(y_val, y_pred_proba)
        acc = accuracy_score(y_val, y_pred)
        precision, recall, f1, _ = precision_recall_fscore_support(y_val, y_pred, average="binary")
        
        fold_metrics.append({
            "fold": fold,
            "auc": auc,
            "accuracy": acc,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "best_iteration": model.best_iteration,
        })
        
        if auc > best_auc:
            best_auc = auc
            best_model = model
    
    metrics = {
        "cv_folds": fold_metrics,
        "mean_auc": np.mean([f["auc"] for f in fold_metrics]),
        "std_auc": np.std([f["auc"] for f in fold_metrics]),
        "mean_accuracy": np.mean([f["accuracy"] for f in fold_metrics]),
        "mean_f1": np.mean([f["f1"] for f in fold_metrics]),
        "best_auc": best_auc,
    }
    
    return best_model, metrics


def get_feature_importances(model: lgb.Booster, feature_names: list) -> dict:
    """Extract feature importances."""
    importances = model.feature_importance(importance_type="gain")
    
    importance_dict = {}
    for name, imp in zip(feature_names, importances):
        importance_dict[name] = float(imp)
    
    return dict(sorted(importance_dict.items(), key=lambda x: x[1], reverse=True))


def save_model(
    model: lgb.Booster,
    version: str,
    metrics: dict,
    feature_importances: dict,
    hyperparameters: dict,
    train_size: int,
) -> str:
    """Save model and register."""
    model_id = str(uuid.uuid4())
    
    # Save model file
    model_dir = config.models_dir / "post_usefulness"
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"{version}.pkl"
    
    joblib.dump(model, model_path)
    print(f"Saved model to {model_path}")
    
    # Register in database
    try:
        client = get_supabase_client()
        client.table("model_registry").insert({
            "model_id": model_id,
            "name": "post_usefulness",
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
        print(f"Registered model: {model_id}")
    except Exception as e:
        print(f"Warning: Could not register model: {e}")
    
    return model_id


def train_and_save(version: Optional[str] = None) -> Optional[str]:
    """Full training pipeline for post usefulness model."""
    print("=== Training Post Usefulness Model ===")
    
    # Load data
    try:
        posts_df = load_post_training_data()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return None
    
    print(f"Loaded {len(posts_df)} labeled posts")
    
    # Check class distribution
    pos_ratio = posts_df["moved_toward_truth"].mean()
    print(f"Positive class ratio: {pos_ratio:.2%}")
    
    if len(posts_df) < 100:
        print("Not enough labeled posts for training")
        return None
    
    # Prepare dataset
    X, y, groups = prepare_post_dataset(posts_df)
    feature_names = get_post_feature_names()
    
    # Ensure X has the right columns
    for col in feature_names:
        if col not in X.columns:
            X[col] = 0
    X = X[feature_names].fillna(0)
    
    print(f"Features: {len(feature_names)}")
    print(f"Samples: {len(X)}")
    print(f"Unique markets: {groups.nunique()}")
    
    # Train
    model, metrics = train_post_usefulness_model(X, y, groups, config.post_model_params)
    
    # Get feature importances
    feature_importances = get_feature_importances(model, feature_names)
    print("\nTop 10 features:")
    for i, (feat, imp) in enumerate(list(feature_importances.items())[:10]):
        print(f"  {i+1}. {feat}: {imp:.2f}")
    
    # Generate version
    if not version:
        version = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save
    model_id = save_model(
        model=model,
        version=version,
        metrics=metrics,
        feature_importances=feature_importances,
        hyperparameters=config.post_model_params,
        train_size=len(X),
    )
    
    # Generate report
    report = {
        "model_id": model_id,
        "version": version,
        "trained_at": datetime.now().isoformat(),
        "train_size": len(X),
        "class_distribution": {
            "positive": int(y.sum()),
            "negative": int(len(y) - y.sum()),
        },
        "metrics": metrics,
        "top_features": dict(list(feature_importances.items())[:20]),
    }
    
    report_path = config.reports_dir / f"post_model_report_{version}.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to {report_path}")
    
    print("=== Training Complete ===")
    return model_id


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Train Post Usefulness Model")
    parser.add_argument("--version", type=str, help="Model version string")
    
    args = parser.parse_args()
    train_and_save(args.version)

