
import os
import json
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Fetch the last inserted call
response = supabase.table("calls").select("*").order("id", desc=True).limit(2).execute()

print(json.dumps(response.data, indent=2))
