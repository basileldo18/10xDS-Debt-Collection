import os
import io
import sys
import json
import time
import asyncio
import threading
import smtplib
import uuid  # Added for webhook channel IDs
import aiofiles  # For async file operations
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Request, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool

from dotenv import load_dotenv


from datetime import datetime, timedelta
from groq import Groq
from werkzeug.utils import secure_filename

# Import Pydantic models
from fastapi_models import LoginRequest, TranslateRequest, DeleteCallRequest, DiarizationUpdateRequest, VapiCallRequest, UserSettings

load_dotenv()


# --- Groq LLM Setup (Meta Llama) ---
groq_client = None
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
    groq_client = Groq(api_key=GROQ_API_KEY)
    print("[GROQ] Initialized with Meta Llama model")
else:
    print("[GROQ] Warning: GROQ_API_KEY not set. Using fallback analysis.")

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Move all blocking syncs to a background task so server accepts requests IMMEDIATELY
    global app_loop
    app_loop = asyncio.get_running_loop()
    asyncio.create_task(run_startup_tasks())
    yield

# --- App Configuration ---
app = FastAPI(title="10xDS Debt Collection", lifespan=lifespan)

# Session Middleware (replaces Flask's secret_key session)
SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "voxanalyze-secret-key-change-in-prod")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY)

async def run_startup_tasks():
    print("[STARTUP] Background tasks starting (DB Sync, Webhook)...")
    try:
        print("[STARTUP] Background tasks complete! System ready.")

    except Exception as e:
        print(f"[STARTUP] Background task error: {e}")




def create_notification_event(step, message, status="active", file_id=None):
    """Helper to create standard notification payload."""
    payload = {"step": step, "message": message, "status": status}
    if file_id: payload["file_id"] = file_id
    return json.dumps(payload)




# CORS (Allowed origins - adjust as needed)
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static Files & Templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Custom Exception Handler for 422 Errors
from fastapi.exceptions import RequestValidationError
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"[VALIDATION ERROR] {exc.errors()}")
    print(f"[VALIDATION ERROR] Body: {await request.body()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "body": str(await request.body())},
    )

# Config path
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)



# --- Supabase Setup ---
from supabase import create_client, Client
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = None

if not url or not key:
    print("Warning: SUPABASE_URL or SUPABASE_KEY not found.")
else:
    try:
        supabase = create_client(url, key)
    except Exception as e:
        print(f"Supabase Init Error: {e}")

# --- Email Notification Setup ---
import pandas as pd
from datetime import timezone

# --- Lead Management Helpers ---
def upload_excel_to_supabase(file_path, filename):
    """Upload Excel file to Supabase Storage."""
    if not supabase: return None
    try:
        bucket_name = "audio-files" # Using existing bucket for now, or could use 'documents'
        with open(file_path, 'rb') as f:
            file_content = f.read()
        
        # Determine content type
        ext = filename.split('.')[-1].lower()
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if ext == "csv": content_type = "text/csv"
        elif ext == "xls": content_type = "application/vnd.ms-excel"

        supabase.storage.from_(bucket_name).upload(
            path=f"leads/{filename}",
            file=file_content,
            file_options={"content-type": content_type, "upsert": "true"}
        )
        return supabase.storage.from_(bucket_name).get_public_url(f"leads/{filename}")
    except Exception as e:
        print(f"[EXCEL STORAGE] Error: {e}")
        return None



EMAIL_RECIPIENT = "basileldo2@gmail.com"

