"""Database connection utilities."""

from supabase import create_client, Client
from .config import config


def get_supabase_client() -> Client:
    """Get Supabase client with service role key."""
    if not config.supabase_url or not config.supabase_service_key:
        raise ValueError("Supabase credentials not configured")
    
    return create_client(config.supabase_url, config.supabase_service_key)


def check_db_connection() -> bool:
    """Check if database connection works."""
    try:
        client = get_supabase_client()
        # Simple query to verify connection
        result = client.table("markets").select("id").limit(1).execute()
        return True
    except Exception as e:
        print(f"Database connection failed: {e}")
        return False

