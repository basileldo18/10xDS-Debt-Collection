import requests
import json

url = "https://ytsfklwfsqhulywjnazc.supabase.co/storage/v1/bucket"

headers = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0c2ZrbHdmc3FodWx5d2puYXpjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTgxMTgxMywiZXhwIjoyMDg3Mzg3ODEzfQ.uG7t6WKI8EfErrF07OO2F46LezSVJrTEFyUqBIOog64",
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0c2ZrbHdmc3FodWx5d2puYXpjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTgxMTgxMywiZXhwIjoyMDg3Mzg3ODEzfQ.uG7t6WKI8EfErrF07OO2F46LezSVJrTEFyUqBIOog64"
}

response = requests.get(url, headers=headers)
try:
    print(response.json())
except Exception as e:
    print(e)