def send_email_notification(filename, sentiment, tags, summary):
    """Send email notification after transcription is complete."""
    smtp_server = "smtp.gmail.com"
    smtp_port = 587
    sender_email = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD")
    
    if not sender_email or not sender_password:
        print("[EMAIL] Warning: SMTP_EMAIL or SMTP_PASSWORD not set in .env")
        return False
    
    try:
        # Parse summary JSON if it's a string
        summary_data = None
        summary_text = ""
        
        if isinstance(summary, str):
            try:
                summary_data = json.loads(summary)
                # Get overview as the main summary
                summary_text = summary_data.get('overview', summary)
            except:
                summary_text = summary
        elif isinstance(summary, dict):
            summary_data = summary
            summary_text = summary_data.get('overview', str(summary))
        else:
            summary_text = str(summary)
        
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"📞 [VoxAnalyze] New Call Analyzed: {filename}"
        msg["From"] = sender_email
        msg["To"] = EMAIL_RECIPIENT
        
        tags_str = ", ".join(tags) if tags else "None"
        
        # Build plain text version
        text = f"""
============================================================
NEW CALL ANALYSIS COMPLETE
============================================================

File: {filename}
Sentiment: {sentiment}
Tags: {tags_str}

SUMMARY:
------------------------------------------------------------
{summary_text}

============================================================
VoxAnalyze - AI-Powered Call Analysis Dashboard
============================================================
"""
        
        # Build HTML version
        sentiment_class = sentiment.lower() if sentiment else 'neutral'
        sentiment_colors = {
            'positive': {'bg': '#d1fae5', 'text': '#065f46'},
            'negative': {'bg': '#fee2e2', 'text': '#991b1b'},
            'neutral': {'bg': '#e2e8f0', 'text': '#475569'}
        }
        sentiment_color = sentiment_colors.get(sentiment_class, sentiment_colors['neutral'])
        
        html = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8fafc; padding: 20px; margin: 0; }}
        .container {{ max-width: 650px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }}
        .header {{ background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; padding: 32px 24px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 28px; font-weight: 600; }}
        .header p {{ margin: 8px 0 0 0; opacity: 0.9; font-size: 14px; }}
        .content {{ padding: 32px 24px; }}
        .meta-row {{ display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 2px solid #f1f5f9; }}
        .meta-item {{ flex: 1; min-width: 200px; }}
        .meta-label {{ font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }}
        .meta-value {{ font-size: 15px; color: #0f172a; font-weight: 500; }}
        .stat {{ display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 14px; }}
        .tags {{ display: flex; flex-wrap: wrap; gap: 6px; }}
        .tag {{ background: #f1f5f9; color: #475569; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 500; }}
        .summary-box {{ background: #f8fafc; padding: 20px; border-radius: 12px; line-height: 1.8; color: #334155; font-size: 15px; margin-top: 24px; border-left: 4px solid #6366f1; }}
        .footer {{ text-align: center; padding: 24px; background: #f8fafc; color: #94a3b8; font-size: 13px; border-top: 1px solid #e2e8f0; }}
        .footer strong {{ color: #64748b; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📞 New Call Analyzed</h1>
            <p>Call analysis summary</p>
        </div>
        <div class="content">
            <div class="meta-row">
                <div class="meta-item">
                    <div class="meta-label">File Name</div>
                    <div class="meta-value">{filename}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Sentiment</div>
                    <div class="meta-value">
                        <span class="stat" style="background: {sentiment_color['bg']}; color: {sentiment_color['text']};">{sentiment}</span>
                    </div>
                </div>
            </div>
"""
        
        # Tags section
        if tags:
            html += f"""
            <div class="meta-row">
                <div class="meta-item" style="flex: 1 1 100%;">
                    <div class="meta-label">Tags</div>
                    <div class="tags">
"""
            for tag in tags:
                html += f'                        <span class="tag">{tag}</span>\n'
            html += """                    </div>
                </div>
            </div>
"""
        
        # Summary section
        html += f"""
            <div class="summary-box">
                <strong style="color: #1e293b; font-size: 16px; display: block; margin-bottom: 12px;">Summary</strong>
                {summary_text}
            </div>
        </div>
        <div class="footer">
            <strong>VoxAnalyze</strong> - AI-Powered Call Analysis Dashboard
        </div>
    </div>
</body>
</html>"""
        
        part1 = MIMEText(text, "plain")
        part2 = MIMEText(html, "html")
        msg.attach(part1)
        msg.attach(part2)
        
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, EMAIL_RECIPIENT, msg.as_string())
        
        print(f"[EMAIL] Notification sent to {EMAIL_RECIPIENT}")
        return True
        
    except Exception as e:
        print(f"[EMAIL] Error sending notification: {e}")
        return False

# --- Supabase Storage Helper Functions ---

def upload_audio_to_supabase(file_path, filename):
    """
    Upload an audio file to Supabase Storage.
    
    Args:
        file_path: Path to the local audio file
        filename: Name to use for the file in storage
    
    Returns:
        public_url: Public URL of the uploaded file, or None if failed
    """
    if not supabase:
        print("[SUPABASE STORAGE] Supabase client not available")
        return None
    
    try:
        bucket_name = "audio-files"
        
        # Read file content
        with open(file_path, 'rb') as f:
            file_content = f.read()
        
        # Upload to Supabase Storage
        print(f"[SUPABASE STORAGE] Uploading {filename} to bucket '{bucket_name}'...")
        
        # Upload file (will overwrite if exists with same name)
        response = supabase.storage.from_(bucket_name).upload(
            path=filename,
            file=file_content,
            file_options={"content-type": "audio/wav", "upsert": "true"}
        )
        
        # Get public URL
        public_url = supabase.storage.from_(bucket_name).get_public_url(filename)
        
        print(f"[SUPABASE STORAGE] Upload successful! URL: {public_url}")
        return public_url
        
    except Exception as e:
        print(f"[SUPABASE STORAGE] Upload failed: {e}")
        import traceback
        traceback.print_exc()
        return None

def check_file_exists_in_supabase(filename):
    """
    Check if a file already exists in Supabase Storage.
    
    Args:
        filename: Name of the file to check
    
    Returns:
        public_url: Public URL if file exists, None otherwise
    """
    if not supabase:
        return None
    
    try:
        bucket_name = "audio-files"
        
        # List files in bucket
        files = supabase.storage.from_(bucket_name).list()
        
        # Check if file exists
        for file in files:
            if file['name'] == filename:
                public_url = supabase.storage.from_(bucket_name).get_public_url(filename)
                print(f"[SUPABASE STORAGE] File {filename} already exists: {public_url}")
                return public_url
        
        return None
        
    except Exception as e:
        print(f"[SUPABASE STORAGE] Error checking file existence: {e}")
        return None

# --- Helper Functions ---

def analyze_transcript_with_groq(text):
    if not groq_client: return None
    try:
        # Debug: Log input
        print(f"[GROQ] Starting analysis - Transcript length: {len(text)} characters")
        print(f"[GROQ] Transcript preview (first 200 chars): {text[:200]}...")
        
        prompt = f"""Analyze the following call transcript and provide a comprehensive, detailed analysis in simple, easy-to-understand words.

1. Sentiment: Classify as exactly one of: "Positive", "Negative", or "Neutral"
2. Tags: List relevant tags from these options: "Billing", "Support", "Churn Risk", "Sales", "Feedback", "Complaint", "Technical Issue", "Right Party Contact", "Payment Made", "Promise to Pay", "Refusal", "Dispute", "Wrong Number", "Callback Requested"
3. Speakers: Map the conversation to Speaker 1 and Speaker 2.
   - **Speaker 1**: Always the Agent / 10xDS representative.
   - **Speaker 2**: Always the Customer / Debtor.
   - **IMPORTANT**: If a speaker verifies their name (e.g., "Basil Eldo"), use that name for the respective speaker.
   - Extract ONLY the name if available (e.g., "Diana"). 
   - NEVER combine name with role (e.g., use "Diana" NOT "Diana, Agent").
   - If the specific name is unknown, use "Agent" for Speaker 1 and "Customer" for Speaker 2.

4. Summary: A detailed summary with the following structure:
   
   - **overview**: Write a comprehensive paragraph (4-6 sentences minimum) that tells the complete story of the call. Include WHO was involved (specifically check if identity was verified), WHAT was discussed (especially the $200 overdue balance), WHY they called, and WHAT happened with the payment. Be specific and detailed.
   
   - **key_points**: List 3-5 specific, detailed points that were actually discussed in the call. Each point should be a complete sentence describing what was said or what happened (e.g., "Customer confirmed identity", "Customer agreed to pay full amount via card"). 
   
   - **caller_intent**: Write 2-3 detailed sentences explaining EXACTLY what the caller wanted to achieve or accomplish in this call. Be specific about their goals, needs, or requests.
     ❌ BAD: "General inquiry"
     ✅ GOOD: "The agent called to collect an overdue balance of $200. The customer wanted to confirm the amount and discuss payment options."
   
   - **issue_details**: Write 2-3 detailed sentences describing the SPECIFIC problem, topic, or situation that was discussed. Include relevant details like the overdue balance, the due date, and any reasons given for non-payment.
     ❌ BAD: "Greeting only"
     ✅ GOOD: "The customer confirmed they had a $200 overdue balance but mentioned they had already made a payment earlier."
   
   - **resolution**: Write 2-3 detailed sentences explaining EXACTLY what was done, decided, or agreed upon. Include specific actions taken (payment processed, promise to pay date set), promises made, or next steps identified.
     ❌ BAD: "Call completed"
     ✅ GOOD: "The customer agreed to pay the full $200 immediately via card. The agent processed the payment and provided a confirmation number."
   
   - **action_items**: List specific, actionable next steps with WHO needs to do WHAT. If there are no action items, use an empty array.
   
   - **tone**: Overall tone (e.g., "friendly and cooperative", "frustrated but professional", "urgent and concerned", "empathetic and supportive")
   
   - **meeting_date**: Extract if mentioned in the conversation, else null.
   - **meeting_time**: Extract if mentioned in the conversation, else null.

**CRITICAL REQUIREMENTS**:
- NEVER use generic one-word or two-word answers like "General inquiry", "Greeting only", "Call completed"
- ALWAYS write detailed, specific responses based on the ACTUAL content of the transcript
- Each field (caller_intent, issue_details, resolution) must be AT LEAST 2 complete sentences
- Be specific about what was actually said and what actually happened
- If the call is very short or just a greeting, describe EXACTLY what was said in detail

Transcript:
{text[:6000]}

Respond ONLY in this exact JSON format:
{{
    "sentiment": "Positive" or "Negative" or "Neutral",
    "tags": ["tag1", "tag2"],
    "speakers": {{
        "Speaker 1": "Agent Name (Operator)",
        "Speaker 2": "Customer Name"
    }},
    "summary": {{
        "overview": "Detailed 4-6 sentence paragraph describing the entire call",
        "key_points": ["Detailed point 1", "Detailed point 2", "Detailed point 3"],
        "caller_intent": "2-3 detailed sentences about what the caller specifically wanted",
        "issue_details": "2-3 detailed sentences about the specific topic or problem discussed",
        "resolution": "2-3 detailed sentences about what was specifically done or decided",
        "action_items": ["Specific action 1", "Specific action 2"],
        "tone": "Descriptive tone with adjectives",
        "meeting_date": "Date or null",
    "meeting_time": "Time or null",
        "collection_metrics": {{
            "payment_outcome": "One of: 'Full Payment', 'Partial Payment', 'Promise to Pay', 'Refusal', 'Dispute', 'No Payment'",
            "total_debt_amount": 0.0,
            "amount_collected": 0.0,
            "currency": "USD",
            "payment_method": "One of: 'Credit Card', 'Bank Transfer', 'Ach', 'Check', 'Online', 'N/A'"
        }}
    }}
}}"""
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a professional call analysis expert who provides detailed, specific, and contextual analysis. NEVER use generic one-word answers. Always write detailed responses (minimum 2 sentences) based on the actual transcript content. Extract ONLY speaker names if available. Be thorough and specific in your analysis."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=2000,
            response_format={"type": "json_object"}
        )
        result_text = response.choices[0].message.content.strip()
        
        # Debug logging
        print(f"[GROQ] Raw response length: {len(result_text)} characters")
        print(f"[GROQ] First 500 chars of response: {result_text[:500]}")
        
        if result_text.startswith("```"):
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
        
        # Clean up the response text
        result_text = result_text.strip()
        
        # Try to parse the JSON
        try:
            result = json.loads(result_text)
        except json.JSONDecodeError as json_err:
            print(f"[GROQ] JSON parsing failed: {json_err}")
            print(f"[GROQ] Attempting to fix malformed JSON...")
            
            # Try to extract JSON from the response
            # Sometimes the LLM adds extra text before/after
            start_idx = result_text.find("{")
            end_idx = result_text.rfind("}") + 1
            
            if start_idx >= 0 and end_idx > start_idx:
                result_text = result_text[start_idx:end_idx]
                try:
                    result = json.loads(result_text)
                    print(f"[GROQ] Successfully extracted and parsed JSON")
                except:
                    print(f"[GROQ] Could not parse JSON even after extraction")
                    return None
            else:
                return None
        sentiment = result.get("sentiment", "Neutral")
        tags = result.get("tags", [])
        speakers = result.get("speakers", {})
        summary_data = result.get("summary", {})
        
        # Ensure required fields have defaults if missing or too short
        if not summary_data.get("caller_intent") or len(summary_data.get("caller_intent", "")) < 20:
            summary_data["caller_intent"] = "The caller initiated contact to engage with the service or representative. The specific purpose was not clearly stated in this brief interaction."
        if not summary_data.get("issue_details") or len(summary_data.get("issue_details", "")) < 20:
            summary_data["issue_details"] = "This was a brief interaction or initial greeting. No specific issue or detailed topic was discussed during this short call."
        if not summary_data.get("resolution") or len(summary_data.get("resolution", "")) < 20:
            summary_data["resolution"] = "The call was completed as a brief interaction. No specific resolution or action was required as this appeared to be an initial contact or test call."
        if not summary_data.get("tone"):
            summary_data["tone"] = "Professional and courteous"
        
        # Merge speakers into summary data for persistence if needed, 
        # or keep separate. The UI usually looks for 'summary'.
        if speakers:
            summary_data["detected_speakers"] = speakers

        if speakers:
            summary_data["detected_speakers"] = speakers

        if sentiment not in ["Positive", "Negative", "Neutral"]:
            sentiment = "Neutral"
        
        print(f"[GROQ] Analysis complete - Sentiment: {sentiment}, Tags: {tags}")
        print(f"[GROQ] Summary keys: {list(summary_data.keys())}")
        print(f"[GROQ] Speakers detected: {list(speakers.values())}")
        return sentiment, tags, summary_data, speakers
    except Exception as e:
        print(f"[GROQ] Error analyzing transcript: {e}")
        return None

def analyze_transcript_fallback(text):
    if not text: return "Neutral", [], "No text to summarize"
    text_lower = text.lower()
    
    sentiment = "Neutral"
    positive_words = ['good', 'great', 'excellent', 'thanks', 'helpful', 'wonderful', 'appreciate', 'happy', 'perfect']
    negative_words = ['bad', 'error', 'wrong', 'fail', 'issue', 'problem', 'angry', 'slow', 'terrible', 'awful', 'disappointed']
    
    pos_count = sum(1 for word in positive_words if word in text_lower)
    neg_count = sum(1 for word in negative_words if word in text_lower)
    
    if pos_count > neg_count: sentiment = "Positive"
    elif neg_count > pos_count: sentiment = "Negative"
    
    tags = []
    if any(w in text_lower for w in ['billing', 'price', 'cost', 'charge', 'payment', 'invoice']): tags.append("Billing")
    if any(w in text_lower for w in ['support', 'help', 'technical', 'broken', 'fix', 'assist']): tags.append("Support")
    if any(w in text_lower for w in ['cancel', 'cancellation', 'refund', 'leaving', 'quit']): tags.append("Churn Risk")
    
    sentences = text.split('.')
    overview = ". ".join(sentences[:2]).strip() + "." if len(sentences) > 0 else text
    
    summary = {
        "overview": overview,
        "key_points": [],
        "caller_intent": "Not available (fallback analysis)",
        "issue_details": "Not available (fallback analysis)",
        "resolution": "Not available (fallback analysis)",
        "action_items": [],
        "tone": sentiment,
        "meeting_date": None,
        "meeting_time": None
    }
    return sentiment, tags, summary

def analyze_transcript(text, diarization_data=None):
    if not text: return "Neutral", [], "No text to summarize", {}
    
    # If we have diarization data, format it into a speaker-prefixed transcript
    # to help the LLM identify roles.
    analysis_text = text
    if diarization_data:
        # Sort utterances by start time to be safe
        sorted_data = sorted(diarization_data, key=lambda x: x.get('start', 0))
        
        # Create a map to convert A, B, C... to Speaker 1, Speaker 2, Speaker 3...
        speaker_map = {}
        speaker_index = 1
        
        formatted_segments = []
        for segment in sorted_data:
            orig_speaker = segment.get('speaker', 'Unknown')
            if orig_speaker not in speaker_map:
                speaker_map[orig_speaker] = f"Speaker {speaker_index}"
                speaker_index += 1
            
            label = speaker_map[orig_speaker]
            segment_text = segment.get('text', '')
            formatted_segments.append(f"{label}: {segment_text}")
        
        analysis_text = "\n".join(formatted_segments)
        print(f"[ANALYSIS] Formatted transcript with {len(diarization_data)} diarized segments and {speaker_index-1} speakers.")

    if groq_client:
        result = analyze_transcript_with_groq(analysis_text)
        if result: 
            return result
        
    print("[ANALYSIS] Using fallback keyword analysis")
    sentiment, tags, summary = analyze_transcript_fallback(text)
    return sentiment, tags, summary, {}

import requests

# ... (Previous imports remaining unchanged) ...

# --- AssemblyAI Setup ---
# aai.settings.api_key = os.environ.get("ASSEMBLYAI_API_KEY") # Removed SDK setup

def transcribe_audio(file_path, language_code=None, speakers_expected=None):
    api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not api_key:
        return "Error: AssemblyAI API Key missing", 0, [], 0

    headers = {'authorization': api_key}

    try:
        print(f"Uploading {file_path} to AssemblyAI...")
        def read_file(filename, chunk_size=5242880):
            with open(filename, 'rb') as _file:
                while True:
                    data = _file.read(chunk_size)
                    if not data: break
                    yield data

        upload_response = requests.post('https://api.assemblyai.com/v2/upload', headers=headers, data=read_file(file_path))
        upload_response.raise_for_status()
        upload_url = upload_response.json()['upload_url']

        print("Requesting transcription...")
        json_data = {
            "audio_url": upload_url, 
            "speaker_labels": True
        }
        
        # If language is provided, use it, else use detection
        if language_code and language_code != 'auto':
            json_data["language_code"] = language_code
        else:
            json_data["language_detection"] = True
            
        # Add speaker count hint if provided
        if speakers_expected and int(speakers_expected) > 0:
            json_data["speakers_expected"] = int(speakers_expected)
            
        response = requests.post('https://api.assemblyai.com/v2/transcript', json=json_data, headers=headers)
        response.raise_for_status()
        transcript_id = response.json()['id']

        print(f"Polling for transcript {transcript_id}...")
        while True:
            polling_response = requests.get(f'https://api.assemblyai.com/v2/transcript/{transcript_id}', headers=headers)
            polling_response.raise_for_status()
            result = polling_response.json()

            if result['status'] == 'completed':
                text = result.get('text', '')
                duration = result.get('audio_duration', 0)
                language_code = result.get('language_code', 'en')
                
                diarization_data = []
                utterances = result.get('utterances', [])
                speaker_set = set()
                
                if utterances:
                    for utt in utterances:
                        speaker_label = utt.get('speaker', 'Unknown')
                        speaker_set.add(speaker_label)
                        diarization_data.append({
                            "speaker": speaker_label,
                            "text": utt.get('text', ''),
                            "start": utt.get('start'),
                            "end": utt.get('end')
                        })
                
                speaker_count = len(speaker_set)
                print(f"[TRANSCRIBE] Duration: {duration}s, Speakers: {speaker_count}, Language: {language_code}")
                return text, duration, diarization_data, speaker_count, language_code
            
            elif result['status'] == 'error':
                 return f"Transcription Failed: {result.get('error')}", 0, [], 0, 'en'
            
            time.sleep(3)

    except Exception as e:
        print(f"Transcription Exception: {e}")
        return f"Transcription Exception: {e}", 0, [], 0, 'en'

def encode_audio_to_base64(file_path):
    try:
        import base64
        with open(file_path, 'rb') as f:
            file_data = f.read()
        ext = file_path.lower().split('.')[-1] if '.' in file_path else 'wav'
        content_types = {'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'ogg': 'audio/ogg', 'webm': 'audio/webm'}
        content_type = content_types.get(ext, 'audio/mpeg')
        b64_data = base64.b64encode(file_data).decode('utf-8')
        return f"data:{content_type};base64,{b64_data}"
    except Exception as e:
        print(f"[AUDIO] Error encoding audio: {e}")
        return None

def process_audio_file(file_path, original_filename, language_code=None, speakers_expected=None, medium=None):
    try:
        transcript, duration_seconds, diarization_data, speaker_count, detected_lang = transcribe_audio(file_path, language_code, speakers_expected)
        sentiment, tags, summary, speakers = analyze_transcript(transcript, diarization_data=diarization_data)
        
        # Patch diarization_data with detected speaker names
        if speakers and diarization_data:
            # Reconstruct the Speaker 1, 2 mapping used in analyze_transcript
            sorted_diarization = sorted(diarization_data, key=lambda x: x.get('start', 0))
            speaker_map = {}
            speaker_index = 1
            for segment in sorted_diarization:
                orig_id = segment.get('speaker', 'Unknown')
                if orig_id not in speaker_map:
                    label = f"Speaker {speaker_index}"
                    name = speakers.get(label, label)
                    # Safety: only take the name part if LLM included a role with a comma
                    if isinstance(name, str) and ',' in name:
                        name = name.split(',')[0].strip()
                    speaker_map[orig_id] = name
                    speaker_index += 1
                segment['display_name'] = speaker_map[orig_id]
            
            # Update original diarization_data with display names
            diarization_data = sorted_diarization
            # Update speaker count based on detected speakers if possible
            if len(speaker_map) > 0:
                speaker_count = len(speaker_map)

        email_sent = False
        
        audio_url = encode_audio_to_base64(file_path)
        if not audio_url:
            print(f"[STORAGE] Warning: No audio URL generated for {original_filename}")

        
        # Generate Call ID (TXN-XXXX)
        call_id_display = None
        if supabase:
            try:
                # Use max(id) to avoid duplicates if rows were deleted
                max_resp = supabase.table('calls').select("id").order("id", desc=True).limit(1).execute()
                next_id = (max_resp.data[0]['id'] if max_resp.data else 0) + 1
                call_id_display = f"TXN-{2801 + next_id}"
            except:
                pass

        data = {
            "call_id": call_id_display,
            "filename": original_filename,
            "transcript": transcript,
            "sentiment": sentiment,
            "tags": tags,
            "summary": summary,
            "duration": int(duration_seconds),
            "email_sent": False,
            "audio_url": audio_url,
            "diarization_data": diarization_data,
            "speaker_count": speaker_count,
            "medium": medium or "Web"
        }
        
        if supabase:
            # Retry logic for DB insert to handle transient socket errors (like WinError 10035)
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    # Double check if this file was already processed by another thread/process
                    # (e.g. race between webhook and manual upload)
                    if attempt == 0: # Only check existence on first attempt
                        exists = supabase.table('calls').select("id").eq("filename", original_filename).execute()
                        if exists.data:
                            print(f"[DB] Skipping save: {original_filename} already exists in database.")
                            return exists.data[0]

                    if attempt == 0: # Send email only once
                         try:
                             email_sent = send_email_notification(original_filename, sentiment, tags, summary)
                             data["email_sent"] = email_sent
                         except Exception as email_err:
                             print(f"[EMAIL] Warning during processing: {email_err}")

                    supabase.table('calls').insert(data).execute()
                    print(f"[DB] Saved results for {original_filename}")
                    break # Success!
                except Exception as db_err:
                    print(f"[DB] Error (Attempt {attempt+1}/{max_retries}): {db_err}")
                    if attempt < max_retries - 1:
                        time.sleep(2) # Wait before retry
                    else:
                        print(f"[DB] FAILED to save {original_filename} after {max_retries} attempts.")
                
        return data
    except Exception as e:
        print(f"Error processing file: {e}")
        return None



# --- Vapi Webhooks ---

from datetime import datetime
from datetime import timedelta
from datetime import timezone

@app.post("/api/vapi-webhook")
async def vapi_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Handle Vapi webhooks for real-time transcripts and call events.
    """
    try:
        payload = await request.json()
        message = payload.get('message', {})
        
        # Try to find call object in top-level or inside message
        call_data = payload.get('call')
        if not call_data:
            call_data = message.get('call', {})
            
        # Try to find call_id
        call_id = call_data.get('id')
        if not call_id:
            # Fallback: check other common locations
            call_id = message.get('call_id') or message.get('callId') or payload.get('call_id')
            
        # Inject found ID back into call_data for handlers to use
        if call_id and isinstance(call_data, dict):
            call_data['id'] = call_id

        print(f"[VAPI-WEBHOOK] Extracted Call ID: {call_id}")

        message_type = message.get('type')
        print(f"[VAPI-WEBHOOK] Message Type: {message_type}")
        
        # Ensure Call Exists in DB (Important for FK constraints)
        if call_id and supabase:
            # If we receive ANY event for a call ID, ensure it's tracked as 'in-progress' unless it's an end report
            # This fixes issues where 'status-update' (started) might be missed or not sent
            if message_type not in ['end-of-call-report']:
                # Upsert call to ensure it exists
                # We use a lightweight upsert to avoid overwriting critical fields if they exist
                # But we ensure status is 'in-progress' logic if needed
                
                # Check if this qualifies as an active call signal
                is_active_signal = message_type in ['transcript', 'speech-update', 'conversation-update', 'status-update']
                
                if is_active_signal:
                    try:
                         # Upsert with minimal data to ensure row exists
                         # We'll set status to 'in-progress' if it's not already ended? 
                         # Actually simpler: just upsert. If it was 'ended', we might re-open it? 
                         # No, Vapi call IDs are unique. If we get a transcript, it IS in progress.
                         
                        data = {
                            'call_id': call_id,
                            'status': 'in-progress',
                            'updated_at': datetime.now(timezone.utc).isoformat()
                        }
                        # If we have customer info, add it (optional refinement)
                        if call_data.get('customer'):
                            data['customer_phone'] = call_data.get('customer', {}).get('number')
                        
                        # Use upsert with ignoreDuplicates=False (default) to update timestamp
                        # BUT we should be careful not to overwrite 'ended' if we process messages out of order?
                        # For now, simplistic approach is best for "Live" visibility.
                        
                        supabase.table('vapi_calls').upsert(data).execute()
                        # print(f"[VAPI-WEBHOOK] Ensured call {call_id} is tracked.")
                    except Exception as e:
                        print(f"[VAPI-WEBHOOK] Error tracking active call: {e}")

        if message_type == 'transcript':
            await handle_transcript(message, call_data)
        elif message_type == 'end-of-call-report':
            await handle_end_of_call(message, call_data, background_tasks)
        elif message_type == 'status-update':
            await handle_status_update(message, call_data)
        elif message_type in ['conversation-update', 'speech-update']:
            # Just tracking presence (handled above)
            pass
            
        return JSONResponse(status_code=200, content={"success": True})
    except Exception as e:
        print(f"[VAPI-WEBHOOK] Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

async def handle_transcript(message: dict, call_data: dict):
    """Save final transcripts to Supabase."""
    transcript_type = message.get('transcriptType')
    role = message.get('role')
    transcript = message.get('transcript')
    print(transcript)
    if transcript_type != 'final' or not transcript:
        return

    if not supabase:
        print("[VAPI-WEBHOOK] Error: Supabase client not initialized")
        return

    try:
        # IST Timezone (UTC + 5:30)
        ist_time = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
        
        # 1. Check the LAST saved transcript for this call
        # Order by ID desc to get the very latest
        last_res = supabase.table('transcripts').select("*").eq('call_id', call_data.get('id')).order('id', desc=True).limit(1).execute()
        
        last_entry = last_res.data[0] if last_res.data else None
        
        # 2. If valid last entry exists and ROLE MATCHES current role -> MERGE (Update)
        if last_entry and last_entry.get('role') == role:
            prev_text = last_entry.get('transcript', '')
            # Simple spacing check
            new_text = f"{prev_text.strip()} {transcript.strip()}"
            
            # Update the existing row
            supabase.table('transcripts').update({
                'transcript': new_text,
                'timestamp': ist_time.isoformat() # Update timestamp to latest utterance
            }).eq('id', last_entry['id']).execute()
            
            print(f"[VAPI-WEBHOOK] Merged transcript ({role}): ... {transcript[:30]}...")
            
        else:
            # 3. Else (New Speaker or First Entry) -> INSERT
            data = {
                'call_id': call_data.get('id'),
                'role': role,
                'transcript': transcript,
                'timestamp': ist_time.isoformat()
            }
            
            supabase.table('transcripts').insert(data).execute()
            print(f"[VAPI-WEBHOOK] Saved new turn ({role}): {transcript[:30]}...")

    except Exception as e:
        print(f"[VAPI-WEBHOOK] DB Error (Transcript): {e}")

async def handle_end_of_call(message: dict, call_data: dict, background_tasks: BackgroundTasks = None):
    """Save call summary and trigger background processing if recording exists."""
    
    # 1. Send immediate dashboard notification when call ends
    try:
        call_id = call_data.get('id', 'Unknown')
        duration = call_data.get('duration', 0)
        ended_reason = message.get('endedReason', 'Unknown')
        
        # Broadcast to dashboard
        notification_payload = {
            "type": "call_ended",
            "call_id": call_id,
            "duration": duration,
            "ended_reason": ended_reason,
            "message": f"Call {call_id} ended ({ended_reason}). Processing recording...",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        await notification_manager.broadcast(json.dumps(notification_payload))
        print(f"[VAPI-WEBHOOK] Dashboard notification sent for call {call_id}")
    except Exception as e:
        print(f"[VAPI-WEBHOOK] Error sending dashboard notification: {e}")
    
    # 2. Trigger Audio Processing (Drive Upload + Analysis)
    recording_url = message.get('recordingUrl') or message.get('recording_url')
    # Fallback to stereo
    if not recording_url:
        recording_url = message.get('stereoRecordingUrl') or message.get('stereo_recording_url')
        
    if recording_url and background_tasks:
        print(f"[VAPI-WEBHOOK] Found recording URL: {recording_url}")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"vapi_call_{timestamp}.wav"
        safe_name = secure_filename(filename)
        temp_path = os.path.join(UPLOAD_FOLDER, safe_name)
        
        # Determine Medium from Vapi call type
        # Vapi sends: 'webCall' for browser/widget calls, 'inboundPhoneCall'/'outboundPhoneCall' for phone
        call_type = call_data.get('type', '')
        print(f"[VAPI-WEBHOOK] Raw call type: '{call_type}'")
        
        # Detect phone calls explicitly; everything else (web widget, unknown) defaults to 'Web'
        phone_types = ['inboundPhoneCall', 'outboundPhoneCall', 'inbound-phone-call', 'outbound-phone-call']
        if call_type in phone_types or ('phone' in call_type.lower()):
            medium = 'Phone'
        else:
            # webCall, web, web_call, or empty/unknown → Web (browser widget)
            medium = 'Web'
        
        print(f"[VAPI-WEBHOOK] Detected medium: {medium} (call_type='{call_type}')")
        background_tasks.add_task(process_vapi_call_background, recording_url, temp_path, safe_name, notification_manager, medium)
    else:
        print("[VAPI-WEBHOOK] No recording URL found (or no background tasks), skipping file processing.")

    # 3. Save Report to Database
    if not supabase: return

    try:
        data = {
            'call_id': call_data.get('id'),
            'ended_reason': message.get('endedReason'),
            'summary': message.get('summary'),
            'recording_url': recording_url,
            'duration': call_data.get('duration'),
            'cost': call_data.get('cost'),
            # 'ended_at': datetime.now(timezone.utc).isoformat() 
        }
        
        supabase.table('call_reports').insert(data).execute()
        print(f"[VAPI-WEBHOOK] Saved End of Call Report for {data['call_id']}")

        # FALLBACK: Explicitly mark call as ended in vapi_calls table
        supabase.table('vapi_calls').update({
            'status': 'ended',
            'updated_at': datetime.now(timezone.utc).isoformat()
        }).eq('call_id', call_data.get('id')).execute()
        print(f"[VAPI-WEBHOOK] Force-updated status to 'ended' for {data['call_id']}")
    except Exception as e:
        print(f"[VAPI-WEBHOOK] DB Error (Report/Status Fallback): {e}")

async def handle_status_update(message: dict, call_data: dict):
    """Track call status."""
    if not supabase: return

    try:
        status = message.get('status')
        call_id = call_data.get('id')
        
        # Only track essential statuses to avoid premature "Live" display
        if status not in ['in-progress', 'ended']:
            print(f"[VAPI-WEBHOOK] Ignoring status update: {call_id} -> {status}")
            return
            
        print(f"[VAPI-WEBHOOK] Call Status Update: {call_id} -> {status}")
        
        supabase.table('vapi_calls').upsert({
            'call_id': call_id,
            'status': status,
            'updated_at': datetime.now(timezone.utc).isoformat()
        }).execute()
    except Exception as e:
        print(f"[VAPI-WEBHOOK] DB Error (Status): {e}")


@app.get("/api/transcripts/{call_id}")
async def get_transcripts(call_id: str):
    """Fetch transcripts for a specific call (Bypasses RLS)."""
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Fetch transcripts sorted by timestamp
        response = supabase.table('transcripts').select('*').eq('call_id', call_id).order('timestamp').execute()
        return response.data
    except Exception as e:
        print(f"Error fetching transcripts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Webhook & Background Tasks ---



# --- Dependencies ---

async def get_current_user(request: Request):
    user_id = request.session.get('user_id')
    if not user_id:
        # For API calls, return None or raise HTTPException
        # For page loads, we handle redirect in the route
        return None
    return user_id

async def login_required(request: Request):
    user_id = request.session.get('user_id')
    if not user_id:
        raise HTTPException(status_code=status.HTTP_307_TEMPORARY_REDIRECT, headers={"Location": "/login"})
    return user_id

# --- Routes ---

# --- Lead Routes ---

@app.post("/api/pending/upload")
async def upload_pending_leads(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(login_required)
):
    if not supabase:
        return JSONResponse(status_code=500, content={"error": "Database not connected"})
    
    filename = secure_filename(file.filename)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_filename = f"{timestamp}_{filename}"
    temp_path = os.path.join(UPLOAD_FOLDER, unique_filename)
    
    # Save temp file
    async with aiofiles.open(temp_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)
        
    try:
        # Parse Excel/CSV
        if unique_filename.endswith('.csv'):
            df = pd.read_csv(temp_path)
        else:
            df = pd.read_excel(temp_path)
            
        # Standardize column names (lowercase, no spaces)
        df.columns = [str(c).strip() for c in df.columns]
        
        # Convert to list of dicts via JSON string to safely handle NaN/Infinity values
        # pandas.to_json handles NaN -> null correctly for PostgreSQL JSONB
        records_json = df.to_json(orient='records', date_format='iso')
        records = json.loads(records_json)
        
        if not records:
            return JSONResponse(status_code=400, content={"error": "Excel sheet is empty"})
            
        # Store in Supabase
        # We'll try to insert batches to avoid timeout
        batch_size = 50
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            db_records = []
            # Calculate call scheduled time: current time + 2 hours
            call_scheduled_time = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
            
            for row in batch:
                db_records.append({
                    "user_id": user_id,
                    "filename": filename,
                    "lead_data": row,
                    "status": "pending",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "call_scheduled_on": call_scheduled_time
                })
            
            # Using table 'pending_leads'. Note: User must have this table created.
            supabase.table('pending_leads').insert(db_records).execute()
        
        # Upload original file to storage in background
        background_tasks.add_task(upload_excel_to_supabase, temp_path, unique_filename)
        
        return {
            "status": "success", 
            "message": f"Successfully imported {len(records)} leads from {filename}",
            "count": len(records)
        }
        
    except Exception as e:
        print(f"[EXCEL UPLOAD] Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        # We keep the file until background task finishes, or delete after 
        pass

@app.get("/api/pending/leads")
async def get_pending_leads(user_id: str = Depends(login_required)):
    if not supabase:
        return JSONResponse(status_code=500, content={"error": "Database error"})
    
    try:
        response = supabase.table('pending_leads')\
            .select("*")\
            .order('id', desc=False)\
            .execute()
        return response.data
    except Exception as e:
        print(f"[GET LEADS] Error: {e}")
        return []

@app.delete("/api/pending/leads")
async def clear_pending_leads(user_id: str = Depends(login_required)):
    if not supabase:
        return JSONResponse(status_code=500, content={"error": "Database error"})
    
    try:
        # For simplicity, we clear all for now. In multi-user we would filter by user_id
        supabase.table('pending_leads').delete().neq('id', 0).execute()
        return {"status": "success", "message": "Cleared lead queue"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.delete("/api/pending/leads/{lead_id}")
async def delete_pending_lead(lead_id: int, user_id: str = Depends(login_required)):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database error"})
    try:
        supabase.table('pending_leads').delete().eq('id', lead_id).execute()
        return {"status": "success"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/", response_class=HTMLResponse)
async def index(request: Request, user_id: str = Depends(login_required)):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "vapi_public_key": os.environ.get("VAPI_PUBLIC_KEY", ""),
        "vapi_assistant_id": os.environ.get("VAPI_ASSISTANT_ID", ""),
        "supabase_url": os.environ.get("SUPABASE_URL", ""),
        "supabase_key": os.environ.get("SUPABASE_KEY", "")
    })

@app.get("/settings", response_class=HTMLResponse)
async def settings(request: Request, user_id: str = Depends(login_required)):
    return templates.TemplateResponse("settings.html", {
        "request": request,
        "supabase_url": os.environ.get("SUPABASE_URL", ""),
        "supabase_key": os.environ.get("SUPABASE_KEY", "")
    })

@app.get("/debug", response_class=HTMLResponse)
async def debug_page(request: Request):
    return templates.TemplateResponse("debug_chat.html", {"request": request})

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if "user_id" in request.session:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("login.html", {
        "request": request,
        "supabase_url": os.environ.get("SUPABASE_URL", ""),
        "supabase_key": os.environ.get("SUPABASE_KEY", "")
    })

@app.post("/api/auth/login")
async def api_login(request: Request, login_data: LoginRequest):
    request.session["user_id"] = login_data.user_id
    request.session["email"] = login_data.email
    return {"success": True, "message": "Session created"}

@app.get("/api/admin/setup")
async def setup_admin():
    """Diagnostic route to create the default admin user if it's missing."""
    if not supabase: 
        return JSONResponse(status_code=500, content={"error": "Supabase client not initialized"})
    
    try:
        admin_email = "admin@10xds.com"
        default_password = "admin123" # Temporary setup password
        
        # Use service role to create user via admin API
        # This only works if SUPABASE_KEY is the service_role key
        response = supabase.auth.admin.create_user({
            "email": admin_email,
            "password": default_password,
            "email_confirm": True
        })
        
        return {
            "success": True, 
            "message": f"Admin user '{admin_email}' created successfully with password '{default_password}'. Please log in and change your password.",
            "user_id": response.user.id
        }
    except Exception as e:
        error_str = str(e)
        if "already exists" in error_str.lower() or "User already exists" in error_str:
            return {
                "success": False, 
                "message": "Admin user 'admin@10xds.com' already exists. If you forgot the password, please reset it in the Supabase Dashboard."
            }
        print(f"[SETUP] Admin setup error: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to create admin user: {error_str}"})

@app.post("/api/auth/logout")
async def api_logout(request: Request):
    request.session.clear()
    return {"success": True, "message": "Session cleared"}

@app.get("/api/auth/session")
async def api_session(request: Request):
    if "user_id" in request.session:
        return {
            "authenticated": True,
            "user_id": request.session.get("user_id"),
            "email": request.session.get("email")
        }
    return JSONResponse(status_code=401, content={"authenticated": False})

@app.get("/api/settings")
async def get_settings(user_id: str = Depends(get_current_user)):
    if not user_id: return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    if not supabase: return {}
    
    try:
        # Check if table exists implicitly by trying query
        response = supabase.table('user_settings').select("settings").eq("user_id", user_id).execute()
        
        if response.data and len(response.data) > 0:
            return response.data[0].get('settings', {})
        else:
            return {}
            
    except Exception as e:
        print(f"[SETTINGS] Error fetching settings: {e}")
        # Table might not exist, return empty (defaults will be used by frontend)
        return {}

@app.post("/api/settings")
async def save_settings(settings: UserSettings, user_id: str = Depends(login_required)):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database not available"})
    
    try:
        data = {
            "user_id": user_id,
            "settings": settings.dict()
        }
        
        # Upsert settings
        supabase.table('user_settings').upsert(data).execute()
        return {"success": True, "message": "Settings saved"}
        
    except Exception as e:
        print(f"[SETTINGS] Error saving settings: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
        
# Helper function to run blocking Supabase calls in a thread

# Helper function to run blocking Supabase calls in a thread
def run_query(query_builder):
    return query_builder.execute()


@app.get("/api/calls/{call_id}")
async def get_call_details(call_id: int, user_id: str = Depends(login_required)):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database not available"})
    
    try:
        response = supabase.table('calls').select("*").eq('id', call_id).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]
        else:
            raise HTTPException(status_code=404, detail="Call not found")
    except Exception as e:
        print(f"[API] Error fetching call details: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/call-stats")
async def get_call_stats_endpoint(days: int = 0, user_id: str = Depends(get_current_user)):
    if not supabase: return {"stats": {}}
    
    try:
        t_start = time.time()
        print("[API STATS] Fetching statistics...")

        # CRITICAL FIX: Always try database function first
        use_db_function = False
        stats_data = {}
        
        # try:
        #     stats_result = await asyncio.to_thread(
        #         lambda: supabase.rpc('get_call_stats').execute()
        #     )
        #     print(f"[API STATS] RPC result type: {type(stats_result.data)}")
        #     if stats_result.data:
        #         if isinstance(stats_result.data, list) and len(stats_result.data) > 0:
        #             stats_data = stats_result.data[0]
        #         elif isinstance(stats_result.data, dict):
        #             stats_data = stats_result.data
                
        #         if isinstance(stats_data, dict):
        #             print(f"[API STATS] RPC stats received keys: {list(stats_data.keys())}")
        #             use_db_function = True
        #         else:
        #             print(f"[API STATS] RPC returned data but it wasn't a dict: {type(stats_data)}")
        # except Exception as e:
        #     print(f"[API STATS] Database function failed: {e}, using fallback")
        #     use_db_function = False

        # Get total count independently to ensure accuracy
        total_count = 0
        try:
            count_resp = await asyncio.to_thread(lambda: supabase.table('calls').select("*", count="exact").limit(1).execute())
            total_count = count_resp.count if hasattr(count_resp, 'count') else 0
            print(f"[API STATS] Total count from DB: {total_count}")
        except Exception as e:
            print(f"[API STATS] Count query failed: {e}")

        if use_db_function:
            # Stats already computed by database
            stats = {
                "total": total_count or stats_data.get('total_calls', 0) or stats_data.get('count', 0),
                "sentiment": {
                    "positive": stats_data.get('positive', 0),
                    "negative": stats_data.get('negative', 0),
                    "neutral": stats_data.get('neutral', 0)
                },
                "avg_duration": round(float(stats_data.get('avg_duration') or 0), 2),
                "tag_counts": {
                    "PTP": stats_data.get('ptp', 0) or stats_data.get('payment_made', 0) or stats_data.get('billing', 0),
                    "Refusal": stats_data.get('refusal', 0),
                    "Dispute": stats_data.get('dispute', 0),
                    "Wrong Number": stats_data.get('wrong_number', 0),
                    "Callback": stats_data.get('callback', 0) or stats_data.get('callback_requested', 0),
                    "RPC": stats_data.get('rpc', 0) or stats_data.get('right_party_contact', 0)
                },
                "resolved_cases": stats_data.get('payment_made', 0) or stats_data.get('paid_full', 0) or 0
            }
        else:
            print("[API STATS] Running fallback manual calculation...")
            # Fallback: Drastically reduce the limit
            stats_query = supabase.table('calls')\
                .select("sentiment, duration, tags, summary, created_at")\
                .order('id', desc=True)
            
            if days > 0:
                start_date = (datetime.now() - timedelta(days=days)).isoformat()
                print(f"[API STATS] Filtering calls from: {start_date}")
                stats_query = stats_query.gte('created_at', start_date)
            
            stats_query = stats_query.limit(2000)
            
            stats_response = await asyncio.to_thread(run_query, stats_query)
            all_data = stats_response.data or []
            print(f"[API STATS] Fallback data rows: {len(all_data)}")
            
            # Calculate stats from dataset
            stats = {
                "total": total_count,
                "analyzed_total": len(all_data),
                "sentiment": {"positive": 0, "negative": 0, "neutral": 0},
                "avg_duration": 0,
                "tag_counts": {
                    "PTP": 0,
                    "Refusal": 0,
                    "Dispute": 0,
                    "Wrong Number": 0,
                    "Callback": 0,
                    "RPC": 0
                },
                "resolved_cases": 0,
                "performance_trend": [],
                "weekly_activity": [],
                "funnel": {
                    "calls_made": 0,
                    "connected": 0,
                    "ptp": 0,
                    "payment": 0
                }
            }
            
            monthly_trend = {}
            weekly_counts = {
                "Mon": {"calls": 0, "payments": 0},
                "Tue": {"calls": 0, "payments": 0},
                "Wed": {"calls": 0, "payments": 0},
                "Thu": {"calls": 0, "payments": 0},
                "Fri": {"calls": 0, "payments": 0},
                "Sat": {"calls": 0, "payments": 0},
                "Sun": {"calls": 0, "payments": 0}
            }
            # Day mapping for datetime.weekday() (0=Monday, 6=Sunday)
            day_map = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
            
            # List of month names in order for sorting
            month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            
            total_duration = 0
            valid_duration_count = 0
            
            for c in all_data:
                if not isinstance(c, dict): continue
                
                sent = (c.get('sentiment') or 'neutral').lower()
                if sent == 'positive': 
                    stats["sentiment"]["positive"] += 1
                elif sent == 'negative': 
                    stats["sentiment"]["negative"] += 1
                else: 
                    stats["sentiment"]["neutral"] += 1

                dur = c.get('duration')
                if dur is not None:
                    try:
                        total_duration += float(dur)
                        valid_duration_count += 1
                    except: pass

                tags = c.get('tags', [])
                tags_lower = []
                if isinstance(tags, list):
                    tags_lower = [str(tag).lower() for tag in tags]
                    
                    # Flexible matching (substrings) - alignment with frontend logic
                    # Expanded PTP synonyms
                    if any(x in t for x in ['promise', 'ptp', 'payment made', 'commitment', 'will pay', 'agreed', 'partial payment', 'full payment', 'commitment to pay'] for t in tags_lower):
                        stats["tag_counts"]["PTP"] += 1
                    
                    if any(x in t for x in ['refusa', 'not interested', 'hang up', 'not paying', 'rejected'] for t in tags_lower):
                        stats["tag_counts"]["Refusal"] += 1
                        
                    if any(x in t for x in ['dispute', 'complaint', 'legal', 'lawyer', 'incorrect'] for t in tags_lower):
                        stats["tag_counts"]["Dispute"] += 1
                        
                    if any('wrong number' in t or 'not the person' in t for t in tags_lower):
                        stats["tag_counts"]["Wrong Number"] += 1
                        
                    if any('callback' in t or 'call me back' in t or 'busy' in t for t in tags_lower):
                        stats["tag_counts"]["Callback"] += 1
                        
                    # Expanded RPC synonyms
                    if any(x in t for x in ['right party', 'verified', 'rpc', 'spoke to', 'contacted', 'identity confirmed', 'person reached'] for t in tags_lower):
                        stats["tag_counts"]["RPC"] += 1

                # Parse Summary for Metrics
                summary_raw = c.get('summary')
                summary = {}
                if isinstance(summary_raw, dict):
                    summary = summary_raw
                elif isinstance(summary_raw, str):
                    try: summary = json.loads(summary_raw)
                    except: pass
                
                payment_outcome = str(summary.get('collection_metrics', {}).get('payment_outcome', '')).lower()

                # Calculate Resolved Cases: Check tags AND summary metrics
                is_resolved = False
                if any('paid full' in t or 'paid in full' in t or 'fully paid' in t for t in tags_lower):
                    is_resolved = True
                elif 'full' in payment_outcome: 
                    # Align with frontend logic: includes('full') -> 'Paid Full'
                    is_resolved = True

                if is_resolved:
                    stats["resolved_cases"] += 1
                
                # Trend logic: Group by Month
                raw_date = c.get('created_at')
                if raw_date:
                    try:
                        dt = datetime.fromisoformat(raw_date.replace('Z', '+00:00'))
                        month_key = dt.strftime('%b')
                        
                        if month_key not in monthly_trend:
                            monthly_trend[month_key] = {"total_due": 0.0, "collected": 0.0, "balance": 0.0}
                        
                        if isinstance(summary, dict) and 'collection_metrics' in summary:
                            metrics = summary['collection_metrics']
                            total = float(metrics.get('total_debt_amount') or metrics.get('total_due') or 0.0)
                            collected = float(metrics.get('amount_collected') or 0.0)
                            
                            monthly_trend[month_key]["total_due"] += total
                            monthly_trend[month_key]["collected"] += collected
                            monthly_trend[month_key]["balance"] += (total - collected)
                        elif isinstance(summary, dict) and 'summary' in summary and isinstance(summary['summary'], dict) and 'collection_metrics' in summary['summary']:
                            metrics = summary['summary']['collection_metrics']
                            total = float(metrics.get('total_debt_amount') or metrics.get('total_due') or 0.0)
                            collected = float(metrics.get('amount_collected') or 0.0)
                            
                            monthly_trend[month_key]["total_due"] += total
                            monthly_trend[month_key]["collected"] += collected
                            monthly_trend[month_key]["balance"] += (total - collected)
                            
                    except Exception as trend_err:
                        pass # Silently skip malformed dates in trend

                # Weekly Activity Logic
                if raw_date:
                    try:
                        dt = datetime.fromisoformat(raw_date.replace('Z', '+00:00'))
                        day_idx = dt.weekday()
                        day_key = day_map[day_idx]
                        
                        weekly_counts[day_key]["calls"] += 1
                        
                        # Check for payment success (PTP tag or collected amount > 0)
                        is_payment = False
                        if any(x in t for x in ['promise', 'ptp', 'payment', 'paid'] for t in tags_lower):
                            is_payment = True
                        
                        if not is_payment and isinstance(summary, dict):
                             metrics = summary.get('collection_metrics') or (summary.get('summary', {}).get('collection_metrics') if isinstance(summary.get('summary'), dict) else None)
                             if metrics and float(metrics.get('amount_collected') or 0.0) > 0:
                                 is_payment = True

                        if is_payment:
                            weekly_counts[day_key]["payments"] += 1
                        
                        # Funnel Logic
                        stats["funnel"]["calls_made"] += 1
                        if c.get('duration') and float(c.get('duration')) > 5:
                            stats["funnel"]["connected"] += 1
                        if any(x in t for x in ['promise', 'ptp'] for t in tags_lower):
                             stats["funnel"]["ptp"] += 1
                        if is_payment:
                             stats["funnel"]["payment"] += 1
                             
                    except: pass

            # Format trend data for frontend
            sorted_months = sorted(monthly_trend.keys(), key=lambda m: month_names.index(m) if m in month_names else 99)
            for m in sorted_months:
                stats["performance_trend"].append({
                    "month": m,
                    "total_due": round(monthly_trend[m]["total_due"], 2),
                    "collected": round(monthly_trend[m]["collected"], 2),
                    "balance": round(monthly_trend[m]["balance"], 2)
                })
            
            # Format Weekly Activity
            for day in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]:
                stats["weekly_activity"].append({
                    "day": day,
                    "calls": weekly_counts[day]["calls"],
                    "payments": weekly_counts[day]["payments"]
                })

            # Mock data only if truly empty
            if not stats["performance_trend"]:
                stats["performance_trend"] = [
                    {"month": "Jan", "total_due": 240, "collected": 65, "balance": 175},
                    {"month": "Feb", "total_due": 235, "collected": 70, "balance": 165},
                    {"month": "Mar", "total_due": 240, "collected": 68, "balance": 172},
                    {"month": "Apr", "total_due": 230, "collected": 75, "balance": 155},
                    {"month": "May", "total_due": 235, "collected": 72, "balance": 163},
                    {"month": "Jun", "total_due": 230, "collected": 78, "balance": 152}
                ]
            
            if all(d["calls"] == 0 for d in stats["weekly_activity"]):
                 stats["weekly_activity"] = [
                    {"day": "Mon", "calls": 420, "payments": 180},
                    {"day": "Tue", "calls": 560, "payments": 220},
                    {"day": "Wed", "calls": 610, "payments": 240},
                    {"day": "Thu", "calls": 540, "payments": 190},
                    {"day": "Fri", "calls": 480, "payments": 175},
                    {"day": "Sat", "calls": 210, "payments": 90},
                    {"day": "Sun", "calls": 150, "payments": 65}
                ]
            
            stats["avg_duration"] = round(total_duration / valid_duration_count, 2) if valid_duration_count > 0 else 0

        return {"stats": stats}

    except Exception as e:
        print(f"[API STATS] Error: {e}")
        import traceback
        traceback.print_exc()
        # Return empty stats on error rather than 500 to prevent UI crash
        return {"stats": {
            "total": 0,
            "sentiment": {"positive": 0, "negative": 0, "neutral": 0},
            "avg_duration": 0,
            "tag_counts": {
                "PTP": 0,
                "Refusal": 0,
                "Dispute": 0,
                "Wrong Number": 0,
                "Callback": 0,
                "RPC": 0
            }
        }}

@app.get("/api/calls")
async def get_calls(user_id: str = Depends(get_current_user), offset: int = 0, limit: int = 20):
    if not supabase: return {"calls": [], "total": 0, "stats": {}}
    
    try:
        t_start = time.time()
        # Main query (Optimized: Exclude heavy transcript/diarization fields)
        # Use ID for sorting as it's an indexed primary key (faster than created_at)
        main_query = supabase.table('calls')\
            .select("id, call_id, filename, sentiment, tags, summary, duration, created_at, speaker_count, email_sent, medium", count="exact")\
            .order('id', desc=True)\
            .range(offset, offset + limit - 1)

        # Execute main query
        response = await asyncio.to_thread(run_query, main_query)
        
        # Ensure 'medium' field for old records that have NULL medium in DB
        if response.data:
            for call in response.data:
                if not call.get('medium'):  # Only patch NULL/empty values
                    filename = call.get('filename', '').lower()
                    # Only mark as Phone if filename explicitly signals a phone call
                    if 'phone' in filename:
                        call['medium'] = 'Phone'
                    else:
                        # vapi_call_ files from web widget, manual uploads, etc. → Web
                        call['medium'] = 'Web'
                    
        data_len = len(response.data) if response.data else 0
        print(f"[API] get_calls returned {data_len} rows.")

        total_count = response.count if isinstance(response.count, int) else 0

        t_end = time.time()
        
        return {
            "calls": response.data,
            "total": total_count,
            "stats": {}, # Stats are now fetched via /api/call-stats
            "debug_timing": {
                "total_sec": round(t_end - t_start, 4)
            }
        }

    except Exception as e:
        print(f"[API] Error fetching calls: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

             


@app.put("/api/calls/{call_id}/diarization")
async def update_diarization(call_id: int, request: DiarizationUpdateRequest):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database not available"})
    try:
        response = supabase.table('calls').update({
            'diarization_data': request.diarization_data
        }).eq('id', call_id).execute()
        return {"success": True, "message": "Diarization data updated"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/upload")
async def upload_audio(
    file: UploadFile = File(...),
    language: str = Form(None),
    speakers: int = Form(None)
):
    # Validate extension
    allowed_extensions = {'wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac', 'aac'}
    file_ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if file_ext not in allowed_extensions:
        return JSONResponse(status_code=400, content={'error': f'Invalid file type. Allowed: {", ".join(allowed_extensions)}'})

    safe_name = secure_filename(file.filename)
    temp_path = os.path.join(UPLOAD_FOLDER, safe_name)
    
    # Save file
    async with aiofiles.open(temp_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)

    async def generate_progress():
        try:
            # Upload to Supabase Storage
            yield f"data: {json.dumps({'step': 'upload', 'status': 'active', 'message': 'Uploading to Supabase Storage...'})}\n\n"
            
            # Check if file already exists in Supabase Storage
            existing_url = await run_in_threadpool(check_file_exists_in_supabase, safe_name)
            
            audio_url = None
            if existing_url:
                print(f"[UPLOAD] File {safe_name} already exists in Supabase Storage. Stopping processing.")
                yield f"data: {json.dumps({'step': 'upload', 'status': 'error', 'message': 'File already exists in Supabase Storage. Manual upload cancelled.'})}\n\n"
                return # Stop further processing
            else:
                # Upload to Supabase Storage
                print(f"[UPLOAD] Uploading {safe_name} to Supabase Storage")
                audio_url = await run_in_threadpool(upload_audio_to_supabase, temp_path, safe_name)
                
                if audio_url:
                    print(f"[UPLOAD] Upload successful. URL: {audio_url}")
                    yield f"data: {json.dumps({'step': 'upload', 'status': 'complete', 'message': 'Uploaded to Supabase Storage!'})}\n\n"
                else:
                    error_msg = f"Supabase Storage upload failed for {safe_name}. Check server logs for details."
                    print(f"[UPLOAD] {error_msg}")
                    yield f"data: {json.dumps({'step': 'upload', 'status': 'error', 'message': error_msg})}\n\n"
                    return

            # Transcribe
            yield f"data: {json.dumps({'step': 'transcribe', 'status': 'active', 'message': 'Transcribing audio...'})}\n\n"
            transcript, duration_seconds, diarization_data, speaker_count, detected_lang = await run_in_threadpool(transcribe_audio, temp_path, language, speakers)
            yield f"data: {json.dumps({'step': 'transcribe', 'status': 'complete', 'message': 'Transcription complete!'})}\n\n"
            
            # Analyze
            yield f"data: {json.dumps({'step': 'analyze', 'status': 'active', 'message': 'Analyzing sentiment...'})}\n\n"
            sentiment, tags, summary, detected_speakers = await run_in_threadpool(analyze_transcript, transcript)
            yield f"data: {json.dumps({'step': 'analyze', 'status': 'complete', 'message': 'Analysis complete!'})}\n\n"
            
            # Save
            yield f"data: {json.dumps({'step': 'save', 'status': 'active', 'message': 'Saving to database...'})}\n\n"
            # audio_url is already set from Supabase Storage upload
            
            email_sent = send_email_notification(safe_name, sentiment, tags, summary)
            
            # Generate Call ID
            call_id_display = None
            if supabase:
                try:
                    # Use max(id) to avoid duplicates if rows were deleted
                    max_resp = supabase.table('calls').select("id").order("id", desc=True).limit(1).execute()
                    next_id = (max_resp.data[0]['id'] if max_resp.data else 0) + 1
                    call_id_display = f"TXN-{2801 + next_id}"
                except:
                    pass

            data = {
                "call_id": call_id_display,
                "filename": safe_name,
                "transcript": transcript,
                "sentiment": sentiment,
                "tags": tags,
                "summary": summary,
                "email_sent": email_sent,
                "audio_url": audio_url,
                "duration": int(duration_seconds),
                "diarization_data": diarization_data,
                "speaker_count": speaker_count,
                "medium": "Web"
            }
            
            if supabase:
                supabase.table('calls').insert(data).execute()
            
            yield f"data: {json.dumps({'step': 'save', 'status': 'complete', 'message': 'Saved to database!'})}\n\n"
            yield f"data: {json.dumps({'step': 'done', 'status': 'success', 'message': 'File processed successfully!'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'step': 'error', 'status': 'error', 'message': str(e)})}\n\n"
        finally:
            if os.path.exists(temp_path):
                # Robust deletion for Windows file locking
                for i in range(5):
                    try:
                        os.remove(temp_path)
                        break
                    except PermissionError:
                        await asyncio.sleep(1) # Wait for handle release
                    except Exception as e:
                        print(f"Error deleting temp file: {e}")
                        break

    return StreamingResponse(generate_progress(), media_type="text/event-stream")

@app.post("/api/translate")
async def translate_transcript(req: TranslateRequest):
    if not groq_client: return JSONResponse(status_code=500, content={"error": "Translation service not available"})
    try:
        lang_map = {'en': 'English', 'ml': 'Malayalam', 'hi': 'Hindi', 'ar': 'Arabic'}
        language_name = lang_map.get(req.language, 'Spanish')
        
        if req.diarization_data:
            texts = [u.get('text', '') for u in req.diarization_data]
            combined = "\n---\n".join(texts)
            prompt = f"""Translate segments to {language_name}. Separated by ---. Preserve order/count. Only text.
Segments:
{combined[:6000]}"""
            
            resp = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "system", "content": "Translate accurately. Preserve format."}, {"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=4000
            )
            translated_segs = resp.choices[0].message.content.strip().split("---")
            
            new_diarization = []
            for i, u in enumerate(req.diarization_data):
                txt = translated_segs[i].strip() if i < len(translated_segs) else u.get('text', '')
                new_diarization.append({**u, "text": txt, "original_text": u.get("text", "")})
            
            return {
                "success": True,
                "translated_diarization": new_diarization,
                "language": language_name,
                "has_diarization": True
            }
        else:
            # Check if transcript is a structured summary (JSON)
            summary_data = None
            try:
                summary_data = json.loads(req.transcript)
            except:
                pass
            
            if summary_data and isinstance(summary_data, dict):
                # This is a structured summary - translate field by field
                print(f"[TRANSLATE] Translating structured summary to {language_name}")
                
                # Build a simplified prompt for translation
                prompt = f"""Translate this call summary to {language_name}. Keep all field names in English, translate only the values.

JSON to translate:
{json.dumps(summary_data, indent=2)[:2500]}

Return the translated JSON (keep field names like 'overview', 'key_points' in English):"""
                
                resp = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role": "system", "content": f"Translate to {language_name}. Return JSON only."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.2,
                    max_tokens=12000
                )
                
                translated_response = resp.choices[0].message.content.strip()
                
                # Clean up any markdown artifacts
                if "```" in translated_response:
                    translated_response = translated_response.replace("```json", "").replace("```", "").strip()
                
                # Extract JSON if there's extra text
                if not translated_response.startswith("{"):
                    json_start = translated_response.find("{")
                    if json_start != -1:
                        json_end = translated_response.rfind("}") + 1
                        if json_end > json_start:
                            translated_response = translated_response[json_start:json_end]
                
                # Verify it's valid JSON before returning
                try:
                    json.loads(translated_response)
                    print(f"[TRANSLATE] Successfully translated structured summary")
                except json.JSONDecodeError as e:
                    print(f"[TRANSLATE] JSON validation failed: {e}")
                    print(f"[TRANSLATE] Response preview: {translated_response[:200]}")
                    # Return original if translation parsing fails
                    translated_response = req.transcript
                
                return {
                    "success": True,
                    "translated_text": translated_response,
                    "language": language_name,
                    "has_diarization": False
                }
            else:
                # Plain text translation
                prompt = f"Translate the following text to {language_name}:\n\n{req.transcript[:6000]}"
                resp = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role": "system", "content": f"You are a professional translator. Translate accurately to {language_name}."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3, 
                    max_tokens=4000
                )
                
                translated_response = resp.choices[0].message.content.strip()
                
                return {
                    "success": True,
                    "translated_text": translated_response,
                    "language": language_name,
                    "has_diarization": False
                }
    except Exception as e:
        print(f"[TRANSLATE] Error: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/admin/delete-call")
async def delete_call(req: DeleteCallRequest):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database error"})
    try:
        temp_sb = create_client(url, key)
        auth = temp_sb.auth.sign_in_with_password({"email": "admin@10xds.com", "password": req.password})
        if not auth.user: return JSONResponse(status_code=401, content={"error": "Invalid admin password"})
        
        # First, get the call data to retrieve the filename
        call_data = supabase.table('calls').select("filename, audio_url").eq('id', req.call_id).execute()
        if not call_data.data or len(call_data.data) == 0:
            return JSONResponse(status_code=404, content={"error": "Call not found"})
        
        filename = call_data.data[0].get('filename')
        audio_url = call_data.data[0].get('audio_url')
        
        # Delete from database
        res = supabase.table('calls').delete().eq('id', req.call_id).execute()
        
        # Delete audio file from Supabase storage if it exists
        if filename:
            try:
                # Try to delete from the 'audio-files' bucket (common bucket name)
                # Adjust bucket name if your setup uses a different name
                bucket_name = "audio-files"
                supabase.storage.from_(bucket_name).remove([filename])
                print(f"[DELETE] Successfully deleted audio file from storage: {filename}")
            except Exception as storage_error:
                # Log the error but don't fail the delete operation
                # The database record is already deleted at this point
                print(f"[DELETE] Warning: Could not delete audio file from storage: {storage_error}")
                # Continue with success response since DB deletion succeeded
        
        return {"success": True, "message": "Call deleted"}
    except Exception as e:
        if "Invalid login credentials" in str(e): return JSONResponse(status_code=401, content={"error": "Invalid admin password"})
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/admin/reanalyze-call")
async def reanalyze_call(req: Dict[str, Any]):
    """Re-run LLM analysis on an existing call to improve speaker detection."""
    call_id = req.get("call_id")
    password = req.get("password")
    
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database error"})
    if not call_id: return JSONResponse(status_code=400, content={"error": "Call ID required"})

    try:
        # Verify admin
        temp_sb = create_client(url, key)
        auth = temp_sb.auth.sign_in_with_password({"email": "admin@10xds.com", "password": password})
        if not auth.user: return JSONResponse(status_code=401, content={"error": "Invalid admin password"})

        # Fetch existing call
        res = supabase.table('calls').select("*").eq('id', call_id).execute()
        if not res.data: return JSONResponse(status_code=404, content={"error": "Call not found"})
        
        call_data = res.data[0]
        transcript = call_data.get("transcript")
        diarization_data = call_data.get("diarization_data")
        
        if not transcript:
            return JSONResponse(status_code=400, content={"error": "No transcript available for re-analysis"})

        print(f"[REANALYZE] Re-running analysis for call {call_id}...")
        
        # Run improved analysis
        sentiment, tags, summary, speakers = analyze_transcript(transcript, diarization_data=diarization_data)
        
        # Patch diarization_data if we have speaker detection
        if speakers and diarization_data:
            sorted_diarization = sorted(diarization_data, key=lambda x: x.get('start', 0))
            speaker_map = {}
            speaker_index = 1
            for segment in sorted_diarization:
                orig_id = segment.get('speaker', 'Unknown')
                if orig_id not in speaker_map:
                    label = f"Speaker {speaker_index}"
                    name = speakers.get(label, label)
                    # Safety: only take the name part if LLM included a role with a comma
                    if isinstance(name, str) and ',' in name:
                        name = name.split(',')[0].strip()
                    speaker_map[orig_id] = name
                    speaker_index += 1
                segment['display_name'] = speaker_map[orig_id]
            diarization_data = sorted_diarization

        # Update record
        update_data = {
            "sentiment": sentiment,
            "tags": tags,
            "summary": summary,
            "diarization_data": diarization_data,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        supabase.table('calls').update(update_data).eq('id', call_id).execute()
        
        return {
            "success": True, 
            "message": "Call re-analyzed successfully",
            "sentiment": sentiment,
            "tags": tags,
            "summary": json.loads(summary) if isinstance(summary, str) and summary.startswith('{') else summary
        }

    except Exception as e:
        print(f"[REANALYZE] Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})






# --- Notification System (Global SSE) ---

class NotificationManager:
    def __init__(self):
        self.active_connections: List[asyncio.Queue] = []

    async def connect(self):
        queue = asyncio.Queue()
        self.active_connections.append(queue)
        print(f"[NOTIFY] Client connected. Total: {len(self.active_connections)}")
        try:
            while True:
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            self.active_connections.remove(queue)
            print(f"[NOTIFY] Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        if not self.active_connections:
            return
        
        # Create tasks for all queues
        for queue in self.active_connections:
            await queue.put(message)

notification_manager = NotificationManager()

@app.get("/api/notifications/stream")
async def notifications_stream(request: Request):
    return StreamingResponse(
        notification_manager.connect(),
        media_type="text/event-stream"
    )

# --- Vapi Webhook Handling ---

async def process_vapi_call_background(url: str, temp_path: str, filename: str, notification_manager: NotificationManager, medium: str = None):
    """
    Background task to process Vapi call and broadcast updates.
    """
    def create_event(step, message, status="active", file_id=None):
        payload = {"step": step, "message": message, "status": status}
        if file_id: payload["file_id"] = file_id
        return json.dumps(payload)

    await notification_manager.broadcast(create_event("start", "New Vapi call received. Starting processing..."))
    
    print(f"[VAPI] Downloading recording from {url}...")
    await notification_manager.broadcast(create_event("download", "Downloading audio file..."))
    
    try:
        # Download Recording
        # Use run_in_threadpool for blocking I/O
        def download_file():
            with requests.get(url, stream=True) as r:
                r.raise_for_status()
                with open(temp_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
        
        await run_in_threadpool(download_file)
        
        print(f"[VAPI] Download complete: {temp_path}")
        await notification_manager.broadcast(create_event("download", "Download complete", "complete"))
        
        # Upload to Supabase Storage
        audio_url = None
        await notification_manager.broadcast(create_event("upload", "Uploading to Supabase Storage...", "active"))
        
        # Check for existing file in Supabase Storage
        def check_and_upload_supabase():
            try:
                existing_url = check_file_exists_in_supabase(filename)
                if existing_url:
                    print(f"\n{'='*50}\n[VAPI DEBUG] FILE EXISTS IN SUPABASE\nURL: {existing_url}\n{'='*50}\n")
                    return existing_url, False, None  # URL, is_new, error
                else:
                    print(f"\n{'='*50}\n[VAPI DEBUG] STARTING SUPABASE UPLOAD\nFilename: {filename}\n{'='*50}\n")
                    new_url = upload_audio_to_supabase(temp_path, filename)
                    if new_url:
                        print(f"\n{'='*50}\n[VAPI DEBUG] UPLOAD SUCCESSFUL\nURL: {new_url}\n{'='*50}\n")
                        return new_url, True, None
                    else:
                        return None, False, "Upload function returned None"
            except Exception as upload_err:
                print(f"\n{'='*50}\n[VAPI DEBUG] SUPABASE UPLOAD ERROR\n{upload_err}\n{'='*50}\n")
                import traceback
                traceback.print_exc()
                return None, False, str(upload_err)
        
        audio_url, is_new, upload_error = await run_in_threadpool(check_and_upload_supabase)
        
        # STRICT CHECK: Abort if upload failed
        if not audio_url:
            error_msg = f"[VAPI] CRITICAL: Supabase Storage upload FAILED. Error: {upload_error}"
            print(error_msg)
            await notification_manager.broadcast(create_event("upload", f"Supabase Upload Failed - Processing Aborted", "error"))
            print("[VAPI] ABORTING: File was NOT uploaded to Supabase. Processing cancelled.")
            print(f"[VAPI] Error details: {upload_error}")
            return
        
        # Upload successful - proceed with processing
        if is_new:
            await notification_manager.broadcast(create_event("upload", "Saved to Supabase Storage! Starting analysis...", "complete"))
        else:
            await notification_manager.broadcast(create_event("upload", "File already in Supabase Storage. Proceeding...", "complete"))
            
        # Run Analysis Pipeline (only if Supabase upload succeeded)
        print("[VAPI] Supabase upload confirmed. Starting Analysis Pipeline...")
        await notification_manager.broadcast(create_event("analyze", "Analyzing call sentiment..."))
        
        # process_audio_file is synchronous
        await run_in_threadpool(process_audio_file, temp_path, filename, medium=medium)
        
        print("[VAPI] Processing Complete!")
        await notification_manager.broadcast(create_event("done", "Analysis complete!", "success"))
        
    except Exception as e:
        print(f"[VAPI] Error processing Vapi call: {e}")
        await notification_manager.broadcast(create_event("error", f"Error: {str(e)}", "error"))
    finally:
        # Cleanup
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@app.post("/api/vapi-call")
async def handle_vapi_call(request: Request, background_tasks: BackgroundTasks):
    """
    Endpoint to receive Vapi webhook payloads.
    Vapi sends different event types with varying structures.
    """
    try:
        # Get raw JSON payload
        payload = await request.json()

        
        # Extract recording URL from different possible locations in Vapi's payload
        recording_url = None
        
        # Check common paths where Vapi might put the recording URL
        if isinstance(payload, dict):
            check_obj = payload.get('message', payload)
            message_type = check_obj.get('type')
            call_id = check_obj.get('call', {}).get('id') or payload.get('call', {}).get('id')
            
            # Debug Log
            if message_type not in ['speech-update', 'model-output']:  # Filter noise
                print(f"[VAPI DEBUG] Type: {message_type}, Call ID: {call_id}")

        
        # --- 1. Handle Status Updates (Live Call Tracking) ---
        if message_type == 'status-update' or message_type == 'call-status-update':
            status = check_obj.get('status')
            if call_id and status and supabase:
                print(f"[VAPI LIVE] Status Update: {call_id} -> {status}")
                data = {
                    "call_id": call_id,
                    "status": status,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                
                # NOTE: Schema provided does not have started_at, ended_at, cost, summary.
                # Commenting out to prevent 'column does not exist' errors.
                # if status == 'started':
                #     data['started_at'] = datetime.now(timezone.utc).isoformat()
                # elif status == 'ended':
                #     data['ended_at'] = datetime.now(timezone.utc).isoformat()
                #     if 'cost' in check_obj: data['cost'] = check_obj['cost']
                #     if 'summary' in check_obj: data['summary'] = check_obj['summary']

                # Extract customer phone if available (Schema supports this)
                customer_phone = check_obj.get('call', {}).get('customer', {}).get('number')
                if customer_phone:
                    data['customer_phone'] = customer_phone

                try:
                    # Use on_conflict to ensure upsert works with unique call_id constraint
                    await asyncio.to_thread(lambda: supabase.table('vapi_calls').upsert(data, on_conflict='call_id').execute())
                    
                    # Broadcast notification for started/in-progress calls
                    if status in ['started', 'in-progress']:
                        print(f"[VAPI LIVE] Broadcasting call started event for {call_id}")
                        await notification_manager.broadcast(json.dumps({
                            "type": "vapi_call_started",
                            "call_id": call_id,
                            "status": status,
                            "message": f"A new live call has started (ID: {call_id[:8]}...)"
                        }))
                    elif status in ['ended', 'failed', 'completed']:
                        print(f"[VAPI LIVE] Broadcasting call ended event for {call_id}")
                        await notification_manager.broadcast(json.dumps({
                            "type": "vapi_call_ended",
                            "call_id": call_id,
                            "status": status
                        }))
                except Exception as e:
                    print(f"[VAPI LIVE] Error updating call status: {e}")

        # --- 2. Handle Live Transcripts ---
        elif message_type == 'transcript' and check_obj.get('transcriptType') == 'final':
            transcript_text = check_obj.get('transcript')
            role = check_obj.get('role', 'user') # 'user' or 'assistant'
            
            if call_id and transcript_text and supabase:
                print(f"[VAPI LIVE] Transcript: {role}: {transcript_text[:30]}...")
                t_data = {
                    "call_id": call_id,
                    "role": role,
                    "transcript": transcript_text,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                try:
                    await asyncio.to_thread(lambda: supabase.table('transcripts').insert(t_data).execute())
                except Exception as e:
                    print(f"[VAPI LIVE] Error saving transcript: {e}")
                    # Retry logic for Foreign Key Violation (race condition where call doesn't exist yet)
                    if "foreign key" in str(e).lower() or "constraint" in str(e).lower():
                        print(f"[VAPI LIVE] Missing parent call {call_id}, creating placeholder...")
                        try:
                            parent_data = {
                                "call_id": call_id,
                                "status": "in-progress",
                                "updated_at": datetime.now(timezone.utc).isoformat()
                            }
                            await asyncio.to_thread(lambda: supabase.table('vapi_calls').upsert(parent_data, on_conflict='call_id').execute())
                            # Retry transcript insert
                            await asyncio.to_thread(lambda: supabase.table('transcripts').insert(t_data).execute())
                            print(f"[VAPI LIVE] Retry successful for transcript.")
                        except Exception as e2:
                            print(f"[VAPI LIVE] Retry failed: {e2}")
                except Exception as e:
                    print(f"[VAPI LIVE] Error saving transcript: {e}")

        # --- 3. PROCEED TO ORIGINAL RECORDING URL CHECK ---
        # Get raw JSON payload
        # (check_obj is already set above)
            
        # Extract recording URL from different possible locations in Vapi's payload
        recording_url = None
        
        # Check common paths where Vapi might put the recording URL
        if isinstance(payload, dict):
            # Direct recording_url field
            recording_url = check_obj.get('recording_url') or check_obj.get('recordingUrl')
            
            # Nested in artifact
            if not recording_url and 'artifact' in check_obj:
                artifact = check_obj['artifact']
                recording_url = artifact.get('recordingUrl') or artifact.get('recording_url')
            
            # Nested in call object
            if not recording_url and 'call' in check_obj:
                call = check_obj['call']
                recording_url = call.get('recordingUrl') or call.get('recording_url')
                
                # Check artifact inside call
                if not recording_url and 'artifact' in call:
                    artifact = call['artifact']
                    recording_url = artifact.get('recordingUrl') or artifact.get('recording_url')
            
            # Stereo recording URL as fallback
            if not recording_url:
                recording_url = check_obj.get('stereoRecordingUrl')
                if not recording_url and 'artifact' in check_obj:
                    recording_url = check_obj['artifact'].get('stereoRecordingUrl')
        
        if not recording_url:
            # Silence logs for normal status updates to avoid clutter
            if message_type not in ['status-update', 'transcript', 'call-status-update']:
                print(f"[VAPI WEBHOOK] No recording URL found in payload (Type: {message_type})")
            return {"status": "received", "message": "Event processed"}
        
        
        print(f"[VAPI WEBHOOK] Extracted recording URL: {recording_url}")
        
        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"vapi_call_{timestamp}.wav"
        
        safe_name = secure_filename(filename)
        temp_path = os.path.join(UPLOAD_FOLDER, safe_name)
        
        # Trigger background task
        background_tasks.add_task(process_vapi_call_background, recording_url, temp_path, safe_name, notification_manager)
        
        return {"status": "processing", "message": "Call processing started in background"}
        
    except Exception as e:
        print(f"[VAPI WEBHOOK] Error processing webhook: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})



import aiofiles

@app.get("/api/debug/live-calls")
async def debug_live_calls():
    """Debug endpoint to check vapi_calls table content directly from backend."""
    if not supabase: return {"error": "Supabase not connected"}
    try:
        # Fetch all recent calls without filters
        response = supabase.table('vapi_calls').select('*').order('created_at', desc=True).limit(20).execute()
        return {
            "count": len(response.data),
            "data": response.data,
            "server_time": datetime.now().isoformat()
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    # ... rest of main ...
    # Removed blocking syncs from here. They are now handled in startup_event background task.
    # sync_seen_ids_from_db()
    
    print("[SERVER] Starting FastAPI Server with Uvicorn...")
    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=True)