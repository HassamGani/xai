-- Add author_username to raw_posts for better display and linking
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'raw_posts' AND column_name = 'author_username'
    ) THEN
        ALTER TABLE raw_posts ADD COLUMN author_username TEXT NULL;
    END IF;
END $$;

