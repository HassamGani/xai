-- ML Feedback Loop Tables
-- These tables support the machine learning system that learns from resolved markets
-- to improve probability predictions over time.

-- ============================================================================
-- 1. Add resolution fields to markets table (if not already present)
-- ============================================================================
DO $$ 
BEGIN
    -- Add resolved_at if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'markets' AND column_name = 'resolved_at') THEN
        ALTER TABLE markets ADD COLUMN resolved_at TIMESTAMP NULL;
    END IF;
    
    -- Add resolved_outcome_id if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'markets' AND column_name = 'resolved_outcome_id') THEN
        ALTER TABLE markets ADD COLUMN resolved_outcome_id TEXT NULL;
    END IF;
    
    -- Add resolution_confidence if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'markets' AND column_name = 'resolution_confidence') THEN
        ALTER TABLE markets ADD COLUMN resolution_confidence FLOAT NULL;
    END IF;
    
    -- Add resolution_summary if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'markets' AND column_name = 'resolution_summary') THEN
        ALTER TABLE markets ADD COLUMN resolution_summary TEXT NULL;
    END IF;
    
    -- Add resolution_source if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'markets' AND column_name = 'resolution_source') THEN
        ALTER TABLE markets ADD COLUMN resolution_source TEXT NULL;
    END IF;
    
    -- Add resolved_by (method used for resolution) if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'markets' AND column_name = 'resolved_by') THEN
        ALTER TABLE markets ADD COLUMN resolved_by TEXT NULL;
    END IF;
    
    -- Add stream_active flag if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'markets' AND column_name = 'stream_active') THEN
        ALTER TABLE markets ADD COLUMN stream_active BOOLEAN DEFAULT false;
    END IF;
END $$;

-- ============================================================================
-- 2. Create resolved_markets table (materialized snapshot for ML training)
-- ============================================================================
CREATE TABLE IF NOT EXISTS resolved_markets (
    id UUID PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    normalized_question TEXT,
    resolution_time TIMESTAMP NOT NULL,
    winning_outcome_id TEXT NOT NULL,
    winning_outcome_label TEXT,
    
    -- Aggregate statistics
    num_posts INTEGER DEFAULT 0,
    num_scored_posts INTEGER DEFAULT 0,
    num_unique_authors INTEGER DEFAULT 0,
    duration_hours FLOAT,
    
    -- Time series summary (compressed for training)
    -- Format: [{ timestamp, probabilities: { outcome_id: prob } }, ...]
    time_series_summary JSONB,
    
    -- Market-level features for ML
    -- { K, duration_days, avg_posts_per_hour, topic_category, initial_entropy, 
    --   final_entropy, volatility, author_concentration, ... }
    features JSONB,
    
    -- Final predictions vs ground truth
    final_probabilities JSONB,  -- { outcome_id: final_prob }
    brier_score FLOAT,          -- Computed: Σ(pred - actual)²
    log_loss FLOAT,             -- Computed: -Σ actual*log(pred)
    
    -- Metadata
    created_at TIMESTAMP DEFAULT now(),
    
    CONSTRAINT valid_brier CHECK (brier_score >= 0 AND brier_score <= 2)
);

-- Index for time-range queries during training
CREATE INDEX IF NOT EXISTS idx_resolved_markets_resolution_time 
ON resolved_markets(resolution_time);

-- ============================================================================
-- 3. Create training_posts table (flattened post features for ML)
-- ============================================================================
CREATE TABLE IF NOT EXISTS training_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- References
    scored_post_id UUID REFERENCES scored_posts(id) ON DELETE CASCADE,
    raw_post_id UUID REFERENCES raw_posts(id) ON DELETE CASCADE,
    market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
    outcome_id TEXT NOT NULL,
    
    -- Timing
    post_created_at TIMESTAMP,
    scored_at TIMESTAMP,
    hours_before_resolution FLOAT,
    
    -- Grok scores (denormalized for fast access)
    relevance FLOAT,
    stance FLOAT,
    strength FLOAT,
    credibility FLOAT,
    confidence FLOAT,
    
    -- Computed signal features
    semantic_strength FLOAT,      -- relevance * strength * credibility
    abs_stance FLOAT,             -- |stance|
    signed_signal FLOAT,          -- stance * semantic_strength
    
    -- Author features
    author_id TEXT,
    author_followers INTEGER,
    author_verified BOOLEAN,
    author_account_age_days INTEGER,
    author_posts_in_market INTEGER,  -- Count of posts by this author in this market (dilution)
    
    -- Engagement features (at ingest time)
    likes INTEGER DEFAULT 0,
    reposts INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    quotes INTEGER DEFAULT 0,
    
    -- Text features
    text_length INTEGER,
    cashtag_count INTEGER DEFAULT 0,
    url_count INTEGER DEFAULT 0,
    mention_count INTEGER DEFAULT 0,
    hashtag_count INTEGER DEFAULT 0,
    has_numeric BOOLEAN DEFAULT false,
    caps_ratio FLOAT DEFAULT 0,
    
    -- Flags from Grok
    is_sarcasm BOOLEAN DEFAULT false,
    is_question BOOLEAN DEFAULT false,
    is_rumor BOOLEAN DEFAULT false,
    
    -- Probability state (for computing moved_toward_truth)
    prob_before FLOAT,            -- P(winning_outcome) before this post
    prob_after FLOAT,             -- P(winning_outcome) after this post
    delta_prob FLOAT,             -- prob_after - prob_before
    
    -- Training label (computed after market resolution)
    moved_toward_truth BOOLEAN,   -- TRUE if post moved prob toward correct answer
    
    -- Optional: text embedding vector (stored as JSON array or reference to vector store)
    text_embedding JSONB,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT now(),
    
    CONSTRAINT valid_relevance CHECK (relevance >= 0 AND relevance <= 1),
    CONSTRAINT valid_stance CHECK (stance >= -1 AND stance <= 1),
    CONSTRAINT valid_strength CHECK (strength >= 0 AND strength <= 1),
    CONSTRAINT valid_credibility CHECK (credibility >= 0 AND credibility <= 1)
);

