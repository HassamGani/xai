"""Configuration for ML service."""

import os
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()


class Config(BaseModel):
    """ML Service Configuration."""
    
    # Supabase
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    
    # Paths
    base_dir: Path = Path(__file__).parent.parent
    data_dir: Path = base_dir / "data"
    models_dir: Path = base_dir / "models"
    reports_dir: Path = base_dir / "reports"
    
    # Training thresholds
    min_resolved_markets_gbdt: int = 50
    min_resolved_markets_nn: int = 300
    retrain_trigger_new_markets: int = 30
    
    # Model hyperparameters (defaults)
    gbdt_params: dict = {
        "num_rounds": 3000,
        "learning_rate": 0.03,
        "max_depth": 8,
        "num_leaves": 64,
        "early_stopping_rounds": 50,
        "objective": "regression",
        "metric": "rmse",
        "verbose": -1,
    }
    
    post_model_params: dict = {
        "num_rounds": 2000,
        "learning_rate": 0.05,
        "max_depth": 6,
        "objective": "binary",
        "metric": "auc",
        "verbose": -1,
    }
    
    # Feature configuration
    relevance_threshold: float = 0.3
    
    # API
    api_host: str = os.getenv("ML_API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("ML_API_PORT", "8000"))
    internal_secret: str = os.getenv("INTERNAL_ML_SECRET", "")
    
    class Config:
        arbitrary_types_allowed = True


config = Config()

# Ensure directories exist
config.data_dir.mkdir(parents=True, exist_ok=True)
config.models_dir.mkdir(parents=True, exist_ok=True)
config.reports_dir.mkdir(parents=True, exist_ok=True)

