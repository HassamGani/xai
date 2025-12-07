#!/bin/bash
# Retraining script for ML models
# Usage: ./scripts/retrain.sh [--force]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== ML Model Retraining Pipeline ==="
echo "Started at: $(date)"
echo ""

# Check for force flag
FORCE=false
if [[ "$1" == "--force" ]]; then
    FORCE=true
    echo "Force mode: will retrain even if not enough data"
fi

# Step 1: Export training data
echo "Step 1: Exporting training data..."
python -m src.etl --export

# Check if we have enough data
MARKETS_COUNT=$(python -c "import pandas as pd; df = pd.read_parquet('data/resolved_markets.parquet'); print(len(df))" 2>/dev/null || echo "0")

echo "Resolved markets: $MARKETS_COUNT"

if [[ "$MARKETS_COUNT" -lt 50 && "$FORCE" != "true" ]]; then
    echo ""
    echo "Not enough resolved markets for training (need 50, have $MARKETS_COUNT)"
    echo "Use --force to train anyway"
    exit 0
fi

# Step 2: Train GBDT correction model
echo ""
echo "Step 2: Training GBDT correction model..."
python -m src.train_gbdt --version "$(date +%Y%m%d_%H%M%S)"

# Step 3: Train post usefulness model
echo ""
echo "Step 3: Training post usefulness model..."
python -m src.train_post_model --version "$(date +%Y%m%d_%H%M%S)"

# Step 4: Generate summary report
echo ""
echo "Step 4: Generating summary report..."

REPORT_FILE="reports/retrain_summary_$(date +%Y%m%d_%H%M%S).json"
cat > "$REPORT_FILE" << EOF
{
    "timestamp": "$(date -Iseconds)",
    "markets_trained_on": $MARKETS_COUNT,
    "models_trained": ["gbdt_correction", "post_usefulness"],
    "status": "completed"
}
EOF

echo "Summary saved to: $REPORT_FILE"
echo ""
echo "=== Retraining Complete ==="
echo "Finished at: $(date)"