-- Indexes for training queries
CREATE INDEX IF NOT EXISTS idx_training_posts_market ON training_posts(market_id);
CREATE INDEX IF NOT EXISTS idx_training_posts_moved ON training_posts(moved_toward_truth);
CREATE INDEX IF NOT EXISTS idx_training_posts_scored_at ON training_posts(scored_at);

-- ============================================================================
-- 4. Create model_registry table (track ML model versions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS model_registry (
    model_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Model identification
    name TEXT NOT NULL,           -- e.g., "gbdt_correction", "post_usefulness", "calibrator"
    version TEXT NOT NULL,        -- Semantic version e.g., "1.0.0"
    type TEXT NOT NULL,           -- "gbdt", "nn", "calibrator", "meta"
    
    -- Storage
    path TEXT,                    -- S3/storage path to model artifact
    checksum TEXT,                -- SHA256 of model file
    
    -- Training metadata
    trained_at TIMESTAMP DEFAULT now(),
    trained_on_start TIMESTAMP,   -- Start of training data range
    trained_on_end TIMESTAMP,     -- End of training data range
    train_size INTEGER,           -- Number of training examples
    
    -- Evaluation metrics
    metrics JSONB,                -- { brier, log_loss, auc, calibration_error, ... }
    feature_importances JSONB,    -- Top features and their importances
    
    -- Hyperparameters used
    hyperparameters JSONB,
    
    -- Deployment status
    approved BOOLEAN DEFAULT false,
    approved_by TEXT,
    approved_at TIMESTAMP,
    deployed BOOLEAN DEFAULT false,
    deployed_at TIMESTAMP,
    
    -- A/B test results
    ab_test_results JSONB,        -- { sample_size, brier_improvement, p_value }
    
    -- Notes and changelog
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT now(),
    
    UNIQUE(name, version)
);

-- Index for finding deployed models
CREATE INDEX IF NOT EXISTS idx_model_registry_deployed 
ON model_registry(name, deployed) WHERE deployed = true;

-- ============================================================================
-- 5. Create ml_predictions table (log predictions for monitoring)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ml_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
    model_id UUID REFERENCES model_registry(model_id),
    
    -- What we predicted
    prediction_type TEXT NOT NULL,  -- "correction", "meta_params", "post_usefulness"
    input_features JSONB,
    
    -- Correction predictions
    original_probabilities JSONB,
    corrected_probabilities JSONB,
    
    -- Meta predictions
    suggested_params JSONB,         -- { temperature, beta, W_min }
    
    -- Explainability
    top_features JSONB,             -- Top 5 features that drove prediction
    confidence FLOAT,
    
    -- Outcome tracking (filled after resolution)
    actual_outcome TEXT,
    was_improvement BOOLEAN,        -- Did ML correction improve Brier?
    
    predicted_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_predictions_market ON ml_predictions(market_id);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_model ON ml_predictions(model_id);

-- ============================================================================
-- 6. Create ml_training_runs table (track training jobs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ml_training_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- What was trained
    model_name TEXT NOT NULL,
    
    -- Training parameters
    train_start TIMESTAMP,
    train_end TIMESTAMP,
    num_markets INTEGER,
    num_posts INTEGER,
    
    -- Status
    status TEXT DEFAULT 'running',  -- running, completed, failed
    started_at TIMESTAMP DEFAULT now(),
    completed_at TIMESTAMP,
    
    -- Results
    best_model_id UUID REFERENCES model_registry(model_id),
    metrics JSONB,
    logs TEXT,
    error_message TEXT,
    
    -- Trigger info
    triggered_by TEXT,              -- "scheduled", "manual", "drift_detected"
    
    created_at TIMESTAMP DEFAULT now()
);

-- ============================================================================
-- 7. RLS Policies (if RLS is enabled)
-- ============================================================================
-- These tables are internal/ML only - no public access

ALTER TABLE resolved_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_training_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for workers)
CREATE POLICY "Service role full access on resolved_markets" ON resolved_markets
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on training_posts" ON training_posts
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on model_registry" ON model_registry
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on ml_predictions" ON ml_predictions
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on ml_training_runs" ON ml_training_runs
    FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 8. Helper function to populate training_posts after market resolution
