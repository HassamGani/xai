"""FastAPI server for ML model predictions."""

import os
from typing import Dict, List, Optional
from datetime import datetime
import numpy as np
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel, Field
import joblib

from .config import config
from .db import get_supabase_client
from .features import prepare_market_features, prepare_post_features, get_post_feature_names

app = FastAPI(
    title="XAI ML Service",
    description="ML feedback loop for X-Powered Prediction Markets",
    version="0.1.0",
)

# ============================================================================
# Request/Response Models
# ============================================================================

class PostFeatures(BaseModel):
    """Features for a single post."""
    relevance: float = 0.0
    stance: float = 0.0
    strength: float = 0.0
    credibility: float = 0.0
    confidence: float = 0.0
    log_followers: float = 0.0
    author_verified: bool = False


class MarketFeatures(BaseModel):
    """Market-level features."""
    K: int = 2
    duration_days: float = 0.0
    avg_posts_per_hour: float = 0.0
    topic: Optional[str] = None


class RecentSummary(BaseModel):
    """Summary of recent evidence."""
    Wbatch: float = 0.0
    last_hour_delta: float = 0.0
    top_post_features: List[PostFeatures] = []


class CorrectionRequest(BaseModel):
    """Request for probability correction."""
    market_id: str
    current_probabilities: Dict[str, float]
    market_features: MarketFeatures
    recent_summary: RecentSummary


class CorrectionResponse(BaseModel):
    """Response with corrected probabilities."""
    probabilities_corrected: Dict[str, float]
    model_version: str
    confidence: float
    explain: Dict[str, float] = {}  # Top feature importances


class MetaParamsRequest(BaseModel):
    """Request for meta-parameter suggestions."""
    market_id: str
    market_features: MarketFeatures


class MetaParamsResponse(BaseModel):
    """Response with suggested hyperparameters."""
    temperature: float = 1.0
    beta: float = 0.2
    W_min: float = 0.01
    model_version: str


class PostUsefulnessRequest(BaseModel):
    """Request for post usefulness prediction."""
    post_features: PostFeatures
    market_context: MarketFeatures
    prob_before: float = 0.5


class PostUsefulnessResponse(BaseModel):
    """Response with post usefulness prediction."""
    usefulness_score: float
    move_toward_truth_prob: float
    model_version: str


class TrainingStatus(BaseModel):
    """Status of training data and models."""
    resolved_markets: int
    training_posts: int
    models_available: List[dict]
    can_train_gbdt: bool
    can_train_nn: bool
    last_trained: Optional[str]


# ============================================================================
# Model Loading
# ============================================================================

_models = {}


def load_model(name: str, version: Optional[str] = None):
    """Load a model from disk or cache."""
    cache_key = f"{name}:{version or 'latest'}"
    
    if cache_key in _models:
        return _models[cache_key]
    
    # Find model path
    model_dir = config.models_dir / name
    
    if not model_dir.exists():
        return None
    
    # Get latest version if not specified
    if not version:
        model_files = list(model_dir.glob("*.pkl"))
        if not model_files:
            return None
        model_path = max(model_files, key=lambda p: p.stat().st_mtime)
        version = model_path.stem
    else:
        model_path = model_dir / f"{version}.pkl"
    
    if not model_path.exists():
        return None
    
    model = joblib.load(model_path)
    _models[cache_key] = {"model": model, "version": version}
    
    return _models[cache_key]


def get_deployed_model(name: str) -> Optional[dict]:
    """Get the currently deployed model from registry."""
    try:
        client = get_supabase_client()
        result = client.table("model_registry")\
            .select("*")\
            .eq("name", name)\
            .eq("deployed", True)\
            .order("created_at", desc=True)\
            .limit(1)\
            .execute()
        
        if result.data:
            model_info = result.data[0]
            model_path = model_info.get("path")
            if model_path and os.path.exists(model_path):
                return {
                    "model": joblib.load(model_path),
                    "version": model_info["version"],
                    "model_id": model_info["model_id"],
                }
    except Exception as e:
        print(f"Error loading deployed model: {e}")
    
    return None


# ============================================================================
# Auth
# ============================================================================

async def verify_internal_secret(x_internal_secret: str = Header(None)):
    """Verify internal API secret."""
    if config.internal_secret and x_internal_secret != config.internal_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
    return True


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/healthz")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/status", response_model=TrainingStatus)
async def get_status():
    """Get training status and available models."""
    try:
        client = get_supabase_client()
        
        # Count resolved markets
        markets_result = client.table("markets")\
            .select("id", count="exact")\
            .eq("status", "resolved")\
            .execute()
        resolved_markets = markets_result.count or 0
        
        # Count training posts
        posts_result = client.table("training_posts")\
            .select("id", count="exact")\
            .execute()
        training_posts = posts_result.count or 0
        
        # Get models
        models_result = client.table("model_registry")\
            .select("name, version, type, deployed, metrics, created_at")\
            .order("created_at", desc=True)\
            .limit(10)\
            .execute()
        models = models_result.data or []
        
        # Find last trained
        last_trained = None
        if models:
            last_trained = models[0].get("created_at")
        
        return TrainingStatus(
            resolved_markets=resolved_markets,
            training_posts=training_posts,
            models_available=models,
            can_train_gbdt=resolved_markets >= config.min_resolved_markets_gbdt,
            can_train_nn=resolved_markets >= config.min_resolved_markets_nn,
            last_trained=last_trained,
        )
    except Exception as e:
        return TrainingStatus(
            resolved_markets=0,
            training_posts=0,
            models_available=[],
            can_train_gbdt=False,
            can_train_nn=False,
            last_trained=None,
        )


