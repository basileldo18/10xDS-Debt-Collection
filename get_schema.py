import os
import requests
import json

url = "https://ytsfklwfsqhulywjnazc.supabase.co/rest/v1/?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0c2ZrbHdmc3FodWx5d2puYXpjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTgxMTgxMywiZXhwIjoyMDg3Mzg3ODEzfQ.uG7t6WKI8EfErrF07OO2F46LezSVJrTEFyUqBIOog64"

headers = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0c2ZrbHdmc3FodWx5d2puYXpjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTgxMTgxMywiZXhwIjoyMDg3Mzg3ODEzfQ.uG7t6WKI8EfErrF07OO2F46LezSVJrTEFyUqBIOog64",
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0c2ZrbHdmc3FodWx5d2puYXpjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTgxMTgxMywiZXhwIjoyMDg3Mzg3ODEzfQ.uG7t6WKI8EfErrF07OO2F46LezSVJrTEFyUqBIOog64"
}

response = requests.get(url, headers=headers)
try:
    data = response.json()
    print("Definitions found:")
    for comp_name, comp_schema in data.get('definitions', {}).items():
        print(f"--- Table: {comp_name} ---")
        for prop, details in comp_schema.get('properties', {}).items():
            prop_type = details.get('type', 'unknown')
            prop_format = details.get('format', '')
            print(f"  {prop}: {prop_type} {prop_format}")
except Exception as e:
    print("Error parsing OpenAPI spec:", e)
