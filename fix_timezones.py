
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Desired LOCAL times (IST +5:30) as per previous "+2 hours" request logic
# Call 1 (Abdul Aziz): 10:00 AM + 2h = 12:00 PM Local
# Call 2 (Abdul Rahman): 11:15 AM + 2h = 01:15 PM Local
# Call 3 (Abdullah): 09:30 AM + 2h = 11:30 AM Local

updates = [
    {
        "filename": "Call_001_Abdul_Aziz_Al_Balushi.mp3",
        "target_local_str": "2023-03-26 12:00:00"
    },
    {
        "filename": "Call_002_Abdul_Rahman_Al_Siabi.mp3",
        "target_local_str": "2023-01-31 13:15:00"
    },
    {
        "filename": "Call_003_Abdullah_Al_Balushi.mp3",
        "target_local_str": "2023-09-18 11:30:00"
    }
]

print("Adjusting `created_at` to ensure dashboard displays correct Local Time (considering IST +5:30)...")

# IST Offset
ist_offset = timedelta(hours=5, minutes=30)

for item in updates:
    local_dt = datetime.strptime(item["target_local_str"], "%Y-%m-%d %H:%M:%S")
    
    # improved logic: Local Time - Offset = UTC Time
    utc_dt = local_dt - ist_offset
    
    utc_iso = utc_dt.isoformat() + "+00:00" # Explicitly adding UTC timezone info
    
    print(f"Updating {item['filename']}...")
    print(f"  Target Local: {local_dt}")
    print(f"  Calculated UTC: {utc_iso}")
    
    try:
        supabase.table("calls").update({"created_at": utc_iso}).eq("filename", item["filename"]).execute()
        print("  Success.")
    except Exception as e:
        print(f"  Error: {e}")

print("Timezone correction complete.")