@app.post("/v1/predict/correction", response_model=CorrectionResponse)
async def predict_correction(
    request: CorrectionRequest,
    _: bool = Depends(verify_internal_secret)
):
    """Predict probability corrections using ML model."""
    # Try to load deployed model
    model_info = get_deployed_model("gbdt_correction") or load_model("gbdt_correction")
    
    if not model_info:
        # No model available - return original probabilities
        return CorrectionResponse(
            probabilities_corrected=request.current_probabilities,
            model_version="none",
            confidence=0.0,
            explain={"message": "No model available yet"},
        )
    
    model = model_info["model"]
    version = model_info["version"]
    
    try:
        # Prepare features from request
        features = {
            "K": request.market_features.K,
            "duration_days": request.market_features.duration_days,
            "posts_per_hour": request.market_features.avg_posts_per_hour,
            "Wbatch": request.recent_summary.Wbatch,
            "last_hour_delta": request.recent_summary.last_hour_delta,
        }
        
        # Add aggregated post features
        if request.recent_summary.top_post_features:
            posts = request.recent_summary.top_post_features
            features["mean_relevance"] = np.mean([p.relevance for p in posts])
            features["mean_strength"] = np.mean([p.strength for p in posts])
            features["mean_credibility"] = np.mean([p.credibility for p in posts])
            features["mean_stance"] = np.mean([p.stance for p in posts])
        
        # Predict correction
        import pandas as pd
        X = pd.DataFrame([features]).fillna(0)
        
        # Ensure all expected columns exist
        for col in model.feature_name():
            if col not in X.columns:
                X[col] = 0
        X = X[model.feature_name()]
        
        correction = model.predict(X)[0]
        
        # Apply correction in logit space
        corrected = {}
        for outcome, prob in request.current_probabilities.items():
            # Clip to avoid log(0)
            prob = max(0.01, min(0.99, prob))
            logit = np.log(prob / (1 - prob))
            corrected_logit = logit + correction
            corrected[outcome] = 1 / (1 + np.exp(-corrected_logit))
        
        # Normalize
        total = sum(corrected.values())
        corrected = {k: v / total for k, v in corrected.items()}
        
        # Get feature importances for explanation
        importances = model.feature_importance(importance_type="gain")
        feature_names = model.feature_name()
        explain = dict(sorted(
            zip(feature_names, importances),
            key=lambda x: x[1],
            reverse=True
        )[:5])
        
        return CorrectionResponse(
            probabilities_corrected=corrected,
            model_version=version,
            confidence=0.8,  # TODO: compute actual confidence
            explain=explain,
        )
    except Exception as e:
        print(f"Prediction error: {e}")
        return CorrectionResponse(
            probabilities_corrected=request.current_probabilities,
            model_version=version,
            confidence=0.0,
            explain={"error": str(e)},
        )


@app.post("/v1/predict/meta", response_model=MetaParamsResponse)
async def predict_meta_params(
    request: MetaParamsRequest,
    _: bool = Depends(verify_internal_secret)
):
    """Predict optimal hyperparameters for a market."""
    # For now, return defaults
    # TODO: Train a meta-model that learns optimal params per market type
    
    return MetaParamsResponse(
        temperature=1.0,
        beta=0.2,
        W_min=0.01,
        model_version="default",
    )


@app.post("/v1/predict/post_usefulness", response_model=PostUsefulnessResponse)
async def predict_post_usefulness(
    request: PostUsefulnessRequest,
    _: bool = Depends(verify_internal_secret)
):
    """Predict whether a post will move probability toward truth."""
    model_info = get_deployed_model("post_usefulness") or load_model("post_usefulness")
    
    if not model_info:
        # Default: use semantic strength as proxy
        semantic = request.post_features.relevance * request.post_features.strength * request.post_features.credibility
        return PostUsefulnessResponse(
            usefulness_score=semantic,
            move_toward_truth_prob=0.5,
            model_version="heuristic",
        )
    
    model = model_info["model"]
    version = model_info["version"]
    
    try:
        # Prepare features
        features = prepare_post_features({
            "relevance": request.post_features.relevance,
            "stance": request.post_features.stance,
            "strength": request.post_features.strength,
            "credibility": request.post_features.credibility,
            "confidence": request.post_features.confidence,
            "log_followers": request.post_features.log_followers,
            "author_verified": request.post_features.author_verified,
            "prob_before": request.prob_before,
        })
        
        import pandas as pd
        feature_names = get_post_feature_names()
        X = pd.DataFrame([features])[feature_names].fillna(0)
        
        # Predict
        prob = model.predict(X)[0]
        
        return PostUsefulnessResponse(
            usefulness_score=prob,
            move_toward_truth_prob=prob,
            model_version=version,
        )
    except Exception as e:
        print(f"Post usefulness prediction error: {e}")
        return PostUsefulnessResponse(
            usefulness_score=0.5,
            move_toward_truth_prob=0.5,
            model_version=version,
        )


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.api_host, port=config.api_port)

