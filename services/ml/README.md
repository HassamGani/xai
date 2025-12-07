# ML Feedback Loop Service

Machine learning system that learns from resolved prediction markets to improve probability estimates over time.

## Overview

This service implements a feedback loop where:

1. **Data Collection**: As markets resolve, we capture the ground truth (which outcome actually happened)
2. **Feature Engineering**: Extract features from posts, markets, and probability time series
3. **Model Training**: Train models to predict probability corrections and post usefulness
4. **Model Serving**: FastAPI service provides predictions to the main application
5. **Continuous Improvement**: Retrain models as more markets resolve

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ML Feedback Loop                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                   │
│  │ Resolved │───►│   ETL    │───►│ Training │                   │
│  │ Markets  │    │ Pipeline │    │   Data   │                   │
│  └──────────┘    └──────────┘    └──────────┘                   │
│                                        │                         │
│                                        ▼                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                   │
│  │  Model   │◄───│ Training │◄───│  GBDT/   │                   │
│  │ Registry │    │ Scripts  │    │   NN     │                   │
│  └──────────┘    └──────────┘    └──────────┘                   │
│        │                                                         │
│        ▼                                                         │
│  ┌──────────────────────────────────────────┐                   │
│  │           FastAPI Server                  │                   │
│  │  POST /v1/predict/correction             │                   │
│  │  POST /v1/predict/post_usefulness        │                   │
│  │  POST /v1/predict/meta                   │                   │
│  └──────────────────────────────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Setup

### Prerequisites

- Python 3.10+
- pip or poetry

### Installation

```bash
cd services/ml

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env
# Edit .env with your credentials
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for DB access | Yes |
| `ML_API_HOST` | API host (default: 0.0.0.0) | No |
| `ML_API_PORT` | API port (default: 8000) | No |
| `INTERNAL_ML_SECRET` | Secret for internal API auth | Recommended |

## Usage

### Running the API Server

```bash
# Development
uvicorn src.app:app --reload --host 0.0.0.0 --port 8000

# Production
uvicorn src.app:app --host 0.0.0.0 --port 8000 --workers 4
```

### Exporting Training Data

```bash
python -m src.etl --export
```

This creates:
- `data/resolved_markets.parquet` - Market-level training data
- `data/training_posts.parquet` - Post-level training data with labels

### Training Models

```bash
# Train GBDT correction model (needs 50+ resolved markets)
python -m src.train_gbdt

# Train post usefulness model (needs labeled posts)
python -m src.train_post_model

# Or run the full pipeline
./scripts/retrain.sh
```

### API Endpoints

#### `GET /healthz`
Health check endpoint.

#### `GET /status`
Get training status, available models, and data counts.

#### `POST /v1/predict/correction`
Get probability corrections from ML model.

```json
{
  "market_id": "uuid",
  "current_probabilities": {"yes": 0.45, "no": 0.55},
  "market_features": {
    "K": 2,
    "duration_days": 15,
    "avg_posts_per_hour": 12
  },
  "recent_summary": {
    "Wbatch": 0.18,
    "last_hour_delta": 0.01,
    "top_post_features": [
      {"relevance": 0.95, "stance": 0.8, "strength": 0.6, "credibility": 0.5}
    ]
  }
}
```

#### `POST /v1/predict/post_usefulness`
Predict whether a post will move probability toward truth.

```json
{
  "post_features": {
    "relevance": 0.95,
    "stance": 0.8,
    "strength": 0.6,
    "credibility": 0.5,
    "confidence": 0.85,
    "log_followers": 10.5,
    "author_verified": true
  },
  "market_context": {
    "K": 2,
    "duration_days": 15
  },
  "prob_before": 0.45
}
```

## Models

### GBDT Correction Model (`gbdt_correction`)

- **Purpose**: Correct probability estimates based on market-level patterns
- **Algorithm**: LightGBM regression
- **Input**: Market features, recent evidence summary
- **Output**: Logit-space correction factor
- **Minimum data**: 50 resolved markets

### Post Usefulness Model (`post_usefulness`)

- **Purpose**: Predict if a post will move probability toward truth
- **Algorithm**: LightGBM binary classifier
- **Input**: Post features, market context
- **Output**: Probability of usefulness (0-1)
- **Minimum data**: 100 labeled posts

## Database Tables

The ML system uses these tables (created by migration):

- `resolved_markets` - Snapshot of resolved market data
- `training_posts` - Flattened post features with labels
- `model_registry` - Model versions and metadata
- `ml_predictions` - Prediction logs for monitoring
- `ml_training_runs` - Training job history

## Retraining

### Manual Retraining

```bash
./scripts/retrain.sh
```

### Automated Retraining

Add to cron or GitHub Actions:

```bash
# Weekly retraining
0 0 * * 0 cd /path/to/services/ml && ./scripts/retrain.sh
```

### Retraining Triggers

- **Scheduled**: Weekly (recommended)
- **Threshold**: When 30+ new markets resolve since last training
- **Manual**: Via script or CI/CD

## Development

### Running Tests

```bash
pytest tests/
```

### Code Quality

```bash
# Format
black src/

# Lint
ruff check src/

# Type check
mypy src/
```

## Docker

```bash
# Build
docker build -t xai-ml .

# Run
docker run -p 8000:8000 --env-file .env xai-ml
```

## Monitoring

The service exposes:
- `/healthz` - Health check
- `/status` - Training status and model info

Metrics to monitor:
- Brier score improvement over time
- Model prediction latency
- Training frequency
- Resolved markets count

## Troubleshooting

### "Not enough resolved markets"

Models require minimum data to train:
- GBDT: 50 resolved markets
- NN: 300 resolved markets

Wait for more markets to resolve, or use `--force` for testing.

### "No model available"

Either:
1. No models have been trained yet
2. Models haven't been approved/deployed

Check `/status` endpoint or `model_registry` table.

### Database connection errors

Verify:
1. `SUPABASE_URL` is correct
2. `SUPABASE_SERVICE_ROLE_KEY` is valid
3. Network access to Supabase