-- ============================================================================
CREATE OR REPLACE FUNCTION populate_training_posts_for_market(p_market_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_winning_outcome_id TEXT;
    v_resolution_time TIMESTAMP;
    v_count INTEGER := 0;
BEGIN
    -- Get winning outcome
    SELECT resolved_outcome_id, resolved_at 
    INTO v_winning_outcome_id, v_resolution_time
    FROM markets 
    WHERE id = p_market_id AND status = 'resolved';
    
    IF v_winning_outcome_id IS NULL THEN
        RAISE EXCEPTION 'Market % is not resolved', p_market_id;
    END IF;
    
    -- Insert training posts
    INSERT INTO training_posts (
        scored_post_id, raw_post_id, market_id, outcome_id,
        post_created_at, scored_at, hours_before_resolution,
        relevance, stance, strength, credibility, confidence,
        semantic_strength, abs_stance, signed_signal,
        author_id, author_followers, author_verified,
        likes, reposts, replies, quotes,
        text_length, is_sarcasm, is_question, is_rumor,
        prob_before, prob_after, delta_prob, moved_toward_truth
    )
    SELECT 
        sp.id,
        sp.raw_post_id,
        sp.market_id,
        sp.outcome_id,
        rp.post_created_at,
        sp.scored_at,
        EXTRACT(EPOCH FROM (v_resolution_time - sp.scored_at)) / 3600.0,
        (sp.scores->>'relevance')::FLOAT,
        (sp.scores->>'stance')::FLOAT,
        (sp.scores->>'strength')::FLOAT,
        (sp.scores->>'credibility')::FLOAT,
        (sp.scores->>'confidence')::FLOAT,
        (sp.scores->>'relevance')::FLOAT * (sp.scores->>'strength')::FLOAT * (sp.scores->>'credibility')::FLOAT,
        ABS((sp.scores->>'stance')::FLOAT),
        (sp.scores->>'stance')::FLOAT * (sp.scores->>'relevance')::FLOAT * (sp.scores->>'strength')::FLOAT * (sp.scores->>'credibility')::FLOAT,
        rp.author_id,
        rp.author_followers,
        rp.author_verified,
        COALESCE((rp.metrics->>'like_count')::INTEGER, 0),
        COALESCE((rp.metrics->>'retweet_count')::INTEGER, 0),
        COALESCE((rp.metrics->>'reply_count')::INTEGER, 0),
        COALESCE((rp.metrics->>'quote_count')::INTEGER, 0),
        LENGTH(rp.text),
        COALESCE((sp.flags->>'is_sarcasm')::BOOLEAN, false),
        COALESCE((sp.flags->>'is_question')::BOOLEAN, false),
        COALESCE((sp.flags->>'is_rumor')::BOOLEAN, false),
        NULL, -- prob_before (needs separate calculation)
        NULL, -- prob_after (needs separate calculation)
        NULL, -- delta_prob
        NULL  -- moved_toward_truth (computed later)
    FROM scored_posts sp
    JOIN raw_posts rp ON sp.raw_post_id = rp.id
    WHERE sp.market_id = p_market_id
    ON CONFLICT (id) DO NOTHING;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. Trigger to auto-populate training data when market resolves
-- ============================================================================
CREATE OR REPLACE FUNCTION on_market_resolved()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'resolved' AND OLD.status != 'resolved' THEN
        -- Populate training posts (async would be better but this works)
        PERFORM populate_training_posts_for_market(NEW.id);
        
        -- Insert into resolved_markets
        INSERT INTO resolved_markets (
            id, question, normalized_question, resolution_time, 
            winning_outcome_id, num_posts
        )
        VALUES (
            NEW.id, NEW.question, NEW.normalized_question, NEW.resolved_at,
            NEW.resolved_outcome_id, NEW.total_posts_processed
        )
        ON CONFLICT (id) DO UPDATE SET
            resolution_time = EXCLUDED.resolution_time,
            winning_outcome_id = EXCLUDED.winning_outcome_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_market_resolved ON markets;
CREATE TRIGGER trigger_market_resolved
    AFTER UPDATE ON markets
    FOR EACH ROW
    EXECUTE FUNCTION on_market_resolved();

-- ============================================================================
-- Done! ML tables are ready.
-- ============================================================================

