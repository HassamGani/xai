-- Add profile image URL to experiment posts

ALTER TABLE public.experiment_posts
ADD COLUMN IF NOT EXISTS profile_image_url text;

