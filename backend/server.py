"""InstaPark Valet Parking Management Backend."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Query, Body, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse, RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo
from pathlib import Path
import os, uuid, logging, asyncio, bcrypt, jwt, requests, smtplib, re, random, time, subprocess, tempfile, shutil
import static_ffmpeg
from email.mime.text import MIMEText 
from email.mime.multipart import MIMEMultipart 
from email.utils import make_msgid
import cloudinary
import cloudinary.uploader
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---- Config ----
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_EXPIRE_HOURS = int(os.environ.get('JWT_EXPIRE_HOURS', 24))
# EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY')
APP_NAME = os.environ.get('APP_NAME', 'instapark')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://domain.com')
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com") 
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587")) 
SMTP_USER = os.environ.get("SMTP_USER", "") 
SMTP_PASS = os.environ.get("SMTP_PASS", "") 
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "InstaPark") 
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "noreply@instapark.ai")
SMS_PROVIDER = os.environ.get("SMS_PROVIDER", "stub")  # "twilio" or "msg91" or "stub"
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.environ.get("TWILIO_FROM", "")
MSG91_API_KEY = os.environ.get("MSG91_API_KEY", "")
MSG91_SENDER_ID = os.environ.get("MSG91_SENDER_ID", "INSTPK")
# STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
# Cloudinary config
cloudinary.config(
    cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key=os.environ.get('CLOUDINARY_API_KEY'),
    api_secret=os.environ.get('CLOUDINARY_API_SECRET')
)

try:
    FFMPEG_PATH, FFPROBE_PATH = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
except Exception as e:
    logging.getLogger("instapark").warning(f"Failed to fetch static_ffmpeg binaries: {e}")
    FFMPEG_PATH = None
    FFPROBE_PATH = None

client = AsyncIOMotorClient(
    MONGO_URL,
    maxPoolSize=10,
    minPoolSize=2,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    socketTimeoutMS=30000,
)
db = client[DB_NAME]

# Safe projection for driver documents — never expose credential fields
SAFE_DRIVER_PROJ = {
    "_id": 0, "hashed_pin": 0, "hashed_password": 0, "pin": 0
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("instapark")

test_checkin_log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_checkin.log")
test_checkin_logger = logging.getLogger("test_checkin")
test_checkin_logger.setLevel(logging.INFO)
_test_checkin_handler = logging.FileHandler(test_checkin_log_path)
_test_checkin_handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s'))
test_checkin_logger.addHandler(_test_checkin_handler)
test_checkin_logger.propagate = False

app = FastAPI(title="InstaPark API")
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
api_router = APIRouter(prefix="/api/v1")
bearer = HTTPBearer(auto_error=False)

@app.get("/health")
async def health():
    try:
        await client.admin.command("ping")
        return {"status": "ok", "db": "connected", "timestamp": now_iso()}
    except Exception as e:
        logger.error(f"Health check DB ping failed: {e}")
        raise HTTPException(503, "Database unavailable")


# ---- Storage ----
# storage_key: Optional[str] = None
# def init_storage():
#     global storage_key
#     if storage_key:
#         return storage_key
#     try:
#         r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
#         r.raise_for_status()
#         storage_key = r.json()["storage_key"]
#         return storage_key
#     except Exception as e:
#         logger.error(f"Storage init failed: {e}")
#         return None

# def put_object(path: str, data: bytes, content_type: str) -> dict:
#     key = init_storage()
#     if not key:
#         raise HTTPException(500, "Storage not initialized")
#     r = requests.put(f"{STORAGE_URL}/objects/{path}",
#                      headers={"X-Storage-Key": key, "Content-Type": content_type},
#                      data=data, timeout=120)
#     r.raise_for_status()
#     return r.json()

async def put_object(path: str, data: bytes, content_type: str = "image/jpeg") -> dict:
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: cloudinary.uploader.upload(
                data,
                public_id=path,
                resource_type="auto",
                overwrite=True
            )
        )
        return result
    except Exception as e:
        logger.error(f"Cloudinary upload failed: {e}")
        raise HTTPException(500, f"Upload failed: {str(e)}")


# ---- Helpers ----
def send_sms(phone: str, message: str):
    try:
        if SMS_PROVIDER == "twilio" and TWILIO_ACCOUNT_SID:
            from twilio.rest import Client
            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            # Normalize Indian numbers
            to = f"+91{phone}" if len(phone) == 10 else phone
            client.messages.create(to=to, from_=TWILIO_FROM, body=message)
        elif SMS_PROVIDER == "msg91" and MSG91_API_KEY:
            import requests as req
            payload = {"sender": MSG91_SENDER_ID, "route": "4", "country": "91",
                       "sms": [{"message": message, "to": [phone]}]}
            req.post("https://api.msg91.com/api/v2/sendsms",
                     json=payload, headers={"authkey": MSG91_API_KEY, "content-type": "application/json"})
        else:
            logger.info(f"[SMS STUB] To: {phone} | {message}")
    except Exception as e:
        logger.error(f"SMS send failed to {phone}: {e}")

def _title_case_name(name: str) -> str:
    if not name:
        return name
    return " ".join(word.capitalize() for word in str(name).strip().split())

def _html_to_text(html_body: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', html_body)
    return re.sub(r'\s+', ' ', text).strip()

def _send_smtp(to: str, subject: str, html_body: str):
    if not SMTP_USER or not SMTP_PASS:
        logger.info(f"[EMAIL STUB] To: {to} | Subject: {subject}")
        logger.info(f"[EMAIL STUB] Body: {html_body[:200]}...")
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to
    msg["Reply-To"] = SMTP_USER
    msg["Message-ID"] = make_msgid()
    msg.attach(MIMEText(_html_to_text(html_body), "plain"))
    msg.attach(MIMEText(html_body, "html"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, to, msg.as_string())
    logger.info(f"[EMAIL SENT] To: {to} | Subject: {subject}")

async def send_email(to: str, subject: str, html_body: str):
    if RESEND_API_KEY:
        try:
            import httpx
            async with httpx.AsyncClient() as client_http:
                resp = await client_http.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                    json={"from": EMAIL_FROM, "to": [to], "subject": subject, "html": html_body},
                    timeout=10
                )
                if resp.status_code not in (200, 201):
                    logger.error(f"Resend email failed: {resp.status_code} — {resp.text}")
        except Exception as e:
            logger.error(f"Email to {to} failed: {e}")
    else:
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, _send_smtp, to, subject, html_body)
        except Exception as e:
            logger.error(f"[EMAIL ERROR] To: {to} | Error: {e}")

async def send_expo_push(tokens: list, title: str, body_text: str, data: dict = {}):
    """Send push notifications via Expo Push API. Silently ignores failures."""
    logger.info(f"[PUSH] send_expo_push called with {len(tokens)} raw tokens, title='{title}'")
    if not tokens:
        return
    valid_tokens = [t for t in tokens if t and isinstance(t, str) and t.startswith("ExponentPushToken")]
    if not valid_tokens:
        return
    logger.info(f"[PUSH] {len(valid_tokens)} valid ExponentPushToken(s) found after filtering")
    messages = [
        {"to": t, "title": title, "body": body_text, "data": data, "sound": "default"}
        for t in valid_tokens
    ]
    try:
        import httpx
        async with httpx.AsyncClient() as c:
            resp = await c.post(
                "https://exp.host/--/api/v2/push/send",
                json=messages,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                timeout=10
            )
            try:
                result = resp.json()
                tickets = result.get("data", [])
                for i, ticket in enumerate(tickets):
                    if ticket.get("status") == "error":
                        details = ticket.get("details", {})
                        err_type = details.get("error", "unknown")
                        token = valid_tokens[i] if i < len(valid_tokens) else "unknown"
                        logger.warning(f"[PUSH] Ticket error for token={token[:30]}... type={err_type} message={ticket.get('message','')}")
                        if err_type == "DeviceNotRegistered":
                            logger.warning(f"[PUSH] DeviceNotRegistered — token should be cleared from DB: {token[:30]}...")
                    else:
                        token = valid_tokens[i] if i < len(valid_tokens) else "unknown"
                        logger.info(f"[PUSH] Ticket ok for token={token[:30]}... id={ticket.get('id','?')}")
            except Exception as parse_err:
                logger.warning(f"[PUSH] Could not parse Expo response: {parse_err}")
    except Exception as e:
        logger.warning(f"[PUSH] Failed: {e}")

async def get_event_driver_tokens(event_id: str) -> list:
    """Return push tokens for all active drivers assigned to an event."""
    assignments = await db.event_drivers.find(
        {"event_id": event_id, "assigned": True}, {"_id": 0, "driver_id": 1}
    ).to_list(500)
    driver_ids = [a["driver_id"] for a in assignments]
    if not driver_ids:
        return []
    drivers = await db.drivers.find(
        {"id": {"$in": driver_ids}, "is_active": True, "push_token": {"$exists": True, "$ne": None}},
        {"_id": 0, "push_token": 1}
    ).to_list(500)
    return [d["push_token"] for d in drivers if d.get("push_token")]

async def get_event_supervisor_tokens(event_id: str) -> list:
    """Return push tokens for all active supervisors assigned to an event."""
    assignments = await db.event_supervisors.find(
        {"event_id": event_id}, {"_id": 0, "supervisor_id": 1}
    ).to_list(200)
    sup_ids = [a["supervisor_id"] for a in assignments]
    if not sup_ids:
        return []
    sups = await db.drivers.find(
        {"id": {"$in": sup_ids}, "is_active": True, "push_token": {"$exists": True, "$ne": None}},
        {"_id": 0, "push_token": 1}
    ).to_list(200)
    return [s["push_token"] for s in sups if s.get("push_token")]

async def get_provider_admin_tokens(provider_id: str) -> list:
    """Return push token for the admin of a provider."""
    prov = await db.providers.find_one(
        {"id": provider_id, "push_token": {"$exists": True, "$ne": None}},
        {"_id": 0, "push_token": 1}
    )
    return [prov["push_token"]] if prov and prov.get("push_token") else []

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _fix_gate_timer(car: dict) -> dict:
    val = car.get("gate_timer_expires_at")
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        car["gate_timer_expires_at"] = val.isoformat()
    return car


async def refresh_driver_duty_status(driver_id: str):
    """Recompute a driver's duty_status from what's actually still on their plate,
    instead of blindly flipping to available — a driver can be handling more than one
    car at once if a supervisor deliberately double-booked them."""
    active = await db.cars.find_one({
        "deleted": {"$ne": True},
        "$or": [
            {"check_in_driver_id": driver_id, "status": "CHECKED_IN"},
            {"retrieval_driver_id": driver_id, "status": {"$in": ["BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"]}},
        ]
    }, {"_id": 0, "id": 1})
    await db.drivers.update_one(
        {"id": driver_id},
        {"$set": {"duty_status": "busy" if active else "available", "duty_status_updated_at": now_iso()}}
    )


async def record_assignment(
    car_id: str,
    event_id: str,
    driver_id: str,
    action: str,
    source: str,
    performed_by: Optional[dict] = None,
    previous_driver_id: Optional[str] = None,
):
    """Append-only audit record for every car<->driver assignment event.
    action: checkin_assigned | retrieval_assigned | reassigned
    source: self | admin | supervisor | superadmin
    performed_by: {"user_id","name","role"} — None when source == "self"
    """
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "name": 1})
    doc = {
        "id": str(uuid.uuid4()),
        "car_id": car_id,
        "event_id": event_id,
        "driver_id": driver_id,
        "driver_name": driver["name"] if driver else None,
        "action": action,
        "source": source,
        "performed_by": performed_by,
        "previous_driver_id": previous_driver_id,
        "created_at": now_iso(),
    }
    await db.assignments.insert_one(doc.copy())
    await manager.broadcast(f"event:{event_id}", {"type": "assignment_created", "data": doc})
    return doc


async def is_email_taken(email: str, exclude_id: str = None) -> bool:
    """Check if an email is already used by any driver, supervisor, provider, or superadmin."""
    if not email:
        return False
    email = email.lower()
    query = {"email": email}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    if await db.providers.find_one(query):
        return True
    if await db.drivers.find_one(query):
        return True
    if await db.superadmins.find_one(query):
        return True
    return False


async def is_phone_taken(phone: str, exclude_id: str = None) -> bool:
    """Check if a phone number is already used by any driver, supervisor, or provider."""
    if not phone:
        return False
    driver_query = {"phone": phone}
    if exclude_id:
        driver_query["id"] = {"$ne": exclude_id}
    if await db.drivers.find_one(driver_query):
        return True
    provider_query = {"phone": phone}
    if exclude_id:
        provider_query["id"] = {"$ne": exclude_id}
    if await db.providers.find_one(provider_query):
        return True
    return False

def hash_password(pw: str) -> str:
    pw_bytes = pw.encode()
    if len(pw_bytes) > 72:
        raise HTTPException(400, "Password must be 72 characters or fewer")
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_token(payload: dict) -> str:
    to_encode = payload.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    return jwt.encode(to_encode, JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

async def get_current(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(creds.credentials)
    role = payload.get("role")
    user_id = payload.get("user_id")
    if role in ("driver", "supervisor") and user_id:
        db_user = await db.drivers.find_one({"id": user_id}, {"_id": 0, "is_active": 1})
        if db_user and db_user.get("is_active") == False:
            raise HTTPException(401, "Account deactivated")
    if role in ("admin", "owner") and payload.get("provider_id"):
        db_provider = await db.providers.find_one(
            {"id": payload["provider_id"]}, {"_id": 0, "is_active": 1}
        )
        if db_provider and db_provider.get("is_active") == False:
            raise HTTPException(401, "Account deactivated")
    return payload

async def get_current_optional(credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False))):
    if not credentials:
        return None
    try:
        return decode_token(credentials.credentials)
    except:
        return None

def require_roles(*roles):
    async def checker(user=Depends(get_current)):
        if user.get("role") not in roles:
            raise HTTPException(403, "Forbidden")
        return user
    return checker

def clean(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc

# ---- WebSocket Manager ----
class ConnManager:
    def __init__(self):
        self.channels: Dict[str, List[WebSocket]] = {}

    async def connect(self, channel: str, ws: WebSocket):
        await ws.accept()
        self.channels.setdefault(channel, []).append(ws)

    def disconnect(self, channel: str, ws: WebSocket):
        if channel in self.channels and ws in self.channels[channel]:
            self.channels[channel].remove(ws)

    async def broadcast(self, channel: str, message: dict):
        sockets = list(self.channels.get(channel, []))
        async def _send(ws):
            try:
                await asyncio.wait_for(ws.send_json(message), timeout=2.0)
            except Exception:
                pass
        await asyncio.gather(*[_send(ws) for ws in sockets])

manager = ConnManager()

OTP_EXPIRY_SECONDS = 600  # 10 minutes
INVITE_OTP_EXPIRY_SECONDS = 86400  # 24 hours
APP_DOWNLOAD_LINK = ""  # TODO: add real app store / download link later
OTP_MAX_ATTEMPTS = 5      # lock out after 5 wrong guesses
OTP_RATE_LIMIT_WINDOW = 900  # 15 min window for send rate-limit
OTP_RATE_LIMIT_MAX = 3    # max 3 OTP sends per window
DEFAULT_GATE_TIMER_MINUTES = 5  # fallback if event has no custom gate timer set

async def _otp_set(key: str, otp: str, extra: dict, ttl_seconds: int = OTP_EXPIRY_SECONDS):
    """Persist OTP to MongoDB with TTL-based expiry."""
    await db.otp_store.update_one(
        {"key": key},
        {"$set": {
            "key": key,
            "otp": otp,
            "expires": time.time() + ttl_seconds,
            "attempts": 0,
            **extra
        }},
        upsert=True
    )

async def _otp_get(key: str) -> dict | None:
    return await db.otp_store.find_one({"key": key}, {"_id": 0})

async def _otp_delete(key: str):
    await db.otp_store.delete_one({"key": key})

async def _otp_increment_attempts(key: str) -> int:
    result = await db.otp_store.find_one_and_update(
        {"key": key},
        {"$inc": {"attempts": 1}},
        return_document=True
    )
    return result["attempts"] if result else OTP_MAX_ATTEMPTS

async def _otp_check_rate_limit(rate_key: str) -> bool:
    """Returns True if allowed (under limit), False if rate-limited."""
    now = time.time()
    window_start = now - OTP_RATE_LIMIT_WINDOW
    rec = await db.otp_rate_limits.find_one({"key": rate_key})
    if rec:
        sends = [t for t in rec.get("sends", []) if t > window_start]
        if len(sends) >= OTP_RATE_LIMIT_MAX:
            return False
        sends.append(now)
        await db.otp_rate_limits.update_one(
            {"key": rate_key}, {"$set": {"sends": sends}}
        )
    else:
        await db.otp_rate_limits.insert_one({"key": rate_key, "sends": [now]})
    return True

async def broadcast_car_update(car: dict):
    car = _fix_gate_timer(car)
    cid, eid = car["id"], car["event_id"]
    tasks = [
        manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car}),
        manager.broadcast(f"event:{eid}", {"type": "car_update", "data": car}),
    ]
    if car["status"] in ("RETRIEVAL_REQUESTED", "BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"):
        tasks.append(manager.broadcast(f"retrievals:{eid}", {"type": "retrieval_update", "data": car}))
    await asyncio.gather(*tasks)

class SOSBody(BaseModel):
    alert_type: str  # "BLOCKED_CAR", "DAMAGE_CLAIM", "NEED_HELP", "MEDICAL", "OTHER"
    note: Optional[str] = None
    car_id: Optional[str] = None
    car_number: Optional[str] = None

# ============== AUTH ==============

class LoginEmail(BaseModel):
    email: str
    password: str

class LoginPhone(BaseModel):
    phone: str
    password: str  # Note: holds PIN for drivers

class PhoneChange(BaseModel):
    new_phone: str
    target_account_id: str | None = None

class PhoneChangeVerify(BaseModel):
    otp: str
    target_account_id: str | None = None

@api_router.post("/auth/superadmin/login")
async def superadmin_login(body: LoginEmail):
    sa = await db.superadmins.find_one({"email": body.email.lower()})
    if not sa or not verify_password(body.password, sa["hashed_password"]):
        logger.warning(f"[AUTH] login fail reason=invalid_credentials identifier={body.email.lower()}")
        raise HTTPException(401, "Invalid credentials")
    payload = {"user_id": sa["id"], "role": "superadmin", "name": sa["name"], "email": sa["email"]}
    token = create_token(payload)
    logger.info(f"[AUTH] login ok user_id={sa['id']} role=superadmin name={sa.get('name') or '?'}")
    return {"token": token, "superadmin": {"id": sa["id"], "name": sa["name"], "email": sa["email"]}}

@api_router.post("/auth/superadmin/forgot-password")
async def superadmin_forgot_password(body: dict = Body(...)):
    email = body.get("email", "").strip().lower()
    if not email:
        raise HTTPException(400, "Email is required")
    sa = await db.superadmins.find_one({"email": email}, {"_id": 0, "id": 1, "name": 1})
    if not sa:
        raise HTTPException(404, "No superadmin account found with this email address")
    if not await _otp_check_rate_limit(f"superadmin_rate_{email}"):
        raise HTTPException(429, "Too many requests. Please wait before requesting another OTP")
    otp = str(random.randint(100000, 999999))
    await _otp_set(f"superadmin_{email}", otp, {"superadmin_id": sa["id"]})
    html = f"""
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
          <div style="background:#0F2044;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#fff;margin:0;">InstaPark Superadmin Password Reset</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <p>Hi {_title_case_name(sa['name'])},</p>
            <p style="margin-top:12px;">Your superadmin password reset OTP is:</p>
            <div style="background:#EFF6FF;border-radius:10px;padding:20px;text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:900;letter-spacing:8px;color:#0F2044;">{otp}</span>
            </div>
            <p style="color:#6b7280;font-size:13px;">This OTP expires in 10 minutes. If you did not request this, ignore this email.</p>
          </div>
        </div>"""
    asyncio.create_task(send_email(to=email, subject="InstaPark Superadmin Password Reset", html_body=html))
    return {"message": "OTP sent successfully to your email"}

@api_router.post("/auth/superadmin/reset-password")
async def superadmin_reset_password(body: dict = Body(...)):
    email = body.get("email", "").strip().lower()
    otp = body.get("otp", "").strip()
    new_password = body.get("new_password", "").strip()
    if not all([email, otp, new_password]):
        raise HTTPException(400, "Email, OTP and new password are required")
    if len(new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    key = f"superadmin_{email}"
    stored = await _otp_get(key)
    if not stored:
        raise HTTPException(400, "Invalid or expired OTP")
    if time.time() > stored["expires"]:
        await _otp_delete(key)
        raise HTTPException(400, "OTP has expired")
    attempts = await _otp_increment_attempts(key)
    if attempts > OTP_MAX_ATTEMPTS:
        await _otp_delete(key)
        raise HTTPException(400, "Too many incorrect attempts. Please request a new OTP")
    if stored["otp"] != otp:
        raise HTTPException(400, "Incorrect OTP")
    hashed = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    await db.superadmins.update_one({"id": stored["superadmin_id"]}, {"$set": {"hashed_password": hashed}})
    await _otp_delete(key)
    return {"message": "Password reset successfully"}

async def resolve_true_role(account: dict, collection_name: str) -> dict:
    """Given an account doc and which collection it came from, resolve the TRUE 
    role (owner vs admin) and provider linkage via the providers collection when 
    the account is an 'admin' mirror record in drivers. Returns the account dict 
    with role, parent_provider_id, provider_type, hashed_password patched in."""
    if account.get("role") == "admin" and collection_name == "drivers" and account.get("provider_id"):
        true_prov = await db.providers.find_one({"id": account["provider_id"]})
        if true_prov:
            account["role"] = true_prov.get("role", "admin")
            account["parent_provider_id"] = true_prov.get("parent_provider_id")
            account["provider_type"] = true_prov.get("provider_type")
            if account["role"] == "owner":
                account["id"] = true_prov["id"]
    return account

@api_router.post("/auth/login")
@limiter.limit("10/minute")
async def auth_login(request: Request, body: LoginPhone):
    phone = body.phone.strip()
    if not re.match(r"^\d{10}$", phone):
        logger.warning(f"[AUTH] login fail reason=invalid_format identifier={phone}")
        raise HTTPException(401, "Invalid credentials")
    
    account = None
    collection_name = None

    account = await db.drivers.find_one({"phone": phone})
    if account:
        collection_name = "drivers"
    else:
        account = await db.providers.find_one({"phone": phone})
        if account:
            collection_name = "providers"

    if not account:
        logger.warning(f"[AUTH] login fail reason=not_found identifier={phone}")
        raise HTTPException(401, "Invalid credentials")

    if not account.get("is_verified"):
        logger.warning(f"[AUTH] login fail reason=not_verified identifier={phone}")
        raise HTTPException(403, {"detail": "ACCOUNT_NOT_VERIFIED", "phone": phone, "role": account.get("role")})
        
    if not account.get("is_active", True):
        logger.warning(f"[AUTH] login fail reason=deactivated identifier={phone}")
        raise HTTPException(403, "Account deactivated")

    account = await resolve_true_role(account, collection_name)
    
    # verify credential
    role = account.get("role")
    
    if role == "driver":
        hashed_pin = account.get("hashed_pin")
        if hashed_pin:
            if not verify_password(body.password, hashed_pin):
                logger.warning(f"[AUTH] login fail reason=wrong_pin identifier={phone}")
                raise HTTPException(401, "Invalid credentials")
        else:
            if account.get("pin") != body.password:
                logger.warning(f"[AUTH] login fail reason=wrong_pin identifier={phone}")
                raise HTTPException(401, "Invalid credentials")
            # migrate pin
            await db.drivers.update_one(
                {"id": account["id"]},
                {"$set": {"hashed_pin": hash_password(body.password)}, "$unset": {"pin": ""}}
            )
    else:
        # provider, supervisor, admin, owner
        if not verify_password(body.password, account.get("hashed_password", "")):
            logger.warning(f"[AUTH] login fail reason=wrong_password identifier={phone}")
            raise HTTPException(401, "Invalid credentials")

    # verify parent provider active state
    if role in ("supervisor", "driver"):
        prov = await db.providers.find_one({"id": account["provider_id"]}, {"_id": 0, "is_active": 1, "provider_type": 1})
        if not prov or prov.get("is_active") is False:
            logger.warning(f"[AUTH] login fail reason=provider_deactivated identifier={phone}")
            raise HTTPException(403, "Provider account is deactivated")
        provider_type = prov.get("provider_type", "valet_provider")
        
        payload = {
            "user_id": account["id"],
            "role": role,
            "provider_id": account["provider_id"],
            "name": account["name"],
            "email": account.get("email"),
            "provider_type": provider_type
        }
    else:
        # owner, admin
        prov_role = account.get("role") or "owner"
        if prov_role == "admin":
            resolved_provider_id = account.get("parent_provider_id")
            if not resolved_provider_id:
                raise HTTPException(400, "This provider account is misconfigured (missing owner link)")
        else:
            prov_role = "owner"
            resolved_provider_id = account["id"]
            
        payload = {
            "user_id": account["id"],
            "role": prov_role,
            "provider_id": resolved_provider_id,
            "account_id": account["id"],
            "name": account["name"],
            "provider_type": account.get("provider_type", "valet_provider")
        }

    token = create_token(payload)
    return {
        "token": token,
        "user": {
            "id": account["id"],
            "name": account["name"],
            "role": payload["role"],
            "provider_id": payload["provider_id"]
        }
    }


@api_router.post("/auth/first-login/send-otp")
async def first_login_send_otp(body: dict = Body(...)):
    phone = body.get("phone", "").strip()
    if not re.match(r"^\d{10}$", phone):
        raise HTTPException(400, "Invalid phone number")
        
    account = None
    collection = None
    account = await db.drivers.find_one({"phone": phone})
    if account:
        collection = "drivers"
    else:
        account = await db.providers.find_one({"phone": phone})
        if account:
            collection = "providers"
            
    if not account:
        raise HTTPException(400, "Account not found")
        
    if account.get("is_verified"):
        raise HTTPException(400, "This account is already activated. Please log in.")
        
    if not await _otp_check_rate_limit(f"first_login_rate_{phone}"):
        raise HTTPException(429, "Too many requests. Please wait.")
        
    otp = str(random.randint(100000, 999999))
    await _otp_set(f"first_login_{phone}", otp, {"account_id": account["id"], "collection": collection})
    
    # send email
    email = account.get("email")
    if not email and account.get("provider_id"):
        provider = await db.providers.find_one({"id": account["provider_id"]})
        email = provider.get("email") if provider else None
        
    if email:
        html = f"""
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
          <div style="background:#0F2044;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#fff;margin:0;">InstaPark Account Activation</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <p>Hi {_title_case_name(account['name'])},</p>
            <p style="margin-top:12px;">Your OTP to activate your account is:</p>
            <div style="background:#EFF6FF;border-radius:10px;padding:20px;text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:900;letter-spacing:8px;color:#0F2044;">{otp}</span>
            </div>
            <p style="color:#6b7280;font-size:13px;">This OTP expires in 10 minutes.</p>
          </div>
        </div>"""
        asyncio.create_task(send_email(to=email, subject="InstaPark Activation OTP", html_body=html))
        # TODO: remove email-OTP fallback once SMS_PROVIDER is live
        
    # Send SMS (stub)
    send_sms(phone, f"Your InstaPark activation OTP is: {otp}")
    
    return {"message": "OTP sent"}

@api_router.post("/auth/first-login/verify")
async def first_login_verify(body: dict = Body(...)):
    phone = body.get("phone", "").strip()
    otp = body.get("otp", "").strip()
    new_credential = body.get("new_credential", "").strip()
    confirm_credential = body.get("confirm_credential", "").strip()
    
    if not all([phone, otp, new_credential, confirm_credential]):
        raise HTTPException(400, "All fields are required")
        
    if new_credential != confirm_credential:
        raise HTTPException(400, "Passwords/PINs do not match")
        
    key = f"first_login_{phone}"
    stored = await _otp_get(key)
    if not stored:
        raise HTTPException(400, "Invalid or expired OTP")
    if time.time() > stored["expires"]:
        await _otp_delete(key)
        raise HTTPException(400, "OTP has expired")
    attempts = await _otp_increment_attempts(key)
    if attempts > OTP_MAX_ATTEMPTS:
        await _otp_delete(key)
        raise HTTPException(400, "Too many incorrect attempts")
    if stored["otp"] != otp:
        raise HTTPException(400, "Incorrect OTP")
        
    collection = stored["collection"]
    account_id = stored["account_id"]
    
    db_col = db[collection]
    account = await db_col.find_one({"id": account_id})
    if not account:
        raise HTTPException(400, "Account no longer exists")
        
    role = account.get("role")
    
    if role == "driver":
        if not re.match(r"^\d{4}$", new_credential):
            raise HTTPException(400, "PIN must be exactly 4 digits")
        hashed = hash_password(new_credential)
        update_fields = {"hashed_pin": hashed}
    else:
        if len(new_credential) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        import re as _re
        if not _re.search(r'[A-Z]', new_credential):
            raise HTTPException(400, "Password must contain at least one uppercase letter")
        if not _re.search(r'[0-9]', new_credential):
            raise HTTPException(400, "Password must contain at least one number")
        if not _re.search(r'[^A-Za-z0-9]', new_credential):
            raise HTTPException(400, "Password must contain at least one special character")
        hashed = hash_password(new_credential)
        update_fields = {"hashed_password": hashed}
        
    update_fields.update({
        "is_verified": True,
        "is_phone_verified": True,
        "phone_verified_at": now_iso(),
        "is_active": True
    })
    
    await db_col.update_one({"id": account_id}, {"$set": update_fields})
    
    if collection == "drivers" and role in ("admin", "owner") and account.get("provider_id"):
        await db.providers.update_one(
            {"id": account["provider_id"]},
            {"$set": {
                "is_verified": True, 
                "is_phone_verified": True, 
                "phone_verified_at": update_fields["phone_verified_at"],
                "hashed_password": update_fields.get("hashed_password", account.get("hashed_password", ""))
            }}
        )
    elif collection == "providers":
        mirror = await db.drivers.find_one({"provider_id": account_id, "role": "admin"})
        if mirror:
            await db.drivers.update_one(
                {"id": mirror["id"]},
                {"$set": {
                    "is_verified": True, 
                    "is_phone_verified": True, 
                    "phone_verified_at": update_fields["phone_verified_at"],
                    "hashed_password": update_fields.get("hashed_password", account.get("hashed_password", ""))
                }}
            )
            
    await _otp_delete(key)
    
    # Generate token and return login response
    # We can fetch the updated account and use similar logic to auth_login
    updated_account = await db_col.find_one({"id": account_id})
    updated_account = await resolve_true_role(updated_account, collection)
    role = updated_account.get("role")
    if role in ("supervisor", "driver"):
        prov = await db.providers.find_one({"id": updated_account["provider_id"]}, {"_id": 0, "provider_type": 1})
        provider_type = prov.get("provider_type", "valet_provider") if prov else "valet_provider"
        payload = {
            "user_id": updated_account["id"],
            "role": role,
            "provider_id": updated_account["provider_id"],
            "name": updated_account["name"],
            "email": updated_account.get("email"),
            "provider_type": provider_type
        }
    else:
        prov_role = updated_account.get("role") or "owner"
        resolved_provider_id = updated_account.get("parent_provider_id") if prov_role == "admin" else updated_account["id"]
        payload = {
            "user_id": updated_account["id"],
            "role": prov_role,
            "provider_id": resolved_provider_id,
            "account_id": updated_account["id"],
            "name": updated_account["name"],
            "provider_type": updated_account.get("provider_type", "valet_provider")
        }
        
    token = create_token(payload)
    return {
        "token": token,
        "user": {
            "id": updated_account["id"],
            "name": updated_account["name"],
            "role": payload["role"],
            "provider_id": payload["provider_id"]
        }
    }

@api_router.post("/auth/phone-change/send-otp")
async def phone_change_send_otp(body: PhoneChange, user=Depends(get_current)):
    new_phone = body.new_phone.strip()
    if not re.match(r"^\d{10}$", new_phone):
        raise HTTPException(400, "Invalid phone number")
        
    target_id = body.target_account_id or user["user_id"]
    
    # Check if we are editing someone else
    if body.target_account_id and body.target_account_id != user["user_id"]:
        # Ensure user is admin/owner
        if user["role"] not in ("owner", "admin", "superadmin"):
            raise HTTPException(403, "Not authorized to change others' phone number")
            
    # Find target account
    target_account = await db.drivers.find_one({"id": target_id})
    collection = "drivers"
    if not target_account:
        target_account = await db.providers.find_one({"id": target_id})
        collection = "providers"
        
    if not target_account:
        raise HTTPException(404, "Target account not found")
        
    # Permission check for admins managing other drivers/supervisors
    if body.target_account_id and user["role"] != "superadmin":
        if target_account.get("provider_id") != user["provider_id"]:
             raise HTTPException(403, "Not authorized to modify this user")
             
    # Unique check
    if await is_phone_taken(new_phone, exclude_id=target_id):
        raise HTTPException(400, "This phone number is already registered")
        
    if not await _otp_check_rate_limit(f"phone_change_rate_{target_id}"):
        raise HTTPException(429, "Too many requests. Please wait.")
        
    await db[collection].update_one({"id": target_id}, {"$set": {"pending_phone": new_phone}})
    
    otp = str(random.randint(100000, 999999))
    await _otp_set(f"phone_change_{target_id}", otp, {"target_id": target_id, "new_phone": new_phone, "collection": collection})
    
    email = target_account.get("email")
    if not email and target_account.get("provider_id"):
        provider = await db.providers.find_one({"id": target_account["provider_id"]})
        email = provider.get("email") if provider else None
        
    if email:
        html = f"""
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
          <div style="background:#0F2044;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#fff;margin:0;">InstaPark Phone Number Update</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <p>Hi {_title_case_name(target_account['name'])},</p>
            <p style="margin-top:12px;">Your OTP to verify your new phone number ({new_phone}) is:</p>
            <div style="background:#EFF6FF;border-radius:10px;padding:20px;text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:900;letter-spacing:8px;color:#0F2044;">{otp}</span>
            </div>
            <p style="color:#6b7280;font-size:13px;">This OTP expires in 10 minutes.</p>
          </div>
        </div>"""
        asyncio.create_task(send_email(to=email, subject="InstaPark Phone Change OTP", html_body=html))
        # TODO: remove email-OTP fallback once SMS_PROVIDER is live
        
    send_sms(new_phone, f"Your InstaPark phone change OTP is: {otp}")
    
    return {"message": "OTP sent"}

@api_router.post("/auth/phone-change/verify")
async def phone_change_verify(body: PhoneChangeVerify, user=Depends(get_current)):
    otp = body.otp.strip()
    target_id = body.target_account_id or user["user_id"]
    
    if body.target_account_id and body.target_account_id != user["user_id"]:
        if user["role"] not in ("owner", "admin", "superadmin"):
            raise HTTPException(403, "Not authorized")
            
    key = f"phone_change_{target_id}"
    stored = await _otp_get(key)
    if not stored:
        raise HTTPException(400, "Invalid or expired OTP")
    if time.time() > stored["expires"]:
        await _otp_delete(key)
        raise HTTPException(400, "OTP has expired")
    attempts = await _otp_increment_attempts(key)
    if attempts > OTP_MAX_ATTEMPTS:
        await _otp_delete(key)
        raise HTTPException(400, "Too many incorrect attempts")
    if stored["otp"] != otp:
        raise HTTPException(400, "Incorrect OTP")
        
    collection = stored["collection"]
    new_phone = stored["new_phone"]
    
    # Final check for uniqueness before committing
    if await is_phone_taken(new_phone, exclude_id=target_id):
        raise HTTPException(400, "Phone number is no longer available")
        
    update_ops = {"$set": {"phone": new_phone, "phone_verified_at": now_iso(), "is_phone_verified": True}, "$unset": {"pending_phone": ""}}
    await db[collection].update_one({"id": target_id}, update_ops)
    
    account = await db[collection].find_one({"id": target_id})
    if account:
        role = account.get("role")
        if collection == "drivers" and role in ("admin", "owner") and account.get("provider_id"):
            await db.providers.update_one({"id": account["provider_id"]}, update_ops)
        elif collection == "providers":
            mirror = await db.drivers.find_one({"provider_id": target_id, "role": "admin"})
            if mirror:
                await db.drivers.update_one({"id": mirror["id"]}, update_ops)
                
    await _otp_delete(key)
    
    return {"message": "Phone number updated successfully"}


@api_router.post("/auth/forgot-password")
async def forgot_password_unified(body: dict = Body(...)):
    phone = body.get("phone", "").strip()
    if not phone:
        raise HTTPException(400, "Phone number is required")
        
    account = await db.drivers.find_one({"phone": phone})
    if not account:
        account = await db.providers.find_one({"phone": phone})
        
    if not account:
        return {"message": "If this phone number exists, an OTP has been sent"}
        
    if not await _otp_check_rate_limit(f"forgot_pwd_rate_{phone}"):
        return {"message": "If this phone number exists, an OTP has been sent"}
        
    otp = str(random.randint(100000, 999999))
    collection = "drivers" if "employee_id" in account or account.get("role") == "supervisor" else "providers"
    await _otp_set(f"forgot_pwd_{phone}", otp, {"account_id": account["id"], "collection": collection})
    
    email = account.get("email")
    if not email and account.get("provider_id"):
        provider = await db.providers.find_one({"id": account["provider_id"]})
        email = provider.get("email") if provider else None
        
    if email:
        html = f"""
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;">
          <div style="background:#0F2044;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#fff;margin:0;">InstaPark Password Reset</h2>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <p>Hi {_title_case_name(account['name'])},</p>
            <p style="margin-top:12px;">Your reset OTP is:</p>
            <div style="background:#EFF6FF;border-radius:10px;padding:20px;text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:900;letter-spacing:8px;color:#0F2044;">{otp}</span>
            </div>
            <p style="color:#6b7280;font-size:13px;">This OTP expires in 10 minutes. If you did not request this, ignore this email.</p>
          </div>
        </div>"""
        asyncio.create_task(send_email(to=email, subject="InstaPark Reset OTP", html_body=html))
        # TODO: remove email-OTP fallback once SMS_PROVIDER is live
        
    send_sms(phone, f"Your InstaPark reset OTP is: {otp}")
    
    return {"message": "If this phone number exists, an OTP has been sent"}

@api_router.post("/auth/reset-password")
async def reset_password_unified(body: dict = Body(...)):
    phone = body.get("phone", "").strip()
    otp = body.get("otp", "").strip()
    new_credential = body.get("new_credential", "").strip()
    confirm_credential = body.get("confirm_credential", "").strip()
    
    if not all([phone, otp, new_credential, confirm_credential]):
        raise HTTPException(400, "All fields are required")
        
    if new_credential != confirm_credential:
        raise HTTPException(400, "Passwords/PINs do not match")
        
    key = f"forgot_pwd_{phone}"
    stored = await _otp_get(key)
    if not stored:
        raise HTTPException(400, "Invalid or expired OTP")
    if time.time() > stored["expires"]:
        await _otp_delete(key)
        raise HTTPException(400, "OTP has expired")
    attempts = await _otp_increment_attempts(key)
    if attempts > OTP_MAX_ATTEMPTS:
        await _otp_delete(key)
        raise HTTPException(400, "Too many incorrect attempts")
    if stored["otp"] != otp:
        raise HTTPException(400, "Incorrect OTP")
        
    collection = stored["collection"]
    account_id = stored["account_id"]
    
    db_col = db[collection]
    account = await db_col.find_one({"id": account_id})
    if not account:
        raise HTTPException(400, "Account no longer exists")
        
    role = account.get("role")
    if role == "driver":
        if not re.match(r"^\d{4}$", new_credential):
            raise HTTPException(400, "PIN must be exactly 4 digits")
        hashed = hash_password(new_credential)
        await db_col.update_one({"id": account_id}, {"$set": {"hashed_pin": hashed}, "$unset": {"pin": ""}})
    else:
        if len(new_credential) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        hashed = hash_password(new_credential)
        update_ops = {"$set": {"hashed_password": hashed}}
        await db_col.update_one({"id": account_id}, update_ops)
        
        if collection == "drivers" and role in ("admin", "owner") and account.get("provider_id"):
            await db.providers.update_one({"id": account["provider_id"]}, update_ops)
        elif collection == "providers":
            mirror = await db.drivers.find_one({"provider_id": account_id, "role": "admin"})
            if mirror:
                await db.drivers.update_one({"id": mirror["id"]}, update_ops)
                
    await _otp_delete(key)
    return {"message": "Reset successfully"}

class CheckPhone(BaseModel):
    phone: str

@api_router.post("/auth/check-phone")
async def check_phone(body: CheckPhone):
    phone = body.phone.strip()
    if not re.match(r"^\d{10}$", phone):
        return {"exists": False}
        
    account = await db.drivers.find_one({"phone": phone}, {"id": 1, "is_verified": 1, "role": 1, "provider_id": 1})
    if not account:
        account = await db.providers.find_one({"phone": phone}, {"id": 1, "is_verified": 1, "role": 1})
        
    if not account:
        return {"exists": False}
        
    role = account.get("role")
    if role == "admin" and account.get("provider_id"):
        true_prov = await db.providers.find_one({"id": account["provider_id"]}, {"role": 1})
        if true_prov and true_prov.get("role"):
            role = true_prov["role"]
            
    return {
        "exists": True,
        "is_verified": account.get("is_verified", False),
        "role": role
    }



async def me(user=Depends(get_current)):
    if "user_id" in user and "id" not in user:
        user["id"] = user["user_id"]
    if user.get("role") in ("owner", "admin", "manager", "supervisor", "driver"):
        prov = await db.providers.find_one({"id": user["provider_id"]}, {"_id": 0, "provider_type": 1})
        user["provider_type"] = prov.get("provider_type", "valet_provider") if prov else "valet_provider"
    return user

# ============== PROVIDERS ==============
class ProviderCreate(BaseModel):
    name: str
    email: str
    phone: str
    plan: str = "starter"
    provider_type: str = "valet_provider"
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    role: str = "owner"
    parent_provider_id: Optional[str] = None
    max_cars: int = 0
    max_events: int = 0
    max_hotels: int = 0

class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    phone: Optional[str] = None
    plan: Optional[str] = None
    provider_type: Optional[str] = None
    is_active: Optional[bool] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    role: Optional[str] = None
    parent_provider_id: Optional[str] = None
    max_cars: Optional[int] = None
    max_events: Optional[int] = None
    max_hotels: Optional[int] = None

# ============== HOTELS ==============
class HotelCreate(BaseModel):
    name: str
    address: str
    city: str
    state: str
    contact_person_name: str
    contact_person_phone: str
    contact_person_email: Optional[str] = None
    total_valet_slots: int
    max_cars: int = 0
    operating_hours_start: Optional[str] = None
    operating_hours_end: Optional[str] = None
    hotel_photo: Optional[str] = None
    provider_id: Optional[str] = None  # required for superadmin, auto-set for admin
    zones: Optional[List[Dict[str, Any]]] = None
    gates: Optional[List[str]] = None
    gate_timer_minutes: Optional[int] = None
    allow_instant_park: Optional[bool] = False

class HotelUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    contact_person_name: Optional[str] = None
    contact_person_phone: Optional[str] = None
    contact_person_email: Optional[str] = None
    total_valet_slots: Optional[int] = None
    max_cars: Optional[int] = None
    operating_hours_start: Optional[str] = None
    operating_hours_end: Optional[str] = None
    hotel_photo: Optional[str] = None
    provider_id: Optional[str] = None
    is_active: Optional[bool] = None
    zones: Optional[List[Dict[str, Any]]] = None
    gates: Optional[List[str]] = None
    gate_timer_minutes: Optional[int] = None
    allow_instant_park: Optional[bool] = None

import re

EMAIL_RE    = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
PHONE_RE    = re.compile(r'^\d{10}$')
PAN_RE      = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')
IFSC_RE     = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')
AADHAR_RE   = re.compile(r'^\d{12}$')
BANK_RE     = re.compile(r'^\d{9,18}$')
DL_RE       = re.compile(r'^[A-Z0-9]{10,16}$')


@api_router.get("/providers/me/stats")
async def my_provider_stats(user=Depends(require_roles("owner", "admin"))):
    """Aggregate dashboard stats for the logged-in owner (valet_provider or hotel_owner)
    across all hotels/events under their provider_id."""
    pid = user["provider_id"]
    today_date = datetime.now(timezone.utc).date()
    today = today_date.isoformat()
    today_start = datetime.combine(today_date, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    tomorrow_start = datetime.combine(today_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).isoformat()
    today_range = {"$gte": today_start, "$lt": tomorrow_start}

    event_ids = [e["id"] for e in await db.events.find({"provider_id": pid}, {"_id": 0, "id": 1}).to_list(10000)]
    car_match = {"event_id": {"$in": event_ids}, "deleted": {"$ne": True}}

    (
        total_hotels, active_events, total_drivers, total_supervisors,
        total_cars, parked_cars, pending_retrievals,
        today_events, today_cars, today_parked, today_retrievals, today_retrieved,
    ) = await asyncio.gather(
        db.hotels.count_documents({"provider_id": pid}),
        db.events.count_documents({"provider_id": pid, "status": "active"}),
        db.drivers.count_documents({"provider_id": pid, "role": "driver"}),
        db.drivers.count_documents({"provider_id": pid, "role": "supervisor"}),
        db.cars.count_documents(car_match),
        db.cars.count_documents({**car_match, "status": "PARKED"}),
        db.cars.count_documents({**car_match, "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}}),
        db.events.count_documents({"provider_id": pid, "date": today}),
        db.cars.count_documents({**car_match, "check_in_time": today_range}),
        db.cars.count_documents({**car_match, "check_in_time": today_range, "status": "PARKED"}),
        db.cars.count_documents({**car_match, "check_in_time": today_range, "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}}),
        db.cars.count_documents({**car_match, "check_in_time": today_range, "status": "DELIVERED"}),
    )

    platform_avg_rating = 0
    driver_avg_rating = 0
    if event_ids:
        car_ids = [c["id"] for c in await db.cars.find(car_match, {"_id": 0, "id": 1}).to_list(50000)]
        if car_ids:
            rating_agg = await db.ratings.aggregate([
                {"$match": {"car_id": {"$in": car_ids}}},
                {"$group": {"_id": None, "avg": {"$avg": "$stars"}}}
            ]).to_list(1)
            platform_avg_rating = round(rating_agg[0]["avg"], 2) if rating_agg else 0
            
            driver_agg = await db.ratings.aggregate([
                {"$match": {"car_id": {"$in": car_ids}, "driver_stars": {"$type": "number"}}},
                {"$group": {"_id": None, "avg": {"$avg": "$driver_stars"}}}
            ]).to_list(1)
            driver_avg_rating = round(driver_agg[0]["avg"], 2) if driver_agg else 0

    # Per-hotel breakdown (used for the valet_provider "Your Hotels" performance table)
    hotels = await db.hotels.find({"provider_id": pid}, {"_id": 0, "id": 1, "name": 1, "city": 1, "state": 1, "total_valet_slots": 1}).to_list(1000)
    hotels_breakdown = []
    for h in hotels:
        h_event_ids = [e["id"] for e in await db.events.find({"hotel_id": h["id"]}, {"_id": 0, "id": 1}).to_list(10000)]
        h_active_events = await db.events.count_documents({"hotel_id": h["id"], "status": "active"})
        h_cars_today = await db.cars.count_documents({"event_id": {"$in": h_event_ids}, "check_in_time": today_range, "deleted": {"$ne": True}})
        h_total_cars = await db.cars.count_documents({"event_id": {"$in": h_event_ids}, "deleted": {"$ne": True}})
        hotels_breakdown.append({
            **h, "active_events": h_active_events,
            "cars_today": h_cars_today, "total_cars_served": h_total_cars,
        })

    return {
        "total_hotels": total_hotels, "active_events": active_events,
        "total_drivers": total_drivers, "total_supervisors": total_supervisors,
        "total_cars": total_cars, "parked_cars": parked_cars,
        "pending_retrievals": pending_retrievals, "platform_avg_rating": platform_avg_rating, "driver_avg_rating": driver_avg_rating,
        "today_events": today_events, "today_cars": today_cars,
        "today_parked": today_parked, "today_retrievals": today_retrievals,
        "today_retrieved": today_retrieved, "hotels_breakdown": hotels_breakdown,
    }


@api_router.get("/providers/me/stats/activity")
async def my_provider_stats_activity(
    user=Depends(require_roles("owner", "admin")),
    days: Optional[int] = Query(None, ge=1, le=366),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    pid = user["provider_id"]
    event_ids = [e["id"] for e in await db.events.find({"provider_id": pid}, {"_id": 0, "id": 1}).to_list(10000)]
    today = datetime.now(timezone.utc).date()

    if start and end:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date()
            end_date = datetime.strptime(end, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "start and end must be YYYY-MM-DD")
        if end_date < start_date:
            raise HTTPException(400, "end must not be before start")
        if (end_date - start_date).days > 366:
            raise HTTPException(400, "range too large")
    else:
        window = days or 7
        end_date = today
        start_date = end_date - timedelta(days=window - 1)

    cutoff = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    cutoff_end = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).isoformat()

    rows = []
    if event_ids:
        pipeline = [
            {"$match": {
                "event_id": {"$in": event_ids},
                "check_in_time": {"$exists": True, "$ne": None, "$gte": cutoff, "$lt": cutoff_end},
                "deleted": {"$ne": True},
            }},
            {"$group": {"_id": {"$substr": ["$check_in_time", 0, 10]}, "checkins": {"$sum": 1}}},
            {"$sort": {"_id": 1}},
        ]
        rows = await db.cars.aggregate(pipeline).to_list(1000)
    counts = {r["_id"]: r["checkins"] for r in rows}

    num_days = (end_date - start_date).days + 1
    date_list = [(start_date + timedelta(days=i)).isoformat() for i in range(num_days)]
    return [{"date": d, "checkins": counts.get(d, 0)} for d in date_list]

@api_router.get("/providers")
async def list_providers(user=Depends(require_roles("superadmin", "owner"))):
    if user["role"] == "superadmin":
        rows = await db.providers.find({"role": "owner"}, {"_id": 0, "hashed_password": 0}).to_list(1000)
    else:
        rows = await db.providers.find({"parent_provider_id": user["provider_id"]}, {"_id": 0, "hashed_password": 0}).to_list(1000)
    return rows

async def sync_car_qr_cards(provider_id: str, new_max_cars: int):
    count = await db.car_qr_cards.count_documents({"provider_id": provider_id})
    if new_max_cars > count:
        highest_card = await db.car_qr_cards.find_one({"provider_id": provider_id}, sort=[("key_tag_number", -1)])
        start_tag = highest_card.get("key_tag_number", 0) if highest_card else 0
        diff = new_max_cars - count
        new_docs = []
        for i in range(diff):
            new_docs.append({
                "id": str(uuid.uuid4()),
                "provider_id": provider_id,
                "key_tag_number": start_tag + i + 1,
                "qr_token": str(uuid.uuid4()),
                "status": "empty",
                "car_id": None,
                "is_active": True,
                "created_at": now_iso()
            })
        if new_docs:
            await db.car_qr_cards.insert_many(new_docs)
            await db.provider_limit_changes.insert_one({
                "id": str(uuid.uuid4()),
                "provider_id": provider_id,
                "field": "max_cars",
                "previous_value": count,
                "new_value": new_max_cars,
                "cards_added": len(new_docs),
                "changed_at": now_iso(),
            })

@api_router.post("/providers")
async def create_provider(body: ProviderCreate, user=Depends(require_roles("superadmin", "owner"))):
    if await is_email_taken(body.email.strip()):
        raise HTTPException(400, "Email already in use")
    if await is_phone_taken(body.phone):
        raise HTTPException(400, "Phone number already in use")
    if not EMAIL_RE.match(body.email.strip()):
        raise HTTPException(400, "Invalid email format")
    if not PHONE_RE.match(body.phone.strip()):
        raise HTTPException(400, "Phone must be exactly 10 digits")
    if not body.name or not body.name.strip():
        raise HTTPException(400, "Name is required")

    role = "owner"
    parent_provider_id = None
    provider_type = body.provider_type
    
    if user["role"] == "superadmin":
        if not body.phone or not body.address or not body.city or not body.state:
            raise HTTPException(400, "Phone, address, city, and state are required for Owner accounts")

    if user["role"] == "owner":
        role = "admin"
        parent_provider_id = user["provider_id"]
        owner_prov = await db.providers.find_one({"id": user["provider_id"]})
        if owner_prov:
            provider_type = owner_prov.get("provider_type", "valet_provider")
            
        owner_hotel = await db.hotels.find_one({"provider_id": user["provider_id"]})
        if owner_hotel:
            body.address = body.address or owner_hotel.get("address")
            body.city = body.city or owner_hotel.get("city")
            body.state = body.state or owner_hotel.get("state")

    pid = str(uuid.uuid4())
    doc = {
        "id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone,
        "plan": body.plan, "provider_type": provider_type, "is_active": True,
        "role": role, "parent_provider_id": parent_provider_id,
        "provider_qr_token": str(uuid.uuid4()),
        "is_verified": False,
        "is_phone_verified": False,
        "phone_verified_at": None,
        "pending_phone": None,
        "created_at": now_iso(), "updated_at": now_iso(),
        "address": body.address or None, "city": body.city or None, "state": body.state or None,
        "max_cars": body.max_cars,
        "max_events": body.max_events,
        "max_hotels": body.max_hotels,
    }
    await db.providers.insert_one(doc.copy())
    # also create admin driver record
    admin_drv = {
        "id": str(uuid.uuid4()), "provider_id": pid, "name": body.name, "phone": body.phone,
        "email": body.email.lower(),
        "role": "admin", "employee_id": f"ADM{str(int(datetime.now().timestamp()))[-5:]}",
        "is_active": True, "auth_user_id": pid, "created_at": now_iso(),
        "is_phone_verified": False,
        "phone_verified_at": None,
        "pending_phone": None,
    }
    await db.drivers.insert_one(admin_drv)

    if body.max_cars > 0:
        await sync_car_qr_cards(pid, body.max_cars)

    # --- Email notifications ---
    # 1. Welcome email to the new provider/admin
    provider_welcome_html = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>Welcome to InstaPark!</strong></p>
    <p style="color:#374151;font-size:16px;">Hi <strong>{_title_case_name(body.name)}</strong>,</p>
    <p style="color:#374151;">Your InstaPark valet management account has been created successfully.</p>
    <p style="color:#374151;">You can activate it by logging in with your phone number on the web portal.</p>
    <div style="background:#F5F3FF;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #7C3AED;">
      <p style="margin:0;color:#374151;"><strong>Phone:</strong> <span style="font-family:monospace;color:#7C3AED;">{body.phone}</span></p>
      <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> <span style="font-family:monospace;color:#7C3AED;">{body.email}</span></p>
      <p style="margin:8px 0 0;color:#374151;"><strong>Plan:</strong> <span style="font-family:monospace;color:#7C3AED;">{body.plan.upper()}</span></p>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
    <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
  </div>
"""
    asyncio.create_task(send_email(
        to=body.email,
        subject="Welcome to InstaPark  Your Account is Ready",
        html_body=provider_welcome_html
    ))

    # 2. Notification to all superadmins
    superadmins = await db.superadmins.find(
        {}, {"_id": 0, "email": 1, "name": 1}
    ).to_list(100)

    superadmin_notify_html = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
  <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>New Provider Onboarded</strong></p>
    <p style="color:#374151;"> 
      A new valet service provider has been added to InstaPark: 
    </p> 
    <div style="background:#F9FAFB;padding:16px;margin:16px 0;"> 
      <p style="margin:0;color:#374151;"> 
        <strong>Company Name:</strong> {_title_case_name(body.name)} 
      </p> 
      <p style="margin:8px 0 0;color:#374151;"> 
        <strong>Email:</strong> {body.email} 
      </p> 
      <p style="margin:8px 0 0;color:#374151;"> 
        <strong>Phone:</strong> {body.phone} 
      </p> 
      <p style="margin:8px 0 0;color:#374151;"> 
        <strong>Plan:</strong> {body.plan.upper()} 
      </p> 
    </div> 
    <p style="color:#6B7280;font-size:14px;"> 
      Log in to your InstaPark superadmin dashboard to manage this provider. 
    </p> 
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
    <p style="color:#9CA3AF;font-size:12px;text-align:center;"> 
      InstaPark Valet Parking Management 
    </p> 
"""
    for sa in superadmins:
        if sa.get("email"):
            asyncio.create_task(send_email(
                to=sa["email"],
                subject=f"New Provider Onboarded  {body.name}",
                html_body=superadmin_notify_html
            ))

    # Notification for superadmin
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "recipient_role": "superadmin",
        "type": "admin_added",
        "title": "New Provider Onboarded",
        "message": f"{_title_case_name(body.name)} has been onboarded.",
        "related_id": admin_drv["id"],
        "is_read": False,
        "created_at": now_iso()
    })

    return {"id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone, "plan": body.plan}

@api_router.get("/providers/{pid}")
async def get_provider(pid: str, user=Depends(require_roles("superadmin"))):
    p = await db.providers.find_one({"id": pid}, {"_id": 0, "hashed_password": 0})
    if not p:
        raise HTTPException(404, "Not found")
    p["events"] = await db.events.find({"provider_id": pid}, {"_id": 0}).to_list(1000)
    p["drivers"] = await db.drivers.find({"provider_id": pid, "role": "driver"}, SAFE_DRIVER_PROJ).to_list(1000)
    p["supervisors"] = await db.drivers.find({"provider_id": pid, "role": "supervisor"}, SAFE_DRIVER_PROJ).to_list(1000)
    return p

@api_router.patch("/providers/{pid}")
async def update_provider(pid: str, body: ProviderUpdate, user=Depends(require_roles("superadmin"))):
    existing = await db.providers.find_one({"id": pid}, {"_id": 0, "phone": 1, "email": 1, "name": 1})
    if not existing:
        raise HTTPException(404, "Not found")
    if body.name is not None and not body.name.strip():
        raise HTTPException(400, "Name cannot be empty")

    if body.phone is not None:
        if not body.phone.strip():
            raise HTTPException(400, "Phone cannot be empty")
        if not PHONE_RE.match(body.phone.strip()):
            raise HTTPException(400, "Phone must be exactly 10 digits")
        if body.phone.strip() != existing.get("phone") and await is_phone_taken(body.phone, exclude_id=pid):
            raise HTTPException(400, "Phone number already in use")

    if body.email is not None:
        if not body.email.strip():
            raise HTTPException(400, "Email cannot be empty")
        if not EMAIL_RE.match(body.email.strip()):
            raise HTTPException(400, "Invalid email format")
        if body.email.strip().lower() != (existing.get("email") or "").lower() and await is_email_taken(body.email.strip(), exclude_id=pid):
            raise HTTPException(400, "Email already in use")

    if body.address is not None and not body.address.strip():
        raise HTTPException(400, "Address cannot be empty")

    if body.city is not None and not body.city.strip():
        raise HTTPException(400, "City cannot be empty")

    if body.state is not None and not body.state.strip():
        raise HTTPException(400, "State cannot be empty")

    if body.password is not None:
        if len(body.password) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")

    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    
    old_phone = existing.get("phone")
    phone_changed = body.phone is not None and body.phone.strip() != old_phone
    if phone_changed:
        upd["is_verified"] = False
        upd["is_phone_verified"] = False
        upd["phone_verified_at"] = None

    if "email" in upd:
        upd["email"] = upd["email"].strip().lower()
    if "password" in upd:
        upd["hashed_password"] = hash_password(upd.pop("password"))
    upd["updated_at"] = now_iso()
    res = await db.providers.update_one({"id": pid}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")

    if phone_changed:
        new_phone = body.phone.strip()
        name = existing.get("name", "User")
        email = existing.get("email")
        
        await db.drivers.update_one(
            {"provider_id": pid, "role": "admin"},
            {"$set": {
                "phone": new_phone,
                "is_verified": False,
                "is_phone_verified": False,
                "phone_verified_at": None,
            }}
        )
        
        if old_phone:
            send_sms(old_phone, 
                "Your InstaPark login mobile number was changed to a new number by an "
                "administrator. If you did not request this, contact your provider/support "
                "immediately.")
        send_sms(new_phone,
            "Your InstaPark login mobile number has been updated. Verify with the OTP "
            "and set a new password to log in again.")
            
        if email:
            asyncio.create_task(send_email(
                to=email,
                subject="InstaPark: Your login mobile number was updated",
                html_body=f"""
                <p>Hi {name},</p>
                <p>Your registered mobile number for InstaPark was changed from 
                {old_phone} to {new_phone} by an administrator.</p>
                <p>If you did not request this change, contact support immediately.</p>
                <p>Otherwise, you'll need to verify the new number with an OTP and set a 
                new password the next time you log in.</p>
                """
            ))

    if body.max_cars is not None:
        await sync_car_qr_cards(pid, body.max_cars)
    return {"ok": True}

@api_router.patch("/providers/{id}/toggle-active")
async def toggle_provider_active(id: str, user=Depends(require_roles("superadmin"))):
    """Toggle provider's is_active status and return updated document."""
    provider = await db.providers.find_one({"id": id}, {"_id": 0})
    if not provider:
        raise HTTPException(404, "Provider not found")
    new_active = not provider.get("is_active", True)
    await db.providers.update_one(
        {"id": id},
        {"$set": {"is_active": new_active, "updated_at": now_iso()}}
    )
    
    if new_active is False:
        await db.events.update_many(
            {"provider_id": id, "status": "active"},
            {"$set": {"status": "closed", "updated_at": now_iso(), "auto_closed_by_provider_toggle": True}}
        )
        await db.drivers.update_many(
            {"provider_id": id, "is_active": True, "role": {"$in": ["driver", "supervisor"]}},
            {"$set": {"is_active": False, "updated_at": now_iso(), "auto_deactivated_by_provider_toggle": True}}
        )
    else:
        await db.events.update_many(
            {"provider_id": id, "auto_closed_by_provider_toggle": True},
            {"$set": {"status": "active", "updated_at": now_iso()}, "$unset": {"auto_closed_by_provider_toggle": ""}}
        )
        await db.drivers.update_many(
            {"provider_id": id, "auto_deactivated_by_provider_toggle": True},
            {"$set": {"is_active": True, "updated_at": now_iso()}, "$unset": {"auto_deactivated_by_provider_toggle": ""}}
        )

    updated_provider = await db.providers.find_one({"id": id}, {"_id": 0, "hashed_password": 0})
    return updated_provider

@api_router.get("/providers/{pid}/stats")
async def provider_stats(pid: str, user=Depends(require_roles("superadmin"))):
    events = await db.events.count_documents({"provider_id": pid})
    drivers = await db.drivers.count_documents({"provider_id": pid, "role": "driver"})
    supervisors = await db.drivers.count_documents({"provider_id": pid, "role": "supervisor"})
    event_ids = [e["id"] for e in await db.events.find({"provider_id": pid}, {"_id": 0, "id": 1}).to_list(1000)]
    cars = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"_id": 0, "id": 1}).to_list(10000)] if event_ids else []
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
    platform_avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    dr_rats = [r["driver_stars"] for r in ratings if r.get("driver_stars")]
    driver_avg = round(sum(dr_rats) / len(dr_rats), 2) if dr_rats else 0
    return {"events": events, "drivers": drivers, "supervisors": supervisors, "cars": cars, "platform_avg_rating": platform_avg, "driver_avg_rating": driver_avg}

@api_router.get("/providers/{pid}/incidents")
async def get_provider_incidents(pid: str, user=Depends(require_roles("superadmin"))):
    event_ids = [e["id"] for e in await db.events.find(
        {"provider_id": pid}, {"_id": 0, "id": 1, "name": 1}
    ).to_list(1000)]
    if not event_ids:
        return []
    events_map = {e["id"]: e["name"] for e in await db.events.find(
        {"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}
    ).to_list(1000)}
    incidents = await db.incidents.find(
        {"event_id": {"$in": event_ids}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    for inc in incidents:
        inc["event_name"] = events_map.get(inc.get("event_id"), "—")
    return incidents

@api_router.get("/cars")
async def list_cars_for_provider(user=Depends(require_roles("owner", "admin", "manager", "supervisor"))):
    pid = user["provider_id"]
    events = await db.events.find({"provider_id": pid}, {"id": 1, "name": 1}).to_list(1000)
    if not events:
        return []
    event_ids = [e["id"] for e in events]
    events_map = {e["id"]: e["name"] for e in events}
    
    cars = await db.cars.find(
        {"event_id": {"$in": event_ids}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    
    unique_cars = {}
    for c in cars:
        plate = c.get("plate")
        if not plate: continue
        if plate not in unique_cars:
            c["last_seen"] = c.get("created_at")
            c["last_event_name"] = events_map.get(c.get("event_id"), "—")
            c["total_visits"] = 1
            c["has_active"] = c.get("status") != "DELIVERED"
            unique_cars[plate] = c
        else:
            unique_cars[plate]["total_visits"] += 1
            if c.get("status") != "DELIVERED":
                unique_cars[plate]["has_active"] = True
    return list(unique_cars.values())

@api_router.get("/incidents")
async def list_incidents_for_provider(user=Depends(require_roles("owner", "admin", "manager", "supervisor"))):
    pid = user["provider_id"]
    events = await db.events.find({"provider_id": pid}, {"id": 1, "name": 1}).to_list(1000)
    if not events:
        return []
    event_ids = [e["id"] for e in events]
    events_map = {e["id"]: e["name"] for e in events}
    
    incidents = await db.incidents.find(
        {"event_id": {"$in": event_ids}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    for inc in incidents:
        inc["event_name"] = events_map.get(inc.get("event_id"), "—")
    return incidents

@api_router.get("/providers/{pid}/report")
async def provider_report(
    pid: str,
    user=Depends(require_roles("superadmin"))
):
    """Full provider report for PDF export."""
    provider = await db.providers.find_one(
        {"id": pid},
        {"_id": 0, "hashed_password": 0}
    )
    if not provider:
        raise HTTPException(404, "Provider not found")

    events = await db.events.find(
        {"provider_id": pid}, {"_id": 0}
    ).sort("date", -1).to_list(1000)

    event_ids = [e["id"] for e in events]

    cars = await db.cars.find(
        {"event_id": {"$in": event_ids}},
        {"_id": 0, "id": 1, "status": 1, "event_id": 1,
         "check_in_time": 1, "delivered_at": 1,
         "retrieval_requested_at": 1}
    ).to_list(100000)

    drivers = await db.drivers.find(
        {"provider_id": pid, "role": "driver"},
        SAFE_DRIVER_PROJ
    ).to_list(1000)

    supervisors = await db.drivers.find(
        {"provider_id": pid, "role": "supervisor"},
        SAFE_DRIVER_PROJ
    ).to_list(1000)

    driver_ids = [d["id"] for d in drivers]
    car_ids = [c["id"] for c in cars]

    incidents = await db.incidents.find(
        {"reported_by_provider": pid},
        {"_id": 0}
    ).to_list(10000)

    ratings_list = await db.ratings.find(
        {"car_id": {"$in": car_ids}},
        {"_id": 0, "car_id": 1, "stars": 1, "driver_stars": 1}
    ).to_list(100000)
    ratings_map = {r["car_id"]: r["stars"]
                   for r in ratings_list}

    total_cars = len(cars)
    delivered = len([
        c for c in cars if c.get("status") == "DELIVERED"
    ])
    platform_avg_rating = round(
        sum(r["stars"] for r in ratings_list) / len(ratings_list), 2
    ) if ratings_list else 0
    dr_rats = [r["driver_stars"] for r in ratings_list if r.get("driver_stars")]
    driver_avg_rating = round(sum(dr_rats) / len(dr_rats), 2) if dr_rats else 0

    durations = []
    for c in cars:
        try:
            if c.get("check_in_time") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["check_in_time"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                durations.append(
                    (t2 - t1).total_seconds() / 60
                )
        except Exception:
            pass

    avg_duration = round(
        sum(durations) / len(durations), 1
    ) if durations else 0

    events_map = {e["id"]: e for e in events}
    event_summary = []
    for e in events:
        e_cars = [c for c in cars
                  if c.get("event_id") == e["id"]]
        e_delivered = len([
            c for c in e_cars
            if c.get("status") == "DELIVERED"
        ])
        event_summary.append({
            "name": e.get("name", ""),
            "date": e.get("date", ""),
            "venue": e.get("venue", ""),
            "status": e.get("status", ""),
            "total_cars": len(e_cars),
            "delivered": e_delivered,
        })

    return {
        "provider": provider,
        "summary": {
            "total_events": len(events),
            "total_cars": total_cars,
            "total_delivered": delivered,
            "total_drivers": len(drivers),
            "total_supervisors": len(supervisors),
            "total_incidents": len(incidents),
            "platform_avg_rating": platform_avg_rating, "driver_avg_rating": driver_avg_rating,
            "avg_duration_minutes": avg_duration,
        },
        "events": event_summary,
        "drivers": drivers,
        "supervisors": supervisors,
        "incidents": incidents[:50],
    }

@api_router.get("/providers/me/qr-token") 
async def get_my_provider_qr_token(user=Depends(require_roles("owner", "admin", "supervisor"))): 
    """Admin fetches their own provider_qr_token for the pre-registration QR.""" 
    provider = await db.providers.find_one( 
        {"id": user["provider_id"]}, 
        {"_id": 0, "provider_qr_token": 1, "name": 1} 
    ) 
    if not provider: 
        raise HTTPException(404, "Provider not found") 
    return { 
        "provider_qr_token": provider["provider_qr_token"], 
        "name": provider["name"] 
    } 

@api_router.get("/providers/{pid}/qr-cards")
async def get_provider_qr_cards(pid: str, search: Optional[str] = None, user=Depends(require_roles("superadmin"))):
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "max_cars": 1})
    if not provider:
        raise HTTPException(404, "Provider not found")
    
    q = {"provider_id": pid, "is_active": {"$ne": False}}
    if search and search.isdigit():
        q["$expr"] = {"$regexMatch": {"input": {"$toString": "$key_tag_number"}, "regex": search}}
        
    cards_cursor = db.car_qr_cards.find(q, {"_id": 0}).sort("key_tag_number", 1)
    cards = await cards_cursor.to_list(length=5000)
    
    return {
        "provider_name": provider.get("name", ""),
        "max_cars": provider.get("max_cars", 0),
        "cards": cards
    }

@api_router.get("/qr-cards/me")
async def get_my_qr_cards(search: Optional[str] = None, user=Depends(require_roles("owner", "admin", "supervisor"))):
    pid = user["provider_id"]
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "max_cars": 1})
    if not provider:
        raise HTTPException(404, "Provider not found")
    
    q = {"provider_id": pid, "is_active": {"$ne": False}}
    if search and search.isdigit():
        q["$expr"] = {"$regexMatch": {"input": {"$toString": "$key_tag_number"}, "regex": search}}
        
    cards_cursor = db.car_qr_cards.find(q, {"_id": 0}).sort("key_tag_number", 1)
    cards = await cards_cursor.to_list(length=5000)
    
    return {
        "provider_name": provider.get("name", ""),
        "max_cars": provider.get("max_cars", 0),
        "cards": cards
    }

class QRIncidentReport(BaseModel):
    reason: str
    note: Optional[str] = None

@api_router.post("/qr-cards/{card_id}/report-incident")
async def report_qr_incident(card_id: str, body: QRIncidentReport, user=Depends(require_roles("owner", "admin"))):
    if body.reason not in ("lost", "damaged"):
        raise HTTPException(400, "Reason must be 'lost' or 'damaged'")
        
    card = await db.car_qr_cards.find_one({"id": card_id})
    if not card:
        raise HTTPException(404, "Card not found")
    if card.get("provider_id") != user["provider_id"]:
        raise HTTPException(403, "Not authorized to access this card")
    if card.get("is_active") is False:
        raise HTTPException(400, "Card is no longer active")
    if card.get("status") == "pending_incident":
        raise HTTPException(400, "Already reported and pending review")
        
    incident_id = str(uuid.uuid4())
    incident = {
        "id": incident_id,
        "card_id": card_id,
        "provider_id": card["provider_id"],
        "key_tag_number": card["key_tag_number"],
        "reason": body.reason,
        "note": body.note,
        "previous_status": card.get("status", "empty"),
        "reported_by_id": user["user_id"],
        "reported_by_name": user["name"],
        "reported_by_role": user["role"],
        "status": "pending",
        "reported_at": now_iso(),
        "resolved_at": None,
        "resolved_by": None,
        "new_card_id": None
    }
    
    await db.qr_card_incidents.insert_one(incident)
    
    await db.car_qr_cards.update_one(
        {"id": card_id},
        {"$set": {"status": "pending_incident"}}
    )
    
    provider = await db.providers.find_one({"id": card["provider_id"]}, {"_id": 0, "name": 1})
    provider_name = provider.get("name", "Unknown Provider") if provider else "Unknown Provider"
    
    superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1, "name": 1}).to_list(100)
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
      <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>QR Card Incident Reported</strong></p>
      <p style="color:#374151;">A QR card has been reported as {body.reason} by {provider_name}.</p> 
      <div style="background:#F9FAFB;padding:16px;margin:16px 0;"> 
        <p style="margin:0;color:#374151;"><strong>Provider:</strong> {provider_name}</p> 
        <p style="margin:8px 0 0;color:#374151;"><strong>Key Tag Number:</strong> {card['key_tag_number']}</p> 
        <p style="margin:8px 0 0;color:#374151;"><strong>Reason:</strong> {body.reason}</p> 
        <p style="margin:8px 0 0;color:#374151;"><strong>Reported By:</strong> {user['name']} ({user['role']})</p> 
      </div> 
      <p style="color:#6B7280;font-size:14px;">Log in to your InstaPark superadmin dashboard to review and approve/reject this incident.</p> 
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
      <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
    </div>
    """
    for sa in superadmins:
        if sa.get("email"):
            asyncio.create_task(send_email(
                to=sa["email"],
                subject=f"QR Card Incident Reported - {provider_name}",
                html_body=html
            ))
            
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "recipient_role": "superadmin",
        "type": "qr_incident_reported",
        "title": "QR Card Reported",
        "message": f"Card {card['key_tag_number']} from {provider_name} was reported as {body.reason}.",
        "related_id": incident_id,
        "is_read": False,
        "created_at": now_iso()
    })
    
    updated_card = await db.car_qr_cards.find_one({"id": card_id}, {"_id": 0})
    return updated_card

@api_router.get("/qr-card-incidents")
async def get_qr_card_incidents(provider_id: str = Query(...), key_tag_number: int = Query(...), user=Depends(require_roles("superadmin"))):
    incidents = await db.qr_card_incidents.find(
        {"provider_id": provider_id, "key_tag_number": key_tag_number},
        {"_id": 0}
    ).sort("reported_at", -1).to_list(1000)
    return incidents

@api_router.post("/qr-card-incidents/{incident_id}/approve")
async def approve_qr_incident(incident_id: str, user=Depends(require_roles("superadmin"))):
    incident = await db.qr_card_incidents.find_one({"id": incident_id})
    if not incident:
        raise HTTPException(404, "Incident not found")
    if incident["status"] != "pending":
        raise HTTPException(400, "Incident is not pending")
        
    old_card_id = incident["card_id"]
    await db.car_qr_cards.update_one(
        {"id": old_card_id},
        {"$set": {"status": "blocked", "is_active": False}}
    )
    
    new_card_id = str(uuid.uuid4())
    new_card = {
        "id": new_card_id,
        "provider_id": incident["provider_id"],
        "key_tag_number": incident["key_tag_number"],
        "qr_token": str(uuid.uuid4()),
        "status": "empty",
        "car_id": None,
        "is_active": True,
        "created_at": now_iso(),
        "replaces_card_id": old_card_id
    }
    await db.car_qr_cards.insert_one(new_card)
    
    await db.qr_card_incidents.update_one(
        {"id": incident_id},
        {"$set": {
            "status": "approved",
            "resolved_at": now_iso(),
            "resolved_by": user["user_id"],
            "new_card_id": new_card_id
        }}
    )
    
    return clean(new_card)

@api_router.post("/qr-card-incidents/{incident_id}/reject")
async def reject_qr_incident(incident_id: str, user=Depends(require_roles("superadmin"))):
    incident = await db.qr_card_incidents.find_one({"id": incident_id})
    if not incident:
        raise HTTPException(404, "Incident not found")
    if incident["status"] != "pending":
        raise HTTPException(400, "Incident is not pending")
        
    old_card_id = incident["card_id"]
    await db.car_qr_cards.update_one(
        {"id": old_card_id},
        {"$set": {"status": incident["previous_status"]}}
    )
    
    await db.qr_card_incidents.update_one(
        {"id": incident_id},
        {"$set": {
            "status": "rejected",
            "resolved_at": now_iso(),
            "resolved_by": user["user_id"]
        }}
    )
    
    updated_card = await db.car_qr_cards.find_one({"id": old_card_id}, {"_id": 0})
    return updated_card

# ============== NOTIFICATIONS ==============

@api_router.get("/notifications/me")
async def get_notifications(user=Depends(require_roles("superadmin"))):
    notifs = await db.notifications.find(
        {"recipient_role": user["role"], "is_read": False},
        {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    return notifs

@api_router.get("/notifications/unread-count")
async def get_unread_count(user=Depends(require_roles("superadmin"))):
    count = await db.notifications.count_documents({
        "recipient_role": user["role"],
        "is_read": False
    })
    return {"count": count}

@api_router.post("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, user=Depends(require_roles("superadmin"))):
    await db.notifications.update_one(
        {"id": notif_id, "recipient_role": user["role"]},
        {"$set": {"is_read": True}}
    )
    return {"ok": True}

@api_router.post("/notifications/mark-all-read")
async def mark_all_notifications_read(user=Depends(require_roles("superadmin"))):
    await db.notifications.update_many(
        {"recipient_role": user["role"], "is_read": False},
        {"$set": {"is_read": True}}
    )
    return {"ok": True}

# ============== DRIVERS ==============
class DriverCreate(BaseModel): 
    name: str 
    phone: str 
    provider_id: Optional[str] = None 
    email: str 
    gender: str  # required: "male" or "female"
    pan_number: Optional[str] = None 
    bank_account_number: Optional[str] = None 
    bank_ifsc: Optional[str] = None 
    driving_license_number: Optional[str] = None 
    driving_license_photo: str 
    aadhar_number: str
    aadhar_photo: str
    driver_photo: Optional[str] = None 
 
class DriverUpdate(BaseModel): 
    name: Optional[str] = None 
    phone: Optional[str] = None 
    pin: Optional[str] = None 
    email: Optional[str] = None 
    gender: Optional[str] = None
    pan_number: Optional[str] = None 
    bank_account_number: Optional[str] = None 
    bank_ifsc: Optional[str] = None 
    driving_license_number: Optional[str] = None 
    driving_license_photo: Optional[str] = None 
    aadhar_number: Optional[str] = None
    aadhar_photo: Optional[str] = None
    driver_photo: Optional[str] = None 

# ============== SUPERVISORS ==============
class SupervisorCreate(BaseModel):
    name: str
    email: str
    phone: str
    gender: str  # required: "male" or "female"
    provider_id: Optional[str] = None
    supervisor_photo: Optional[str] = None
    pan_number: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None
    aadhar_number: str
    aadhar_photo: str

class SupervisorUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    gender: Optional[str] = None
    supervisor_photo: Optional[str] = None
    pan_number: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None
    aadhar_number: Optional[str] = None
    aadhar_photo: Optional[str] = None

@api_router.get("/drivers")
async def list_drivers(user=Depends(get_current)):
    role = user.get("role")
    if role == "superadmin":
        drv = await db.drivers.find({"role": "driver"}, SAFE_DRIVER_PROJ).to_list(2000)
        # join provider name
        prov_ids = list({d["provider_id"] for d in drv})
        provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
        for d in drv:
            d["provider_name"] = provs.get(d["provider_id"], "—")
        return drv
    if role in ("owner", "admin", "supervisor"):
        return await db.drivers.find({"provider_id": user["provider_id"], "role": "driver"}, SAFE_DRIVER_PROJ).to_list(1000)
    raise HTTPException(403, "Forbidden")

@api_router.post("/drivers")
async def create_driver(body: DriverCreate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    if user.get("role") == "superadmin":
        pid = body.provider_id
        if not pid:
            raise HTTPException(400, "provider_id is required when creating a driver as superadmin")
    else:
        pid = user.get("provider_id")
        if not pid:
            raise HTTPException(400, "provider_id missing")

    if not body.name or not body.name.strip():
        raise HTTPException(400, "Name is required")
    if body.email and await is_email_taken(body.email.strip()):
        raise HTTPException(400, "Email already in use")
    if await is_phone_taken(body.phone):
        raise HTTPException(400, "Phone number already in use")
    if not EMAIL_RE.match(body.email.strip()):
        raise HTTPException(400, "Invalid email format")
    if not PHONE_RE.match(body.phone.strip()):
        raise HTTPException(400, "Phone must be exactly 10 digits")
    if body.pan_number and not PAN_RE.match(body.pan_number.strip().upper()):
        raise HTTPException(400, "Invalid PAN format. Expected format: ABCDE1234F")
    if body.bank_account_number and not BANK_RE.match(body.bank_account_number.strip()):
        raise HTTPException(400, "Bank account number must be 9–18 digits")
    if body.bank_ifsc and not IFSC_RE.match(body.bank_ifsc.strip().upper()):
        raise HTTPException(400, "Invalid IFSC format. Expected format: ABCD0123456")
    if body.driving_license_number and not DL_RE.match(body.driving_license_number.strip().upper()):
        raise HTTPException(400, "Invalid driving license number. Must be 10–16 alphanumeric characters")
    if not AADHAR_RE.match(body.aadhar_number.strip()):
        raise HTTPException(400, "Aadhar number must be exactly 12 digits")
    if body.gender not in ("male", "female"):
        raise HTTPException(400, "Gender must be 'male' or 'female'")
    for _ in range(10):
        eid = f"DRV{random.randint(10000, 99999)}"
        if not await db.drivers.find_one({"employee_id": eid}):
            break
    else:
        raise HTTPException(500, "Could not generate unique employee ID — try again")
    doc = { 
        "id": str(uuid.uuid4()), "provider_id": pid, 
        "name": body.name, "phone": body.phone, 
        "email": body.email or None, 
        "pan_number": body.pan_number or None, 
        "bank_account_number": body.bank_account_number or None, 
        "bank_ifsc": body.bank_ifsc or None, 
        "driving_license_number": body.driving_license_number or None, 
        "driving_license_photo": body.driving_license_photo or None, 
        "aadhar_number": body.aadhar_number or None,
        "aadhar_photo": body.aadhar_photo or None,
        "gender": body.gender,
        "driver_photo": body.driver_photo or None, 
        "role": "driver", "employee_id": eid.upper(), 
        "is_verified": False,
        "is_phone_verified": False,
        "phone_verified_at": None,
        "pending_phone": None,
        "is_active": False, "created_at": now_iso(),
        "duty_status": "offline", "duty_status_updated_at": now_iso()
    } 
    await db.drivers.insert_one(doc.copy())

    # --- Email notifications --- 
    # 1. Welcome email to driver with login credentials 
    driver_email_html = f""" 
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
      <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>Welcome to InstaPark!</strong></p>
        <p style="color:#374151;font-size:16px;">Hi <strong>{_title_case_name(body.name)}</strong>,</p> 
        <p style="color:#374151;">You have been onboarded as a valet driver. Your account has been created successfully.</p> 
        <div style="background:#F5F3FF;border-radius:8px;padding:16px;margin:20px 0;">
          <p><strong>Employee ID:</strong> {eid}</p>
          <p><strong>Phone Number:</strong> {body.phone}</p>
        </div>
        <p style="color:#6B7280;font-size:14px;">Download the app and login with your phone number to activate your account and set your PIN.</p> 
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
      </div> 
    """ 
    asyncio.create_task(send_email( 
        to=body.email, 
        subject="Welcome to InstaPark  Your Login Information", 
        html_body=driver_email_html 
    )) 
 
    # 2. Notification email to admin (provider) 
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "email": 1}) 
    if provider and provider.get("email"): 
        admin_email_html = f""" 
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
          <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>New Driver Onboarded</strong></p>
            <p style="color:#374151;">A new driver has been added to <strong>{provider['name']}</strong>:</p> 
            <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
              <p style="margin:0;color:#374151;"><strong>Name:</strong> {_title_case_name(body.name)}</p> 
              <p style="margin:8px 0 0;color:#374151;"><strong>Employee ID:</strong> <span style="font-family:monospace;">{eid.upper()}</span></p> 
              <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p> 
              {"<p style='margin:8px 0 0;color:#374151;'><strong>Phone:</strong> " + body.phone + "</p>" if body.phone else ""} 
            </div> 
            <p style="color:#6B7280;font-size:14px;">Log in to your InstaPark dashboard to manage this driver.</p> 
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
            <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
          </div> 
        """ 
        asyncio.create_task(send_email( 
            to=provider["email"], 
            subject=f"New Driver Onboarded  {body.name}", 
            html_body=admin_email_html 
        )) 
 
    # 3. Notification email to all superadmins 
    superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1, "name": 1}).to_list(100) 
    superadmin_email_html = f""" 
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
      <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>Driver Onboarding Summary</strong></p>
        <p style="color:#374151;">A new driver has been onboarded on the InstaPark platform:</p> 
        <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
          <p style="margin:0;color:#374151;"><strong>Name:</strong> {_title_case_name(body.name)}</p> 
          <p style="margin:8px 0 0;color:#374151;"><strong>Employee ID:</strong> <span style="font-family:monospace;">{eid.upper()}</span></p> 
          <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p> 
          <p style="margin:8px 0 0;color:#374151;"><strong>Provider:</strong> {provider['name'] if provider else '—'}</p> 
          {"<p style='margin:8px 0 0;color:#374151;'><strong>PAN:</strong> " + body.pan_number + "</p>" if body.pan_number else ""} 
          {"<p style='margin:8px 0 0;color:#374151;'><strong>License No:</strong> " + body.driving_license_number + "</p>" if body.driving_license_number else ""} 
        </div> 
        <p style="color:#6B7280;font-size:14px;">Log in to the SuperAdmin dashboard to view full driver details.</p> 
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
      </div> 
    """ 
    for sa in superadmins: 
        if sa.get("email"): 
            asyncio.create_task(send_email( 
                to=sa["email"], 
                subject="New Driver Onboarded", 
                html_body=superadmin_email_html 
            )) 

    # Add notification for superadmin
    provider_name = provider.get("name", "A provider") if provider else "A provider"
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "recipient_role": "superadmin",
        "type": "admin_added",
        "title": "New Driver Onboarded",
        "message": f"Driver {_title_case_name(body.name)} was added by {provider_name}.",
        "related_id": doc["id"],
        "is_read": False,
        "created_at": now_iso()
    })

    return clean(doc)

class DutyStatusUpdate(BaseModel):
    duty_status: str  # "available" | "offline"

@api_router.patch("/drivers/{did}/duty-status")
async def update_duty_status(did: str, body: DutyStatusUpdate, user=Depends(require_roles("driver", "owner", "admin", "superadmin", "supervisor"))):
    if user.get("role") == "driver" and user["user_id"] != did:
        raise HTTPException(403, "Forbidden")
    if body.duty_status not in ("available", "offline"):
        raise HTTPException(400, "duty_status must be 'available' or 'offline'")
    driver = await db.drivers.find_one({"id": did}, {"_id": 0, "duty_status": 1})
    if not driver:
        raise HTTPException(404, "Driver not found")
    if driver.get("duty_status") == "busy" and body.duty_status == "available":
        raise HTTPException(400, "Cannot go available while a task is in progress")
    await db.drivers.update_one({"id": did}, {"$set": {"duty_status": body.duty_status, "duty_status_updated_at": now_iso()}})
    active_events = await db.event_drivers.find({"driver_id": did, "assigned": True}, {"_id": 0, "event_id": 1}).to_list(1000)
    for a in active_events:
        await manager.broadcast(f"event:{a['event_id']}", {"type": "driver_status_update", "data": {"driver_id": did, "duty_status": body.duty_status}})
    return {"driver_id": did, "duty_status": body.duty_status}

@api_router.get("/events/{eid}/driver-availability")
async def get_driver_availability(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Live roster of drivers assigned to this event with duty status, for the dispatch panel."""
    event = await db.events.find_one({"id": eid}, {"_id": 0, "id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    assignments = await db.event_drivers.find({"event_id": eid, "assigned": True}, {"_id": 0, "driver_id": 1}).to_list(1000)
    driver_ids = [a["driver_id"] for a in assignments]
    if not driver_ids:
        return []
    return await db.drivers.find(
        {"id": {"$in": driver_ids}, "is_active": True},
        {"_id": 0, "id": 1, "name": 1, "employee_id": 1, "duty_status": 1, "duty_status_updated_at": 1}
    ).to_list(1000)

class ReassignDriverBody(BaseModel):
    driver_id: str
    stage: str  # "checkin" | "retrieval"

@api_router.patch("/cars/{cid}/reassign-driver")
async def reassign_driver(cid: str, body: ReassignDriverBody, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Supervisor/admin assigns or overrides which driver handles this car — the accountability layer on top of self-service."""
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Car not found")
    if body.stage not in ("checkin", "retrieval"):
        raise HTTPException(400, "stage must be 'checkin' or 'retrieval'")
    field = "check_in_driver_id" if body.stage == "checkin" else "retrieval_driver_id"
    previous_driver_id = car.get(field)
    new_driver = await db.drivers.find_one({"id": body.driver_id, "role": "driver", "is_active": True}, {"_id": 0, "id": 1, "duty_status": 1})
    if not new_driver:
        raise HTTPException(404, "Driver not found or inactive")
    # No hard block on a busy driver — a supervisor may deliberately want their specialist
    # on a premium car even if that driver's mid-task. The mobile app confirms this with the
    # supervisor before calling this endpoint; the backend just allows it.

    update_fields = {field: body.driver_id, "updated_at": now_iso()}
    # Once a retrieval driver is assigned, pull this car out of the self-service claimable queue
    # so no other driver can tap "Pick Up" and steal an already-dispatched car.
    if body.stage == "retrieval" and car.get("status") == "RETRIEVAL_REQUESTED":
        update_fields["status"] = "BEING_FETCHED"
        update_fields["being_fetched_at"] = now_iso()

    await db.cars.update_one({"id": cid}, {"$set": update_fields})
    car.update(update_fields)
    if previous_driver_id and previous_driver_id != body.driver_id:
        asyncio.create_task(refresh_driver_duty_status(previous_driver_id))
    async def _mark_driver_busy_reassign(driver_id=body.driver_id):
        await db.drivers.update_one({"id": driver_id}, {"$set": {"duty_status": "busy", "duty_status_updated_at": now_iso()}})
    asyncio.create_task(_mark_driver_busy_reassign())
    asyncio.create_task(record_assignment(
        car_id=cid, event_id=car["event_id"], driver_id=body.driver_id,
        action="reassigned" if previous_driver_id else (f"{body.stage}_assigned"),
        source=user["role"],
        performed_by={"user_id": user["user_id"], "name": user.get("name"), "role": user["role"]},
        previous_driver_id=previous_driver_id,
    ))
    updated = car

    screen = "retrievals" if body.stage == "retrieval" else "mycars"
    action_word = "Reassigned to" if previous_driver_id else "Assigned to"

    async def _push_reassignment(new_id=body.driver_id, old_id=previous_driver_id, plate=updated.get("plate"), event_id=car["event_id"]):
        new_drv = await db.drivers.find_one({"id": new_id}, {"_id": 0, "push_token": 1})
        new_token = new_drv.get("push_token") if new_drv else None
        await send_expo_push(
            [new_token] if new_token else [],
            title=f"🚗 {plate} {action_word} You",
            body_text="Tap to view details",
            data={"car_id": cid, "event_id": event_id, "screen": screen}
        )
        if old_id and old_id != new_id:
            old_drv = await db.drivers.find_one({"id": old_id}, {"_id": 0, "push_token": 1})
            old_token = old_drv.get("push_token") if old_drv else None
            await send_expo_push(
                [old_token] if old_token else [],
                title=f"↪️ {plate} Reassigned",
                body_text="This car has been reassigned to another driver",
                data={"car_id": cid, "event_id": event_id, "screen": screen}
            )
    asyncio.create_task(_push_reassignment())

    await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": updated})
    await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": updated})
    await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": updated})
    return updated

@api_router.get("/cars/{cid}/suggest-retrieval-driver")
async def suggest_retrieval_driver(cid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    car = await db.cars.find_one({"id": cid}, {"_id": 0, "event_id": 1, "status": 1})
    if not car:
        raise HTTPException(404, "Car not found")
    if car["status"] != "RETRIEVAL_REQUESTED":
        raise HTTPException(400, "Car is not awaiting retrieval")
    assigned = await db.event_drivers.find({"event_id": car["event_id"], "assigned": True}, {"_id": 0, "driver_id": 1}).to_list(1000)
    driver_ids = [a["driver_id"] for a in assigned]
    candidates = await db.drivers.find(
        {"id": {"$in": driver_ids}, "is_active": True, "duty_status": "available"},
        {"_id": 0, "id": 1, "name": 1, "duty_status_updated_at": 1}
    ).sort("duty_status_updated_at", ASCENDING).to_list(10)
    if not candidates:
        return {"suggestion": None, "message": "No available drivers right now"}
    return {"suggestion": candidates[0], "alternatives": candidates[1:5]}

# ============== HOTELS ENDPOINTS ==============

@api_router.get("/hotels")
async def list_hotels(user=Depends(require_roles("owner", "admin", "superadmin", "supervisor")), provider_id: str = None):
    role = user.get("role")
    query = {}
    if role in ("owner", "admin", "manager", "supervisor"):
        query["provider_id"] = user["provider_id"]
    elif provider_id:
        query["provider_id"] = provider_id
    
    hotels = await db.hotels.find(query, {"_id": 0}).to_list(1000)
    
    # Enrich with provider_name, provider_type, and provider_is_verified
    prov_ids = list({h["provider_id"] for h in hotels if h.get("provider_id")})
    provs = {p["id"]: p for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1, "provider_type": 1, "is_verified": 1}).to_list(1000)}
    for h in hotels:
        prov = provs.get(h["provider_id"], {})
        h["provider_name"] = prov.get("name", "—")
        h["provider_type"] = prov.get("provider_type", "valet_provider")
        h["provider_is_verified"] = prov.get("is_verified", True) if prov else True
            
    return [clean(h) for h in hotels]

@api_router.get("/hotels/{hid}")
async def get_hotel(hid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin", "manager", "supervisor") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    
    # Enrich with provider_name
    prov = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "name": 1, "is_verified": 1})
    hotel["provider_name"] = prov["name"] if prov else "—"
    hotel["provider_is_verified"] = prov.get("is_verified", True) if prov else True
    
    # Enrich with assigned_drivers
    driver_ids = hotel.get("assigned_driver_ids", [])
    hotel["assigned_drivers"] = [clean(d) for d in await db.drivers.find({"id": {"$in": driver_ids}}, SAFE_DRIVER_PROJ).to_list(1000)]
    
    # Enrich with assigned_supervisors
    supervisor_ids = hotel.get("assigned_supervisor_ids", [])
    hotel["assigned_supervisors"] = [clean(s) for s in await db.drivers.find({"id": {"$in": supervisor_ids}, "role": "supervisor"}, SAFE_DRIVER_PROJ).to_list(1000)]
    
    return clean(hotel)

@api_router.get("/hotels/{hid}/detail")
async def get_hotel_detail(hid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin", "manager", "supervisor") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    
    # Enrich with provider_name
    prov = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "name": 1, "is_verified": 1})
    provider_name = prov["name"] if prov else "—"
    hotel["provider_is_verified"] = prov.get("is_verified", True) if prov else True
    
    # Enrich with assigned_drivers
    driver_ids = hotel.get("assigned_driver_ids", [])
    assigned_drivers = [clean(d) for d in await db.drivers.find({"id": {"$in": driver_ids}}, SAFE_DRIVER_PROJ).to_list(1000)]
    
    # Enrichment with assigned_supervisors
    supervisor_ids = hotel.get("assigned_supervisor_ids", [])
    assigned_supervisors = [clean(s) for s in await db.drivers.find({"id": {"$in": supervisor_ids}, "role": "supervisor"}, SAFE_DRIVER_PROJ).to_list(1000)]
    

    # Stats
    total_events = await db.events.count_documents({"hotel_id": hid})
    event_ids = [e["id"] for e in await db.events.find({"hotel_id": hid}, {"id": 1}).to_list(10000)]
    total_cars_served = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    
    # Avg rating
    platform_avg_rating = 0
    driver_avg_rating = 0
    if event_ids:
        car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"id": 1}).to_list(50000)]
        if car_ids:
            ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"stars": 1, "driver_stars": 1}).to_list(50000)
            if ratings:
                platform_avg_rating = round(sum(r["stars"] for r in ratings) / len(ratings), 2)
                d_ratings = [r for r in ratings if r.get("driver_stars")]
                if d_ratings:
                    driver_avg_rating = round(sum(r["driver_stars"] for r in d_ratings) / len(d_ratings), 2)
    
    return {
        "hotel": clean(hotel),
        "provider_name": provider_name,
        "assigned_drivers": assigned_drivers,
        "assigned_supervisors": assigned_supervisors,
        "stats": {
            "total_events": total_events,
            "total_cars_served": total_cars_served,
            "platform_avg_rating": platform_avg_rating, "driver_avg_rating": driver_avg_rating
        }
    }

@api_router.get("/hotels/{hid}/events")
async def get_hotel_events(
    hid: str,
    event_type: str,
    status: str = "active",
    page: int = 1,
    page_size: int = 20,
    user=Depends(require_roles("owner", "admin", "superadmin"))
):
    query = {"hotel_id": hid, "event_type": event_type}
    if status != "all":
        query["status"] = status
        
    skip = (page - 1) * page_size
    events = await db.events.find(query, {"_id": 0}).sort("date", -1).skip(skip).limit(page_size).to_list(None)
    total = await db.events.count_documents(query)
    
    return {
        "events": [clean(e) for e in events],
        "total": total,
        "page": page,
        "page_size": page_size
    }

@api_router.get("/hotels/{hid}/incidents")
async def get_hotel_incidents(hid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    event_ids = [e["id"] for e in await db.events.find(
        {"hotel_id": hid}, {"_id": 0, "id": 1}
    ).to_list(1000)]
    if not event_ids:
        return []
    events_map = {e["id"]: e["name"] for e in await db.events.find(
        {"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}
    ).to_list(1000)}
    incidents = await db.incidents.find(
        {"event_id": {"$in": event_ids}}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    for inc in incidents:
        inc["event_name"] = events_map.get(inc.get("event_id"), "—")
    return incidents

@api_router.get("/hotels/{hid}/cars")
async def get_hotel_cars(hid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    event_ids = [e["id"] for e in await db.events.find(
        {"hotel_id": hid}, {"_id": 0, "id": 1}
    ).to_list(1000)]
    if not event_ids:
        return []
    events_map = {e["id"]: e["name"] for e in await db.events.find(
        {"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}
    ).to_list(1000)}
    pipeline = [
        {"$match": {"event_id": {"$in": event_ids}, "deleted": {"$ne": True}}},
        {"$sort": {"check_in_time": -1}},
        {"$group": {
            "_id": "$plate",
            "plate": {"$first": "$plate"},
            "make": {"$first": "$make"},
            "color": {"$first": "$color"},
            "total_visits": {"$sum": 1},
            "last_seen": {"$first": "$check_in_time"},
            "last_event_id": {"$first": "$event_id"},
            "has_active": {"$max": {"$cond": [{"$ne": ["$status", "DELIVERED"]}, 1, 0]}},
        }},
        {"$project": {
            "_id": 0, "plate": 1, "make": 1, "color": 1,
            "total_visits": 1, "last_seen": 1, "last_event_id": 1,
            "has_active": {"$eq": ["$has_active", 1]},
        }},
        {"$sort": {"last_seen": -1}}
    ]
    result = await db.cars.aggregate(pipeline).to_list(10000)
    for v in result:
        v["last_event_name"] = events_map.get(v.get("last_event_id"), "—")
    return result

@api_router.post("/hotels")
async def create_hotel(body: HotelCreate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    if user.get("role") == "superadmin":
        pid = body.provider_id
        if not pid:
            raise HTTPException(400, "provider_id is required for superadmin")
    else:
        pid = user.get("provider_id")

    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "provider_type": 1, "max_hotels": 1})
    if provider and provider.get("provider_type") == "valet_provider":
        max_hotels = provider.get("max_hotels", 0)
        if max_hotels == 0:
            raise HTTPException(400, "Hotel/store limit not configured for this provider — contact support")
        existing_count = await db.hotels.count_documents({"provider_id": pid})
        if existing_count >= max_hotels:
            raise HTTPException(400, "Hotel/store limit reached for this provider")

    if not body.name or not body.name.strip():
        raise HTTPException(400, "Hotel name is required")
    if not body.address or not body.address.strip():
        raise HTTPException(400, "Address is required")
    if not body.city or not body.city.strip():
        raise HTTPException(400, "City is required")
    if not body.state or not body.state.strip():
        raise HTTPException(400, "State is required")
    if not body.contact_person_name or not body.contact_person_name.strip():
        raise HTTPException(400, "Contact person name is required")
    if not body.contact_person_phone or not body.contact_person_phone.strip():
        raise HTTPException(400, "Contact person phone is required")
    if not PHONE_RE.match(body.contact_person_phone.strip()):
        raise HTTPException(400, "Contact person phone must be exactly 10 digits")
    if body.contact_person_email and not EMAIL_RE.match(body.contact_person_email.strip()):
        raise HTTPException(400, "Invalid contact person email format")
    if not body.total_valet_slots or body.total_valet_slots < 1:
        raise HTTPException(400, "Total valet slots must be at least 1")
    
    if body.max_cars > 0:
        provider_data = await db.providers.find_one({"id": pid}, {"_id": 0, "max_cars": 1})
        provider_max_cars = provider_data.get("max_cars", 0) if provider_data else 0
        agg = await db.hotels.aggregate([
            {"$match": {"provider_id": pid}},
            {"$group": {"_id": None, "total": {"$sum": "$max_cars"}}}
        ]).to_list(1)
        other_total = agg[0]["total"] if agg else 0
        if other_total + body.max_cars > provider_max_cars:
            raise HTTPException(400, f"Allocating {body.max_cars} cars to this hotel would exceed the provider's total car limit of {provider_max_cars} (already allocated to other hotels: {other_total})")
    
    hid = str(uuid.uuid4())
    doc = {
        "id": hid,
        "provider_id": pid,
        "name": body.name,
        "address": body.address,
        "city": body.city,
        "state": body.state,
        "contact_person_name": body.contact_person_name,
        "contact_person_phone": body.contact_person_phone,
        "contact_person_email": body.contact_person_email,
        "total_valet_slots": body.total_valet_slots,
        "max_cars": body.max_cars,
        "operating_hours_start": "00:00",
        "operating_hours_end": "23:59",
        "hotel_photo": body.hotel_photo,
        "zones": body.zones,
        "gates": body.gates,
        "allow_instant_park": bool(body.allow_instant_park),
        "hotel_qr_token": str(uuid.uuid4()),
        "assigned_driver_ids": [],
        "assigned_supervisor_ids": [],
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso()
    }
    await db.hotels.insert_one(doc.copy())
    
    # Notification to all superadmins
    superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1, "name": 1}).to_list(100)
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1})
    
    email_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>New Hotel Added</strong></p>
        <p style="color:#374151;">A new hotel has been added to the InstaPark platform:</p>
        <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#374151;"><strong>Hotel Name:</strong> {_title_case_name(body.name)}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Provider:</strong> {provider['name'] if provider else '—'}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Address:</strong> {body.address}, {body.city}, {body.state}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Contact:</strong> {body.contact_person_name} ({body.contact_person_phone})</p>
        </div>
        <p style="color:#6B7280;font-size:14px;">Log in to the SuperAdmin dashboard to view full details.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
    </div>
    """
    for sa in superadmins:
        if sa.get("email"):
            asyncio.create_task(send_email(
                to=sa["email"],
                subject=f"New Hotel Added  {body.name}",
                html_body=email_html
            ))
            
    return clean(doc)

@api_router.patch("/hotels/{hid}")
async def update_hotel(hid: str, body: HotelUpdate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")

    if body.name is not None and not body.name.strip():
        raise HTTPException(400, "Hotel name cannot be empty")
    if body.address is not None and not body.address.strip():
        raise HTTPException(400, "Address cannot be empty")
    if body.city is not None and not body.city.strip():
        raise HTTPException(400, "City cannot be empty")
    if body.state is not None and not body.state.strip():
        raise HTTPException(400, "State cannot be empty")
    if body.contact_person_name is not None and not body.contact_person_name.strip():
        raise HTTPException(400, "Contact person name cannot be empty")
    if body.contact_person_phone is not None:
        if not body.contact_person_phone.strip():
            raise HTTPException(400, "Contact person phone cannot be empty")
        if not PHONE_RE.match(body.contact_person_phone.strip()):
            raise HTTPException(400, "Contact person phone must be exactly 10 digits")
    if body.contact_person_email is not None and body.contact_person_email.strip():
        if not EMAIL_RE.match(body.contact_person_email.strip()):
            raise HTTPException(400, "Invalid contact person email format")
    if body.total_valet_slots is not None and body.total_valet_slots < 1:
        raise HTTPException(400, "Total valet slots must be at least 1")
        
    if body.max_cars is not None:
        provider_data = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "max_cars": 1})
        provider_max_cars = provider_data.get("max_cars", 0) if provider_data else 0
        agg = await db.hotels.aggregate([
            {"$match": {"provider_id": hotel["provider_id"], "id": {"$ne": hid}}},
            {"$group": {"_id": None, "total": {"$sum": "$max_cars"}}}
        ]).to_list(1)
        other_total = agg[0]["total"] if agg else 0
        if other_total + body.max_cars > provider_max_cars:
            raise HTTPException(400, f"Allocating {body.max_cars} cars to this hotel would exceed the provider's total car limit of {provider_max_cars} (already allocated to other hotels: {other_total})")
            
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    _provided = body.model_dump(exclude_unset=True)
    for _f in ("hotel_photo",):
        if _f in _provided:
            upd[_f] = _provided[_f]
    upd["updated_at"] = now_iso()
    await db.hotels.update_one({"id": hid}, {"$set": upd})
    return {"ok": True}

@api_router.delete("/hotels/{hid}")
async def deactivate_hotel(hid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    return {"ok": True}

@api_router.post("/hotels/{hid}/drivers/{did}")
async def assign_driver_to_hotel(hid: str, did: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$addToSet": {"assigned_driver_ids": did}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.delete("/hotels/{hid}/drivers/{did}")
async def remove_driver_from_hotel(hid: str, did: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$pull": {"assigned_driver_ids": did}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.post("/hotels/{hid}/supervisors/{sid}")
async def assign_supervisor_to_hotel(hid: str, sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$addToSet": {"assigned_supervisor_ids": sid}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.delete("/hotels/{hid}/supervisors/{sid}")
async def remove_supervisor_from_hotel(hid: str, sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$pull": {"assigned_supervisor_ids": sid}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.get("/drivers/{did}")
async def get_driver(did: str, user=Depends(get_current)):
    d = await db.drivers.find_one({"id": did}, {"_id": 0, "hashed_pin": 0, "hashed_password": 0, "pin": 0})
    if not d:
        raise HTTPException(404, "Not found")
    if user.get("role") == "superadmin":
        p = await db.providers.find_one({"id": d["provider_id"]}, {"_id": 0, "name": 1})
        d["provider_name"] = p["name"] if p else "—"
    return d

@api_router.patch("/drivers/{did}")
async def update_driver(did: str, body: DriverUpdate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    existing = await db.drivers.find_one({"id": did}, {"_id": 0, "phone": 1, "email": 1, "name": 1})
    if not existing:
        raise HTTPException(404, "Driver not found")
    if body.phone:
        if body.phone.strip() != existing.get("phone") and await is_phone_taken(body.phone, exclude_id=did):
            raise HTTPException(400, "Phone number already in use")
            
    if body.pin is not None:
        if not body.pin.isdigit() or len(body.pin) != 4:
            raise HTTPException(400, "PIN must be exactly 4 digits")

    if body.name is not None and not body.name.strip():
        raise HTTPException(400, "Name cannot be empty")
    if body.email is not None:
        if not body.email.strip():
            raise HTTPException(400, "Email cannot be empty")
        if not EMAIL_RE.match(body.email.strip()):
            raise HTTPException(400, "Invalid email format")
        if body.email.strip().lower() != (existing.get("email") or "").lower() and await is_email_taken(body.email.strip(), exclude_id=did):
            raise HTTPException(400, "Email already in use")
    if body.phone is not None:
        if not body.phone.strip():
            raise HTTPException(400, "Phone cannot be empty")
        if not PHONE_RE.match(body.phone.strip()):
            raise HTTPException(400, "Phone must be exactly 10 digits")
    if body.pan_number is not None and body.pan_number.strip():
        if not PAN_RE.match(body.pan_number.strip().upper()):
            raise HTTPException(400, "Invalid PAN format. Expected: ABCDE1234F")
    if body.bank_account_number is not None and body.bank_account_number.strip():
        if not BANK_RE.match(body.bank_account_number.strip()):
            raise HTTPException(400, "Bank account number must be 9–18 digits")
    if body.bank_ifsc is not None and body.bank_ifsc.strip():
        if not IFSC_RE.match(body.bank_ifsc.strip().upper()):
            raise HTTPException(400, "Invalid IFSC format. Expected: ABCD0123456")
    if body.driving_license_number is not None and body.driving_license_number.strip():
        if not DL_RE.match(body.driving_license_number.strip().upper()):
            raise HTTPException(400, "Invalid driving license number. Must be 10–16 alphanumeric characters")
    if body.aadhar_number is not None:
        if not body.aadhar_number.strip():
            raise HTTPException(400, "Aadhar number cannot be empty")
        if not AADHAR_RE.match(body.aadhar_number.strip()):
            raise HTTPException(400, "Aadhar number must be exactly 12 digits")
    if body.gender is not None and body.gender not in ("male", "female"):
        raise HTTPException(400, "Gender must be 'male' or 'female'")
            
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    _provided = body.model_dump(exclude_unset=True)
    for _f in ("driver_photo", "driving_license_photo", "aadhar_photo"):
        if _f in _provided:
            upd[_f] = _provided[_f]
    
    old_phone = existing.get("phone")
    phone_changed = body.phone is not None and body.phone.strip() != old_phone
    if phone_changed:
        upd["is_verified"] = False
        upd["is_phone_verified"] = False
        upd["phone_verified_at"] = None

    if "pin" in upd:
        upd["hashed_pin"] = hash_password(upd.pop("pin"))
    res = await db.drivers.update_one({"id": did}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")

    if phone_changed:
        new_phone = body.phone.strip()
        name = existing.get("name", "User")
        email = existing.get("email")
        
        if old_phone:
            send_sms(old_phone, 
                "Your InstaPark login mobile number was changed to a new number by an "
                "administrator. If you did not request this, contact your provider/support "
                "immediately.")
        send_sms(new_phone,
            "Your InstaPark login mobile number has been updated. Verify with the OTP "
            "and set a new password to log in again.")
            
        if email:
            asyncio.create_task(send_email(
                to=email,
                subject="InstaPark: Your login mobile number was updated",
                html_body=f"""
                <p>Hi {name},</p>
                <p>Your registered mobile number for InstaPark was changed from 
                {old_phone} to {new_phone} by an administrator.</p>
                <p>If you did not request this change, contact support immediately.</p>
                <p>Otherwise, you'll need to verify the new number with an OTP and set a 
                new password the next time you log in.</p>
                """
            ))

    return {"ok": True}

@api_router.delete("/drivers/{did}")
async def deactivate_driver(did: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    await db.drivers.update_one({"id": did}, {"$set": {"is_active": False}})
    return {"ok": True}

@api_router.delete("/superadmin/drivers/{did}/permanent")
async def permanently_delete_driver(did: str, user=Depends(require_roles("superadmin"))):
    driver = await db.drivers.find_one({"id": did, "role": "driver"})
    if not driver:
        raise HTTPException(404, "Driver not found")
    await db.drivers.delete_one({"id": did})
    return {"ok": True, "message": "Driver permanently deleted"}

@api_router.post("/drivers/push-token")
async def set_driver_push_token(body: dict = Body(...), user=Depends(get_current)):
    """Update push token for authenticated driver/supervisor/admin."""
    push_token = body.get("push_token")
    if not push_token:
        raise HTTPException(400, "push_token is required")
    await db.drivers.update_one(
        {"id": user["user_id"]},
        {"$set": {"push_token": push_token}}
    )
    return {"ok": True}

@api_router.post("/providers/push-token")
async def set_provider_push_token(body: dict = Body(...), user=Depends(require_roles("owner", "admin"))):
    """Update push token for authenticated admin/provider."""
    push_token = body.get("push_token")
    if not push_token:
        raise HTTPException(400, "push_token is required")
    await db.providers.update_one(
        {"id": user["user_id"]},
        {"$set": {"push_token": push_token}}
    )
    return {"ok": True}

@api_router.get("/drivers/{did}/stats")
async def driver_stats(did: str, user=Depends(get_current)):
    cars_in = await db.cars.count_documents({"check_in_driver_id": did})
    cars_out = await db.cars.count_documents({"retrieval_driver_id": did, "status": "DELIVERED"})
    return {"cars_checked_in": cars_in, "cars_retrieved": cars_out}

@api_router.get("/drivers/{did}/stats/filtered")
async def driver_stats_filtered(did: str, filter: str = "all", user=Depends(get_current)):
    now = datetime.now(timezone.utc)
    delta_map = {"week": 7, "month": 30, "quarter": 90}
    q_in: dict = {"check_in_driver_id": did}
    q_out: dict = {"retrieval_driver_id": did, "status": "DELIVERED"}
    if filter in delta_map:
        cutoff = (now - timedelta(days=delta_map[filter])).isoformat()
        q_in["check_in_time"] = {"$gte": cutoff}
        q_out["delivered_at"] = {"$gte": cutoff}
    return {
        "cars_checked_in": await db.cars.count_documents(q_in),
        "cars_retrieved": await db.cars.count_documents(q_out),
        "filter": filter,
    }

# ============== SUPERVISORS ==============

@api_router.get("/supervisors")
async def list_supervisors(user=Depends(require_roles("owner", "admin", "superadmin"))):
    role = user.get("role")
    query = {"role": "supervisor"}
    if role in ("owner", "admin"):
        query["provider_id"] = user["provider_id"]
    
    sups = await db.drivers.find(query, SAFE_DRIVER_PROJ).to_list(1000)
    
    if role == "superadmin":
        # join provider name
        prov_ids = list({s["provider_id"] for s in sups})
        provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
        for s in sups:
            s["provider_name"] = provs.get(s["provider_id"], "—")
            
    return sups

@api_router.get("/supervisors/{sid}")
async def get_supervisor(sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    query = {"id": sid, "role": "supervisor"}
    if user.get("role") in ("owner", "admin"):
        query["provider_id"] = user["provider_id"]
        
    sup = await db.drivers.find_one(query, {"_id": 0, "hashed_pin": 0, "hashed_password": 0, "pin": 0})
    if not sup:
        raise HTTPException(404, "Supervisor not found")
        
    if user.get("role") == "superadmin":
        p = await db.providers.find_one({"id": sup["provider_id"]}, {"_id": 0, "name": 1})
        sup["provider_name"] = p["name"] if p else "—"
        
    return sup

@api_router.post("/supervisors")
async def create_supervisor(body: SupervisorCreate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    if not body.name or not body.name.strip():
        raise HTTPException(400, "Name is required")
    if user.get("role") == "superadmin":
        pid = body.provider_id
        if not pid:
            raise HTTPException(400, "provider_id is required when creating a supervisor as superadmin")
    else:
        pid = user.get("provider_id")
        if not pid:
            raise HTTPException(400, "provider_id missing")

    if await is_email_taken(body.email.strip()):
        raise HTTPException(400, "Email already in use")
    if await is_phone_taken(body.phone):
        raise HTTPException(400, "Phone number already in use")
    if not EMAIL_RE.match(body.email.strip()):
        raise HTTPException(400, "Invalid email format")
    if not PHONE_RE.match(body.phone.strip()):
        raise HTTPException(400, "Phone must be exactly 10 digits")
    if body.pan_number and not PAN_RE.match(body.pan_number.strip().upper()):
        raise HTTPException(400, "Invalid PAN format. Expected format: ABCDE1234F")
    if body.bank_account_number and not BANK_RE.match(body.bank_account_number.strip()):
        raise HTTPException(400, "Bank account number must be 9–18 digits")
    if body.bank_ifsc and not IFSC_RE.match(body.bank_ifsc.strip().upper()):
        raise HTTPException(400, "Invalid IFSC format. Expected format: ABCD0123456")
    if not AADHAR_RE.match(body.aadhar_number.strip()):
        raise HTTPException(400, "Aadhar number must be exactly 12 digits")
    if body.gender not in ("male", "female"):
        raise HTTPException(400, "Gender must be 'male' or 'female'")

    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "provider_id": pid,
        "name": body.name,
        "email": body.email.lower(),
        "phone": body.phone,
        "role": "supervisor",
        "is_verified": False,
        "is_phone_verified": False,
        "phone_verified_at": None,
        "pending_phone": None,
        "supervisor_photo": body.supervisor_photo or None,
        "pan_number": body.pan_number or None,
        "bank_account_number": body.bank_account_number or None,
        "bank_ifsc": body.bank_ifsc or None,
        "aadhar_number": body.aadhar_number or None,
        "aadhar_photo": body.aadhar_photo or None,
        "gender": body.gender,
        "is_active": False,
        "created_at": now_iso(),
        "updated_at": now_iso()
    }
    await db.drivers.insert_one(doc.copy())

    # Welcome Email
    welcome_html = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>Welcome to InstaPark!</strong></p>
    <p style="color:#374151;font-size:16px;">Hi <strong>{_title_case_name(body.name)}</strong>,</p>
    <p style="color:#374151;">You have been onboarded as a <strong>Supervisor</strong> on InstaPark.</p>
    <p style="color:#374151;">You can activate your account by logging in with your phone number on the InstaPark app.</p>
    <div style="background:#F0F4FF;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #0F2044;">
      <p style="margin:0;color:#374151;"><strong>Phone:</strong> <span style="font-family:monospace;color:#0F2044;">{body.phone}</span></p>
      <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> <span style="font-family:monospace;color:#0F2044;">{body.email}</span></p>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
    <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
  </div>
    """
    asyncio.create_task(send_email(
        to=body.email,
        subject="Welcome to InstaPark  Your Supervisor Account is Ready",
        html_body=welcome_html
    ))

    # Notification to admin (provider)
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "email": 1})
    if provider and provider.get("email"):
        admin_email_html = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>New Supervisor Onboarded</strong></p>
            <p style="color:#374151;">A new supervisor has been added to <strong>{provider['name']}</strong>:</p>
            <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:0;color:#374151;"><strong>Name:</strong> {_title_case_name(body.name)}</p>
              <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p>
              {"<p style='margin:8px 0 0;color:#374151;'><strong>Phone:</strong> " + body.phone + "</p>" if body.phone else ""}
            </div>
            <p style="color:#6B7280;font-size:14px;">Log in to your InstaPark dashboard to manage this supervisor.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
            <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
          </div>
        """
        asyncio.create_task(send_email(
            to=provider["email"],
            subject=f"New Supervisor Onboarded  {body.name}",
            html_body=admin_email_html
        ))

    # Notification to all superadmins
    superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1, "name": 1}).to_list(100)
    superadmin_email_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <p style="color:#111827;font-size:18px;margin:0 0 16px;"><strong>Supervisor Onboarding Summary</strong></p>
        <p style="color:#374151;">A new supervisor has been onboarded on the InstaPark platform:</p>
        <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#374151;"><strong>Name:</strong> {_title_case_name(body.name)}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p>
          {"<p style='margin:8px 0 0;color:#374151;'><strong>Phone:</strong> " + body.phone + "</p>" if body.phone else ""}
          <p style="margin:8px 0 0;color:#374151;"><strong>Provider:</strong> {provider['name'] if provider else '—'}</p>
        </div>
        <p style="color:#6B7280;font-size:14px;">Log in to the SuperAdmin dashboard to view full supervisor details.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
    </div>
    """
    for sa in superadmins:
        if sa.get("email"):
            asyncio.create_task(send_email(
                to=sa["email"],
                subject=f"New Supervisor Onboarded  {body.name} ({provider['name'] if provider else ''})",
                html_body=superadmin_email_html
            ))

    # Notification for superadmin
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "recipient_role": "superadmin",
        "type": "admin_added",
        "title": "New Supervisor Onboarded",
        "message": f"Supervisor {_title_case_name(body.name)} was added by {provider['name'] if provider else 'a provider'}.",
        "related_id": sid,
        "is_read": False,
        "created_at": now_iso()
    })

    return clean(doc)

@api_router.patch("/supervisors/{sid}")
async def update_supervisor(sid: str, body: SupervisorUpdate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    query = {"id": sid, "role": "supervisor"}
    if user.get("role") in ("owner", "admin"):
        query["provider_id"] = user["provider_id"]

    sup = await db.drivers.find_one(query)
    if not sup:
        raise HTTPException(404, "Supervisor not found")

    if body.phone:
        if body.phone.strip() != sup.get("phone") and await is_phone_taken(body.phone, exclude_id=sid):
            raise HTTPException(400, "Phone number already in use")

    if body.name is not None and not body.name.strip():
        raise HTTPException(400, "Name cannot be empty")
    if body.email is not None:
        if not body.email.strip():
            raise HTTPException(400, "Email cannot be empty")
        if not EMAIL_RE.match(body.email.strip()):
            raise HTTPException(400, "Invalid email format")
        if body.email.strip().lower() != (sup.get("email") or "").lower() and await is_email_taken(body.email.strip(), exclude_id=sid):
            raise HTTPException(400, "Email already in use")
    if body.phone is not None:
        if not body.phone.strip():
            raise HTTPException(400, "Phone cannot be empty")
        if not PHONE_RE.match(body.phone.strip()):
            raise HTTPException(400, "Phone must be exactly 10 digits")
    if body.pan_number is not None and body.pan_number.strip():
        if not PAN_RE.match(body.pan_number.strip().upper()):
            raise HTTPException(400, "Invalid PAN format. Expected: ABCDE1234F")
    if body.bank_account_number is not None and body.bank_account_number.strip():
        if not BANK_RE.match(body.bank_account_number.strip()):
            raise HTTPException(400, "Bank account number must be 9–18 digits")
    if body.bank_ifsc is not None and body.bank_ifsc.strip():
        if not IFSC_RE.match(body.bank_ifsc.strip().upper()):
            raise HTTPException(400, "Invalid IFSC format. Expected: ABCD0123456")
    if body.aadhar_number is not None:
        if not body.aadhar_number.strip():
            raise HTTPException(400, "Aadhar number cannot be empty")
        if not AADHAR_RE.match(body.aadhar_number.strip()):
            raise HTTPException(400, "Aadhar number must be exactly 12 digits")
    if body.gender is not None and body.gender not in ("male", "female"):
        raise HTTPException(400, "Gender must be 'male' or 'female'")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    _provided = body.model_dump(exclude_unset=True)
    for _f in ("supervisor_photo", "aadhar_photo"):
        if _f in _provided:
            upd[_f] = _provided[_f]
    
    old_phone = sup.get("phone")
    phone_changed = body.phone is not None and body.phone.strip() != old_phone
    if phone_changed:
        upd["is_verified"] = False
        upd["is_phone_verified"] = False
        upd["phone_verified_at"] = None

    if body.password is not None:
        if len(body.password) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        upd["hashed_password"] = hash_password(body.password)

    if "email" in upd:
        upd["email"] = upd["email"].lower()
    upd["updated_at"] = now_iso()

    await db.drivers.update_one({"id": sid}, {"$set": upd})

    if phone_changed:
        new_phone = body.phone.strip()
        name = sup.get("name", "User")
        email = sup.get("email")
        
        if old_phone:
            send_sms(old_phone, 
                "Your InstaPark login mobile number was changed to a new number by an "
                "administrator. If you did not request this, contact your provider/support "
                "immediately.")
        send_sms(new_phone,
            "Your InstaPark login mobile number has been updated. Verify with the OTP "
            "and set a new password to log in again.")
            
        if email:
            asyncio.create_task(send_email(
                to=email,
                subject="InstaPark: Your login mobile number was updated",
                html_body=f"""
                <p>Hi {name},</p>
                <p>Your registered mobile number for InstaPark was changed from 
                {old_phone} to {new_phone} by an administrator.</p>
                <p>If you did not request this change, contact support immediately.</p>
                <p>Otherwise, you'll need to verify the new number with an OTP and set a 
                new password the next time you log in.</p>
                """
            ))

    return {"ok": True}

@api_router.delete("/supervisors/{sid}")
async def deactivate_supervisor(sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    query = {"id": sid, "role": "supervisor"}
    if user.get("role") in ("owner", "admin"):
        query["provider_id"] = user["provider_id"]

    sup = await db.drivers.find_one(query)
    if not sup:
        raise HTTPException(404, "Supervisor not found")

    await db.drivers.update_one({"id": sid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    return {"ok": True}

@api_router.delete("/superadmin/supervisors/{sid}/permanent")
async def permanently_delete_supervisor(sid: str, user=Depends(require_roles("superadmin"))):
    supervisor = await db.drivers.find_one({"id": sid, "role": "supervisor"})
    if not supervisor:
        raise HTTPException(404, "Supervisor not found")
    await db.drivers.delete_one({"id": sid})
    return {"ok": True, "message": "Supervisor permanently deleted"}


# ============== UTILITIES (PROXIES) ==============
@api_router.get("/utils/ifsc/{code}")
async def lookup_ifsc(code: str, user=Depends(require_roles("admin", "owner", "manager", "superadmin", "supervisor"))):
    import re
    import time
    import httpx
    import certifi
    import traceback
    
    if not re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", code.upper()):
        raise HTTPException(status_code=400, detail="Invalid IFSC format")
    
    start_time = time.time()
    try:
        logger.info(f"Looking up IFSC {code.upper()} using certifi bundle: {certifi.where()}")
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(f"https://ifsc.razorpay.com/{code.upper()}")
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="IFSC code not found")
            resp.raise_for_status()
            data = resp.json()
            return {
                "bank": data.get("BANK"),
                "branch": data.get("BRANCH"),
                "city": data.get("CITY"),
                "state": data.get("STATE"),
                "address": data.get("ADDRESS")
            }
    except HTTPException:
        raise
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"IFSC lookup failed for {code.upper()} after {elapsed:.2f}s")
        logger.error(f"Exception Type: {type(e).__name__}")
        logger.error(f"Exception Message: {str(e)}")
        logger.error(f"Traceback:\n{traceback.format_exc()}")
        try:
            logger.error(f"Response status/body (if any): {getattr(resp, 'status_code', 'no response')} / {getattr(resp, 'text', '')[:200]}")
        except Exception:
            pass
        raise HTTPException(status_code=503, detail="Bank lookup service unavailable, please try again")

@api_router.get("/places/autocomplete")
async def places_autocomplete(input: str, user=Depends(require_roles("admin", "manager", "superadmin"))):
    api_key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Places search not configured")
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                "https://places.googleapis.com/v1/places:autocomplete",
                json={"input": input, "regionCode": "in"},
                headers={"X-Goog-Api-Key": api_key, "Content-Type": "application/json"}
            )
            resp.raise_for_status()
            data = resp.json()
            suggestions = data.get("suggestions", [])
            results = []
            for s in suggestions:
                pred = s.get("placePrediction", {})
                if "placeId" in pred and "text" in pred and "text" in pred["text"]:
                    results.append({
                        "place_id": pred["placeId"],
                        "description": pred["text"]["text"]
                    })
            return results
    except Exception as e:
        raise HTTPException(status_code=503, detail="Places autocomplete service unavailable")

@api_router.get("/places/details")
async def places_details(place_id: str, user=Depends(require_roles("admin", "manager", "superadmin"))):
    api_key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Places search not configured")
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://places.googleapis.com/v1/places/{place_id}",
                headers={
                    "X-Goog-Api-Key": api_key,
                    "X-Goog-FieldMask": "displayName,formattedAddress,location"
                }
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "place_id": place_id,
                "name": data.get("displayName", {}).get("text"),
                "address": data.get("formattedAddress"),
                "lat": data.get("location", {}).get("latitude"),
                "lng": data.get("location", {}).get("longitude")
            }
    except Exception as e:
        raise HTTPException(status_code=503, detail="Places details service unavailable")

# ============== EVENTS ==============

class EventCreate(BaseModel):
    name: str
    date: str
    end_date: str
    venue: str
    max_cars: int
    key_hooks: int = 50
    gates: List[str] = []
    zones: List[Dict[str, Any]] = []
    start_time: str = "00:00"
    end_time: str = "23:59"
    is_template: bool = False
    provider_id: Optional[str] = None
    hotel_id: Optional[str] = None
    event_type: str = "regular"
    host_name: Optional[str] = None
    host_email: Optional[str] = None
    gate_timer_minutes: Optional[int] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None
    allow_instant_park: bool = False

class EventUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[str] = None
    end_date: Optional[str] = None
    venue: Optional[str] = None
    max_cars: Optional[int] = None
    key_hooks: Optional[int] = None
    gates: Optional[List[str]] = None
    zones: Optional[List[Dict[str, Any]]] = None
    status: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    host_name: Optional[str] = None
    host_email: Optional[str] = None
    gate_timer_minutes: Optional[int] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None
    allow_instant_park: Optional[bool] = None

@api_router.get("/events")
async def list_events(user=Depends(get_current)):
    query = {}
    if user.get("role") != "superadmin":
        query["provider_id"] = user["provider_id"]
    
    events = await db.events.find(query, {"_id": 0}).to_list(1000)
    
    # Enrich with hotel_name
    hotel_ids = list({e["hotel_id"] for e in events if e.get("hotel_id")})
    hotels = {h["id"]: h["name"] for h in await db.hotels.find({"id": {"$in": hotel_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    for e in events:
        e["hotel_name"] = hotels.get(e.get("hotel_id"), "—")
        
    return [clean(e) for e in events]

@api_router.get("/events/all")
async def all_events(user=Depends(require_roles("superadmin"))):
    events = await db.events.find({}, {"_id": 0}).to_list(2000)
    pids = list({e["provider_id"] for e in events})
    provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    
    event_ids = [e["id"] for e in events]
    if event_ids:
        car_counts = await db.cars.aggregate([
            {"$match": {"event_id": {"$in": event_ids}, "deleted": {"$ne": True}}},
            {"$group": {"_id": "$event_id", "count": {"$sum": 1}}}
        ]).to_list(len(event_ids))
        car_count_map = {r["_id"]: r["count"] for r in car_counts}
    else:
        car_count_map = {}

    for e in events:
        e["provider_name"] = provs.get(e["provider_id"], "—")
        e["cars_count"] = car_count_map.get(e["id"], 0)
    return events

def event_time_range(date_str, start_time, end_date_str, end_time):
    start_dt = datetime.strptime(f"{date_str} {start_time}", "%Y-%m-%d %H:%M")
    end_dt = datetime.strptime(f"{end_date_str} {end_time}", "%Y-%m-%d %H:%M")
    return start_dt, end_dt

async def get_car_limit_ceiling_and_scope(provider_id: str, hotel_id: Optional[str]):
    """Returns (ceiling, query_filter) for the car-limit-overlap check.
    hotel events are capped by that hotel's own allocation; provider-level 
    events are capped by whatever's left after hotel allocations."""
    provider = await db.providers.find_one({"id": provider_id}, {"_id": 0, "max_cars": 1, "provider_type": 1})
    if not provider or provider.get("provider_type") != "valet_provider":
        return None, None

    if hotel_id:
        hotel = await db.hotels.find_one({"id": hotel_id}, {"_id": 0, "max_cars": 1})
        ceiling = hotel.get("max_cars", 0) if hotel else 0
        scope_filter = {"provider_id": provider_id, "hotel_id": hotel_id, "status": "active", "is_template": {"$ne": True}}
    else:
        provider_max_cars = provider.get("max_cars", 0)
        hotels_agg = await db.hotels.aggregate([
            {"$match": {"provider_id": provider_id}},
            {"$group": {"_id": None, "total": {"$sum": "$max_cars"}}}
        ]).to_list(1)
        hotels_total = hotels_agg[0]["total"] if hotels_agg else 0
        ceiling = provider_max_cars - hotels_total
        scope_filter = {"provider_id": provider_id, "hotel_id": None, "status": "active", "is_template": {"$ne": True}}

    return ceiling, scope_filter

@api_router.post("/events")
async def create_event(body: EventCreate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    if body.event_type == "hotel_daily":
        raise HTTPException(400, "hotel_daily events are created automatically")

    if not body.name or not body.name.strip():
        raise HTTPException(400, "Event name is required")
    if not body.venue or not body.venue.strip():
        raise HTTPException(400, "Venue is required")
    if not body.date or not body.date.strip():
        raise HTTPException(400, "Date is required")
    if body.max_cars < 1:
        raise HTTPException(400, "Max cars must be at least 1")
        
    if body.zones:
        total_zone_slots = sum(z.get("slots", 0) for z in body.zones)
        if total_zone_slots > body.max_cars:
            raise HTTPException(
                400,
                f"Total zone slots ({total_zone_slots}) cannot exceed max cars ({body.max_cars}). Please reduce zone slots."
            )

    eid = str(uuid.uuid4())
    doc = body.model_dump()
    pid = body.provider_id if user.get("role") == "superadmin" and body.provider_id else user.get("provider_id")
    
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "provider_type": 1, "max_events": 1})
    if provider and provider.get("provider_type") == "valet_provider":
        max_events = provider.get("max_events", 0)
        if max_events == 0:
            raise HTTPException(400, "Event limit not configured for this provider — contact support")
        existing_count = await db.events.count_documents({"provider_id": pid})
        if existing_count >= max_events:
            raise HTTPException(400, "Event limit reached for this provider")
            
    ceiling, scope_filter = await get_car_limit_ceiling_and_scope(pid, body.hotel_id)
    if ceiling is not None:
        if ceiling <= 0:
            raise HTTPException(400, "No car capacity available — either the provider's car limit isn't configured, or it's fully allocated to hotels")
        if body.max_cars > ceiling:
            raise HTTPException(400, f"This event's car capacity ({body.max_cars}) exceeds the available limit ({ceiling})")

        new_start, new_end = event_time_range(body.date, body.start_time, body.end_date, body.end_time)
        other_events = await db.events.find(scope_filter, {"_id": 0, "date": 1, "end_date": 1, "start_time": 1, "end_time": 1, "max_cars": 1, "id": 1}).to_list(1000)
        overlapping_total = body.max_cars
        for e in other_events:
            e_start, e_end = event_time_range(e["date"], e.get("start_time", "00:00"), e["end_date"], e.get("end_time", "23:59"))
            if e_start < new_end and e_end > new_start:
                overlapping_total += e.get("max_cars", 0)
        if overlapping_total > ceiling:
            raise HTTPException(400, f"Creating this event would require {overlapping_total} concurrent cars, exceeding the available limit of {ceiling}. Reduce car capacity or choose a non-overlapping time.")

    # Fallback for hotel_special events
    if body.event_type == "hotel_special":
        if not doc.get("hotel_id") and user.get("role") in ("owner", "admin"):
            hotel = await db.hotels.find_one({"provider_id": user["provider_id"]}, {"id": 1})
            if hotel:
                doc["hotel_id"] = hotel["id"]
        if not doc.get("event_qr_token"):
            doc["event_qr_token"] = str(uuid.uuid4())

    # Regular valet provider events also get their own QR token
    if body.event_type == "regular" and not doc.get("event_qr_token"):
        doc["event_qr_token"] = str(uuid.uuid4())

    doc.update({"id": eid, "provider_id": pid, "status": "active",
                "key_hooks": body.key_hooks,
                "created_at": now_iso(), "updated_at": now_iso()})
    await db.events.insert_one(doc.copy())
    return clean(doc)

@api_router.post("/hotels/{hid}/events")
async def create_hotel_special_event(hid: str, body: EventCreate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    
    if body.zones:
        total_zone_slots = sum(z.get("slots", 0) for z in body.zones)
        if total_zone_slots > body.max_cars:
            raise HTTPException(
                400,
                f"Total zone slots ({total_zone_slots}) cannot exceed max cars ({body.max_cars}). Please reduce zone slots."
            )

    provider = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "provider_type": 1, "max_events": 1})
    if provider and provider.get("provider_type") == "valet_provider":
        max_events = provider.get("max_events", 0)
        if max_events == 0:
            raise HTTPException(400, "Event limit not configured for this provider — contact support")
        existing_count = await db.events.count_documents({"provider_id": hotel["provider_id"]})
        if existing_count >= max_events:
            raise HTTPException(400, "Event limit reached for this provider")
            
    ceiling, scope_filter = await get_car_limit_ceiling_and_scope(hotel["provider_id"], hid)
    if ceiling is not None:
        if ceiling <= 0:
            raise HTTPException(400, "No car capacity available — either the provider's car limit isn't configured, or it's fully allocated to hotels")
        if body.max_cars > ceiling:
            raise HTTPException(400, f"This event's car capacity ({body.max_cars}) exceeds the available limit ({ceiling})")

        new_start, new_end = event_time_range(body.date, body.start_time, body.end_date, body.end_time)
        other_events = await db.events.find(scope_filter, {"_id": 0, "date": 1, "end_date": 1, "start_time": 1, "end_time": 1, "max_cars": 1, "id": 1}).to_list(1000)
        overlapping_total = body.max_cars
        for e in other_events:
            e_start, e_end = event_time_range(e["date"], e.get("start_time", "00:00"), e["end_date"], e.get("end_time", "23:59"))
            if e_start < new_end and e_end > new_start:
                overlapping_total += e.get("max_cars", 0)
        if overlapping_total > ceiling:
            raise HTTPException(400, f"Creating this event would require {overlapping_total} concurrent cars, exceeding the available limit of {ceiling}. Reduce car capacity or choose a non-overlapping time.")

    eid = str(uuid.uuid4())
    doc = body.model_dump()
    doc.update({
        "id": eid,
        "provider_id": hotel["provider_id"],
        "hotel_id": hid,
        "event_type": "hotel_special",
        "venue": hotel["name"],
        "status": "active",
        "event_qr_token": str(uuid.uuid4()),
        "created_at": now_iso(),
        "updated_at": now_iso()
    })
    await db.events.insert_one(doc.copy())
    return clean(doc)

@api_router.get("/hotels/{hid}/events/{eid}/qr-token")
async def get_hotel_special_event_qr_token(hid: str, eid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    """Fetch or generate the unique QR token for a hotel special event."""
    event = await db.events.find_one({"id": eid, "hotel_id": hid}, {"_id": 0, "event_qr_token": 1, "name": 1})
    if not event:
        raise HTTPException(404, "Event not found for this hotel")
    
    token = event.get("event_qr_token")
    if not token:
        token = str(uuid.uuid4())
        await db.events.update_one({"id": eid}, {"$set": {"event_qr_token": token}})
    
    return {"event_qr_token": token, "event_name": event["name"]}

@api_router.get("/events/{eid}/qr-token")
async def get_event_qr_token(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Fetch or generate the unique QR token for any event (not hotel-scoped)."""
    event = await db.events.find_one({"id": eid}, {"_id": 0, "event_qr_token": 1, "name": 1, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    if user.get("role") in ("owner", "admin", "supervisor") and event.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")

    token = event.get("event_qr_token")
    if not token:
        token = str(uuid.uuid4())
        await db.events.update_one({"id": eid}, {"$set": {"event_qr_token": token}})

    return {"event_qr_token": token, "event_name": event["name"]}

@api_router.post("/events/{eid}/clone")
async def clone_event(
    eid: str,
    user=Depends(require_roles("owner", "admin"))
):
    """Clone an existing event with a new name and date."""
    source = await db.events.find_one(
        {"id": eid}, {"_id": 0}
    )
    if not source:
        raise HTTPException(404, "Event not found")

    new_id = str(uuid.uuid4())
    cloned = {**source}
    cloned["id"] = new_id
    cloned["name"] = f"{source['name']} (Copy)"
    cloned["status"] = "active"
    cloned["created_at"] = now_iso()
    cloned["updated_at"] = now_iso()
    cloned["zones"] = source.get("zones", [])
    cloned["gates"] = source.get("gates", [])
    cloned["key_hooks"] = source.get("key_hooks", 50)
    # Reset all car counts and stats
    cloned["total_cars"] = 0

    await db.events.insert_one(cloned)

    # Clone the slots from the source event
    source_slots = await db.slots.find(
        {"event_id": eid}, {"_id": 0}
    ).to_list(10000)

    if source_slots:
        new_slots = []
        for slot in source_slots:
            new_slot = {**slot}
            new_slot["id"] = str(uuid.uuid4())
            new_slot["event_id"] = new_id
            new_slot["is_occupied"] = False
            new_slot["car_id"] = None
            new_slots.append(new_slot)
        await db.slots.insert_many(new_slots)

    cloned.pop("_id", None)
    return cloned

@api_router.get("/events/{eid}")
async def get_event(eid: str, user=Depends(get_current)):
    e = await db.events.find_one({"id": eid}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Not found")
    return e

@api_router.get("/superadmin/events/{eid}/detail")
async def get_event_detail(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") == "driver": 
        assignment = await db.event_drivers.find_one({ 
            "event_id": eid,  
            "driver_id": user["user_id"],  
            "assigned": True 
        }) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    
    # Provider name
    provider = await db.providers.find_one({"id": event["provider_id"]}, {"_id": 0, "name": 1})
    event["provider_name"] = provider["name"] if provider else "Unknown"
    
    # Stats
    car_ids = [c["id"] for c in await db.cars.find({"event_id": eid, "deleted": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(10000)]
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
    avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    delivered = await db.cars.find({"event_id": eid, "status": "DELIVERED", "deleted": {"$ne": True}}, {"_id": 0}).to_list(10000)
    durations = []
    retrieval_times = []
    for c in delivered:
        try:
            # Retrieval time: from request to delivery
            if c.get("retrieval_requested_at") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["retrieval_requested_at"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                retrieval_times.append((t2 - t1).total_seconds() / 60)
            # Total stay: from check-in to delivery (separate metric)
            if c.get("check_in_time") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["check_in_time"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                durations.append((t2 - t1).total_seconds() / 60)
        except Exception:
            pass
    avg_ret = round(sum(retrieval_times) / len(retrieval_times), 1) if retrieval_times else 0
    avg_duration = round(sum(durations) / len(durations), 1) if durations else 0
    # top driver
    pipeline = [{"$match": {"event_id": eid, "deleted": {"$ne": True}}}, {"$group": {"_id": "$check_in_driver_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 1}]
    top = await db.cars.aggregate(pipeline).to_list(1)
    top_driver = None
    if top and top[0]["_id"]:
        d = await db.drivers.find_one({"id": top[0]["_id"]}, {"_id": 0, "name": 1})
        top_driver = d["name"] if d else None
    
    event["total_cars"] = len(car_ids)
    event["stats"] = {
        "avg_rating": avg,
        "avg_retrieval_minutes": avg_ret,
        "avg_stay_minutes": avg_duration,
        "top_driver": top_driver
    }
    
    # Drivers
    pid = event["provider_id"]
    assigned_driver_ids = {a["driver_id"] for a in await db.event_drivers.find({"event_id": eid, "assigned": True}, {"_id": 0, "driver_id": 1}).to_list(1000)}
    drivers = await db.drivers.find({"id": {"$in": list(assigned_driver_ids)}, "is_active": True}, SAFE_DRIVER_PROJ).to_list(1000) if assigned_driver_ids else []
    
    hotel_id = event.get("hotel_id")
    if hotel_id:
        # Also fetch hotel-assigned supervisors
        hotel_sup = await db.hotels.find_one({"id": hotel_id}, {"_id": 0, "assigned_supervisor_ids": 1})
        if hotel_sup and hotel_sup.get("assigned_supervisor_ids"):
            supervisors = await db.drivers.find(
                {"id": {"$in": hotel_sup["assigned_supervisor_ids"]}, "role": "supervisor", "is_active": True},
                SAFE_DRIVER_PROJ
            ).to_list(1000)
    other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
    assignments = {a["driver_id"]: a for a in await db.event_drivers.find({"event_id": {"$in": [e["id"] for e in other_events]}}, {"_id": 0}).to_list(2000)}
    e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
    e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
    other_map = {e["id"]: e for e in other_events}
    # Batch: cars checked in per driver for this event 
    ci_pipeline = [ 
        {"$match": {"event_id": eid, "deleted": {"$ne": True}}}, 
        {"$group": {"_id": "$check_in_driver_id", "count": {"$sum": 1}}} 
    ] 
    ci_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(ci_pipeline).to_list(1000)} 
 
    # Batch: cars retrieved per driver for this event 
    cr_pipeline = [ 
        {"$match": {"event_id": eid, "status": "DELIVERED", "deleted": {"$ne": True}}}, 
        {"$group": {"_id": "$retrieval_driver_id", "count": {"$sum": 1}}} 
    ] 
    cr_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(cr_pipeline).to_list(1000)} 
 
    # Batch: assigned drivers for this event 
    assigned_ids = assigned_driver_ids 
 
    # Batch: driver ratings (driver_stars from ratings, mapped via retrieval_driver_id)
    driver_ratings_map = {}
    if ratings and delivered:
        r_map = {r["car_id"]: r for r in ratings}
        for c in delivered:
            rd = c.get("retrieval_driver_id")
            if rd:
                c_rating = r_map.get(c["id"])
                if c_rating and c_rating.get("driver_stars"):
                    driver_ratings_map.setdefault(rd, []).append(c_rating["driver_stars"])

    # Batch: incidents per driver
    incidents_pipeline = [
        {"$match": {"event_id": eid}},
        {"$group": {"_id": "$driver_id", "count": {"$sum": 1}}}
    ]
    inc_map = {r["_id"]: r["count"] for r in await db.incidents.aggregate(incidents_pipeline).to_list(1000)}


    for d in drivers:
        conflict = None
        if d["id"] in assignments:
            other = other_map.get(assignments[d["id"]]["event_id"])
            if other:
                o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
                o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
                if e_start < o_end and e_end > o_start:
                    conflict = other["name"]
        d["available"] = conflict is None
        d["conflict_event_name"] = conflict
        d["cars_checked_in"] = ci_map.get(d["id"], 0)
        d["cars_retrieved"] = cr_map.get(d["id"], 0)
        d["assigned"] = d["id"] in assigned_ids
        d_rats = driver_ratings_map.get(d["id"], [])
        d["avg_rating"] = round(sum(d_rats) / len(d_rats), 2) if d_rats else None
        d["incidents"] = inc_map.get(d["id"], 0)
    
    event["drivers"] = drivers

    # Supervisors block
    if 'supervisors' not in locals():
        supervisors = await db.drivers.find({"provider_id": pid, "role": "supervisor", "is_active": True}, SAFE_DRIVER_PROJ).to_list(1000)
    # Batch: assigned supervisors for this event 
    assigned_sup_ids = {a["supervisor_id"] for a in await db.event_supervisors.find({"event_id": eid}, {"_id": 0, "supervisor_id": 1}).to_list(1000)} 
    # Other active assignments for availability check
    other_sup_assignments = {a["supervisor_id"]: a for a in await db.event_supervisors.find({"supervisor_id": {"$in": [s["id"] for s in supervisors]}, "event_id": {"$ne": eid}}, {"_id": 0}).to_list(2000)}

    for s in supervisors:
        conflict = None
        if s["id"] in other_sup_assignments:
            other = other_map.get(other_sup_assignments[s["id"]]["event_id"])
            if other:
                o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
                o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
                if e_start < o_end and e_end > o_start:
                    conflict = other["name"]
        s["available"] = conflict is None
        s["conflict_event_name"] = conflict
        s["assigned"] = s["id"] in assigned_sup_ids
    
    event["supervisors"] = supervisors
    event["stats"]["supervisors_count"] = len(assigned_sup_ids)
    
    return event

@api_router.patch("/events/{eid}")
async def update_event(eid: str, body: EventUpdate, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0, "event_type": 1}) 
    if event and event.get("event_type") == "hotel_daily":
        submitted_fields = {k for k, v in body.model_dump().items() if v is not None}
        if submitted_fields - {"gate_timer_minutes"}:
            raise HTTPException(400, "Daily hotel events cannot be manually edited, except the gate wait timer")
    if user.get("role") in ("owner", "admin", "supervisor"):
        event_full = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
        if event_full and event_full["provider_id"] != user.get("provider_id"):
            raise HTTPException(403, "Forbidden — event belongs to a different provider")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.key_hooks is not None:
        upd["key_hooks"] = body.key_hooks
        
    current = await db.events.find_one({"id": eid}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Not found")

    cap_fields = {"max_cars", "date", "end_date", "start_time", "end_time", "zones"}
    if any(k in upd for k in cap_fields):
        effective = {**current, **upd}
        
        ceiling, scope_filter = await get_car_limit_ceiling_and_scope(current["provider_id"], current.get("hotel_id"))
        if ceiling is not None:
            if effective.get("max_cars", 0) > ceiling:
                raise HTTPException(400, f"This event's car capacity ({effective.get('max_cars', 0)}) exceeds the available limit ({ceiling})")

            new_start, new_end = event_time_range(
                effective["date"], 
                effective.get("start_time", "00:00"), 
                effective.get("end_date") or effective["date"], 
                effective.get("end_time", "23:59")
            )
            other_events = await db.events.find(
                {**scope_filter, "id": {"$ne": eid}},
                {"_id": 0, "date": 1, "end_date": 1, "start_time": 1, "end_time": 1, "max_cars": 1, "id": 1}
            ).to_list(1000)
            
            overlapping_total = effective.get("max_cars", 0)
            for e in other_events:
                e_start, e_end = event_time_range(
                    e["date"], 
                    e.get("start_time", "00:00"), 
                    e.get("end_date") or e["date"], 
                    e.get("end_time", "23:59")
                )
                if e_start < new_end and e_end > new_start:
                    overlapping_total += e.get("max_cars", 0)
            if overlapping_total > ceiling:
                raise HTTPException(400, f"Editing this event would require {overlapping_total} concurrent cars, exceeding the available limit of {ceiling}. Reduce car capacity or choose a non-overlapping time.")
                
        if effective.get("zones"):
            total_zone_slots = sum(z.get("slots", 0) for z in effective["zones"])
            if total_zone_slots > effective.get("max_cars", 0):
                raise HTTPException(400, f"Total zone slots ({total_zone_slots}) cannot exceed max cars ({effective.get('max_cars', 0)}). Please reduce zone slots.")

    upd["updated_at"] = now_iso()
    res = await db.events.update_one({"id": eid}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

@api_router.post("/events/{eid}/close")
async def close_event(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0, "event_type": 1}) 
    if event and event.get("event_type") == "hotel_daily": 
        raise HTTPException(400, "Daily hotel events are closed automatically at midnight") 
    if user.get("role") in ("owner", "admin", "supervisor"):
        event_full = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
        if event_full and event_full["provider_id"] != user.get("provider_id"):
            raise HTTPException(403, "Forbidden — event belongs to a different provider")
    await db.events.update_one({"id": eid}, {"$set": {"status": "closed", "updated_at": now_iso()}})
    await db.parking_slots.delete_many({"event_id": eid})
    return {"ok": True}

@api_router.get("/events/{eid}/stats")
async def event_stats(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    car_ids = [c["id"] for c in await db.cars.find({"event_id": eid, "deleted": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(10000)]
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
    avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    dr_rats = [r["driver_stars"] for r in ratings if r.get("driver_stars")]
    driver_avg = round(sum(dr_rats) / len(dr_rats), 2) if dr_rats else 0
    delivered = await db.cars.find({"event_id": eid, "status": "DELIVERED", "deleted": {"$ne": True}}, {"_id": 0}).to_list(10000)
    durations = []
    retrieval_times = []
    for c in delivered:
        try:
            # Retrieval time: from request to delivery
            if c.get("retrieval_requested_at") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["retrieval_requested_at"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                retrieval_times.append((t2 - t1).total_seconds() / 60)
            # Total stay: from check-in to delivery (separate metric)
            if c.get("check_in_time") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["check_in_time"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                durations.append((t2 - t1).total_seconds() / 60)
        except Exception:
            pass
    avg_ret = round(sum(retrieval_times) / len(retrieval_times), 1) if retrieval_times else 0
    avg_duration = round(sum(durations) / len(durations), 1) if durations else 0
    # top driver
    pipeline = [{"$match": {"event_id": eid, "deleted": {"$ne": True}}}, {"$group": {"_id": "$check_in_driver_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 1}]
    top = await db.cars.aggregate(pipeline).to_list(1)
    top_driver = None
    if top and top[0]["_id"]:
        d = await db.drivers.find_one({"id": top[0]["_id"]}, {"_id": 0, "name": 1})
        top_driver = d["name"] if d else None

    # Pre-registered cars — had a pass before arriving 
    pre_registered = await db.cars.count_documents({ 
        "event_id": eid, 
        "pre_registered": True, 
        "deleted": {"$ne": True} 
    }) 
    
    # Walk-in cars — came directly without pre-registration 
    walk_in = await db.cars.count_documents({ 
        "event_id": eid, 
        "pre_registered": {"$ne": True}, 
        "deleted": {"$ne": True} 
    }) 
    
    # Peak hour — hour with most check-ins 
    all_cars = await db.cars.find( 
        {"event_id": eid, "deleted": {"$ne": True}}, 
        {"_id": 0, "check_in_time": 1} 
    ).to_list(10000) 
    
    hour_counts = {} 
    for c in all_cars: 
        if c.get("check_in_time"): 
            try: 
                hour = (datetime.fromisoformat(c["check_in_time"]) + timedelta(hours=5, minutes=30)).hour 
                hour_counts[hour] = hour_counts.get(hour, 0) + 1 
            except: 
                pass 
    peak_hour = max(hour_counts, key=hour_counts.get) if hour_counts else None 
    peak_hour_str = f"{peak_hour:02d}:00 - {peak_hour+1:02d}:00" if peak_hour is not None else None 
    
    # Total incidents 
    total_incidents = await db.incidents.count_documents({"event_id": eid}) 
    
    # Total delivered cars 
    total_delivered = await db.cars.count_documents({ 
        "event_id": eid, 
        "status": "DELIVERED", 
        "deleted": {"$ne": True} 
    }) 
    
    # Still parked 
    still_parked = await db.cars.count_documents({ 
        "event_id": eid, 
        "status": "PARKED", 
        "deleted": {"$ne": True} 
    }) 

    return { 
        "avg_rating": avg, 
        "driver_avg_rating": driver_avg,
        "avg_retrieval_minutes": avg_ret, 
        "avg_stay_minutes": avg_duration, 
        "top_driver": top_driver, 
        "total_cars": len(car_ids), 
        "pre_registered": pre_registered, 
        "walk_in": walk_in, 
        "peak_hour": peak_hour_str, 
        "total_incidents": total_incidents, 
        "total_delivered": total_delivered, 
        "still_parked": still_parked 
    }

async def _get_avg_retrieval_minutes(eid: str) -> float:
    pipeline = [
        {"$match": {
            "event_id": eid,
            "status": "DELIVERED",
            "retrieval_requested_at": {"$exists": True, "$ne": None},
            "delivered_at": {"$exists": True, "$ne": None}
        }},
        {"$project": {
            "retrieval_ms": {
                "$subtract": [
                    {"$toLong": {"$toDate": "$delivered_at"}},
                    {"$toLong": {"$toDate": "$retrieval_requested_at"}}
                ]
            }
        }},
        {"$group": {"_id": None, "avg_ms": {"$avg": "$retrieval_ms"}, "count": {"$sum": 1}}}
    ]
    result = await db.cars.aggregate(pipeline).to_list(1)
    return round(result[0]["avg_ms"] / 60000, 1) if result and result[0].get("avg_ms") else 5.0

@api_router.get("/events/{eid}/public-stats")
async def event_public_stats(eid: str):
    """Public endpoint — returns only ETA data for guest pass page."""
    avg_minutes = await _get_avg_retrieval_minutes(eid)

    queue_depth = await db.cars.count_documents({
        "event_id": eid,
        "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}
    })

    active_assignments = await db.event_drivers.find(
        {"event_id": eid, "assigned": True},
        {"_id": 0, "driver_id": 1}
    ).to_list(100000)
    driver_ids = [a["driver_id"] for a in active_assignments]
    active_driver_count = await db.drivers.count_documents({
        "id": {"$in": driver_ids},
        "duty_status": {"$in": ["available", "busy"]}
    }) if driver_ids else 0
    effective_drivers = max(active_driver_count, 1)

    return {
        "avg_retrieval_minutes": avg_minutes,
        "queue_depth": queue_depth,
        "estimated_wait_minutes": round(avg_minutes * (-(-max(1, queue_depth) // effective_drivers)), 1)
    }

@api_router.get("/events/{eid}/keys")
async def get_event_keys(
    eid: str,
    user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))
):
    """Returns key board status for an event."""
    event = await db.events.find_one(
        {"id": eid}, {"_id": 0, "key_hooks": 1}
    )
    total_hooks = event.get("key_hooks", 50) if event else 50

    cars = await db.cars.find(
        {
            "event_id": eid,
            "key_tag": {"$ne": None},
            "deleted": {"$ne": True}
        },
        {"_id": 0, "id": 1, "plate": 1, "make": 1,
         "color": 1, "key_tag": 1, "status": 1,
         "zone": 1, "slot": 1}
    ).to_list(10000)

    untagged = await db.cars.find(
        {
            "event_id": eid,
            "key_tag": None,
            "status": {"$in": [
                "CHECKED_IN", "PARKED",
                "RETRIEVAL_REQUESTED", "BEING_FETCHED"
            ]},
            "deleted": {"$ne": True}
        },
        {"_id": 0, "id": 1, "plate": 1,
         "make": 1, "color": 1, "status": 1}
    ).to_list(10000)

    keyed = []
    for c in cars:
        keyed.append({
            "car_id": c["id"],
            "plate": c["plate"],
            "make": c.get("make", ""),
            "color": c.get("color", ""),
            "key_tag": c["key_tag"],
            "status": c["status"],
            "zone": c.get("zone", ""),
            "slot": c.get("slot", ""),
            "in_booth": c["status"] not in ["DELIVERED"],
        })

    keyed.sort(key=lambda x: (
        0 if x["in_booth"] else 1,
        int(x["key_tag"]) if str(x["key_tag"]).isdigit()
        else 999
    ))

    in_booth = len([k for k in keyed if k["in_booth"]])
    returned = len([k for k in keyed if not k["in_booth"]])

    return {
        "keys": keyed,
        "untagged_cars": untagged,
        "total_hooks": total_hooks,
        "total_keys": len(keyed),
        "in_booth": in_booth,
        "returned": returned,
        "untagged_count": len(untagged),
        "hooks_available": max(0, total_hooks - in_booth),
        "hooks_full": in_booth >= total_hooks,
    }

@api_router.get("/events/{eid}/report")
async def get_event_report(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Returns full event report data for PDF/CSV export."""
    event = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    if user.get("role") in ("admin", "supervisor") and event["provider_id"] != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")
    event = await db.events.find_one({"id": eid}, {"_id": 0})

    cars = await db.cars.find(
        {"event_id": eid, "deleted": {"$ne": True}}, {"_id": 0}
    ).to_list(10000)

    driver_ids = list(set(filter(None, [
        c.get("check_in_driver_id") for c in cars
    ] + [
        c.get("parked_driver_id") for c in cars
    ] + [
        c.get("retrieval_driver_id") for c in cars
    ])))
    drivers_list = await db.drivers.find(
        {"id": {"$in": driver_ids}},
        {"_id": 0, "id": 1, "name": 1, "employee_id": 1}
    ).to_list(1000)
    drivers_map = {d["id"]: d for d in drivers_list}

    car_ids = [c["id"] for c in cars]
    ratings_list = await db.ratings.find(
        {"car_id": {"$in": car_ids}},
        {"_id": 0, "car_id": 1, "stars": 1, "driver_stars": 1}
    ).to_list(10000)
    ratings_map = {r["car_id"]: r for r in ratings_list}

    incidents = await db.incidents.find(
        {"event_id": eid}, {"_id": 0}
    ).to_list(1000)

    car_rows = []
    durations = []
    retrieval_times = []

    for c in cars:
        duration_min = None
        retrieval_min = None
        try:
            if c.get("check_in_time") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["check_in_time"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                duration_min = round(
                    (t2 - t1).total_seconds() / 60, 1
                )
                durations.append(duration_min)
            if c.get("retrieval_requested_at") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["retrieval_requested_at"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                retrieval_min = round(
                    (t2 - t1).total_seconds() / 60, 1
                )
                retrieval_times.append(retrieval_min)
        except Exception:
            pass

        car_rows.append({
            "plate": c.get("plate", ""),
            "make": c.get("make", ""),
            "color": c.get("color", ""),
            "status": c.get("status", ""),
            "gate": c.get("gate", ""),
            "zone": c.get("zone", ""),
            "slot": c.get("slot", ""),
            "key_tag": c.get("key_tag", ""),
            "guest_name": c.get("guest_name", ""),
            "guest_phone": c.get("guest_phone", ""),
            "check_in_time": c.get("check_in_time", ""),
            "parked_at": c.get("parked_at", ""),
            "delivered_at": c.get("delivered_at", ""),
            "duration_minutes": duration_min,
            "retrieval_minutes": retrieval_min,
            "check_in_driver": drivers_map.get(
                c.get("check_in_driver_id"), {}
            ).get("name", ""),
            "parked_driver": drivers_map.get(
                c.get("parked_driver_id"), {}
            ).get("name", ""),
            "retrieval_driver": drivers_map.get(
                c.get("retrieval_driver_id"), {}
            ).get("name", ""),
            "rating": ratings_map.get(c["id"], {}).get("stars"),
            "driver_rating": ratings_map.get(c["id"], {}).get("driver_stars"),
            "notes": c.get("notes", ""),
        })

    driver_perf = {}
    for c in cars:
        for role, fld in [
            ("checkin", "check_in_driver_id"),
            ("parking", "parked_driver_id"),
            ("retrieval", "retrieval_driver_id"),
        ]:
            did = c.get(fld)
            if not did:
                continue
            if did not in driver_perf:
                driver_perf[did] = {
                    "name": drivers_map.get(did, {}).get("name", ""),
                    "employee_id": drivers_map.get(
                        did, {}
                    ).get("employee_id", ""),
                    "checkins": 0,
                    "parkings": 0,
                    "retrievals": 0,
                    "incidents": 0,
                    "_driver_ratings": [],
                }
            driver_perf[did][f"{role}s"] += 1

    # Driver rating (how the driver specifically was rated) — attributed to
    # whichever driver retrieved/delivered the car, since that's who the
    # guest is rating in the "driver_stars" field.
    for c in cars:
        rd = c.get("retrieval_driver_id")
        if not rd or rd not in driver_perf:
            continue
        r = ratings_map.get(c["id"])
        if r and r.get("driver_stars"):
            driver_perf[rd]["_driver_ratings"].append(r["driver_stars"])

    for did, perf in driver_perf.items():
        dratings = perf.pop("_driver_ratings")
        perf["avg_rating"] = round(sum(dratings) / len(dratings), 2) if dratings else None

    for inc in incidents:
        did = inc.get("driver_id")
        if did and did in driver_perf:
            driver_perf[did]["incidents"] += 1

    total = len(cars)
    delivered = len([c for c in cars if c.get("status") == "DELIVERED"])
    avg_duration = round(
        sum(durations) / len(durations), 1
    ) if durations else 0
    avg_retrieval = round(
        sum(retrieval_times) / len(retrieval_times), 1
    ) if retrieval_times else 0
    platform_avg_rating = round(
        sum(r["stars"] for r in ratings_list) / len(ratings_list), 2
    ) if ratings_list else 0
    dr_rats = [r["driver_stars"] for r in ratings_list if r.get("driver_stars")]
    driver_avg_rating = round(sum(dr_rats) / len(dr_rats), 2) if dr_rats else 0

    # Pre-registered vs walk-in
    pre_registered = len([c for c in cars if c.get("pre_registered") is True])
    walk_in = total - pre_registered

    # Peak hour — hour with most check-ins (IST)
    hour_counts = {}
    for c in cars:
        if c.get("check_in_time"):
            try:
                hour = (datetime.fromisoformat(c["check_in_time"]) + timedelta(hours=5, minutes=30)).hour
                hour_counts[hour] = hour_counts.get(hour, 0) + 1
            except Exception:
                pass
    peak_hour = max(hour_counts, key=hour_counts.get) if hour_counts else None
    peak_hour_str = f"{peak_hour:02d}:00 - {peak_hour+1:02d}:00" if peak_hour is not None else None

    # Still parked
    still_parked = len([c for c in cars if c.get("status") == "PARKED"])

    return {
        "event": {
            "name": event.get("name", ""),
            "date": event.get("date", ""),
            "end_date": event.get("end_date", ""),
            "start_time": event.get("start_time", ""),
            "end_time": event.get("end_time", ""),
            "venue": event.get("venue", ""),
            "status": event.get("status", ""),
            "max_cars": event.get("max_cars", 0),
        },
        "summary": {
            "total_cars": total,
            "delivered": delivered,
            "active": total - delivered,
            "avg_duration_minutes": avg_duration,
            "avg_retrieval_minutes": avg_retrieval,
            "platform_avg_rating": platform_avg_rating, "driver_avg_rating": driver_avg_rating,
            "total_incidents": len(incidents),
            "total_drivers": len(driver_perf),
            "pre_registered": pre_registered,
            "walk_in": walk_in,
            "peak_hour": peak_hour_str,
            "still_parked": still_parked,
        },
        "cars": car_rows,
        "drivers": list(driver_perf.values()),
        "incidents": incidents,
    }


# Event drivers
@api_router.get("/events/{eid}/drivers")
async def event_drivers(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    pid = event["provider_id"]
    drivers = await db.drivers.find({"provider_id": pid, "role": "driver", "is_active": True}, SAFE_DRIVER_PROJ).to_list(1000)
    other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
    assignments = {a["driver_id"]: a for a in await db.event_drivers.find({"event_id": {"$in": [e["id"] for e in other_events]}}, {"_id": 0}).to_list(2000)}
    e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
    e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
    other_map = {e["id"]: e for e in other_events}
    # Batch fetch — 3 queries total instead of 3×N
    ci_pipeline = [{"$match": {"event_id": eid, "deleted": {"$ne": True}}}, {"$group": {"_id": "$check_in_driver_id", "count": {"$sum": 1}}}]
    ci_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(ci_pipeline).to_list(1000)}

    cr_pipeline = [{"$match": {"event_id": eid, "status": "DELIVERED", "deleted": {"$ne": True}}}, {"$group": {"_id": "$retrieval_driver_id", "count": {"$sum": 1}}}]
    cr_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(cr_pipeline).to_list(1000)}

    assigned_ids = {a["driver_id"] for a in await db.event_drivers.find({"event_id": eid}, {"_id": 0, "driver_id": 1}).to_list(1000)}

    busy_ids = [d["id"] for d in drivers if d.get("duty_status") == "busy"]
    busy_car_plate = {}
    if busy_ids:
        active_cars = await db.cars.find(
            {"event_id": eid, "$or": [
                {"check_in_driver_id": {"$in": busy_ids}, "status": "CHECKED_IN"},
                {"retrieval_driver_id": {"$in": busy_ids}, "status": {"$in": ["BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"]}},
            ]},
            {"_id": 0, "plate": 1, "check_in_driver_id": 1, "retrieval_driver_id": 1}
        ).to_list(1000)
        for c in active_cars:
            if c.get("check_in_driver_id") in busy_ids:
                busy_car_plate[c["check_in_driver_id"]] = c["plate"]
            if c.get("retrieval_driver_id") in busy_ids:
                busy_car_plate[c["retrieval_driver_id"]] = c["plate"]

    for d in drivers:
        d["current_car_plate"] = busy_car_plate.get(d["id"])
        conflict = None
        if d["id"] in assignments:
            other = other_map.get(assignments[d["id"]]["event_id"])
            if other:
                o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
                o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
                if e_start < o_end and e_end > o_start:
                    conflict = other["name"]
        d["available"] = conflict is None
        d["conflict_event_name"] = conflict
        d["cars_checked_in"] = ci_map.get(d["id"], 0)
        d["cars_retrieved"] = cr_map.get(d["id"], 0)
        d["assigned"] = d["id"] in assigned_ids
    return drivers

@api_router.post("/events/{eid}/drivers/{did}")
async def assign_driver(eid: str, did: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    if user.get("role") in ("owner", "admin", "supervisor") and event["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    driver = await db.drivers.find_one({"id": did, "role": "driver"}, {"_id": 0, "provider_id": 1, "is_active": 1, "is_verified": 1})
    if not driver:
        raise HTTPException(404, "Driver not found")
    if driver["provider_id"] != event["provider_id"]:
        raise HTTPException(403, "Driver does not belong to this provider")
    if driver.get("is_active") is False:
        raise HTTPException(400, "Cannot assign an inactive driver to this event")
    if driver.get("is_verified") is False:
        raise HTTPException(400, "Cannot assign an unverified driver to this event")
    if await db.event_drivers.find_one({"event_id": eid, "driver_id": did}):
        return {"ok": True}

    # Check for conflicts
    other_assignments = await db.event_drivers.find({"driver_id": did, "event_id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
    if other_assignments:
        e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
        e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
        
        for a in other_assignments:
            other = await db.events.find_one({"id": a["event_id"], "status": "active"}, {"_id": 0})
            if other:
                o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
                o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
                if e_start < o_end and e_end > o_start:
                    raise HTTPException(409, f"Driver is already assigned to '{other['name']}'. Please unassign them first.")

    await db.event_drivers.insert_one({"id": str(uuid.uuid4()), "event_id": eid, "driver_id": did, "assigned": True, "status": "active"})
    
    async def _push_drv_assigned():
        drv = await db.drivers.find_one({"id": did}, {"_id": 0, "push_token": 1})
        token = drv.get("push_token") if drv else None
        if not token:
            return
        ev = await db.events.find_one({"id": eid}, {"_id": 0, "name": 1, "date": 1})
        if not ev:
            return
        await send_expo_push(
            [token],
            title="📋 Event Assignment",
            body_text=f"You've been assigned to {ev.get('name', 'an event')} on {ev.get('date', '')}",
            data={"event_id": eid, "screen": "event_detail"}
        )
    asyncio.create_task(_push_drv_assigned())

    return {"ok": True}

@api_router.delete("/events/{eid}/drivers/{did}")
async def unassign_driver(eid: str, did: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    if user.get("role") in ("owner", "admin", "supervisor") and event["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    await db.event_drivers.delete_many({"event_id": eid, "driver_id": did})
    return {"ok": True}

# Event supervisors
@api_router.get("/events/{eid}/supervisors")
async def event_supervisors(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    
    pid = event["provider_id"]
    if user.get("role") in ("owner", "admin") and pid != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    supervisors = await db.drivers.find({"provider_id": pid, "role": "supervisor", "is_active": True}, SAFE_DRIVER_PROJ).to_list(1000)
    other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
    assignments = {a["supervisor_id"]: a for a in await db.event_supervisors.find({"supervisor_id": {"$in": [s["id"] for s in supervisors]}}, {"_id": 0}).to_list(2000)}
    
    e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
    e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
    other_map = {e["id"]: e for e in other_events}
    
    for s in supervisors:
        conflict = None
        if s["id"] in assignments:
            other = other_map.get(assignments[s["id"]]["event_id"])
            if other:
                o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
                o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
                if e_start < o_end and e_end > o_start:
                    conflict = other["name"]
        s["available"] = conflict is None
        s["conflict_event_name"] = conflict
        s["assigned"] = await db.event_supervisors.find_one({"event_id": eid, "supervisor_id": s["id"]}) is not None
        
    return supervisors

@api_router.post("/events/{eid}/supervisors/{sid}")
async def assign_supervisor(eid: str, sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
        
    if user.get("role") in ("owner", "admin") and event["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    supervisor = await db.drivers.find_one({"id": sid, "role": "supervisor"}, {"_id": 0, "provider_id": 1, "is_active": 1, "is_verified": 1})
    if not supervisor:
        raise HTTPException(404, "Supervisor not found")
    if supervisor["provider_id"] != event["provider_id"]:
        raise HTTPException(403, "Supervisor does not belong to this provider")
    if supervisor.get("is_active") is False:
        raise HTTPException(400, "Cannot assign an inactive supervisor to this event")
    if supervisor.get("is_verified") is False:
        raise HTTPException(400, "Cannot assign an unverified supervisor to this event")
    if await db.event_supervisors.find_one({"event_id": eid, "supervisor_id": sid}):
        return {"ok": True}
        
    # Check for conflicts
    supervisors = await db.drivers.find({"id": sid, "role": "supervisor"}, SAFE_DRIVER_PROJ).to_list(1)
    if not supervisors:
        raise HTTPException(404, "Supervisor not found")
        
    other_assignments = await db.event_supervisors.find({"supervisor_id": sid, "event_id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
    if other_assignments:
        e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
        e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
        
        for a in other_assignments:
            other = await db.events.find_one({"id": a["event_id"], "status": "active"}, {"_id": 0})
            if other:
                o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
                o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
                if e_start < o_end and e_end > o_start:
                    raise HTTPException(409, f"Supervisor is already assigned to '{other['name']}'. Please unassign them first.")

    await db.event_supervisors.insert_one({"id": str(uuid.uuid4()), "event_id": eid, "supervisor_id": sid, "status": "active"})

    async def _push_sup_assigned(ev=event):
        sup = await db.drivers.find_one({"id": sid}, {"_id": 0, "push_token": 1})
        token = sup.get("push_token") if sup else None
        if not token:
            return
        await send_expo_push(
            [token],
            title="📋 Event Assignment",
            body_text=f"You've been assigned to {ev.get('name', 'an event')} on {ev.get('date', '')}",
            data={"event_id": eid, "screen": "event_detail"}
        )
    asyncio.create_task(_push_sup_assigned())

    return {"ok": True}

@api_router.delete("/events/{eid}/supervisors/{sid}")
async def unassign_supervisor(eid: str, sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    await db.event_supervisors.delete_many({"event_id": eid, "supervisor_id": sid})
    return {"ok": True}

@api_router.get("/supervisors/{sid}/events")
async def get_supervisor_events(sid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    if user.get("role") == "supervisor" and sid != user["user_id"]:
        raise HTTPException(403, "Forbidden")
    query = {"supervisor_id": sid}
    es_records = await db.event_supervisors.find(query, {"_id": 0, "event_id": 1}).to_list(1000)
    event_ids = [r["event_id"] for r in es_records]
    
    events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(1000)
    
    if user.get("role") in ("owner", "admin"):
        events = [e for e in events if e["provider_id"] == user["provider_id"]]
        
    for e in events:
        provider = await db.providers.find_one({"id": e["provider_id"]}, {"_id": 0, "name": 1})
        e["provider_name"] = provider["name"] if provider else "Unknown"
        
    return events

@api_router.get("/supervisors/{sid}/stats")
async def get_supervisor_stats(sid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    sup = await db.drivers.find_one({"id": sid, "role": "supervisor"})
    if not sup:
        raise HTTPException(404, "Supervisor not found")
        
    if user.get("role") in ("owner", "admin") and sup["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    if user.get("role") == "supervisor" and sid != user["user_id"]:
        raise HTTPException(403, "Forbidden")
        
    es_records = await db.event_supervisors.find({"supervisor_id": sid}, {"_id": 0, "event_id": 1}).to_list(2000)
    event_ids = [r["event_id"] for r in es_records]
    
    total_events = len(event_ids)
    active_events = await db.events.count_documents({"id": {"$in": event_ids}, "status": "active"}) if event_ids else 0
    total_cars_managed = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    
    car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"_id": 0, "id": 1}).to_list(100000)] if event_ids else []
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0, "stars": 1, "driver_stars": 1}).to_list(100000) if car_ids else []
    platform_avg_rating = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    dr_rats = [r["driver_stars"] for r in ratings if r.get("driver_stars")]
    driver_avg_rating = round(sum(dr_rats) / len(dr_rats), 2) if dr_rats else 0
    
    incidents_reported = await db.incidents.count_documents({"reported_by": sid})

    driver_records = await db.event_drivers.find( 
        {"event_id": {"$in": event_ids}}, 
        {"_id": 0, "driver_id": 1} 
    ).to_list(100000) if event_ids else [] 
    unique_drivers = len(set(r["driver_id"] for r in driver_records))
        
    return {
        "total_events": total_events,
        "active_events": active_events,
        "total_cars_managed": total_cars_managed,
        "platform_avg_rating": platform_avg_rating, "driver_avg_rating": driver_avg_rating,
        "incidents_reported": incidents_reported,
        "total_drivers_overseen": unique_drivers
    }

@api_router.get("/supervisors/{sid}/report")
async def get_supervisor_report(sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    sup = await db.drivers.find_one({"id": sid, "role": "supervisor"}, SAFE_DRIVER_PROJ)
    if not sup:
        raise HTTPException(404, "Supervisor not found")
        
    if user.get("role") in ("owner", "admin") and sup["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    stats = await get_supervisor_stats(sid, user)
    
    es_records = await db.event_supervisors.find({"supervisor_id": sid}, {"_id": 0, "event_id": 1}).to_list(2000)
    event_ids = [r["event_id"] for r in es_records]
    
    events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).sort("date", -1).to_list(1000)
    
    event_summary = []
    for e in events:
        e_cars = await db.cars.count_documents({"event_id": e["id"]})
        e_car_ids = [c["id"] for c in await db.cars.find({"event_id": e["id"]}, {"id": 1}).to_list(10000)]
        e_ratings = await db.ratings.find({"car_id": {"$in": e_car_ids}}, {"stars": 1, "driver_stars": 1}).to_list(10000) if e_car_ids else []
        platform_avg_rating = round(sum(r["stars"] for r in e_ratings) / len(e_ratings), 2) if e_ratings else 0
        dr_rats = [r["driver_stars"] for r in e_ratings if r.get("driver_stars")]
        driver_avg_rating = round(sum(dr_rats)/len(dr_rats), 2) if dr_rats else 0
        e_drivers_count = await db.event_drivers.count_documents({"event_id": e["id"]})
        
        event_summary.append({
            "event_name": e.get("name", ""),
            "event_date": e.get("date", ""),
            "end_date": e.get("end_date", ""),
            "venue": e.get("venue", ""),
            "status": e.get("status", ""),
            "total_cars": e_cars,
            "platform_avg_rating": platform_avg_rating,
            "driver_avg_rating": driver_avg_rating,
            "drivers_count": e_drivers_count
        })
        
    return {
        "supervisor": sup,
        "summary": stats,
        "events": event_summary
    }

@api_router.get("/drivers/{did}/events")
async def get_driver_events(did: str, user=Depends(require_roles("superadmin", "owner", "admin", "driver"))):
    if user.get("role") == "driver" and did != user["user_id"]: 
        raise HTTPException(403, "You can only view your own events") 

    # event_ids from event_drivers
    ed_ids = [a["event_id"] for a in await db.event_drivers.find({"driver_id": did}, {"_id": 0, "event_id": 1}).to_list(1000)]
    # event_ids from cars (check-in or retrieval)
    car_events = await db.cars.find({"$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}]}, {"_id": 0, "event_id": 1}).to_list(10000)
    car_ids = [c["event_id"] for c in car_events]
    
    all_eids = list(set(ed_ids + car_ids))
    events = await db.events.find({"id": {"$in": all_eids}}, {"_id": 0}).to_list(1000)
    
    if user.get("role") == "driver": 
        assigned_event_ids = [ 
            a["event_id"] for a in await db.event_drivers.find( 
                {"driver_id": did, "assigned": True}, 
                {"_id": 0, "event_id": 1} 
            ).to_list(1000) 
        ] 
        events = [e for e in events if e["id"] in assigned_event_ids and e.get("status") == "active"] 

    for e in events:
        eid = e["id"]
        # provider name
        provider = await db.providers.find_one({"id": e["provider_id"]}, {"_id": 0, "name": 1})
        e["provider_name"] = provider["name"] if provider else "Unknown"
        # stats for this driver
        e["cars_checked_in"] = await db.cars.count_documents({"event_id": eid, "check_in_driver_id": did})
        e["cars_retrieved"] = await db.cars.count_documents({"event_id": eid, "retrieval_driver_id": did, "status": "DELIVERED"})
        
    return events

@api_router.get("/drivers/{did}/report")
async def driver_report(
    did: str,
    user=Depends(get_current)
):
    """Full driver report for PDF export."""
    driver = await db.drivers.find_one(
        {"id": did},
        {"_id": 0, "hashed_pin": 0}
    )
    if not driver:
        raise HTTPException(404, "Driver not found")

    # All events this driver worked
    event_driver_records = await db.event_drivers.find(
        {"driver_id": did}, {"_id": 0, "event_id": 1}
    ).to_list(1000)
    event_ids = [r["event_id"] for r in event_driver_records]

    events_list = await db.events.find(
        {"id": {"$in": event_ids}},
        {"_id": 0, "id": 1, "name": 1, "date": 1,
         "venue": 1}
    ).to_list(1000)
    events_map = {e["id"]: e for e in events_list}

    # Cars checked in by this driver
    checkin_cars = await db.cars.find(
        {"check_in_driver_id": did}, {"_id": 0}
    ).to_list(10000)
    parked_cars = await db.cars.find(
        {"parked_driver_id": did}, {"_id": 0}
    ).to_list(10000)
    retrieved_cars = await db.cars.find(
        {"retrieval_driver_id": did}, {"_id": 0}
    ).to_list(10000)

    # Ratings for cars retrieved by this driver
    retrieved_ids = [c["id"] for c in retrieved_cars]
    ratings_list = await db.ratings.find(
        {"car_id": {"$in": retrieved_ids}},
        {"_id": 0, "car_id": 1, "stars": 1, "driver_stars": 1, "comment": 1}
    ).to_list(10000)
    platform_avg_rating = round(
        sum(r["stars"] for r in ratings_list) /
        len(ratings_list), 2
    ) if ratings_list else 0
    dr_rats = [r["driver_stars"] for r in ratings_list if r.get("driver_stars")]
    driver_avg_rating = round(sum(dr_rats) / len(dr_rats), 2) if dr_rats else 0

    # Incidents involving this driver
    incidents = await db.incidents.find(
        {"driver_id": did}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)

    # Build per-event summary
    event_summary = []
    for eid in event_ids:
        evt = events_map.get(eid, {})
        e_checkins = len([
            c for c in checkin_cars
            if c.get("event_id") == eid
        ])
        e_parkings = len([
            c for c in parked_cars
            if c.get("event_id") == eid
        ])
        e_retrievals = len([
            c for c in retrieved_cars
            if c.get("event_id") == eid
        ])
        if e_checkins + e_parkings + e_retrievals > 0:
            event_summary.append({
                "event_name": evt.get("name", ""),
                "event_date": evt.get("date", ""),
                "venue": evt.get("venue", ""),
                "checkins": e_checkins,
                "parkings": e_parkings,
                "retrievals": e_retrievals,
            })

    return {
        "driver": driver,
        "summary": {
            "total_events": len(event_summary),
            "total_checkins": len(checkin_cars),
            "total_parkings": len(parked_cars),
            "total_retrievals": len(retrieved_cars),
            "platform_avg_rating": platform_avg_rating, "driver_avg_rating": driver_avg_rating,
            "total_incidents": len(incidents),
        },
        "events": event_summary,
        "incidents": incidents,
    }

@api_router.get("/drivers/{did}/events/{eid}/cars")
async def get_driver_event_cars(did: str, eid: str, user=Depends(require_roles("superadmin"))):
    cars = await db.cars.find({"event_id": eid, "$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}], "deleted": {"$ne": True}}, {"_id": 0}).sort("check_in_time", ASCENDING).to_list(5000)
    for c in cars:
        is_ci = c.get("check_in_driver_id") == did
        is_re = c.get("retrieval_driver_id") == did
        if is_ci and is_re:
            c["role_in_event"] = "both"
        elif is_ci:
            c["role_in_event"] = "check_in"
        else:
            c["role_in_event"] = "retrieval"
    return cars

@api_router.post("/admin/fix-hotel-special-events") 
async def fix_hotel_special_events(user=Depends(require_roles("superadmin"))): 
    """One-time data migration to fix hotel_special events missing hotel_id.""" 
    # Find all events with event_type: hotel_special and missing/null hotel_id 
    query = { 
        "event_type": "hotel_special", 
        "$or": [ 
            {"hotel_id": {"$exists": False}}, 
            {"hotel_id": None} 
        ] 
    } 
    events = await db.events.find(query, {"_id": 0}).to_list(None) 
    
    fixed_count = 0 
    for event in events: 
        # Find the first hotel belonging to the same provider 
        hotel = await db.hotels.find_one({"provider_id": event["provider_id"]}, {"id": 1}) 
        if hotel: 
            update_fields = {"hotel_id": hotel["id"]} 
            if not event.get("event_qr_token"): 
                update_fields["event_qr_token"] = str(uuid.uuid4()) 
            
            await db.events.update_one({"id": event["id"]}, {"$set": update_fields}) 
            fixed_count += 1 
            
    return {"status": "success", "fixed_count": fixed_count} 

@api_router.post("/admin/fix-regular-event-qr-tokens")
async def fix_regular_event_qr_tokens(user=Depends(require_roles("superadmin"))):
    """One-time data migration to add event_qr_token to existing regular and hotel_special events missing one."""
    events = await db.events.find({"event_type": {"$in": ["regular", "hotel_special"]}, "event_qr_token": {"$exists": False}}, {"_id": 0, "id": 1}).to_list(10000)
    updated = 0
    for e in events:
        await db.events.update_one({"id": e["id"]}, {"$set": {"event_qr_token": str(uuid.uuid4())}})
        updated += 1
    return {"updated": updated}

@api_router.post("/admin/fix-valet-event-types")
async def fix_valet_event_types(user=Depends(require_roles("superadmin"))):
    """One-time data migration: the mobile app used to create valet-provider events with
    event_type='event' instead of 'regular' (fixed in create-event.jsx). Those events never
    got an event_qr_token because the QR-generation logic only checks for 'regular'.
    This relabels them to 'regular' and backfills a QR token where missing."""
    events = await db.events.find({"event_type": "event"}, {"_id": 0, "id": 1, "event_qr_token": 1}).to_list(10000)
    updated = 0
    for e in events:
        update_fields = {"event_type": "regular"}
        if not e.get("event_qr_token"):
            update_fields["event_qr_token"] = str(uuid.uuid4())
        await db.events.update_one({"id": e["id"]}, {"$set": update_fields})
        updated += 1
    return {"updated": updated}

@api_router.post("/admin/fix-hotel-event-venues") 
async def fix_hotel_event_venues(user=Depends(require_roles("superadmin"))): 
    """One-time migration to set venue to hotel name for all hotel events.""" 
    # Find all events that have a hotel_id 
    events = await db.events.find({"hotel_id": {"$exists": True, "$ne": None}}, {"_id": 0, "id": 1, "hotel_id": 1}).to_list(None) 
    
    updated_count = 0 
    for event in events: 
        hotel = await db.hotels.find_one({"id": event["hotel_id"]}, {"_id": 0, "name": 1}) 
        if hotel: 
            await db.events.update_one( 
                {"id": event["id"]}, 
                {"$set": {"venue": hotel["name"], "updated_at": now_iso()}} 
            ) 
            updated_count += 1 
            
    return {"status": "success", "updated_count": updated_count} 

# ============== CARS ==============
async def assert_car_ownership(car: dict, user: dict):
    """Raises 403 if the authenticated user's provider doesn't own this car's event."""
    if user.get("role") == "superadmin":
        return  # superadmin can touch anything
    event = await db.events.find_one({"id": car.get("event_id")}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    if event["provider_id"] != user.get("provider_id"):
        raise HTTPException(403, "Forbidden — car belongs to a different provider")

class CarCreate(BaseModel):
    plate: str
    qr_token: str
    color: Optional[str] = ""
    make: Optional[str] = ""
    notes: Optional[str] = ""
    gate: Optional[str] = ""
    event_id: str
    check_in_driver_id: str
    guest_phone: Optional[str] = None
    guest_name: Optional[str] = "" 
    instant_park: Optional[bool] = False 
    expected_arrival: Optional[str] = None 
    pass_token: Optional[str] = None 
    car_type: Optional[str] = "normal"
    alt_guest_phone: Optional[str] = None
    has_damage: Optional[bool] = False
    damage_notes: Optional[str] = None
    damage_types: Optional[List[str]] = []

class SendSmsBody(BaseModel): 
    phone: Optional[str] = None 

class DriverLocationBody(BaseModel):
    event_id: str
    lat: float
    lng: float
    car_id: Optional[str] = None
    journey_type: Optional[str] = "idle"
 
class ParkBody(BaseModel):
    zone: str
    slot: int
    parked_driver_id: str
    key_tag: Optional[str] = None
    parked_photo_url: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None

class PickupBody(BaseModel):
    retrieval_driver_id: str

class DeliverBody(BaseModel):
    delivery_photo_url: Optional[str] = ""

class OtpVerifyBody(BaseModel):
    otp: str

@api_router.get("/cars/event/{eid}")
async def cars_event(eid: str, user=Depends(get_current)):
    cars = await db.cars.find({"event_id": eid, "deleted": {"$ne": True}}, {"_id": 0}).to_list(5000)
    status_order = {"RETRIEVAL_REQUESTED": 0, "BEING_FETCHED": 1, "CHECKED_IN": 2, "PARKED": 3, "DELIVERED": 4}

    def sort_key(c):
        status = c.get("status", "")
        if status in ("RETRIEVAL_REQUESTED", "BEING_FETCHED"):
            tiebreak = c.get("retrieval_requested_at") or ""
        else:
            tiebreak = c.get("check_in_time") or ""
        return (status_order.get(status, 99), tiebreak)

    cars.sort(key=sort_key)
    return cars

@api_router.get("/superadmin/events/{eid}/cars")
async def superadmin_event_cars(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") == "driver": 
        assignment = await db.event_drivers.find_one({ 
            "event_id": eid, 
            "driver_id": user["user_id"], 
            "assigned": True 
        }) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    if user.get("role") in ("owner", "admin", "supervisor"):
        event = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
        if not event or event["provider_id"] != user["provider_id"]:
            raise HTTPException(403, "Forbidden")
    cars = await db.cars.find({"event_id": eid, "deleted": {"$ne": True}}, {"_id": 0}).to_list(10000)
    # Sort in Python: sorted(cars, key=lambda c: c.get("check_in_time") or "")
    cars = sorted(cars, key=lambda c: c.get("check_in_time") or "")
    
    # Batch driver lookups: collect all unique driver ids first
    driver_ids = set()
    for c in cars:
        if c.get("check_in_driver_id"):
            driver_ids.add(c["check_in_driver_id"])
        if c.get("retrieval_driver_id"):
            driver_ids.add(c["retrieval_driver_id"])
    
    drivers_map = {}
    if driver_ids:
        # Fetch them all in one query
        drivers_list = await db.drivers.find({"id": {"$in": list(driver_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(driver_ids))
        drivers_map = {d["id"]: d["name"] for d in drivers_list}
        
    for c in cars:
        c["check_in_driver_name"] = drivers_map.get(c.get("check_in_driver_id"), "—")
        c["retrieval_driver_name"] = drivers_map.get(c.get("retrieval_driver_id"), "—")
        
    return cars

@api_router.get("/qr-cards/lookup/{token}")
async def lookup_qr_card(token: str, event_id: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    card = await db.car_qr_cards.find_one({"qr_token": token})
    if not card:
        raise HTTPException(404, "Invalid QR code — this is not a recognized key-tag card.")
    event = await db.events.find_one({"id": event_id}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    if card.get("provider_id") != event["provider_id"]:
        raise HTTPException(400, "This card belongs to a different provider and cannot be used for this event.")
    if not card.get("is_active", True):
        raise HTTPException(400, "This card has been reported lost/damaged and is blocked. Please use a different card.")
    if card.get("status") != "empty":
        raise HTTPException(400, "This card is already in use on another vehicle. Please scan a different card.")
    
    return {"id": card["id"], "key_tag_number": card["key_tag_number"], "qr_token": card["qr_token"]}

@api_router.post("/cars")
@limiter.limit("60/minute")
async def create_car(request: Request, body: CarCreate, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    _t_start = time.perf_counter()
    if user.get("role") == "driver": 
        assignment = await db.event_drivers.find_one({ 
            "event_id": body.event_id, 
            "driver_id": user["user_id"], 
            "assigned": True 
        }) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    plate = body.plate.upper()
    # Run all validation queries in parallel
    event, current, duplicate = await asyncio.gather(
        db.events.find_one({"id": body.event_id}, {"_id": 0}),
        db.cars.count_documents({"event_id": body.event_id, "status": {"$nin": ["DELIVERED"]}}),
        db.cars.find_one({"event_id": body.event_id, "plate": plate}, {"_id": 0, "id": 1, "status": 1, "check_in_driver_id": 1, "check_in_time": 1}), 
    )
    if not event:
        raise HTTPException(404, "Event not found")
    if event.get("status") != "active":
        raise HTTPException(400, f"Event is '{event['status']}' — new check-ins are not allowed")
    if current >= event["max_cars"]:
        raise HTTPException(400, "Event is full")
    use_instant_park = bool(body.instant_park)
    if use_instant_park and not event.get("allow_instant_park"):
        raise HTTPException(400, "Instant Park is not enabled for this event")
    if not use_instant_park:
        if not body.guest_phone or not body.guest_phone.strip():
            raise HTTPException(400, "Guest phone number is required")
        if not body.guest_name or not body.guest_name.strip():
            raise HTTPException(400, "Guest name is required")
    if duplicate: 
        if duplicate.get("status") == "PRE_REGISTERED": 
            return clean(duplicate)  # pre-fill flow
        if duplicate.get("status") == "DELIVERED": 
            pass  # returning guest — allow new check-in record, fall through
        else: 
            # If this looks like a retry of a request that actually succeeded
            # (same driver, same plate, checked in within the last 2 minutes),
            # return the existing car instead of erroring out.
            recent_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
            same_driver = duplicate.get("check_in_driver_id") == body.check_in_driver_id
            recent = duplicate.get("check_in_time", "") >= recent_cutoff
            if same_driver and recent:
                existing_full = await db.cars.find_one({"id": duplicate["id"]}, {"_id": 0})
                return clean(existing_full)
            raise HTTPException(400, f"Vehicle {body.plate} is already active in this event (status: {duplicate['status']})")

    cid = str(uuid.uuid4())
    card = await db.car_qr_cards.find_one_and_update(
        {"qr_token": body.qr_token, "provider_id": event["provider_id"], "status": "empty", "is_active": {"$ne": False}},
        {"$set": {"status": "assigned", "car_id": cid}}
    )
    if not card:
        raise HTTPException(400, "This QR card is unavailable — it may already be in use or blocked. Please scan a different card.")

    doc = {
        "id": cid, "event_id": body.event_id, "plate": plate, "color": body.color or None, "make": body.make or None,
        "guest_name": body.guest_name or None, 
        "expected_arrival": body.expected_arrival or None, 
        "status": "CHECKED_IN", "zone": None, "slot": None, "gate": body.gate,
        "pre_registered": False,
        "qr_token": body.qr_token,
        "retrieval_token": str(uuid.uuid4()),
        "qr_card_id": card["id"],
        "key_tag_number": card["key_tag_number"],
        "scheduled_retrieval_time": None,
        "dispatch_at": None,
        "check_in_driver_id": body.check_in_driver_id, "check_in_time": now_iso(),
        "parked_driver_id": None, "parked_at": None,
        "retrieval_driver_id": None, "delivered_at": None,
        "photo_url": None, "delivery_photo_url": None, "notes": body.notes,
        "guest_phone": body.guest_phone or None,
        "is_instant_park": use_instant_park,
        "car_type": body.car_type or "normal",
        "alt_guest_phone": body.alt_guest_phone or None,
        "has_damage": bool(body.has_damage),
        "damage_notes": body.damage_notes or None,
        "damage_types": body.damage_types or [],
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    try:
        await db.cars.insert_one(doc.copy())
    except Exception:
        await db.car_qr_cards.update_one(
            {"id": card["id"]},
            {"$set": {"status": "empty", "car_id": None}}
        )
        raise
    _duration_ms = round((time.perf_counter() - _t_start) * 1000, 1)
    test_checkin_logger.info(f"plate={plate} event_id={body.event_id} car_id={cid} duration_ms={_duration_ms}")
    out = clean(doc)

    asyncio.create_task(record_assignment(
        car_id=doc["id"], event_id=body.event_id, driver_id=body.check_in_driver_id,
        action="checkin_assigned",
        source="self" if user.get("role") == "driver" else user["role"],
        performed_by=None if user.get("role") == "driver" else {"user_id": user["user_id"], "name": user.get("name"), "role": user["role"]},
    ))
    async def _mark_driver_busy(driver_id=body.check_in_driver_id):
        await db.drivers.update_one({"id": driver_id}, {"$set": {"duty_status": "busy", "duty_status_updated_at": now_iso()}})
    asyncio.create_task(_mark_driver_busy())

    if user.get("role") != "driver":
        async def _push_checkin_assigned(driver_id=body.check_in_driver_id, plate=doc["plate"], gate=doc.get("gate")):
            drv = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "push_token": 1})
            token = drv.get("push_token") if drv else None
            await send_expo_push(
                [token] if token else [],
                title="🚗 Car Assigned to You",
                body_text=f"{plate} checked in{f' at Gate {gate}' if gate else ''} — go park it",
                data={"car_id": doc["id"], "event_id": body.event_id, "screen": "mycars"}
            )
        asyncio.create_task(_push_checkin_assigned())

    out["warning"] = current + 1 >= event["max_cars"] * 0.8
    await manager.broadcast(f"event:{body.event_id}", {"type": "car_update", "data": out})
    await manager.broadcast(f"car:{doc['id']}", {"type": "car_update", "data": out})

    if out.get("warning"):
        async def _push_capacity(ev=event, eid=body.event_id):
            admin_tokens = await get_provider_admin_tokens(ev.get("provider_id", ""))
            sup_tokens = await get_event_supervisor_tokens(eid)
            current_count = await db.cars.count_documents({"event_id": eid, "deleted": {"$ne": True}})
            await send_expo_push(
                list(set(admin_tokens + sup_tokens)),
                title="⚡ Event Near Capacity",
                body_text=f"{ev.get('name')} is over 80% full ({current_count}/{ev.get('max_cars')} cars)",
                data={"event_id": eid, "screen": "event_detail"}
            )
        asyncio.create_task(_push_capacity())

    # Send SMS to guest if phone was provided at check-in 
    if body.guest_phone: 
        retrieval_link = f"{FRONTEND_URL}/r/{doc['retrieval_token']}" 
        sms_message = ( 
            f"Your {body.color} {body.make} is safely parked at {event['name']}. " 
            f"Click here to request retrieval when you're ready: {retrieval_link}" 
        ) 
        asyncio.create_task(asyncio.to_thread(send_sms, body.guest_phone, sms_message)) 

    return out

@api_router.post("/cars/{cid}/send-sms") 
async def resend_car_sms(cid: str, body: SendSmsBody = SendSmsBody(), user=Depends(get_current)): 
    """Send/resend the retrieval SMS. If a new phone is provided, update the record first.""" 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 
 
    # If admin provides a new/corrected number, update it on the car record 
    phone_to_use = car.get("guest_phone") 
    if body.phone: 
        await db.cars.update_one( 
            {"id": cid}, 
            {"$set": {"guest_phone": body.phone, "updated_at": now_iso()}} 
        ) 
        phone_to_use = body.phone 
 
    if not phone_to_use: 
        raise HTTPException(400, "No guest phone number on file for this car") 
 
    event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0}) 
    event_name = event["name"] if event else "your event" 
    retrieval_link = f"{FRONTEND_URL}/r/{car['retrieval_token']}" 
    sms_message = ( 
        f"Your {car['color']} {car['make']} is safely parked at {event_name}. " 
        f"Click here to request retrieval when you're ready: {retrieval_link}" 
    ) 
    send_sms(phone_to_use, sms_message) 
    return {"status": "sent", "phone": phone_to_use} 

@api_router.get("/cars/by-plate/{plate}")
async def get_car_by_plate(plate: str, event_id: str, user=Depends(get_current)):
    c = await db.cars.find_one({"plate": plate, "event_id": event_id, "deleted": {"$ne": True}}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Not found")
    return c

@api_router.get("/cars/{cid}")
async def get_car(cid: str, user=Depends(get_current)):
    c = await db.cars.find_one({"id": cid, "deleted": {"$ne": True}}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Not found")
    return c

@api_router.get("/cars/{cid}/gps-pin")
async def get_car_gps_pin(cid: str, user=Depends(get_current)):
    car = await db.cars.find_one({"id": cid}, {"_id": 0, "id": 1, "plate": 1, "zone": 1, "slot": 1, "status": 1, "gps_lat": 1, "gps_lng": 1})
    if not car:
        raise HTTPException(404, "Car not found")
    return car

@api_router.get("/cars/plate-lookup/{plate}")
async def plate_lookup(plate: str, event_id: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    plate_upper = plate.strip().upper()
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    
    if user.get("role") == "driver":
        assignment = await db.event_drivers.find_one({
            "event_id": event_id,
            "driver_id": user["user_id"],
            "assigned": True
        })
        if not assignment:
            raise HTTPException(403, "You are not assigned to this event")
    elif user.get("role") in ["admin", "supervisor"]:
        if event.get("provider_id") != user.get("provider_id"):
            raise HTTPException(403, "Forbidden")
            
    provider_id = event.get("provider_id")
    event_docs = await db.events.find({"provider_id": provider_id}, {"_id": 0, "id": 1}).to_list(1000)
    event_ids = [e["id"] for e in event_docs if e["id"] != event_id]
    
    match = await db.cars.find_one(
        {
            "plate": plate_upper,
            "event_id": {"$in": event_ids},
            "deleted": {"$ne": True}
        },
        {"_id": 0},
        sort=[("check_in_time", -1)]
    )
    
    if not match:
        return {"found": False}
        
    return {
        "found": True,
        "make": match.get("make"),
        "color": match.get("color"),
        "guest_name": match.get("guest_name"),
        "guest_phone": match.get("guest_phone"),
        "alt_guest_phone": match.get("alt_guest_phone"),
        "car_type": match.get("car_type", "normal")
    }

@api_router.patch("/cars/{cid}/park")
async def park_car(cid: str, body: ParkBody, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") == "driver": 
        car = await db.cars.find_one({"id": cid}) 
        if not car: 
            raise HTTPException(404, "Car not found") 
        assignment = await db.event_drivers.find_one({ 
            "event_id": car["event_id"], 
            "driver_id": user["user_id"], 
            "assigned": True 
        }) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)
    if car.get("status") not in ("CHECKED_IN", "AWAITING_REPARK"):
        raise HTTPException(409, "This car's status has changed and it can no longer be parked from here — the guest may have just requested it back. Please refresh your screen.")
    event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0, "zones": 1, "provider_id": 1})
    valid_zones = [z.get("name") for z in event.get("zones", [])]
    if valid_zones and body.zone not in valid_zones:
        raise HTTPException(400, f"Zone '{body.zone}' does not exist in this event. Valid zones: {valid_zones}")
    # Atomic slot claim
    slot_result = await db.parking_slots.update_one(
        {"event_id": car["event_id"], "zone_name": body.zone, "slot_number": int(body.slot), "is_occupied": False},
        {"$set": {"is_occupied": True, "car_id": cid}}
    )
    if slot_result.modified_count == 0:
        # Check if this car already owns the slot (idempotent re-park)
        existing_slot = await db.parking_slots.find_one(
            {"event_id": car["event_id"], "zone_name": body.zone, "slot_number": int(body.slot), "car_id": cid}
        )
        if not existing_slot:
            raise HTTPException(409, f"Slot {body.zone}-{body.slot} is already occupied — please choose another")
    upd = {
        "status": "PARKED",
        "zone": body.zone,
        "slot": body.slot,
        "parked_driver_id": body.parked_driver_id,
        "parked_at": now_iso(),
        "updated_at": now_iso(),
        "key_tag": body.key_tag,
        "parked_photo_url": body.parked_photo_url,
        "gps_lat": body.gps_lat,
        "gps_lng": body.gps_lng,
    }
    await db.cars.update_one({"id": cid}, {"$set": upd})
    car.update(upd)
    if body.parked_driver_id:
        asyncio.create_task(refresh_driver_duty_status(body.parked_driver_id))
    
    await db.parking_slots.update_one(
        {"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot},
        {"$set": {"is_occupied": True, "car_id": cid}}, upsert=True)
        
    slot = await db.parking_slots.find_one({"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0})
    await asyncio.gather(
        manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car}),
        manager.broadcast(f"event:{car['event_id']}", {"type": "slot_update", "data": slot})
    )
    return car

@api_router.patch("/cars/{cid}/park-photo") 
async def update_park_photo(cid: str, body: dict = Body(...), 
user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))): 
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)
    await db.cars.update_one( 
        {"id": cid}, 
        {"$set": { 
            "parked_photo_url": body.get("parked_photo_url", ""), 
            "updated_at": now_iso() 
        }} 
    ) 
    return {"ok": True} 

@api_router.patch("/cars/{cid}/key-tag")
async def update_key_tag(
    cid: str,
    body: dict = Body(...),
    user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))
):
    """Driver adds or updates key tag number after parking."""
    key_tag = body.get("key_tag", "").strip()
    if not key_tag:
        raise HTTPException(400, "key_tag is required")

    car = await db.cars.find_one(
        {"id": cid}, {"_id": 0, "event_id": 1, "status": 1}
    )
    if not car:
        raise HTTPException(404, "Car not found")
    await assert_car_ownership(car, user)

    if car.get("status") not in [
        "PARKED", "CHECKED_IN",
        "RETRIEVAL_REQUESTED", "BEING_FETCHED"
    ]:
        raise HTTPException(
            400, "Can only add key tag to active cars"
        )
    
    existing = await db.cars.find_one({
        "event_id": car["event_id"],
        "key_tag": key_tag,
        "id": {"$ne": cid},
        "status": {"$nin": ["DELIVERED"]},
        "deleted": {"$ne": True}
    })
    if existing:
        raise HTTPException(
            400,
            f"Hook #{key_tag} is already in use by "
            f"car {existing.get('plate', '')}. "
            f"Please use a different hook."
        )

    await db.cars.update_one(
        {"id": cid},
        {"$set": {
            "key_tag": key_tag,
            "updated_at": now_iso()
        }}
    )
    return {"ok": True, "key_tag": key_tag}

@api_router.patch("/cars/{cid}/request-retrieval")
async def request_retrieval(cid: str, retrieval_token: Optional[str] = Query(None), user=Depends(get_current_optional)):
    car = await db.cars.find_one({"id": cid}, {"_id": 0, "retrieval_token": 1, "status": 1, "event_id": 1, "retrieval_driver_id": 1})
    if not car:
        raise HTTPException(404, "Car not found")
    # Allow guest with matching retrieval_token OR authenticated staff
    if not user:
        if not retrieval_token or car.get("retrieval_token") != retrieval_token:
            raise HTTPException(403, "Invalid or missing token")

    # Guest is back at the gate while the driver is mid-re-park: pull the car
    # straight back to that same driver instead of forcing a full re-park +
    # fresh open-pool request.
    if car.get("status") == "AWAITING_REPARK":
        if not car.get("retrieval_driver_id"):
            raise HTTPException(400, "No driver is currently assigned to this car. Please wait a moment and try again.")
        result = await db.cars.update_one(
            {"id": cid, "status": "AWAITING_REPARK"},
            {"$set": {"status": "BEING_FETCHED", "being_fetched_at": now_iso(), "updated_at": now_iso()}}
        )
        if result.modified_count == 0:
            raise HTTPException(409, "This car's status just changed — please refresh and try again.")
        car = await db.cars.find_one({"id": cid}, {"_id": 0})
        await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
        await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
        await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})

        async def _push_recall():
            drv = await db.drivers.find_one({"id": car["retrieval_driver_id"]}, {"_id": 0, "push_token": 1})
            token_list = [drv["push_token"]] if drv and drv.get("push_token") else []
            await send_expo_push(
                token_list,
                title="🔄 Guest is back at the gate!",
                body_text=f"{car.get('plate')} — bring the car back, no need to re-park.",
                data={"car_id": cid, "event_id": car["event_id"], "screen": "retrievals"}
            )
        asyncio.create_task(_push_recall())
        return car

    allowed_statuses = ("PARKED",)
    if car.get("status") not in allowed_statuses:
        raise HTTPException(400, f"Car cannot be retrieved from status '{car['status']}'. Must be PARKED.")
    await db.cars.update_one({"id": cid}, {"$set": {"status": "RETRIEVAL_REQUESTED", "retrieval_requested_at": now_iso(), "updated_at": now_iso()}})
    rid = str(uuid.uuid4())
    await db.retrieval_requests.insert_one({"id": rid, "car_id": cid, "driver_id": None, "status": "PENDING",
                                            "requested_at": now_iso(), "updated_at": now_iso()})
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
    await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
    await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})

    async def _push_retrieval():
        logger.info(f"[PUSH] _push_retrieval triggered for car_id={cid} event_id={car['event_id']}")
        tokens = await get_event_driver_tokens(car["event_id"])
        sup_tokens = await get_event_supervisor_tokens(car["event_id"])
        logger.info(f"[PUSH] driver_tokens={len(tokens)} sup_tokens={len(sup_tokens)} for event_id={car['event_id']}")
        await send_expo_push(
            list(set(tokens + sup_tokens)),
            title="🚗 Retrieval Requested",
            body_text=f"{car.get('plate')} · Zone {car.get('zone', '?')} Slot {car.get('slot', '?')}",
            data={"car_id": cid, "event_id": car["event_id"], "screen": "retrievals"}
        )
    asyncio.create_task(_push_retrieval())

    return car

@api_router.patch("/cars/{cid}/schedule-retrieval") 
async def schedule_retrieval(cid: str, body: dict = Body(...), retrieval_token: Optional[str] = Query(None), user=Depends(get_current_optional)): 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 
    # Allow guest with matching retrieval_token OR authenticated staff
    if not user:
        if not retrieval_token or car.get("retrieval_token") != retrieval_token:
            raise HTTPException(403, "Invalid or missing token")
    if car["status"] not in ("PARKED",): 
        raise HTTPException(400, "Car must be parked to schedule retrieval") 
    
    scheduled_time_str = body.get("scheduled_time") 
    if not scheduled_time_str: 
        raise HTTPException(400, "scheduled_time is required") 
    
    # Normalize the datetime string — add :00 seconds if missing 
    # (datetime-local input sends "2026-05-20T15:30" without seconds) 
    try: 
        if len(scheduled_time_str) == 16: 
            scheduled_time_str = scheduled_time_str + ":00" 
        # Handle both with and without timezone suffix 
        if scheduled_time_str.endswith("Z"): 
            scheduled_time_str = scheduled_time_str[:-1] + "+00:00" 
        scheduled_dt = datetime.fromisoformat(scheduled_time_str) 
        if scheduled_dt.tzinfo is None: 
            scheduled_dt = scheduled_dt.replace(tzinfo=timezone.utc) 
    except ValueError: 
        raise HTTPException(400, "Invalid datetime format. Expected ISO format.") 
 
    # Validate time constraints OUTSIDE the try/except so 
    # HTTPException is not accidentally caught 
    now = datetime.now(timezone.utc) 
    if scheduled_dt <= now: 
        raise HTTPException(400, "Scheduled time must be in the future") 
    if scheduled_dt > now + timedelta(hours=12): 
        raise HTTPException(400, "Cannot schedule more than 12 hours ahead") 
    
    avg_minutes = await _get_avg_retrieval_minutes(car["event_id"])
    lead_minutes = max(3, min(avg_minutes + 5, 20))
    dispatch_at = scheduled_dt - timedelta(minutes=lead_minutes)
    
    await db.cars.update_one( 
        {"id": cid}, 
        {"$set": { 
            "scheduled_retrieval_time": scheduled_dt, 
            "dispatch_at": dispatch_at,
            "status": "PARKED", 
            "updated_at": now_iso() 
        }} 
    ) 
    updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    await broadcast_car_update(updated) 
    return clean(updated) 

@api_router.patch("/cars/{cid}/schedule-retrieval/cancel") 
async def cancel_scheduled_retrieval(cid: str, retrieval_token: Optional[str] = Query(None), user=Depends(get_current_optional)): 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 
    # Allow guest with matching retrieval_token OR authenticated staff
    if not user:
        if not retrieval_token or car.get("retrieval_token") != retrieval_token:
            raise HTTPException(403, "Invalid or missing token")
    if not car.get("scheduled_retrieval_time"): 
        raise HTTPException(400, "No scheduled retrieval to cancel") 
    await db.cars.update_one( 
        {"id": cid}, 
        {"$set": { 
            "scheduled_retrieval_time": None, 
            "dispatch_at": None,
            "updated_at": now_iso() 
        }} 
    ) 
    updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    await broadcast_car_update(updated) 
    return clean(updated) 

@api_router.patch("/cars/{cid}/pickup")
async def pickup_car(cid: str, body: PickupBody, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") == "driver": 
        car = await db.cars.find_one({"id": cid}) 
        if not car: 
            raise HTTPException(404, "Car not found") 
        assignment = await db.event_drivers.find_one({ 
            "event_id": car["event_id"], 
            "driver_id": user["user_id"], 
            "assigned": True 
        }) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)
    upd = {
        "status": "BEING_FETCHED",
        "retrieval_driver_id": body.retrieval_driver_id,
        "being_fetched_at": now_iso(),
        "updated_at": now_iso()
    }
    result = await db.cars.update_one(
        {"id": cid, "status": "RETRIEVAL_REQUESTED"},
        {"$set": upd}
    )
    if result.modified_count == 0:
        raise HTTPException(409, "Car was already claimed by another driver — refresh your list")
    car.update(upd)
    await db.retrieval_requests.update_one({"car_id": cid, "status": "PENDING"},
                                           {"$set": {"status": "ASSIGNED", "driver_id": body.retrieval_driver_id, "updated_at": now_iso()}})
    asyncio.create_task(record_assignment(
        car_id=cid, event_id=car["event_id"], driver_id=body.retrieval_driver_id,
        action="retrieval_assigned",
        source="self" if user.get("role") == "driver" else user["role"],
        performed_by=None if user.get("role") == "driver" else {"user_id": user["user_id"], "name": user.get("name"), "role": user["role"]},
    ))
    async def _mark_driver_busy_retrieval(driver_id=body.retrieval_driver_id):
        await db.drivers.update_one({"id": driver_id}, {"$set": {"duty_status": "busy", "duty_status_updated_at": now_iso()}})
    asyncio.create_task(_mark_driver_busy_retrieval())
    await asyncio.gather(
        manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car}),
        manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car}),
        manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
    )

    if user.get("role") != "driver":
        async def _push_retrieval_assigned(driver_id=body.retrieval_driver_id, plate=car.get("plate"), event_id=car["event_id"]):
            drv = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "push_token": 1})
            token = drv.get("push_token") if drv else None
            await send_expo_push(
                [token] if token else [],
                title="🔔 Retrieval Assigned to You",
                body_text=f"{plate} needs to be retrieved",
                data={"car_id": cid, "event_id": event_id, "screen": "retrievals"}
            )
        asyncio.create_task(_push_retrieval_assigned())

    return car

@api_router.patch("/cars/{cid}/deliver")
async def deliver_car(cid: str, body: DeliverBody, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") == "driver": 
        car = await db.cars.find_one({"id": cid}) 
        if not car: 
            raise HTTPException(404, "Car not found") 
        assignment = await db.event_drivers.find_one({ 
            "event_id": car["event_id"], 
            "driver_id": user["user_id"], 
            "assigned": True 
        }) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)
    if user.get("role") == "driver" and not car.get("otp_verified"):
        raise HTTPException(400, "Guest must confirm the OTP before delivery can be marked")
    upd = {"status": "DELIVERED", "delivery_photo_url": body.delivery_photo_url,
                                                   "delivered_at": now_iso(), "updated_at": now_iso(),
                                                   "otp_verified": False, "no_show_count": 0}
    await db.cars.update_one({"id": cid}, {"$set": upd})
    car.update(upd)
    if car.get("qr_card_id"):
        await db.car_qr_cards.update_one({"id": car["qr_card_id"]}, {"$set": {"status": "empty", "car_id": None}})
    await db.retrieval_requests.update_one({"car_id": cid}, {"$set": {"status": "COMPLETED", "updated_at": now_iso()}})
    if car.get("retrieval_driver_id"):
        asyncio.create_task(refresh_driver_duty_status(car["retrieval_driver_id"]))
    if car.get("zone") and car.get("slot") is not None:
        await db.parking_slots.update_one(
            {"event_id": car["event_id"], "zone_name": car["zone"], "slot_number": car["slot"]},
            {"$set": {"is_occupied": False, "car_id": None}})
    await asyncio.gather(
        manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car}),
        manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
    )

    async def _push_delivered(c=car):
        sup_tokens = await get_event_supervisor_tokens(c["event_id"])
        await send_expo_push(
            sup_tokens,
            title="✅ Car Delivered",
            body_text=f"{c.get('plate')} handed to guest",
            data={"event_id": c["event_id"], "screen": "event_detail"}
        )
    asyncio.create_task(_push_delivered())

    return car

@api_router.patch("/cars/{cid}/arrive-at-gate")
async def arrive_at_gate(cid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") == "driver":
        car = await db.cars.find_one({"id": cid})
        if not car:
            raise HTTPException(404, "Car not found")
        assignment = await db.event_drivers.find_one({
            "event_id": car["event_id"],
            "driver_id": user["user_id"],
            "assigned": True
        })
        if not assignment:
            raise HTTPException(403, "You are not assigned to this event")
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)
    if car["status"] != "BEING_FETCHED":
        raise HTTPException(400, f"Car must be BEING_FETCHED to mark arrived at gate, current status '{car['status']}'")

    event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0, "gate_timer_minutes": 1, "hotel_id": 1})
    timer_minutes = (event or {}).get("gate_timer_minutes")
    if not timer_minutes and event and event.get("hotel_id"):
        hotel = await db.hotels.find_one({"id": event["hotel_id"]}, {"_id": 0, "gate_timer_minutes": 1})
        timer_minutes = (hotel or {}).get("gate_timer_minutes")
    timer_minutes = timer_minutes or DEFAULT_GATE_TIMER_MINUTES
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=timer_minutes)

    otp = str(random.randint(100000, 999999))
    await _otp_set(f"delivery_{cid}", otp, {"car_id": cid})

    upd = {
        "status": "ARRIVED_AT_GATE",
        "gate_arrival_time": now_iso(),
        "gate_timer_minutes_used": timer_minutes,
        "gate_timer_expires_at": expires_at,
        "otp_verified": False,
        "updated_at": now_iso()
    }
    await db.cars.update_one({"id": cid}, {"$set": upd})
    car.update(upd)
    car = _fix_gate_timer(car)
    await broadcast_car_update(car)
    return car

@api_router.get("/qr/{token}/delivery-otp")
async def get_delivery_otp(token: str):
    card = await db.car_qr_cards.find_one({"qr_token": token})
    if card:
        if not card.get("car_id"):
            raise HTTPException(404, "Invalid token")
        car = await db.cars.find_one({"id": card["car_id"]}, {"_id": 0, "id": 1, "status": 1})
    else:
        car = await db.cars.find_one({"qr_token": token}, {"_id": 0, "id": 1, "status": 1})
    if not car:
        raise HTTPException(404, "Invalid token")
    if car["status"] != "ARRIVED_AT_GATE":
        raise HTTPException(400, "No active delivery code for this car right now")
    stored = await _otp_get(f"delivery_{car['id']}")
    if not stored:
        raise HTTPException(404, "Code not found — ask the driver to try arriving at the gate again")
    return {"otp": stored["otp"]}

@api_router.get("/retrieval/{retrieval_token}/delivery-otp")
async def get_retrieval_delivery_otp(retrieval_token: str):
    car = await db.cars.find_one({"retrieval_token": retrieval_token}, {"_id": 0, "id": 1, "status": 1})
    if not car:
        raise HTTPException(404, "Invalid token")
    if car["status"] != "ARRIVED_AT_GATE":
        raise HTTPException(400, "No active delivery code for this car right now")
    stored = await _otp_get(f"delivery_{car['id']}")
    if not stored:
        raise HTTPException(404, "Code not found — ask the driver to try arriving at the gate again")
    return {"otp": stored["otp"]}

@api_router.post("/cars/{cid}/verify-delivery-otp")
async def verify_delivery_otp(cid: str, body: OtpVerifyBody, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)
    if car["status"] != "ARRIVED_AT_GATE":
        raise HTTPException(400, "Car is not currently waiting at the gate")
    key = f"delivery_{cid}"
    stored = await _otp_get(key)
    if not stored:
        raise HTTPException(400, "Code expired or not found — ask the guest to reopen their page")
    attempts = await _otp_increment_attempts(key)
    if attempts > OTP_MAX_ATTEMPTS:
        await _otp_delete(key)
        raise HTTPException(400, "Too many incorrect attempts. Guest should refresh their page for a new code")
    if stored["otp"] != body.otp.strip():
        raise HTTPException(400, "Incorrect code — please check with the guest and try again")
    await _otp_delete(key)
    upd = {
        "otp_verified": True,
        "gate_timer_expires_at": None,
        "updated_at": now_iso()
    }
    await db.cars.update_one({"id": cid}, {"$set": upd})
    car.update(upd)
    car = _fix_gate_timer(car)
    await broadcast_car_update(car)
    return car

@api_router.patch("/cars/{cid}/update-photo")
async def update_car_photo(cid: str, body: dict, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)
    await db.cars.update_one(
        {"id": cid},
        {"$set": {"delivery_photo_url": body.get("delivery_photo_url", ""), "updated_at": now_iso()}}
    )
    return {"ok": True}

@api_router.delete("/cars/{cid}")
async def delete_car(cid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Car not found")
    event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0, "provider_id": 1})
    if user.get("role") in ("owner", "admin") and event and event["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    await db.cars.update_one({"id": cid}, {"$set": {"deleted": True, "deleted_at": now_iso(), "deleted_by": user.get("user_id")}})

    # Release the parking slot this car was occupying, if any
    if car.get("zone") and car.get("slot") is not None:
        await db.parking_slots.update_one(
            {"event_id": car["event_id"], "zone_name": car["zone"], "slot_number": car["slot"], "car_id": cid},
            {"$set": {"is_occupied": False, "car_id": None}}
        )

    # Refresh duty status of any driver who had this car assigned
    if car.get("check_in_driver_id"):
        await refresh_driver_duty_status(car["check_in_driver_id"])
    if car.get("retrieval_driver_id"):
        await refresh_driver_duty_status(car["retrieval_driver_id"])

    return {"ok": True}

@api_router.get("/pre-register/hotel/{hotel_qr_token}") 
async def get_hotel_preregister_page(hotel_qr_token: str): 
    """Public route — returns hotel info + today's active hotel events.""" 
    hotel = await db.hotels.find_one( 
        {"hotel_qr_token": hotel_qr_token}, 
        {"_id": 0, "id": 1, "name": 1, "address": 1, "city": 1, "provider_id": 1} 
    ) 
    if not hotel: 
        raise HTTPException(404, "Invalid hotel registration link") 
    prov = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "is_active": 1})
    if not prov or prov.get("is_active") is False:
        raise HTTPException(403, "This valet provider is currently inactive")
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat() 
    events = await db.events.find( 
        {
            "hotel_id": hotel["id"], 
            "status": "active", 
            "date": today,
            "event_type": "hotel_daily"
        }, 
        {"_id": 0, "id": 1, "name": 1, "date": 1, "venue": 1, "start_time": 1, "end_time": 1} 
    ).to_list(1) 
    return {"hotel": hotel, "events": events} 
 
@api_router.post("/pre-register/hotel/{hotel_qr_token}") 
async def create_hotel_preregistration(hotel_qr_token: str, body: dict = Body(...)): 
    """Public route — guest pre-registers for hotel valet.""" 
    hotel = await db.hotels.find_one( 
        {"hotel_qr_token": hotel_qr_token}, 
        {"_id": 0, "id": 1, "name": 1, "provider_id": 1} 
    ) 
    if not hotel: 
        raise HTTPException(404, "Invalid hotel registration link") 
    prov = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "is_active": 1})
    if not prov or prov.get("is_active") is False:
        raise HTTPException(403, "This valet provider is currently inactive")
    event_id = body.get("event_id") 
    guest_name = body.get("guest_name", "").strip() 
    guest_phone = body.get("guest_phone", "").strip() 
    plate = body.get("plate", "").strip().upper() 
    make = body.get("make", "").strip() 
    color = body.get("color", "").strip() 
    expected_arrival = body.get("expected_arrival", "") 
    guest_notes = (body.get("guest_notes") or "").strip()
    
    # Validate plate format
    _std = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$')
    _bh = re.compile(r'^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')
    plate_clean = plate.replace("-", "").replace(" ", "")
    if not (_std.match(plate_clean) or _bh.match(plate_clean)):
        raise HTTPException(400, "Invalid number plate format. Use standard (GJ01AB1234) or BH series (22BH1234AA).")
    
    if not all([event_id, guest_name, guest_phone, plate, make, color]): 
        raise HTTPException(400, "All fields are required") 
    if not re.match(r"^\d{10}$", guest_phone): 
        raise HTTPException(400, "Invalid phone number — must be 10 digits") 
    event = await db.events.find_one( 
        {"id": event_id, "hotel_id": hotel["id"]}, 
        {"_id": 0, "name": 1, "max_cars": 1} 
    ) 
    if not event: 
        raise HTTPException(404, "Event not found") 
    existing = await db.cars.find_one( 
        {"event_id": event_id, "plate": plate}, 
        {"_id": 0, "id": 1, "qr_token": 1, "status": 1} 
    ) 
    if existing: 
        if existing["status"] == "PRE_REGISTERED": 
            retrieval_link = f"{FRONTEND_URL}/v/{existing['qr_token']}" 
            send_sms(guest_phone, f"Hi {guest_name}! Already registered for {hotel['name']} valet. QR: {retrieval_link}") 
            return {"pass_token": existing["qr_token"], "already_registered": True} 
        else: 
            raise HTTPException(400, "This plate is already checked in") 
    current_count = await db.cars.count_documents({
        "event_id": event_id,
        "status": {"$nin": ["DELIVERED", "PRE_REGISTERED"]},
        "deleted": {"$ne": True}
    }) 
    if current_count >= event["max_cars"]: 
        async def _push_full_hotel(ev=event, eid=event_id):
            admin_tokens = await get_provider_admin_tokens(ev.get("provider_id", ""))
            sup_tokens = await get_event_supervisor_tokens(eid)
            await send_expo_push(
                list(set(admin_tokens + sup_tokens)),
                title="🚨 Parking Full",
                body_text=f"{ev.get('name')} is now completely full ({current_count}/{ev.get('max_cars')} cars). No more check-ins possible.",
                data={"event_id": eid, "screen": "event_detail"}
            )
        asyncio.create_task(_push_full_hotel())
        raise HTTPException(400, "Hotel valet is at full capacity") 
    cid = str(uuid.uuid4()) 
    pass_token = str(uuid.uuid4()) 
    doc = { 
        "id": cid, "event_id": event_id, "plate": plate, "color": color, "make": make, 
        "guest_name": guest_name, "guest_phone": guest_phone, 
        "expected_arrival": expected_arrival or None, "status": "PRE_REGISTERED", 
        "pre_registered": True,
        "qr_token": pass_token, "scheduled_retrieval_time": None, 
        "dispatch_at": None,
        "zone": None, "slot": None, "gate": None, 
        "check_in_driver_id": None, "check_in_time": None, 
        "parked_driver_id": None, "parked_at": None, 
        "retrieval_driver_id": None, "delivered_at": None, 
        "photo_url": None, "delivery_photo_url": None, 
        "notes": guest_notes, "created_at": now_iso(), "updated_at": now_iso(), 
    } 
    await db.cars.insert_one(doc.copy()) 
    pass_link = f"{FRONTEND_URL}/v/{pass_token}" 
    send_sms(guest_phone, f"Hi {guest_name}! Your {color} {make} ({plate}) is pre-registered for {event['name']}. Show QR on arrival: {pass_link}") 
    return {"pass_token": pass_token, "already_registered": False}

@api_router.get("/pre-register/event/{event_qr_token}") 
async def get_event_preregister_page(event_qr_token: str): 
    """Public route — returns event details for a specific special event.""" 
    event = await db.events.find_one( 
        {"event_qr_token": event_qr_token}, 
        {"_id": 0, "id": 1, "name": 1, "date": 1, "end_date": 1, "venue": 1, "start_time": 1, "end_time": 1, "hotel_id": 1, "provider_id": 1, "status": 1, "event_type": 1} 
    ) 
    if not event: 
        raise HTTPException(404, "Invalid event registration link") 
    if event.get("status") == "closed":
        raise HTTPException(403, "This event is closed and no longer accepting registrations")
    prov = await db.providers.find_one({"id": event["provider_id"]}, {"_id": 0, "is_active": 1})
    if not prov or prov.get("is_active") is False:
        raise HTTPException(403, "This valet provider is currently inactive")
    
    # If it's a hotel special event, get hotel info 
    hotel = None 
    if event.get("hotel_id"): 
        hotel = await db.hotels.find_one( 
            {"id": event["hotel_id"]}, 
            {"_id": 0, "id": 1, "name": 1, "address": 1} 
        ) 
    
    # Get provider info 
    provider = await db.providers.find_one( 
        {"id": event["provider_id"]}, 
        {"_id": 0, "id": 1, "name": 1} 
    ) 
    
    return { 
        "event": event, 
        "hotel": hotel, 
        "provider": provider 
    } 
 
@api_router.post("/pre-register/event/{event_qr_token}") 
async def create_event_preregistration(event_qr_token: str, body: dict = Body(...)): 
    """Public route — guest pre-registers for a specific special event.""" 
    event = await db.events.find_one( 
        {"event_qr_token": event_qr_token}, 
        {"_id": 0, "id": 1, "name": 1, "hotel_id": 1, "provider_id": 1, "max_cars": 1, "status": 1, "date": 1, "end_date": 1, "start_time": 1, "end_time": 1, "event_type": 1} 
    ) 
    if not event: 
        raise HTTPException(404, "Invalid event registration link") 
    if event.get("status") == "closed":
        raise HTTPException(403, "This event is closed and no longer accepting registrations")
    prov = await db.providers.find_one({"id": event["provider_id"]}, {"_id": 0, "is_active": 1})
    if not prov or prov.get("is_active") is False:
        raise HTTPException(403, "This valet provider is currently inactive")
 
    guest_name = body.get("guest_name", "").strip() 
    guest_phone = body.get("guest_phone", "").strip() 
    plate = body.get("plate", "").strip().upper() 
    make = body.get("make", "").strip() 
    color = body.get("color", "").strip() 
    expected_arrival = body.get("expected_arrival", "") 
    if expected_arrival and event.get("event_type") != "hotel_daily":
        try:
            arrival_dt = datetime.fromisoformat(expected_arrival.replace("Z", "+00:00")).astimezone(ZoneInfo("Asia/Kolkata"))
            event_start = datetime.strptime(f"{event['date']} {event.get('start_time') or '00:00'}", "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("Asia/Kolkata"))
            event_end = datetime.strptime(f"{event.get('end_date') or event['date']} {event.get('end_time') or '23:59'}", "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("Asia/Kolkata"))
            if arrival_dt < event_start:
                raise HTTPException(400, f"Arrival time cannot be before the event starts ({event.get('start_time')})")
            if arrival_dt > event_end:
                raise HTTPException(400, f"Arrival time cannot be after the event ends ({event.get('end_time')})")
        except HTTPException:
            raise
        except Exception:
            pass
    guest_notes = (body.get("guest_notes") or "").strip()
    
    # Validate plate format
    _std = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$')
    _bh = re.compile(r'^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')
    plate_clean = plate.replace("-", "").replace(" ", "")
    if not (_std.match(plate_clean) or _bh.match(plate_clean)):
        raise HTTPException(400, "Invalid number plate format. Use standard (GJ01AB1234) or BH series (22BH1234AA).")
    
    if not all([guest_name, guest_phone, plate, make, color]): 
        raise HTTPException(400, "All fields are required") 
    if not re.match(r"^\d{10}$", guest_phone): 
        raise HTTPException(400, "Invalid phone number — must be 10 digits") 
 
    # Check if already pre-registered 
    existing = await db.cars.find_one( 
        {"event_id": event["id"], "plate": plate}, 
        {"_id": 0, "id": 1, "qr_token": 1, "status": 1} 
    ) 
    if existing: 
        if existing["status"] == "PRE_REGISTERED": 
            retrieval_link = f"{FRONTEND_URL}/v/{existing['qr_token']}" 
            send_sms(guest_phone, f"Hi {guest_name}! Already registered for {event['name']}. QR: {retrieval_link}") 
            return {"pass_token": existing["qr_token"], "already_registered": True} 
        else: 
            raise HTTPException(400, "This plate is already checked in") 
 
    # Check capacity 
    current_count = await db.cars.count_documents({
        "event_id": event["id"],
        "status": {"$nin": ["DELIVERED", "PRE_REGISTERED"]},
        "deleted": {"$ne": True}
    }) 
    if current_count >= event["max_cars"]: 
        async def _push_full_valet(ev=event, eid=event["id"]):
            admin_tokens = await get_provider_admin_tokens(ev.get("provider_id", ""))
            sup_tokens = await get_event_supervisor_tokens(eid)
            await send_expo_push(
                list(set(admin_tokens + sup_tokens)),
                title="🚨 Parking Full",
                body_text=f"{ev.get('name')} is now completely full ({current_count}/{ev.get('max_cars')} cars). No more check-ins possible.",
                data={"event_id": eid, "screen": "event_detail"}
            )
        asyncio.create_task(_push_full_valet())
        raise HTTPException(400, "Event is at full capacity") 
 
    # Create record 
    cid = str(uuid.uuid4()) 
    pass_token = str(uuid.uuid4()) 
    doc = { 
        "id": cid, "event_id": event["id"], "plate": plate, "color": color, "make": make, 
        "guest_name": guest_name, "guest_phone": guest_phone, 
        "expected_arrival": expected_arrival or None, "status": "PRE_REGISTERED", 
        "pre_registered": True,
        "qr_token": pass_token, "scheduled_retrieval_time": None, 
        "dispatch_at": None,
        "zone": None, "slot": None, "gate": None, 
        "check_in_driver_id": None, "check_in_time": None, 
        "parked_driver_id": None, "parked_at": None, 
        "retrieval_driver_id": None, "delivered_at": None, 
        "photo_url": None, "delivery_photo_url": None, 
        "notes": guest_notes, "created_at": now_iso(), "updated_at": now_iso(), 
    } 
    await db.cars.insert_one(doc.copy()) 
 
    # SMS 
    pass_link = f"{FRONTEND_URL}/v/{pass_token}" 
    send_sms(guest_phone, f"Hi {guest_name}! Your {color} {make} ({plate}) is pre-registered for {event['name']}. Show QR on arrival: {pass_link}") 
 
    return {"pass_token": pass_token, "already_registered": False}

@api_router.get("/pre-register/{provider_qr_token}") 
async def get_preregister_page(provider_qr_token: str): 
    """Public route — returns provider info + active/upcoming events.""" 
    provider = await db.providers.find_one( 
        {"provider_qr_token": provider_qr_token}, 
        {"_id": 0, "id": 1, "name": 1, "phone": 1} 
    ) 
    if not provider: 
        raise HTTPException(404, "Invalid registration link") 
    events = await db.events.find( 
        { 
            "provider_id": provider["id"], 
            "status": {"$in": ["active", "upcoming"]}, 
            "event_type": {"$nin": ["hotel_daily", "hotel_special"]} 
        }, 
        {"_id": 0, "id": 1, "name": 1, "date": 1, "venue": 1, "start_time": 1} 
    ).to_list(50) 
    return {"provider": provider, "events": events} 
 
 
@api_router.post("/pre-register/{provider_qr_token}") 
async def create_preregistration(provider_qr_token: str, body: dict = Body(...)): 
    """Public route — guest pre-registers their vehicle.""" 
    provider = await db.providers.find_one( 
        {"provider_qr_token": provider_qr_token}, 
        {"_id": 0, "id": 1, "name": 1} 
    ) 
    if not provider: 
        raise HTTPException(404, "Invalid registration link") 
 
    event_id = body.get("event_id") 
    guest_name = body.get("guest_name", "").strip() 
    guest_phone = body.get("guest_phone", "").strip() 
    plate = body.get("plate", "").strip().upper() 
    make = body.get("make", "").strip() 
    color = body.get("color", "").strip() 
    expected_arrival = body.get("expected_arrival", "") 
    guest_notes = (body.get("guest_notes") or "").strip()
    
    # Validate plate format
    _std = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$')
    _bh = re.compile(r'^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')
    plate_clean = plate.replace("-", "").replace(" ", "")
    if not (_std.match(plate_clean) or _bh.match(plate_clean)):
        raise HTTPException(400, "Invalid number plate format. Use standard (GJ01AB1234) or BH series (22BH1234AA).")
    
    # Validate required fields 
    if not all([event_id, guest_name, guest_phone, plate, make, color]): 
        raise HTTPException(400, "All fields are required") 
    if not re.match(r"^\d{10}$", guest_phone): 
        raise HTTPException(400, "Invalid phone number — must be 10 digits") 
 
    # Validate event belongs to provider 
    event = await db.events.find_one( 
        {"id": event_id, "provider_id": provider["id"]}, 
        {"_id": 0, "name": 1, "max_cars": 1} 
    ) 
    if not event: 
        raise HTTPException(404, "Event not found") 
 
    if event.get("event_type") == "hotel_daily": 
        raise HTTPException(400, "Please use the hotel QR code to register for hotel valet service") 
 
    # Check if already pre-registered for this event 
    existing = await db.cars.find_one( 
        {"event_id": event_id, "plate": plate}, 
        {"_id": 0, "id": 1, "qr_token": 1, "status": 1} 
    ) 
    if existing: 
        if existing["status"] == "PRE_REGISTERED": 
            # Already pre-registered — resend SMS and return pass token 
            retrieval_link = f"{FRONTEND_URL}/v/{existing['qr_token']}" 
            send_sms(guest_phone, f"Hi {guest_name}! Already registered for {event['name']}. QR: {retrieval_link}") 
            return {"pass_token": existing["qr_token"], "already_registered": True} 
        else: 
            raise HTTPException(400, "This plate is already checked in for this event") 
 
    # Check event capacity 
    current_count = await db.cars.count_documents({
        "event_id": event_id,
        "status": {"$nin": ["DELIVERED", "PRE_REGISTERED"]},
        "deleted": {"$ne": True}
    }) 
    if current_count >= event["max_cars"]: 
        raise HTTPException(400, "Event is at full capacity") 
 
    # Create pre-registered car record 
    cid = str(uuid.uuid4()) 
    pass_token = str(uuid.uuid4()) 
    doc = { 
        "id": cid, 
        "event_id": event_id, 
        "plate": plate, 
        "color": color, 
        "make": make, 
        "guest_name": guest_name, 
        "guest_phone": guest_phone, 
        "expected_arrival": expected_arrival or None, 
        "status": "PRE_REGISTERED", 
        "pre_registered": True,
        "qr_token": pass_token, 
        "scheduled_retrieval_time": None, 
        "dispatch_at": None,
        "zone": None, "slot": None, "gate": None, 
        "check_in_driver_id": None, "check_in_time": None, 
        "parked_driver_id": None, "parked_at": None, 
        "retrieval_driver_id": None, "delivered_at": None, 
        "photo_url": None, "delivery_photo_url": None, 
        "notes": guest_notes, 
        "created_at": now_iso(), "updated_at": now_iso(), 
    } 
    await db.cars.insert_one(doc.copy()) 
 
    # Send SMS with pass link 
    pass_link = f"{FRONTEND_URL}/v/{pass_token}" 
    send_sms(guest_phone, f"Hi {guest_name}! Your {color} {make} ({plate}) is pre-registered for {event['name']}. Show QR on arrival: {pass_link}") 
 
    return {"pass_token": pass_token, "already_registered": False} 

@api_router.get("/pass/{pass_token}") 
async def get_pass(pass_token: str): 
    """Public route — returns car details for driver QR scanner.""" 
    car = await db.cars.find_one({"qr_token": pass_token}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Invalid pass") 
    event = await db.events.find_one( 
        {"id": car["event_id"]}, 
        {"_id": 0, "name": 1, "venue": 1, "date": 1} 
    ) 
    return { 
        "car_id": car["id"], 
        "pass_token": pass_token, 
        "plate": car["plate"], 
        "make": car["make"], 
        "color": car["color"], 
        "guest_name": car.get("guest_name"), 
        "guest_phone": car.get("guest_phone"), 
        "expected_arrival": car.get("expected_arrival"), 
        "guest_notes": car.get("notes", ""),
        "status": car["status"], 
        "event_id": car["event_id"], 
        "event_name": event["name"] if event else "—", 
        "event_venue": event["venue"] if event else "—", 
        "can_request_retrieval": car.get("status") == "PARKED",
        "can_schedule_retrieval": car.get("status") in ("PARKED", "CHECKED_IN"),
    } 

@api_router.patch("/cars/{cid}/complete-checkin") 
async def complete_checkin(cid: str, body: dict = Body(...), user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))): 
    """Driver completes check-in for a PRE_REGISTERED car.""" 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 
    submitted_event_id = body.get("event_id")
    if submitted_event_id and submitted_event_id != car["event_id"]:
        raise HTTPException(400, "This guest is not registered for your assigned event")
    event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    if event.get("status") != "active":
        raise HTTPException(400, f"Event is '{event['status']}' — new check-ins are not allowed")
    if car["status"] != "PRE_REGISTERED": 
        raise HTTPException(400, "Car is not in PRE_REGISTERED status") 
        
    if not body.get("guest_name") or not str(body.get("guest_name")).strip():
        raise HTTPException(400, "Guest name is required")
 
    update = { 
        "status": "CHECKED_IN", 
        "pre_registered": True,
        "check_in_driver_id": body.get("check_in_driver_id"), 
        "check_in_time": now_iso(), 
        "gate": body.get("gate", ""), 
        "updated_at": now_iso(), 
    } 
    # Allow updating make/color/plate in case guest made typo 
    if body.get("make"): update["make"] = body["make"].strip() 
    if body.get("color"): update["color"] = body["color"].strip() 
    if body.get("notes"): update["notes"] = body["notes"].strip()
    if body.get("plate"): update["plate"] = body["plate"].strip().upper() 
    if body.get("car_type"): update["car_type"] = body["car_type"]
    if "alt_guest_phone" in body: update["alt_guest_phone"] = body.get("alt_guest_phone")
    if "has_damage" in body: update["has_damage"] = bool(body.get("has_damage"))
    if body.get("damage_notes"): update["damage_notes"] = body["damage_notes"].strip()
    if body.get("damage_types"): update["damage_types"] = body["damage_types"]
    if body.get("guest_name"): update["guest_name"] = body["guest_name"].strip()
 
    await db.cars.update_one({"id": cid}, {"$set": update}) 
    updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    await broadcast_car_update(updated) 
    await manager.broadcast( 
        f"event:{car['event_id']}", 
        {"type": "car_update", "data": clean(updated)} 
    ) 
    return clean(updated) 

# ============== CAR PHOTOS ==============
class PhotosBody(BaseModel):
    urls: List[str]
    type: str
    labels: Optional[List[str]] = None

@api_router.post("/cars/{cid}/photos")
async def save_photos(cid: str, body: PhotosBody, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    docs = []
    for i, u in enumerate(body.urls):
        label = body.labels[i] if body.labels and i < len(body.labels) else None
        docs.append({
            "id": str(uuid.uuid4()),
            "car_id": cid,
            "url": u,
            "type": body.type,
            "label": label,
            "created_at": now_iso(),
        })
    if docs:
        await db.car_photos.insert_many(docs)
    if body.type == "checkin" and body.urls:
        await db.cars.update_one({"id": cid}, {"$set": {"photo_url": body.urls[0]}})
        car = await db.cars.find_one({"id": cid}, {"_id": 0, "plate": 1, "check_in_time": 1})
        if car and car.get("check_in_time"):
            try:
                checkin_dt = datetime.fromisoformat(car["check_in_time"])
                elapsed_ms = round((datetime.now(timezone.utc) - checkin_dt).total_seconds() * 1000, 1)
                test_checkin_logger.info(f"VEHICLE_COMPLETE plate={car.get('plate')} car_id={cid} photos={len(body.urls)} total_time_since_checkin_ms={elapsed_ms}")
            except Exception:
                pass
    return {"ok": True, "count": len(docs)}

@api_router.get("/cars/{cid}/photos")
async def get_photos(cid: str, user=Depends(get_current)):
    return await db.car_photos.find({"car_id": cid}, {"_id": 0}).to_list(1000)

@api_router.get("/cars/{cid}/log") 
async def get_car_log(cid: str, user=Depends(get_current)): 
    """Returns complete timeline log for a single car.""" 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 

    # Fetch all driver names in one query 
    driver_ids = list(filter(None, [ 
        car.get("check_in_driver_id"), 
        car.get("parked_driver_id"), 
        car.get("retrieval_driver_id"), 
    ])) 
    drivers_list = await db.drivers.find( 
        {"id": {"$in": driver_ids}}, 
        {"_id": 0, "id": 1, "name": 1} 
    ).to_list(10) 
    drivers_map = {d["id"]: d["name"] for d in drivers_list} 

    # Fetch photos grouped by type 
    photos = await db.car_photos.find( 
        {"car_id": cid}, {"_id": 0} 
    ).to_list(100) 
    photos_by_type = {} 
    for p in photos: 
        photos_by_type.setdefault(p["type"], []).append(p["url"]) 

    # Fetch incidents for this car 
    incidents = await db.incidents.find( 
        {"car_id": cid}, {"_id": 0} 
    ).sort("created_at", 1).to_list(50) 

    # Fetch assignments for this car
    assignment_history = await db.assignments.find(
        {"car_id": cid}, {"_id": 0}
    ).sort("created_at", 1).to_list(100)

    # Fetch rating 
    rating = await db.ratings.find_one( 
        {"car_id": cid}, {"_id": 0} 
    ) 

    # Calculate durations 
    total_minutes = None 
    retrieval_minutes = None 
    try: 
        if car.get("check_in_time") and car.get("delivered_at"): 
            t1 = datetime.fromisoformat(car["check_in_time"]) 
            t2 = datetime.fromisoformat(car["delivered_at"]) 
            total_minutes = round( 
                (t2 - t1).total_seconds() / 60, 1 
            ) 
        if car.get("updated_at") and car.get("parked_at"): 
            if car.get("status") in [ 
                "RETRIEVAL_REQUESTED", "BEING_FETCHED", "DELIVERED" 
            ]: 
                t1 = datetime.fromisoformat(car["parked_at"]) 
                t2 = datetime.fromisoformat( 
                    car.get("delivered_at") or car["updated_at"] 
                ) 
                retrieval_minutes = round( 
                    (t2 - t1).total_seconds() / 60, 1 
                ) 
    except Exception: 
        pass 

    return { 
        "car": car, 
        "drivers_map": drivers_map, 
        "photos_by_type": photos_by_type, 
        "incidents": incidents, 
        "assignment_history": assignment_history,
        "rating_platform": rating["stars"] if rating else None,
        "rating_driver": rating.get("driver_stars") if rating else None,
        "rating_comment": rating.get("comment") if rating else None,
        "total_minutes": total_minutes, 
        "retrieval_minutes": retrieval_minutes, 
    } 


@api_router.get("/cars/{cid}/queue-position")
async def get_queue_position(cid: str):
    """Returns how many cars are ahead in retrieval queue."""
    car = await db.cars.find_one(
        {"id": cid},
        {"_id": 0, "event_id": 1, "status": 1,
         "retrieval_requested_at": 1}
    )
    if not car:
        raise HTTPException(404, "Car not found")

    if car.get("status") not in [
        "RETRIEVAL_REQUESTED", "BEING_FETCHED"
    ]:
        return {"position": 0, "total_waiting": 0, "avg_retrieval_minutes": 5.0, "estimated_wait_minutes": 0}

    avg_retrieval_minutes = await _get_avg_retrieval_minutes(car["event_id"])
    
    active_assignments = await db.event_drivers.find(
        {"event_id": car["event_id"], "assigned": True},
        {"_id": 0, "driver_id": 1}
    ).to_list(100000)
    driver_ids = [a["driver_id"] for a in active_assignments]
    
    active_driver_count = await db.drivers.count_documents({
        "id": {"$in": driver_ids},
        "duty_status": {"$in": ["available", "busy"]}
    }) if driver_ids else 0
    effective_drivers = max(active_driver_count, 1)

    # Count cars that requested retrieval BEFORE this car
    requested_at = car.get("retrieval_requested_at")
    if not requested_at:
        return {"position": 1, "total_waiting": 1, "avg_retrieval_minutes": avg_retrieval_minutes, "estimated_wait_minutes": avg_retrieval_minutes}

    # Cars ahead = same event, same statuses,
    # requested before this car
    cars_ahead = await db.cars.count_documents({
        "event_id": car["event_id"],
        "status": {"$in": [
            "RETRIEVAL_REQUESTED", "BEING_FETCHED"
        ]},
        "retrieval_requested_at": {"$lt": requested_at},
        "id": {"$ne": cid}
    })

    total_waiting = await db.cars.count_documents({
        "event_id": car["event_id"],
        "status": {"$in": [
            "RETRIEVAL_REQUESTED", "BEING_FETCHED"
        ]}
    })

    position = cars_ahead + 1
    estimated_wait_minutes = round(avg_retrieval_minutes * (-(-position // effective_drivers)), 1)

    return {
        "position": position,
        "total_waiting": total_waiting,
        "being_fetched": car["status"] == "BEING_FETCHED",
        "avg_retrieval_minutes": avg_retrieval_minutes,
        "estimated_wait_minutes": estimated_wait_minutes
    }

# ============== SLOTS ==============
@api_router.get("/slots/event/{eid}")
async def slots_event(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") in ("owner", "admin", "supervisor"):
        event = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
        if not event or event["provider_id"] != user["provider_id"]:
            raise HTTPException(403, "Forbidden")
    if user.get("role") == "driver": 
        assignment = await db.event_drivers.find_one({"event_id": eid, "driver_id": user["user_id"], "assigned": True}) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    return await db.parking_slots.find({"event_id": eid}, {"_id": 0}).to_list(5000)

@api_router.post("/slots/event/{eid}/initialize")
async def init_slots(eid: str, user=Depends(get_current)):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    # Bulk fetch all existing slots in one query
    existing_slots = await db.parking_slots.find(
        {"event_id": eid}, {"_id": 0, "zone_name": 1, "slot_number": 1}
    ).to_list(5000)
    existing_set = {(s["zone_name"], s["slot_number"]) for s in existing_slots}
    # Build all missing slots at once
    to_insert = []
    for zone in event.get("zones", []):
        zname = zone.get("name")
        count = int(zone.get("slots", 0))
        for i in range(1, count + 1):
            if (zname, i) not in existing_set:
                to_insert.append({
                    "id": str(uuid.uuid4()), "event_id": eid, "zone_name": zname,
                    "slot_number": i, "car_id": None, "is_occupied": False, "created_at": now_iso(),
                })
    # Single bulk insert instead of N inserts
    if to_insert:
        await db.parking_slots.insert_many(to_insert, ordered=False)
    slots = await db.parking_slots.find({"event_id": eid}, {"_id": 0}).to_list(5000)
    await manager.broadcast(f"event:{eid}", {"type": "slot_update", "data": {"slots": slots}})
    return {"ok": True, "created": len(to_insert), "total": len(slots)}

# ============== RETRIEVALS ==============
@api_router.get("/retrievals/event/{eid}")
async def event_retrievals(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    if user.get("role") == "driver": 
        assignment = await db.event_drivers.find_one({ 
            "event_id": eid, 
            "driver_id": user["user_id"], 
            "assigned": True 
        }) 
        if not assignment: 
            raise HTTPException(403, "You are not assigned to this event") 
    cars = await db.cars.find({"event_id": eid, "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"]}, "deleted": {"$ne": True}}, {"_id": 0}).to_list(1000)
    return [_fix_gate_timer(c) for c in cars]

class RetrievalBody(BaseModel):
    car_id: str

@api_router.post("/retrievals")
async def create_retrieval(body: RetrievalBody, user=Depends(get_current_optional)):
    return await request_retrieval(body.car_id, qr_token=None, user=user)

# ============== RATINGS ==============
class RatingBody(BaseModel):
    car_id: str
    stars: int
    driver_stars: int
    comment: Optional[str] = None

@api_router.post("/ratings")
async def post_rating(body: RatingBody, retrieval_token: Optional[str] = Query(None)):
    # Validate: either must be guest with matching retrieval_token, or car must exist
    car = await db.cars.find_one({"id": body.car_id}, {"_id": 0, "retrieval_token": 1, "status": 1})
    if not car:
        raise HTTPException(404, "Car not found")
    if car.get("status") != "DELIVERED":
        raise HTTPException(400, "Can only rate a delivered car")
    if retrieval_token and car.get("retrieval_token") != retrieval_token:
        raise HTTPException(403, "Invalid token")
    if body.stars < 1 or body.stars > 5:
        raise HTTPException(400, "Stars must be 1-5")
    if body.driver_stars < 1 or body.driver_stars > 5:
        raise HTTPException(400, "Driver stars must be 1-5")
    existing = await db.ratings.find_one({"car_id": body.car_id})
    if existing:
        return {"ok": True, "duplicate": True}
    await db.ratings.insert_one({
        "id": str(uuid.uuid4()),
        "car_id": body.car_id,
        "stars": body.stars,
        "driver_stars": body.driver_stars,
        "comment": body.comment or None,
        "created_at": now_iso()
    })

    if body.stars <= 2:
        async def _push_low_rating(car_snap=car):
            event_doc = await db.events.find_one(
                {"id": car_snap.get("event_id")},
                {"_id": 0, "provider_id": 1, "name": 1}
            )
            if not event_doc:
                return
            admin_tokens = await get_provider_admin_tokens(event_doc.get("provider_id", ""))
            sup_tokens = await get_event_supervisor_tokens(car_snap.get("event_id", ""))
            stars_display = "⭐" * body.stars
            await send_expo_push(
                list(set(admin_tokens + sup_tokens)),
                title=f"{stars_display} Low Rating Received",
                body_text=f"{car_snap.get('plate')} — {body.comment[:50] if body.comment else 'No comment'}",
                data={"event_id": car_snap.get("event_id"), "screen": "event_detail"}
            )
        asyncio.create_task(_push_low_rating())

    return {"ok": True}

# ============== INCIDENTS ==============

@api_router.get("/incidents/event/{eid}") 
async def get_event_incidents( 
    eid: str, 
    user=Depends(require_roles("owner", "admin", "superadmin", "supervisor")) 
): 
    if user.get("role") in ("owner", "admin", "supervisor"):
        event = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
        if not event or event["provider_id"] != user["provider_id"]:
            raise HTTPException(403, "Forbidden")
    incidents = await db.incidents.find( 
        {"event_id": eid}, {"_id": 0} 
    ).sort("created_at", -1).to_list(1000) 
    return incidents 

VALID_INCIDENT_TYPES = [
    "DAMAGE", "THEFT", "WRONG_CAR", "DELAY",
    "KEY_LOST", "ACCIDENT", "MISCONDUCT", "GUEST_COMPLAINT", "OTHER"
]

@api_router.post("/incidents")
async def create_incident(
    body: dict = Body(...),
    user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))
):
    event_id = body.get("event_id")
    car_id = body.get("car_id")
    driver_id = body.get("driver_id")
    description = body.get("description", "").strip()
    photo_url = body.get("photo_url", None)
    incident_type = body.get("incident_type", "").strip().upper()

    if not all([event_id, car_id, description, incident_type]):
        raise HTTPException(
            400, "event_id, car_id, description and incident_type are required"
        )
    if incident_type not in VALID_INCIDENT_TYPES:
        raise HTTPException(
            400, f"Invalid incident_type. Must be one of: {', '.join(VALID_INCIDENT_TYPES)}"
        )

    car = await db.cars.find_one( 
        {"id": car_id, "event_id": event_id}, 
        {"_id": 0, "plate": 1, "make": 1, "color": 1} 
    ) 
    if not car: 
        raise HTTPException(404, "Car not found in this event") 

    event = await db.events.find_one( 
        {"id": event_id}, {"_id": 0, "name": 1, "provider_id": 1} 
    )

    if user.get("role") in ("owner", "admin", "supervisor"):
        if not event or event["provider_id"] != user["provider_id"]:
            raise HTTPException(403, "Forbidden")
    if user.get("role") == "supervisor":
        assignment = await db.event_supervisors.find_one({
            "event_id": event_id, "supervisor_id": user["user_id"]
        })
        if not assignment:
            raise HTTPException(403, "You are not assigned to this event")

    driver_name = None 
    if driver_id: 
        drv = await db.drivers.find_one( 
            {"id": driver_id}, {"_id": 0, "name": 1} 
        ) 
        driver_name = drv["name"] if drv else None 

    incident = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "event_name": event["name"] if event else "",
        "car_id": car_id,
        "plate": car["plate"],
        "make": car.get("make", ""),
        "color": car.get("color", ""),
        "driver_id": driver_id or None,
        "driver_name": driver_name,
        "incident_type": incident_type,
        "description": description,
        "photo_url": photo_url,
        "status": "OPEN",
        "remark": None,
        "resolved_by": None,
        "resolved_at": None,
        "reported_by_provider": user.get("provider_id"),
        "reported_by": user.get("name") or "Unknown",
        "supervisor_id": user.get("user_id") if user.get("role") == "supervisor" else None,
        "created_at": now_iso(),
    }
    await db.incidents.insert_one(incident.copy()) 

    async def _push_incident(ev=event, inc=incident):
        if not ev:
            return
        admin_tokens = await get_provider_admin_tokens(ev.get("provider_id", ""))
        sup_tokens = await get_event_supervisor_tokens(inc["event_id"])
        await send_expo_push(
            list(set(admin_tokens + sup_tokens)),
            title="⚠️ Incident Reported",
            body_text=f"{inc['plate']} — {inc['description'][:60]}",
            data={"event_id": inc["event_id"], "car_id": inc["car_id"], "screen": "incidents"}
        )
    asyncio.create_task(_push_incident())

    incident.pop("_id", None) 
    return incident 

@api_router.patch("/incidents/{incident_id}")
async def update_incident(
    incident_id: str,
    body: dict = Body(...),
    user=Depends(require_roles("owner", "admin", "supervisor"))
):
    VALID_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]
    new_status = body.get("status", "").strip().upper()
    remark = body.get("remark", "").strip()

    if not new_status:
        raise HTTPException(400, "status is required")
    if new_status not in VALID_STATUSES:
        raise HTTPException(400, f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}")
    if new_status in ("RESOLVED", "DISMISSED") and not remark:
        raise HTTPException(400, "remark is required when resolving or dismissing an incident")

    incident = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not incident:
        raise HTTPException(404, "Incident not found")

    if user.get("role") in ("owner", "admin"):
        event = await db.events.find_one(
            {"id": incident["event_id"]}, {"_id": 0, "provider_id": 1}
        )
        if not event or event["provider_id"] != user["provider_id"]:
            raise HTTPException(403, "Forbidden")

    if user.get("role") == "supervisor":
        assignment = await db.event_supervisors.find_one({
            "event_id": incident["event_id"], "supervisor_id": user["user_id"]
        })
        if not assignment:
            raise HTTPException(403, "You are not assigned to this event")

    update = {
        "status": new_status,
        "remark": remark or incident.get("remark"),
    }
    if new_status in ("RESOLVED", "DISMISSED"):
        update["resolved_by"] = user.get("name") or user.get("email") or user.get("user_id")
        update["resolved_at"] = now_iso()

    await db.incidents.update_one({"id": incident_id}, {"$set": update})
    updated = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    return updated

@api_router.get("/incidents/car/{cid}") 
async def get_car_incidents(cid: str, user=Depends(get_current)): 
    incidents = await db.incidents.find( 
        {"car_id": cid}, {"_id": 0} 
    ).sort("created_at", -1).to_list(100) 
    return incidents

@api_router.get("/incidents/driver/{did}")
async def get_driver_incidents(did: str, user=Depends(require_roles("superadmin", "owner", "admin"))):
    """Fetch all incidents related to a specific driver with plate and event enrichment."""
    incidents = await db.incidents.find({"driver_id": did}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    # Enrichment
    for inc in incidents:
        # Fetch plate from cars
        if inc.get("car_id"):
            car = await db.cars.find_one({"id": inc["car_id"]}, {"_id": 0, "plate": 1})
            inc["plate"] = car["plate"] if car else "Unknown"
        else:
            inc["plate"] = "Unknown"
            
        # Fetch event name from events
        if inc.get("event_id"):
            event = await db.events.find_one({"id": inc["event_id"]}, {"_id": 0, "name": 1})
            inc["event_name"] = event["name"] if event else "Unknown"
        else:
            inc["event_name"] = "Unknown"
            
        # Map reported_by from reported_by_provider if reported_by doesn't exist
        if "reported_by" not in inc:
            inc["reported_by"] = inc.get("reported_by_provider", "System")

    # Filter to requested fields
    result = []
    for inc in incidents:
        result.append({
            "id": inc.get("id"),
            "car_id": inc.get("car_id"),
            "plate": inc.get("plate"),
            "event_id": inc.get("event_id"),
            "event_name": inc.get("event_name"),
            "description": inc.get("description"),
            "created_at": inc.get("created_at"),
            "reported_by": inc.get("reported_by"),
            "incident_type": inc.get("incident_type"),
            "status": inc.get("status"),
            "remark": inc.get("remark"),
            "resolved_by": inc.get("resolved_by"),
            "resolved_at": inc.get("resolved_at"),
        })
        
    return result

@api_router.get("/drivers/{did}/cars")
async def get_driver_cars(did: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    cars = await db.cars.find(
        {"check_in_driver_id": did, "deleted": {"$ne": True}},
        {"_id": 0}
    ).sort("check_in_time", -1).to_list(10000)
    event_ids = list({c["event_id"] for c in cars if c.get("event_id")})
    events_map = {}
    if event_ids:
        evs = await db.events.find(
            {"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}
        ).to_list(len(event_ids))
        events_map = {e["id"]: e["name"] for e in evs}
    for c in cars:
        c["event_name"] = events_map.get(c.get("event_id"), "—")
    return cars

@api_router.get("/incidents/supervisor/{sid}")
async def get_supervisor_incidents(sid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    """Fetch all incidents where supervisor_id matches {sid}. Admin role is restricted to their own provider."""
    query = {"supervisor_id": sid}
    if user.get("role") in ("owner", "admin"):
        query["reported_by_provider"] = user["provider_id"]
    incidents = await db.incidents.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return incidents

# ============== QR (no auth) ==============
async def _build_guest_view(car: dict) -> dict:
    car = _fix_gate_timer(car)
    event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0, "name": 1})
    event_name = event["name"] if event else "Event"
    return {
        **{k: v for k, v in car.items() if k != "_id"},
        "event_name": event_name,
        "can_request_retrieval": car.get("status") == "PARKED",
        "can_schedule_retrieval": car.get("status") in ("PARKED", "CHECKED_IN"),
    }

@api_router.get("/retrieval/{token}")
async def get_by_retrieval_token(token: str):
    car = await db.cars.find_one({"retrieval_token": token}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Invalid retrieval link")
    return await _build_guest_view(car)

@api_router.get("/qr-redirect/{token}")
async def qr_redirect(token: str):
    card = await db.car_qr_cards.find_one({"qr_token": token})
    if card and card.get("car_id"):
        car = await db.cars.find_one({"id": card["car_id"]}, {"_id": 0, "retrieval_token": 1})
        if car and car.get("retrieval_token"):
            return RedirectResponse(f"{FRONTEND_URL}/r/{car['retrieval_token']}", status_code=302)
    # No active car on this card right now — fall back to the existing /v/ page,
    # which already shows a friendly "Invalid QR" state for this exact case.
    return RedirectResponse(f"{FRONTEND_URL}/v/{token}", status_code=302)

@api_router.get("/qr/{token}")
async def get_by_qr(token: str):
    card = await db.car_qr_cards.find_one({"qr_token": token})
    if card:
        if not card.get("car_id"):
            raise HTTPException(404, "Invalid QR token")
        car = await db.cars.find_one({"id": card["car_id"]}, {"_id": 0})
    else:
        car = await db.cars.find_one({"qr_token": token}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Invalid QR token")
    return await _build_guest_view(car)

# ============== UPLOAD ==============
# @api_router.post("/upload")
# async def upload(file: UploadFile = File(...), folder: str = Form("misc"), user=Depends(get_current)):
#     ext = file.filename.split(".")[-1] if "." in (file.filename or "") else "bin"
#     path = f"{APP_NAME}/{folder}/{uuid.uuid4()}.{ext}"
#     data = await file.read()
#     result = put_object(path, data, file.content_type or "application/octet-stream")
#     public_url = f"{STORAGE_URL}/objects/{result['path']}"
#     return {"url": public_url, "path": result["path"]}

@api_router.post("/upload")
@limiter.limit("30/minute")
async def upload(request: Request, file: UploadFile = File(...), folder: str = Form("misc"), user=Depends(get_current)):
    _t0 = time.perf_counter()
    data = await file.read()
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Only image files are allowed (jpg, png, webp, etc.)")
    ext = file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg'
    path = f"{folder}/{uuid.uuid4()}.{ext}"
    result = await put_object(path, data, file.content_type or "application/octet-stream")
    duration_ms = round((time.perf_counter() - _t0) * 1000, 1)
    test_checkin_logger.info(f"PHOTO_UPLOAD folder={folder} size_kb={round(len(data)/1024, 1)} duration_ms={duration_ms}")
    return {"url": result.get("secure_url") or result.get("url"), "path": path}


# Requires ffmpeg + ffprobe installed on the server (apt install ffmpeg) — not currently a dependency of this codebase.
@api_router.post("/upload/checkin-video")
@limiter.limit("10/minute")
async def upload_checkin_video(request: Request, file: UploadFile = File(...), folder: str = Form("misc"), frame_count: int = Form(6), user=Depends(get_current)):
    _t0 = time.perf_counter()
    if not (file.content_type or "").startswith("video/"):
        raise HTTPException(400, "Only video files are allowed")
    
    data = await file.read()
    
    input_path = ""
    temp_dir = ""
    video_url = None
    photo_urls = []
    
    try:
        if FFMPEG_PATH is None or FFPROBE_PATH is None:
            video_result = await put_object(f"{folder}/video_{uuid.uuid4()}.mp4", data, content_type=file.content_type or "video/mp4")
            video_url = video_result.get("secure_url") or video_result.get("url")
            logger.warning("static_ffmpeg binaries missing, skipping frame extraction.")
            return {"video_url": video_url, "photo_urls": []}
            
        # Save video to temp file
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_video:
            tmp_video.write(data)
            input_path = tmp_video.name
            
        # Upload original video
        video_result = await put_object(f"{folder}/video_{uuid.uuid4()}.mp4", data, content_type=file.content_type or "video/mp4")
        video_url = video_result.get("secure_url") or video_result.get("url")
        
        # Create temp dir for frames
        temp_dir = tempfile.mkdtemp()
        
        # Get duration
        loop = asyncio.get_running_loop()
        try:
            duration_out = await loop.run_in_executor(
                None,
                lambda: subprocess.check_output(
                    [FFPROBE_PATH, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrapper=1:nokey=1", input_path],
                    stderr=subprocess.STDOUT
                )
            )
            duration = float(duration_out.decode('utf-8').strip())
        except Exception as e:
            logger.warning(f"Failed to get video duration with ffprobe, defaulting to 10.0s: {e}")
            duration = 10.0
            
        # Extract frames
        if duration > 0 and frame_count > 0:
            # Avoid exactly 0 and exactly duration
            start_time = duration * 0.05
            end_time = duration * 0.95
            interval = (end_time - start_time) / (frame_count - 1) if frame_count > 1 else 0
            
            for i in range(frame_count):
                ts = start_time + (i * interval)
                out_frame = os.path.join(temp_dir, f"frame_{i}.jpg")
                try:
                    await loop.run_in_executor(
                        None,
                        lambda: subprocess.check_output(
                            [FFMPEG_PATH, "-ss", str(ts), "-i", input_path, "-frames:v", "1", "-q:v", "3", "-y", out_frame],
                            stderr=subprocess.STDOUT
                        )
                    )
                    
                    if os.path.exists(out_frame):
                        with open(out_frame, "rb") as f:
                            frame_data = f.read()
                        frame_result = await put_object(f"{folder}/frame_{i}_{uuid.uuid4()}.jpg", frame_data, content_type="image/jpeg")
                        frame_url = frame_result.get("secure_url") or frame_result.get("url")
                        if frame_url:
                            photo_urls.append(frame_url)
                except Exception as e:
                    logger.error(f"Failed to extract or upload frame {i} at {ts}s: {e}")
                    
    except Exception as e:
        logger.error(f"Error processing video upload: {e}")
    finally:
        if input_path and os.path.exists(input_path):
            try:
                os.remove(input_path)
            except Exception:
                pass
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass
                
    duration_ms = round((time.perf_counter() - _t0) * 1000, 1)
    test_checkin_logger.info(f"VIDEO_UPLOAD folder={folder} size_kb={round(len(data)/1024, 1)} frames_extracted={len(photo_urls)} duration_ms={duration_ms}")
    
    return {"video_url": video_url, "photo_urls": photo_urls}



# ============== SUPERADMIN STATS ==============
@api_router.get("/superadmin/stats")
async def super_stats(user=Depends(require_roles("superadmin"))):
    today_date = datetime.now(timezone.utc).date()
    today = today_date.isoformat()
    today_start = datetime.combine(today_date, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    tomorrow_start = datetime.combine(today_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).isoformat()
    today_range = {"$gte": today_start, "$lt": tomorrow_start}

    (
        total_p, active_p, active_e, total_d, total_c, parked_c, pending_r,
        today_events, today_cars, today_parked, today_retrievals, today_retrieved,
        rating_agg, driver_rating_agg,
    ) = await asyncio.gather(
        db.providers.count_documents({"role": "owner"}),
        db.providers.count_documents({"role": "owner", "is_active": True}),
        db.events.count_documents({"status": "active"}),
        db.drivers.count_documents({"role": "driver"}),
        db.cars.count_documents({"deleted": {"$ne": True}}),
        db.cars.count_documents({"status": "PARKED"}),
        db.cars.count_documents({"status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}}),
        db.events.count_documents({"date": today}),
        db.cars.count_documents({"check_in_time": today_range, "deleted": {"$ne": True}}),
        db.cars.count_documents({"check_in_time": today_range, "status": "PARKED", "deleted": {"$ne": True}}),
        db.cars.count_documents({"check_in_time": today_range, "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}, "deleted": {"$ne": True}}),
        db.cars.count_documents({"check_in_time": today_range, "status": "DELIVERED", "deleted": {"$ne": True}}),
        db.ratings.aggregate([{"$group": {"_id": None, "avg": {"$avg": "$stars"}, "count": {"$sum": 1}}}]).to_list(1),
        db.ratings.aggregate([{"$match": {"driver_stars": {"$type": "number"}}}, {"$group": {"_id": None, "avg": {"$avg": "$driver_stars"}}}]).to_list(1),
    )
    avg = round(rating_agg[0]["avg"], 2) if rating_agg else 0
    driver_avg = round(driver_rating_agg[0]["avg"], 2) if driver_rating_agg else 0
    return {"total_providers": total_p, "active_providers": active_p, "active_events": active_e,
            "total_drivers": total_d, "total_cars": total_c, "parked_cars": parked_c,
            "pending_retrievals": pending_r, "platform_avg_rating": avg, "driver_avg_rating": driver_avg,
            "today_events": today_events, 
            "today_cars": today_cars, 
            "today_parked": today_parked, 
            "today_retrievals": today_retrievals, 
            "today_retrieved": today_retrieved}

@api_router.get("/superadmin/stats/activity")
async def super_stats_activity(
    user=Depends(require_roles("superadmin")),
    days: Optional[int] = Query(None, ge=1, le=366),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    today = datetime.now(timezone.utc).date()

    if start and end:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date()
            end_date = datetime.strptime(end, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "start and end must be YYYY-MM-DD")
        if end_date < start_date:
            raise HTTPException(400, "end must not be before start")
        if (end_date - start_date).days > 366:
            raise HTTPException(400, "range too large")
    else:
        window = days or 7
        end_date = today
        start_date = end_date - timedelta(days=window - 1)

    cutoff = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    cutoff_end = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).isoformat()

    pipeline = [
        {"$match": {"check_in_time": {"$exists": True, "$ne": None, "$gte": cutoff, "$lt": cutoff_end}, "deleted": {"$ne": True}}},
        {"$group": {"_id": {"$substr": ["$check_in_time", 0, 10]}, "checkins": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.cars.aggregate(pipeline).to_list(1000)
    counts = {r["_id"]: r["checkins"] for r in rows}

    num_days = (end_date - start_date).days + 1
    date_list = [(start_date + timedelta(days=i)).isoformat() for i in range(num_days)]
    return [{"date": d, "checkins": counts.get(d, 0)} for d in date_list]

@api_router.get("/superadmin/cars") 
async def superadmin_cars_list(
    user=Depends(require_roles("superadmin")),
    provider_id: Optional[str] = Query(None),
    plate: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500)
): 
    match = {"deleted": {"$ne": True}}
    if plate:
        match["plate"] = plate.upper()

    pipeline = [{"$match": match}]

    if provider_id:
        event_ids = [e["id"] for e in await db.events.find(
            {"provider_id": provider_id}, {"_id": 0, "id": 1}
        ).to_list(10000)]
        pipeline.append({"$match": {"event_id": {"$in": event_ids}}})

    pipeline.extend([
        {"$sort": {"check_in_time": -1}},
        {"$group": {
            "_id": "$plate",
            "plate": {"$first": "$plate"},
            "make": {"$first": "$make"},
            "color": {"$first": "$color"},
            "total_visits": {"$sum": 1},
            "last_seen": {"$first": "$check_in_time"},
            "last_event_id": {"$first": "$event_id"},
            "has_active": {"$max": {"$cond": [{"$ne": ["$status", "DELIVERED"]}, 1, 0]}},
        }},
        {"$project": {
            "_id": 0,
            "plate": 1,
            "make": 1,
            "color": 1,
            "total_visits": 1,
            "last_seen": 1,
            "last_event_id": 1,
            "has_active": {"$eq": ["$has_active", 1]},
        }},
        {"$sort": {"last_seen": -1}},
        {"$skip": skip},
        {"$limit": limit},
    ])

    result = await db.cars.aggregate(pipeline).to_list(limit)

    event_ids = list({v["last_event_id"] for v in result if v.get("last_event_id")})
    events_map = {}
    if event_ids:
        evs = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(event_ids))
        events_map = {e["id"]: e["name"] for e in evs}

    for v in result:
        v["last_event_name"] = events_map.get(v.get("last_event_id"), "—")

    return result

@api_router.get("/superadmin/cars/{plate}/history") 
async def superadmin_car_history(plate: str, user=Depends(require_roles("superadmin"))): 
    plate = plate.upper() 
    # All records for this plate 
    records = await db.cars.find({"plate": plate}, {"_id": 0}).sort("check_in_time", ASCENDING).to_list(1000) 
    if not records: 
        raise HTTPException(404, "No records found for this plate") 
    
    # Batch fetch events 
    event_ids = list({r["event_id"] for r in records}) 
    events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(len(event_ids)) 
    events_map = {e["id"]: e for e in events} 
    
    # Batch fetch provider names 
    provider_ids = list({e.get("provider_id") for e in events if e.get("provider_id")}) 
    providers = await db.providers.find({"id": {"$in": provider_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(provider_ids)) 
    providers_map = {p["id"]: p["name"] for p in providers} 
    
    # Batch fetch all driver ids 
    driver_ids = set() 
    for r in records: 
        for f in ["check_in_driver_id", "parked_driver_id", "retrieval_driver_id"]: 
            if r.get(f): 
                driver_ids.add(r[f]) 
    drivers = await db.drivers.find({"id": {"$in": list(driver_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(driver_ids)) 
    drivers_map = {d["id"]: d["name"] for d in drivers} 
    
    # Batch fetch all photos for these car ids 
    car_ids = [r["id"] for r in records] 
    photos = await db.car_photos.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(5000) 
    photos_by_car = {} 
    for p in photos: 
        photos_by_car.setdefault(p["car_id"], []).append(p) 
    
    # Batch fetch ratings 
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(1000) 
    ratings_map = {r["car_id"]: r for r in ratings} 

    # Batch fetch assignment audit trail (who assigned which driver, self vs supervisor/admin, reassignments)
    assignments = await db.assignments.find({"car_id": {"$in": car_ids}}, {"_id": 0}).sort("created_at", ASCENDING).to_list(5000)
    assignments_by_car = {}
    for a in assignments:
        assignments_by_car.setdefault(a["car_id"], []).append(a)
    
    # Build enriched visit records 
    visits = [] 
    for r in records: 
        event = events_map.get(r["event_id"], {}) 
        provider_id = event.get("provider_id") 
        
        # Calculate duration in minutes 
        duration_minutes = None 
        try: 
            if r.get("check_in_time") and r.get("delivered_at"): 
                t1 = datetime.fromisoformat(r["check_in_time"]) 
                t2 = datetime.fromisoformat(r["delivered_at"]) 
                duration_minutes = round((t2 - t1).total_seconds() / 60, 1) 
        except Exception: 
            pass 
        
        visits.append({ 
            "car_id": r["id"], 
            "event_id": r["event_id"], 
            "event_name": event.get("name", "—"), 
            "event_date": event.get("date", "—"), 
            "provider_name": providers_map.get(provider_id, "—"), 
            "status": r.get("status"), 
            "gate": r.get("gate", "—"), 
            "zone": r.get("zone"), 
            "slot": r.get("slot"), 
            "check_in_time": r.get("check_in_time"), 
            "parked_at": r.get("parked_at"), 
            "delivered_at": r.get("delivered_at"), 
            "retrieval_requested_at": r.get("retrieval_requested_at"), 
            "being_fetched_at": r.get("being_fetched_at"), 
            "duration_minutes": duration_minutes, 
            "check_in_driver": drivers_map.get(r.get("check_in_driver_id"), "—"), 
            "parked_by": drivers_map.get(r.get("parked_driver_id"), "—"), 
            "retrieved_by": drivers_map.get(r.get("retrieval_driver_id"), "—"), 
            "notes": r.get("notes", ""), 
            "guest_name": r.get("guest_name"),
            "guest_phone": r.get("guest_phone"),
            "alt_guest_phone": r.get("alt_guest_phone"),
            "key_tag": r.get("key_tag"),
            "car_type": r.get("car_type", "normal"),
            "has_damage": r.get("has_damage", False),
            "damage_notes": r.get("damage_notes"),
            "damage_types": r.get("damage_types", []),
            "rating": ratings_map.get(r["id"], {}).get("stars") if ratings_map.get(r["id"]) else None,
            "rating_comment": ratings_map.get(r["id"], {}).get("comment") if ratings_map.get(r["id"]) else None,
            "rating_driver": ratings_map.get(r["id"], {}).get("driver_stars") if ratings_map.get(r["id"]) else None,
            "photos": photos_by_car.get(r["id"], []), 
            "delivery_photo_url": r.get("delivery_photo_url"),
            "assignments": assignments_by_car.get(r["id"], []),
        }) 
    
    # Summary stats 
    delivered_visits = [v for v in visits if v["status"] == "DELIVERED"] 
    durations = [v["duration_minutes"] for v in delivered_visits if v["duration_minutes"] is not None] 
    
    return { 
        "plate": plate, 
        "make": records[-1].get("make", ""), 
        "color": records[-1].get("color", ""), 
        "total_visits": len(visits), 
        "first_seen": records[0].get("check_in_time"), 
        "last_seen": records[-1].get("check_in_time"), 
        "avg_duration_minutes": round(sum(durations) / len(durations), 1) if durations else None, 
        "visits": visits, 
    }

@api_router.get("/provider/cars/{plate}/history")
async def owner_car_history(plate: str, user=Depends(require_roles("owner", "admin"))):
    plate = plate.upper()
    records = await db.cars.find({"plate": plate}, {"_id": 0}).sort("check_in_time", ASCENDING).to_list(1000)
    if not records:
        raise HTTPException(404, "No records found for this plate")

    event_ids = list({r["event_id"] for r in records})
    events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(len(event_ids))
    events_map = {e["id"]: e for e in events}

    # Scope to this provider only — drop any visit records from other providers
    records = [r for r in records if events_map.get(r["event_id"], {}).get("provider_id") == user["provider_id"]]
    if not records:
        raise HTTPException(404, "No records found for this plate")

    # Batch fetch all driver ids 
    driver_ids = set() 
    for r in records: 
        for f in ["check_in_driver_id", "parked_driver_id", "retrieval_driver_id"]: 
            if r.get(f): 
                driver_ids.add(r[f]) 
    drivers = await db.drivers.find({"id": {"$in": list(driver_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(driver_ids)) 
    drivers_map = {d["id"]: d["name"] for d in drivers} 
    
    # Batch fetch all photos for these car ids 
    car_ids = [r["id"] for r in records] 
    photos = await db.car_photos.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(5000) 
    photos_by_car = {} 
    for p in photos: 
        photos_by_car.setdefault(p["car_id"], []).append(p) 
    
    # Batch fetch ratings 
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(1000) 
    ratings_map = {r["car_id"]: r for r in ratings} 

    # Batch fetch assignment audit trail
    assignments = await db.assignments.find({"car_id": {"$in": car_ids}}, {"_id": 0}).sort("created_at", ASCENDING).to_list(5000)
    assignments_by_car = {}
    for a in assignments:
        assignments_by_car.setdefault(a["car_id"], []).append(a)
    
    # Build enriched visit records 
    visits = [] 
    for r in records: 
        event = events_map.get(r["event_id"], {}) 
        
        # Calculate duration in minutes 
        duration_minutes = None 
        try: 
            if r.get("check_in_time") and r.get("delivered_at"): 
                t1 = datetime.fromisoformat(r["check_in_time"]) 
                t2 = datetime.fromisoformat(r["delivered_at"]) 
                duration_minutes = round((t2 - t1).total_seconds() / 60, 1) 
        except Exception: 
            pass 
        
        visits.append({ 
            "car_id": r["id"], 
            "event_id": r["event_id"], 
            "event_name": event.get("name", "—"), 
            "event_date": event.get("date", "—"), 
            "status": r.get("status"), 
            "gate": r.get("gate", "—"), 
            "zone": r.get("zone"), 
            "slot": r.get("slot"), 
            "check_in_time": r.get("check_in_time"), 
            "parked_at": r.get("parked_at"), 
            "delivered_at": r.get("delivered_at"), 
            "retrieval_requested_at": r.get("retrieval_requested_at"), 
            "being_fetched_at": r.get("being_fetched_at"), 
            "duration_minutes": duration_minutes, 
            "check_in_driver": drivers_map.get(r.get("check_in_driver_id"), "—"), 
            "parked_by": drivers_map.get(r.get("parked_driver_id"), "—"), 
            "retrieved_by": drivers_map.get(r.get("retrieval_driver_id"), "—"), 
            "notes": r.get("notes", ""), 
            "guest_name": r.get("guest_name"),
            "guest_phone": r.get("guest_phone"),
            "alt_guest_phone": r.get("alt_guest_phone"),
            "key_tag": r.get("key_tag"),
            "car_type": r.get("car_type", "normal"),
            "has_damage": r.get("has_damage", False),
            "damage_notes": r.get("damage_notes"),
            "damage_types": r.get("damage_types", []),
            "rating": ratings_map.get(r["id"], {}).get("stars") if ratings_map.get(r["id"]) else None,
            "rating_comment": ratings_map.get(r["id"], {}).get("comment") if ratings_map.get(r["id"]) else None,
            "rating_driver": ratings_map.get(r["id"], {}).get("driver_stars") if ratings_map.get(r["id"]) else None,
            "photos": photos_by_car.get(r["id"], []), 
            "delivery_photo_url": r.get("delivery_photo_url"),
            "assignments": assignments_by_car.get(r["id"], []),
        }) 
    
    # Summary stats 
    delivered_visits = [v for v in visits if v["status"] == "DELIVERED"] 
    durations = [v["duration_minutes"] for v in delivered_visits if v["duration_minutes"] is not None] 
    
    return { 
        "plate": plate, 
        "make": records[-1].get("make", ""), 
        "color": records[-1].get("color", ""), 
        "total_visits": len(visits), 
        "first_seen": records[0].get("check_in_time"), 
        "last_seen": records[-1].get("check_in_time"), 
        "avg_duration_minutes": round(sum(durations) / len(durations), 1) if durations else None, 
        "visits": visits, 
    }

@api_router.get("/superadmin/cars/{plate}/report")
async def superadmin_car_report(
    plate: str,
    user=Depends(require_roles("superadmin"))
):
    """Full vehicle report across all visits for PDF export."""
    cars = await db.cars.find(
        {"plate": plate.upper()},
        {"_id": 0}
    ).sort("created_at", 1).to_list(1000)

    if not cars:
        raise HTTPException(404, "No records for this plate")

    # Get all driver IDs
    driver_ids = list(set(filter(None, [
        c.get("check_in_driver_id") for c in cars
    ] + [
        c.get("parked_driver_id") for c in cars
    ] + [
        c.get("retrieval_driver_id") for c in cars
    ])))
    drivers_list = await db.drivers.find(
        {"id": {"$in": driver_ids}},
        {"_id": 0, "id": 1, "name": 1}
    ).to_list(1000)
    drivers_map = {d["id"]: d["name"] for d in drivers_list}

    # Get all event names
    event_ids = list(set(
        c.get("event_id") for c in cars if c.get("event_id")
    ))
    events_list = await db.events.find(
        {"id": {"$in": event_ids}},
        {"_id": 0, "id": 1, "name": 1, "date": 1,
         "venue": 1}
    ).to_list(1000)
    events_map = {e["id"]: e for e in events_list}

    # Get all photos
    car_ids = [c["id"] for c in cars]
    photos_list = await db.car_photos.find(
        {"car_id": {"$in": car_ids}},
        {"_id": 0}
    ).to_list(10000)
    photos_by_car = {}
    for p in photos_list:
        photos_by_car.setdefault(
            p["car_id"], []
        ).append(p)

    # Get ratings
    ratings_list = await db.ratings.find(
        {"car_id": {"$in": car_ids}},
        {"_id": 0, "car_id": 1, "stars": 1, "driver_stars": 1, "comment": 1}
    ).to_list(1000)
    ratings_map = {r["car_id"]: r for r in ratings_list}

    # Get incidents
    incidents_list = await db.incidents.find(
        {"car_id": {"$in": car_ids}},
        {"_id": 0}
    ).to_list(1000)
    incidents_by_car = {}
    for i in incidents_list:
        incidents_by_car.setdefault(
            i["car_id"], []
        ).append(i)

    # Build visit records
    visits = []
    for c in cars:
        duration_min = None
        retrieval_min = None
        try:
            if c.get("check_in_time") and c.get("delivered_at"):
                t1 = datetime.fromisoformat(c["check_in_time"])
                t2 = datetime.fromisoformat(c["delivered_at"])
                duration_min = round(
                    (t2 - t1).total_seconds() / 60, 1
                )
            if c.get("retrieval_requested_at") and \
               c.get("delivered_at"):
                t1 = datetime.fromisoformat(
                    c["retrieval_requested_at"]
                )
                t2 = datetime.fromisoformat(c["delivered_at"])
                retrieval_min = round(
                    (t2 - t1).total_seconds() / 60, 1
                )
        except Exception:
            pass

        evt = events_map.get(c.get("event_id"), {})
        rating = ratings_map.get(c["id"])
        visits.append({
            "car_id": c["id"],
            "event_name": evt.get("name", ""),
            "event_date": evt.get("date", ""),
            "event_venue": evt.get("venue", ""),
            "status": c.get("status", ""),
            "gate": c.get("gate", ""),
            "zone": c.get("zone", ""),
            "slot": c.get("slot", ""),
            "key_tag": c.get("key_tag", ""),
            "guest_name": c.get("guest_name", ""),
            "guest_phone": c.get("guest_phone", ""),
            "notes": c.get("notes", ""),
            "check_in_time": c.get("check_in_time", ""),
            "parked_at": c.get("parked_at", ""),
            "delivered_at": c.get("delivered_at", ""),
            "duration_minutes": duration_min,
            "retrieval_minutes": retrieval_min,
            "check_in_driver": drivers_map.get(
                c.get("check_in_driver_id"), ""
            ),
            "parked_driver": drivers_map.get(
                c.get("parked_driver_id"), ""
            ),
            "retrieval_driver": drivers_map.get(
                c.get("retrieval_driver_id"), ""
            ),
            "rating_platform": rating["stars"] if rating else None,
        "rating_driver": rating.get("driver_stars") if rating else None,
            "rating_comment": rating.get("comment")
                if rating else None,
            "photos": photos_by_car.get(c["id"], []),
            "incidents": incidents_by_car.get(c["id"], []),
        })

    # First car's basic info
    first = cars[0]
    total_delivered = len([
        v for v in visits if v["status"] == "DELIVERED"
    ])
    avg_duration = round(
        sum(v["duration_minutes"] for v in visits
            if v["duration_minutes"]) /
        max(total_delivered, 1), 1
    ) if total_delivered else 0

    return {
        "plate": plate.upper(),
        "make": first.get("make", ""),
        "color": first.get("color", ""),
        "guest_name": first.get("guest_name", ""),
        "guest_phone": first.get("guest_phone", ""),
        "total_visits": len(visits),
        "total_delivered": total_delivered,
        "avg_duration_minutes": avg_duration,
        "total_incidents": sum(
            len(v["incidents"]) for v in visits
        ),
        "visits": visits,
    }

@api_router.post("/sos/event/{event_id}")
async def create_sos_alert(event_id: str, body: SOSBody, user=Depends(get_current)):
    alert = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "driver_id": user["user_id"],
        "driver_name": user.get("name", ""),
        "alert_type": body.alert_type,
        "note": body.note,
        "car_id": body.car_id,
        "car_number": body.car_number,
        "status": "ACTIVE",
        "created_at": now_iso(),
        "resolved_at": None,
        "resolved_by": None,
    }
    await db.sos_alerts.insert_one({**alert, "_id": alert["id"]})
    await manager.broadcast(f"sos:{event_id}", {"type": "sos_alert", "alert": alert})

    async def _push_sos():
        sup_tokens = await get_event_supervisor_tokens(event_id)
        admin_tokens = await get_provider_admin_tokens(user.get("provider_id", ""))
        await send_expo_push(
            list(set(sup_tokens + admin_tokens)),
            title="🚨 SOS Alert",
            body_text=f"{body.alert_type.replace('_', ' ')} — {user.get('name', 'A driver')}",
            data={"event_id": event_id, "screen": "sos"}
        )
    asyncio.create_task(_push_sos())

    return alert

@api_router.get("/sos/event/{event_id}")
async def get_sos_alerts(event_id: str, status: Optional[str] = None, user=Depends(get_current)):
    query = {"event_id": event_id}
    if status:
        query["status"] = status
    alerts = await db.sos_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return alerts

@api_router.patch("/sos/{alert_id}/resolve")
async def resolve_sos_alert(alert_id: str, user=Depends(get_current)):
    alert = await db.sos_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(404, "Alert not found")
    upd = {
        "status": "RESOLVED",
        "resolved_at": now_iso(),
        "resolved_by": user["user_id"],
    }
    await db.sos_alerts.update_one({"id": alert_id}, {"$set": upd})
    await manager.broadcast(f"sos:{alert['event_id']}", {"type": "sos_resolved", "alert_id": alert_id})
    return {**alert, **upd}

@api_router.get("/sos/event/{event_id}/active-count")
async def sos_active_count(event_id: str, user=Depends(get_current)):
    count = await db.sos_alerts.count_documents({"event_id": event_id, "status": "ACTIVE"})
    return {"count": count}

# ============== WEBSOCKETS ==============
async def _ws_loop(channel: str, ws: WebSocket, token: Optional[str] = None, require_auth: bool = True):
    if require_auth:
        if not token:
            await ws.close(code=4001, reason="Unauthorized")
            return
        try:
            decode_token(token)
        except Exception:
            await ws.close(code=4001, reason="Unauthorized")
            return
    await manager.connect(channel, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(channel, ws)

# Spec-compliant paths
@app.websocket("/ws/event/{event_id}")
async def ws_event(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"event:{event_id}", ws, token=token, require_auth=True)

@app.websocket("/ws/car/{car_id}")
async def ws_car(ws: WebSocket, car_id: str, token: str = Query(None)):
    # Allow guest access via retrieval_token
    if token:
        car = await db.cars.find_one({"id": car_id, "retrieval_token": token}, {"_id": 0, "id": 1})
        if not car:
            await ws.close(code=4001, reason="Unauthorized")
            return
    await _ws_loop(f"car:{car_id}", ws, token=None, require_auth=False)

@app.websocket("/ws/retrievals/{event_id}")
async def ws_retrievals(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"retrievals:{event_id}", ws, token=token, require_auth=True)

# Ingress-friendly aliases (mounted under /api so Kubernetes ingress proxies them)
@app.websocket("/api/v1/ws/event/{event_id}")
async def ws_event_api(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"event:{event_id}", ws, token=token, require_auth=True)

@app.websocket("/api/v1/ws/car/{car_id}")
async def ws_car_api(ws: WebSocket, car_id: str, token: str = Query(None)):
    # Allow guest access via retrieval_token
    if token:
        car = await db.cars.find_one({"id": car_id, "retrieval_token": token}, {"_id": 0, "id": 1})
        if not car:
            await ws.close(code=4001, reason="Unauthorized")
            return
    await _ws_loop(f"car:{car_id}", ws, token=None, require_auth=False)

@app.websocket("/api/v1/ws/retrievals/{event_id}")
async def ws_retrievals_api(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"retrievals:{event_id}", ws, token=token, require_auth=True)

@app.websocket("/ws/sos/{event_id}")
async def ws_sos(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"sos:{event_id}", ws, token=token, require_auth=True)

@app.websocket("/api/v1/ws/sos/{event_id}")
async def ws_sos_api(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"sos:{event_id}", ws, token=token, require_auth=True)

# ============== STARTUP ==============
async def auto_close_loop():
    while True:
        try:
            now = datetime.now(timezone.utc)
            events = await db.events.find({"status": "active"}, {"_id": 0}).to_list(2000)
            for e in events:
                try:
                    end_dt = datetime.fromisoformat(f'{e["end_date"]}T{e.get("end_time","23:59")}:00+00:00')
                    if now > end_dt:
                        await db.events.update_one({"id": e["id"]}, {"$set": {"status": "closed", "updated_at": now_iso()}})
                        
                        async def _push_autoclosed(ev=e):
                            admin_tokens = await get_provider_admin_tokens(ev.get("provider_id", ""))
                            sup_tokens = await get_event_supervisor_tokens(ev["id"])
                            drv_tokens = await get_event_driver_tokens(ev["id"])
                            await send_expo_push(
                                list(set(admin_tokens + sup_tokens + drv_tokens)),
                                title="🏁 Event Closed",
                                body_text=f"{ev.get('name', 'Event')} has been closed automatically",
                                data={"event_id": ev["id"], "screen": "event_detail"}
                            )
                        asyncio.create_task(_push_autoclosed())

                        await db.parking_slots.delete_many({"event_id": e["id"]})
                        logger.info(f"Auto-closed event {e['id']}")
                except Exception as ex:
                    logger.warning(f"auto_close parse error {e.get('id')}: {ex}")
        except Exception as e:
            logger.error(f"auto_close_loop error: {e}")
        await asyncio.sleep(60)

async def scheduled_retrieval_loop(): 
    while True: 
        try: 
            now = datetime.now(timezone.utc) 
            # Find all parked cars with a scheduled retrieval time in the past 
            cars = await db.cars.find( 
                { 
                    "status": "PARKED", 
                    "dispatch_at": {"$ne": None, "$lte": now},
                    "deleted": {"$ne": True}
                }, 
                {"_id": 0} 
            ).to_list(1000) 
            if cars: 
                logger.info(f"[SCHEDULER] Found {len(cars)} car(s) due for retrieval") 
            for car in cars: 
                try: 
                    await db.cars.update_one( 
                        {"id": car["id"]}, 
                        {"$set": { 
                            "status": "RETRIEVAL_REQUESTED", 
                            "retrieval_requested_at": now_iso(),
                            "auto_dispatched": True,
                            "dispatch_at": None,
                            "updated_at": now_iso() 
                        }} 
                    ) 
                    updated = await db.cars.find_one({"id": car["id"]}, {"_id": 0}) 
                    await broadcast_car_update(updated) 

                    async def _push_sched(c=car):
                        tokens = await get_event_driver_tokens(c["event_id"])
                        sup_tokens = await get_event_supervisor_tokens(c["event_id"])
                        await send_expo_push(
                            list(set(tokens + sup_tokens)),
                            title="⏰ Scheduled Retrieval Due",
                            body_text=f"{c.get('plate')} · Zone {c.get('zone', '?')} Slot {c.get('slot', '?')}",
                            data={"car_id": c["id"], "event_id": c["event_id"], "screen": "retrievals"}
                        )
                    asyncio.create_task(_push_sched())

                    logger.info(f"Scheduled retrieval triggered for car {car['id']}") 
                except Exception as ex: 
                    logger.warning(f"Scheduled retrieval error for car {car['id']}: {ex}") 
        except Exception as e: 
            logger.error(f"scheduled_retrieval_loop error: {e}") 
        await asyncio.sleep(30)  # check every 30 seconds 

async def gate_timeout_loop():
    while True:
        try:
            now = datetime.now(timezone.utc)
            cars = await db.cars.find(
                {
                    "status": "ARRIVED_AT_GATE",
                    "gate_timer_expires_at": {"$ne": None, "$lte": now},
                    "deleted": {"$ne": True}
                },
                {"_id": 0}
            ).to_list(1000)
            for car in cars:
                try:
                    await _otp_delete(f"delivery_{car['id']}")
                    if car.get("zone") and car.get("slot") is not None:
                        await db.parking_slots.update_one(
                            {"event_id": car["event_id"], "zone_name": car["zone"], "slot_number": car["slot"]},
                            {"$set": {"is_occupied": False, "car_id": None}}
                        )
                    await db.cars.update_one(
                        {"id": car["id"]},
                        {
                            "$set": {
                                "status": "AWAITING_REPARK",
                                "zone": None,
                                "slot": None,
                                "gate_arrival_time": None,
                                "gate_timer_expires_at": None,
                                "otp_verified": False,
                                "updated_at": now_iso()
                            },
                            "$inc": {"no_show_count": 1}
                        }
                    )
                    updated = await db.cars.find_one({"id": car["id"]}, {"_id": 0})
                    updated = _fix_gate_timer(updated)
                    await broadcast_car_update(updated)

                    async def _push_noshow(c=car):
                        tokens = await get_event_driver_tokens(c["event_id"])
                        sup_tokens = await get_event_supervisor_tokens(c["event_id"])
                        await send_expo_push(
                            list(set(tokens + sup_tokens)),
                            title="⏱️ Guest No-Show",
                            body_text=f"{c.get('plate')} needs to be re-parked — guest didn't arrive in time",
                            data={"car_id": c["id"], "event_id": c["event_id"], "screen": "retrievals"}
                        )
                    asyncio.create_task(_push_noshow())
                    logger.info(f"Gate timeout: car {car['id']} awaiting re-park (no-show)")
                except Exception as ex:
                    logger.warning(f"gate_timeout_loop error for car {car['id']}: {ex}")
        except Exception as e:
            logger.error(f"gate_timeout_loop error: {e}")
        await asyncio.sleep(15)

async def migrate_provider_types(): 
    await db.providers.update_many( 
        {"provider_type": {"$exists": False}}, 
        {"$set": {"provider_type": "valet_provider"}} 
    )

async def migrate_hotel_qr_tokens(): 
    hotels = await db.hotels.find( 
        {"hotel_qr_token": {"$exists": False}}, 
        {"_id": 0, "id": 1} 
    ).to_list(1000) 
    for h in hotels: 
        await db.hotels.update_one( 
            {"id": h["id"]}, 
            {"$set": {"hotel_qr_token": str(uuid.uuid4())}} 
        ) 

async def migrate_event_qr_tokens(): 
    """Ensures all hotel special events have a unique QR token.""" 
    events = await db.events.find( 
        {"event_type": "hotel_special", "event_qr_token": {"$exists": False}}, 
        {"_id": 0, "id": 1} 
    ).to_list(1000) 
    for e in events: 
        await db.events.update_one( 
            {"id": e["id"]}, 
            {"$set": {"event_qr_token": str(uuid.uuid4())}} 
        ) 

async def create_daily_hotel_events(): 
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat() 
    # 1. Auto-close yesterday's hotel_daily events 
    await db.events.update_many( 
        {"event_type": "hotel_daily", "status": "active", "date": {"$lt": today}}, 
        {"$set": {"status": "closed", "auto_closed_at": now_iso()}} 
    ) 
    # 2. Fix existing broken daily events (today's active hotel_daily with zero parking slots)
    today_events = await db.events.find({"event_type": "hotel_daily", "status": "active", "date": today}).to_list(1000)
    for event in today_events:
        slot_count = await db.parking_slots.count_documents({"event_id": event["id"]})
        if slot_count == 0:
            # Need to get the hotel for this event to get zones
            hotel = await db.hotels.find_one({"id": event["hotel_id"]})
            if hotel:
                zones = hotel.get("zones")
                if not zones:
                    zones = [{"name": "A", "slots": hotel["total_valet_slots"]}]
                # Create slots for this event
                now = now_iso()
                slots_to_insert = []
                for zone in zones:
                    zname = zone.get("name")
                    count = int(zone.get("slots", 0))
                    for i in range(1, count + 1):
                        slots_to_insert.append({
                            "id": str(uuid.uuid4()),
                            "event_id": event["id"],
                            "zone_name": zname,
                            "slot_number": i,
                            "car_id": None,
                            "is_occupied": False,
                            "created_at": now,
                        })
                if slots_to_insert:
                    await db.parking_slots.insert_many(slots_to_insert, ordered=False)
    # 3. Create today's event for each active hotel with an active & verified provider
    eligible_provider_ids = [
        p["id"] for p in await db.providers.find(
            {"is_active": True, "is_verified": True},
            {"_id": 0, "id": 1}
        ).to_list(10000)
    ]
    hotels = await db.hotels.find({
        "is_active": True,
        "provider_id": {"$in": eligible_provider_ids}
    }).to_list(1000) 
    for hotel in hotels: 
        existing = await db.events.find_one({"hotel_id": hotel["id"], "event_type": "hotel_daily", "date": today}) 
        if existing: 
            continue 
        event_id = str(uuid.uuid4()) 
        # Get zones, gates from hotel
        zones = hotel.get("zones")
        if not zones:
            zones = [{"name": "A", "slots": hotel["total_valet_slots"]}]
        gates = hotel.get("gates")
        if not gates:
            gates = ["Main Gate"]
        key_hooks = hotel.get("key_hooks", 50)
        gate_timer_minutes = hotel.get("gate_timer_minutes")
        allow_instant_park = bool(hotel.get("allow_instant_park", False))
        
        event = { 
            "id": event_id, 
            "provider_id": hotel["provider_id"], 
            "hotel_id": hotel["id"], 
            "event_type": "hotel_daily", 
            "name": f"{hotel['name']} — {today}", 
            "date": today, 
            "end_date": today, 
            "start_time": "00:00", 
            "end_time": "23:59", 
            "venue": hotel["name"], 
            "max_cars": hotel["total_valet_slots"], 
            "zones": zones,
            "gates": gates,
            "key_hooks": key_hooks,
            "gate_timer_minutes": gate_timer_minutes,
            "allow_instant_park": allow_instant_park,
            "status": "active", 
            "created_at": now_iso() 
        } 
        await db.events.insert_one(event) 
        # Auto-create parking slots
        now = now_iso()
        slots_to_insert = []
        for zone in zones:
            zname = zone.get("name")
            count = int(zone.get("slots", 0))
            for i in range(1, count + 1):
                slots_to_insert.append({
                    "id": str(uuid.uuid4()),
                    "event_id": event_id,
                    "zone_name": zname,
                    "slot_number": i,
                    "car_id": None,
                    "is_occupied": False,
                    "created_at": now,
                })
        if slots_to_insert:
            await db.parking_slots.insert_many(slots_to_insert, ordered=False)
        # Assign drivers/supervisors
        for did in hotel.get("assigned_driver_ids", []): 
            await db.event_drivers.insert_one({"id": str(uuid.uuid4()), "event_id": event_id, "driver_id": did, "status": "active"}) 
        for sid in hotel.get("assigned_supervisor_ids", []): 
            await db.event_supervisors.insert_one({"id": str(uuid.uuid4()), "event_id": event_id, "supervisor_id": sid, "status": "active"})

        # Step 4 — Carry forward overnight parked cars
        from datetime import timedelta
        yesterday = (datetime.now(ZoneInfo("Asia/Kolkata")).date() - timedelta(days=1)).isoformat()
        yesterday_event = await db.events.find_one({
            "hotel_id": hotel["id"],
            "event_type": "hotel_daily",
            "date": yesterday
        })
        if yesterday_event:
            parked_cars = await db.cars.find({
                "event_id": yesterday_event["id"],
                "status": "PARKED",
                "deleted": {"$ne": True}
            }).to_list(1000)
            
            checked_in_cars = await db.cars.find({
                "event_id": yesterday_event["id"],
                "status": "CHECKED_IN",
                "deleted": {"$ne": True}
            }).to_list(1000)
            
            if parked_cars or checked_in_cars:
                today_event = await db.events.find_one({
                    "hotel_id": hotel["id"],
                    "event_type": "hotel_daily",
                    "date": today
                })
                if today_event:
                    for car in parked_cars:
                        upd = {
                            "event_id": today_event["id"],
                            "carried_forward": True,
                            "updated_at": now_iso()
                        }
                        if not car.get("original_event_id"):
                            upd["original_event_id"] = yesterday_event["id"]
                            
                        await db.cars.update_one({"id": car["id"]}, {"$set": upd})
                        
                        target_slot = None
                        if car.get("zone") and car.get("slot"):
                            target_slot = await db.parking_slots.find_one({
                                "event_id": today_event["id"],
                                "zone_name": car["zone"],
                                "slot_number": int(car["slot"]),
                                "is_occupied": False
                            })
                        
                        if not target_slot and car.get("zone"):
                            target_slot = await db.parking_slots.find_one({
                                "event_id": today_event["id"],
                                "zone_name": car["zone"],
                                "is_occupied": False
                            })
                            
                        if not target_slot:
                            target_slot = await db.parking_slots.find_one({
                                "event_id": today_event["id"],
                                "is_occupied": False
                            })
                            
                        if target_slot:
                            await db.parking_slots.update_one(
                                {"id": target_slot["id"]},
                                {"$set": {"is_occupied": True, "car_id": car["id"]}}
                            )
                            if target_slot["zone_name"] != car.get("zone") or target_slot["slot_number"] != car.get("slot"):
                                await db.cars.update_one({"id": car["id"]}, {"$set": {"zone": target_slot["zone_name"], "slot": target_slot["slot_number"]}})
                        
                        await db.parking_slots.update_many(
                            {"event_id": yesterday_event["id"], "car_id": car["id"]},
                            {"$set": {"is_occupied": False, "car_id": None}}
                        )
                        
                    for car in checked_in_cars:
                        upd = {
                            "event_id": today_event["id"],
                            "carried_forward": True,
                            "updated_at": now_iso()
                        }
                        if not car.get("original_event_id"):
                            upd["original_event_id"] = yesterday_event["id"]
                            
                        await db.cars.update_one({"id": car["id"]}, {"$set": upd})

                    print(f"[carry-forward] Hotel {hotel['id']}: moved {len(parked_cars)} parked + {len(checked_in_cars)} checked-in car(s) from {yesterday} to {today}") 

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata") 
scheduler.add_job(create_daily_hotel_events, "cron", hour=0, minute=0) 

@api_router.post("/superadmin/trigger-daily-events")
async def trigger_daily_events(user=Depends(require_roles("superadmin"))):
    await create_daily_hotel_events()
    return {"ok": True, "message": "Daily hotel events processed"}

async def run_migrations():
    """Run DB migrations exactly once each, tracked by name."""
    applied = {m["name"] for m in await db.migrations.find({}, {"name": 1}).to_list(1000)}
    
    migrations = [
        ("v1_provider_types", migrate_provider_types),
        ("v2_hotel_qr_tokens", migrate_hotel_qr_tokens),
        ("v3_event_qr_tokens", migrate_event_qr_tokens),
    ]
    for name, fn in migrations:
        if name not in applied:
            try:
                await fn()
                await db.migrations.insert_one({"name": name, "applied_at": now_iso()})
                logger.info(f"Migration applied: {name}")
            except Exception as e:
                logger.error(f"Migration failed: {name} — {e}")
                raise

@app.on_event("startup")
async def on_start():
    # init_storage()
    await run_migrations()
    await db.car_qr_cards.update_many({"is_active": {"$exists": False}}, {"$set": {"is_active": True}})
    # start scheduler
    scheduler.start()
    # indexes
    await db.parking_slots.create_index([("event_id", ASCENDING), ("zone_name", ASCENDING), ("slot_number", ASCENDING)], unique=True)
    await db.cars.create_index([("check_in_time", ASCENDING)])
    await db.cars.create_index([("qr_token", ASCENDING)], unique=False)
    await db.cars.create_index([("event_id", ASCENDING)])
    await db.cars.create_index([("event_id", ASCENDING), ("plate", ASCENDING)])
    await db.cars.create_index([("event_id", ASCENDING), ("status", ASCENDING)])
    await db.cars.create_index([("check_in_driver_id", ASCENDING)])
    await db.cars.create_index([("retrieval_driver_id", ASCENDING)])
    await db.ratings.create_index([("car_id", ASCENDING)], unique=True)
    await db.providers.create_index([("email", ASCENDING)], unique=True)
    await db.drivers.create_index([("employee_id", ASCENDING)], unique=True, sparse=True)
    await db.drivers.create_index([("phone", ASCENDING)], unique=True, sparse=True)
    await db.drivers.create_index([("provider_id", ASCENDING)])
    await db.events.create_index([("provider_id", ASCENDING)])
    await db.events.create_index([("status", ASCENDING)])
    await db.event_drivers.create_index([("event_id", ASCENDING)])
    await db.event_drivers.create_index([("driver_id", ASCENDING)])
    await db.parking_slots.create_index([("event_id", ASCENDING)])
    await db.otp_store.create_index("expires", expireAfterSeconds=0)
    await db.otp_store.create_index("key", unique=True)
    await db.otp_rate_limits.create_index("key", unique=True)
    # Missing indexes
    await db.cars.create_index([("plate", ASCENDING)])  # for history lookup
    await db.cars.create_index([("status", ASCENDING), ("event_id", ASCENDING), ("dispatch_at", ASCENDING)])  # scheduler loop
    await db.incidents.create_index([("event_id", ASCENDING)])
    await db.car_photos.create_index([("car_id", ASCENDING)])
    await db.incidents.create_index([("car_id", ASCENDING)])
    await db.assignments.create_index([("car_id", ASCENDING)])
    await db.assignments.create_index([("event_id", ASCENDING)])
    # TTL on OTP rate limits so records don't accumulate forever
    await db.otp_rate_limits.create_index("created_at", expireAfterSeconds=3600)
    await db.superadmins.create_index([("email", ASCENDING)], unique=True)
    # Backfill provider_qr_token for existing providers 
    providers_without_qr = await db.providers.find( 
        {"provider_qr_token": {"$exists": False}}, {"_id": 0, "id": 1} 
    ).to_list(1000) 
    for p in providers_without_qr: 
        await db.providers.update_one( 
            {"id": p["id"]}, 
            {"$set": {"provider_qr_token": str(uuid.uuid4())}} 
        ) 

    # Backfill duty_status for drivers created before the dispatch feature existed
    drivers_without_duty_status = await db.drivers.find(
        {"role": "driver", "duty_status": {"$exists": False}}, {"_id": 0, "id": 1}
    ).to_list(10000)
    for d in drivers_without_duty_status:
        await db.drivers.update_one(
            {"id": d["id"]},
            {"$set": {"duty_status": "offline", "duty_status_updated_at": now_iso()}}
        ) 
    sa_email = os.environ.get("SUPERADMIN_EMAIL", "").strip()
    sa_password = os.environ.get("SUPERADMIN_PASSWORD", "").strip()
    if sa_email and sa_password:
        existing_sa = await db.superadmins.find_one({"email": sa_email.lower()})
        if not existing_sa:
            await db.superadmins.insert_one({
                "id": str(uuid.uuid4()),
                "name": "Super Admin",
                "email": sa_email.lower(),
                "hashed_password": hash_password(sa_password),
                "role": "superadmin",
                "must_change_password": True,
                "created_at": now_iso()
            })
            logger.info(f"Superadmin seeded: {sa_email}")
    else:
        logger.warning("SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD env vars not set — skipping seed")
    asyncio.create_task(auto_close_loop())
    asyncio.create_task(scheduled_retrieval_loop())
    asyncio.create_task(gate_timeout_loop())


@api_router.post("/drivers/location")
async def update_driver_location(body: DriverLocationBody, user=Depends(get_current)):
    now = now_iso()
    doc = {
        "driver_id": user["user_id"],
        "driver_name": user.get("name", ""),
        "event_id": body.event_id,
        "lat": body.lat,
        "lng": body.lng,
        "car_id": body.car_id or None,
        "journey_type": body.journey_type or "idle",
        "timestamp": now,
    }
    await db.driver_locations.insert_one({**doc, "_id": str(uuid.uuid4())})
    await db.driver_locations_latest.update_one(
        {"driver_id": user["user_id"], "event_id": body.event_id},
        {"$set": doc},
        upsert=True
    )
    return {"ok": True}

@api_router.get("/superadmin/events/{event_id}/driver-locations")
async def get_driver_locations(event_id: str, user=Depends(require_roles("superadmin"))):
    locations = await db.driver_locations_latest.find(
        {"event_id": event_id}, {"_id": 0}
    ).to_list(200)
    return locations

@api_router.get("/superadmin/drivers/{driver_id}/live-trail")
async def get_driver_live_trail(driver_id: str, event_id: str, user=Depends(require_roles("superadmin"))):
    """
    Return the current live trail for a driver — only pings belonging to their
    current unbroken journey segment (same car_id + journey_type combination).
    Also returns current car context if driver is actively handling a car.
    """
    # Get driver's latest location to know current car_id and journey_type
    latest = await db.driver_locations_latest.find_one(
        {"driver_id": driver_id, "event_id": event_id},
        {"_id": 0}
    )
    if not latest:
        return {"trail": [], "current_car": None, "journey_type": "idle", "latest": None}

    current_car_id = latest.get("car_id")
    current_journey_type = latest.get("journey_type", "idle")

    # Get the current journey's trail pings — same car_id and journey_type
    # If idle (car_id is None), just return the last 20 idle pings so map shows
    # where driver is currently standing, not a long idle history
    if current_car_id:
        trail = await db.driver_locations.find(
            {
                "driver_id": driver_id,
                "event_id": event_id,
                "car_id": current_car_id,
                "journey_type": current_journey_type
            },
            {"_id": 0, "lat": 1, "lng": 1, "timestamp": 1, "journey_type": 1}
        ).sort("timestamp", 1).to_list(2000)
    else:
        trail = await db.driver_locations.find(
            {
                "driver_id": driver_id,
                "event_id": event_id,
                "car_id": None,
                "journey_type": "idle"
            },
            {"_id": 0, "lat": 1, "lng": 1, "timestamp": 1, "journey_type": 1}
        ).sort("timestamp", -1).to_list(20)
        trail = list(reversed(trail))

    # Get current car details if driver is actively handling one
    current_car = None
    if current_car_id:
        car = await db.cars.find_one(
            {"id": current_car_id},
            {"_id": 0, "id": 1, "plate": 1, "make": 1, "color": 1, "status": 1}
        )
        if car:
            current_car = car

    return {
        "trail": trail,
        "current_car": current_car,
        "journey_type": current_journey_type,
        "latest": latest
    }

@api_router.get("/cars/{cid}/driver-path")
async def get_car_driver_path(cid: str, user=Depends(require_roles("superadmin", "owner", "admin", "supervisor"))):
    """Return ordered GPS pings for a specific car journey, split into checkin and retrieval legs."""
    pings = await db.driver_locations.find(
        {"car_id": cid},
        {"_id": 0, "lat": 1, "lng": 1, "timestamp": 1, "journey_type": 1, "driver_name": 1}
    ).sort("timestamp", 1).to_list(5000)

    checkin_leg = [p for p in pings if p.get("journey_type") in ("checkin", "parked")]
    retrieval_leg = [p for p in pings if p.get("journey_type") in ("retrieval", "delivered")]

    return {
        "checkin_to_park": checkin_leg,
        "park_to_gate": retrieval_leg,
        "all_pings": pings
    }

@api_router.get("/events/{event_id}/queue")
async def get_event_queue(event_id: str, user=Depends(get_current)):
    cars = await db.cars.find(
        {"event_id": event_id, "deleted": {"$ne": True}},
        {"_id": 0}
    ).to_list(1000)

    driver_ids = set()
    for c in cars:
        for field in ["check_in_driver_id", "parked_driver_id", "retrieval_driver_id"]:
            if c.get(field):
                driver_ids.add(c[field])

    drivers = await db.drivers.find(
        {"id": {"$in": list(driver_ids)}},
        {"_id": 0, "id": 1, "name": 1}
    ).to_list(500)
    driver_map = {d["id"]: d["name"] for d in drivers}

    def minutes_since(iso_str):
        if not iso_str:
            return None
        try:
            dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
            diff = datetime.now(dt.tzinfo) - dt
            return int(diff.total_seconds() / 60)
        except:
            return None

    status_order = {"RETRIEVAL_REQUESTED": 0, "BEING_FETCHED": 1, "CHECKED_IN": 2, "PARKED": 3, "DELIVERED": 4}

    result = []
    for c in cars:
        status = c.get("status", "")
        if status == "CHECKED_IN":
            mins = minutes_since(c.get("check_in_time"))
        elif status == "PARKED":
            mins = minutes_since(c.get("parked_at"))
        elif status in ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]:
            mins = minutes_since(c.get("retrieval_requested_at") or c.get("parked_at"))
        else:
            mins = minutes_since(c.get("delivered_at"))

        result.append({
            "car_id": c.get("id"),
            "car_number": c.get("plate"),
            "guest_name": c.get("guest_name"),
            "status": status,
            "check_in_driver_name": driver_map.get(c.get("check_in_driver_id"), ""),
            "parked_driver_name": driver_map.get(c.get("parked_driver_id"), ""),
            "retrieval_driver_name": driver_map.get(c.get("retrieval_driver_id"), ""),
            "check_in_time": c.get("check_in_time"),
            "parked_at": c.get("parked_at"),
            "delivered_at": c.get("delivered_at"),
            "retrieval_requested_at": c.get("retrieval_requested_at"),
            "zone": c.get("zone"),
            "slot": c.get("slot"),
            "key_tag": c.get("key_tag"),
            "minutes_in_current_status": mins,
        })

    def queue_sort_key(x):
        status = x["status"]
        if status in ("RETRIEVAL_REQUESTED", "BEING_FETCHED"):
            tiebreak = x.get("retrieval_requested_at") or ""
        elif status == "PARKED":
            tiebreak = x.get("parked_at") or ""
        elif status == "CHECKED_IN":
            tiebreak = x.get("check_in_time") or ""
        else:
            tiebreak = x.get("delivered_at") or ""
        return (status_order.get(status, 99), tiebreak)

    result.sort(key=queue_sort_key)
    return result

# ============== GUEST LIST & HOST PORTAL ==============
import pandas as pd
import io

@api_router.post("/hotels/{hid}/guest-list/upload")
async def upload_hotel_guest_list(hid: str, file: UploadFile = File(...), event_id: Optional[str] = Form(None), user=Depends(require_roles("owner", "admin", "supervisor"))):
    content = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, "Invalid Excel file")
    
    guests = []
    cols = [str(c).lower() for c in df.columns]
    name_col = next((c for c in cols if 'name' in c), df.columns[0])
    contact_col = next((c for c in cols if 'contact' in c or 'phone' in c), df.columns[1] if len(df.columns) > 1 else None)
    arrival_col = next((c for c in cols if 'arrival' in c or 'time' in c), df.columns[2] if len(df.columns) > 2 else None)
    
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0, "hotel_qr_token": 1, "name": 1})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
        
    if event_id:
        event = await db.events.find_one({"id": event_id, "hotel_id": hid}, {"_id": 0, "event_qr_token": 1, "name": 1})
        if not event:
            raise HTTPException(404, "Event not found for this hotel")
        event_qr = event.get("event_qr_token", event_id)

    for _, row in df.iterrows():
        if contact_col and pd.notna(row[contact_col]):
            contact = str(row[contact_col]).strip()
            name = str(row[name_col]).strip() if pd.notna(row[name_col]) else "Guest"
            arrival = str(row[arrival_col]).strip() if arrival_col and pd.notna(row[arrival_col]) else None
            
            token = str(uuid.uuid4())
            
            if event_id:
                link = f"{FRONTEND_URL}/pre-register/event/{event_qr}?guest_phone={contact}"
                context_type = "event"
                context_id = event_id
                msg = f"Hi {name}! You're pre-registered for {event['name']}. Show QR on arrival: {link}"
            else:
                link = f"{FRONTEND_URL}/hotel-register/{hotel.get('hotel_qr_token')}?guest_phone={contact}"
                context_type = "hotel"
                context_id = hid
                hotel_name = hotel.get("name", "The Hotel")
                msg = f"Hi {name}! {hotel_name} has pre-registered you for valet. Click to save time on arrival: {link}"
            
            guest = {
                "id": str(uuid.uuid4()),
                "context_type": context_type,
                "context_id": context_id,
                "name": name,
                "contact": contact,
                "expected_arrival": arrival,
                "pre_reg_token": token,
                "pre_reg_link": link,
                "sms_sent": True,
                "sms_sent_at": now_iso(),
                "pre_registered": False,
                "pre_registered_at": None,
                "car_id": None,
                "added_by_role": user["role"],
                "added_by_id": user["user_id"],
                "added_at": now_iso()
            }
            guests.append(guest)
            send_sms(contact, msg)
            
    if guests:
        await db.guest_list.insert_many(guests)
    return {"inserted": len(guests)}

@api_router.get("/hotels/{hid}/guest-list")
async def get_hotel_guest_list(hid: str, user=Depends(require_roles("owner", "admin", "supervisor"))):
    return await db.guest_list.find({"context_type": "hotel", "context_id": hid}, {"_id": 0}).to_list(10000)

@api_router.patch("/events/{eid}/host")
async def set_event_host(eid: str, body: dict, user=Depends(require_roles("owner", "admin", "superadmin"))):
    host_name = body.get("host_name")
    host_email = body.get("host_email")
    if not host_name or not host_email:
        raise HTTPException(400, "host_name and host_email are required")
    
    event = await db.events.find_one({"id": eid})
    if not event:
        raise HTTPException(404, "Event not found")
    if event.get("status") == "closed":
        raise HTTPException(400, "Cannot send host portal email — this event is closed")
        
    if event.get("host_token"):
        host_token = event.get("host_token")
        host_portal_link = event.get("host_portal_link")
    else:
        host_token = str(uuid.uuid4())
        host_portal_link = f"{FRONTEND_URL}/host-portal/{host_token}"
    
    await db.events.update_one({"id": eid}, {"$set": {
        "host_name": host_name,
        "host_email": host_email,
        "host_token": host_token,
        "host_portal_link": host_portal_link,
        "host_email_sent": True
    }})
    
    html = f"<p>Hi {_title_case_name(host_name)},</p><p>Manage your guest list here: <a href='{host_portal_link}'>{host_portal_link}</a></p>"
    asyncio.create_task(send_email(to=host_email, subject="Your Event Host Portal", html_body=html))
    return {"ok": True, "host_portal_link": host_portal_link}

@api_router.get("/host-portal/{host_token}")
async def get_host_portal(host_token: str):
    event = await db.events.find_one({"host_token": host_token}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Invalid token")
    return event

@api_router.post("/host-portal/{host_token}/upload")
async def upload_host_guest_list(host_token: str, file: UploadFile = File(...)):
    event = await db.events.find_one({"host_token": host_token}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Invalid token")
        
    content = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, "Invalid Excel file")
        
    guests = []
    cols = [str(c).lower() for c in df.columns]
    name_col = next((c for c in cols if 'name' in c), df.columns[0])
    contact_col = next((c for c in cols if 'contact' in c or 'phone' in c), df.columns[1] if len(df.columns) > 1 else None)
    
    for _, row in df.iterrows():
        if contact_col and pd.notna(row[contact_col]):
            contact = str(row[contact_col]).strip()
            name = str(row[name_col]).strip() if pd.notna(row[name_col]) else "Guest"
            
            token = str(uuid.uuid4())
            event_qr = event.get('event_qr_token', event['id'])
            link = f"{FRONTEND_URL}/pre-register/event/{event_qr}?guest_phone={contact}"
            
            guest = {
                "id": str(uuid.uuid4()),
                "context_type": "event",
                "context_id": event["id"],
                "name": name,
                "contact": contact,
                "expected_arrival": None,
                "pre_reg_token": token,
                "pre_reg_link": link,
                "sms_sent": True,
                "sms_sent_at": now_iso(),
                "pre_registered": False,
                "pre_registered_at": None,
                "car_id": None,
                "added_by_role": "host",
                "added_by_id": event.get("host_name", "host"),
                "added_at": now_iso()
            }
            guests.append(guest)
            
            event_name = event.get("name", "Event")
            msg = f"Hi {name}! You're invited to pre-register for {event_name} valet parking. Register here: {link}"
            send_sms(contact, msg)
            
    if guests:
        await db.guest_list.insert_many(guests)
    return {"inserted": len(guests)}

@api_router.get("/events/{eid}/guest-count")
async def get_event_guest_count(eid: str, user=Depends(require_roles("owner", "admin", "supervisor", "driver"))):
    count = await db.guest_list.count_documents({"context_type": "event", "context_id": eid})
    return {"count": count}

@app.on_event("shutdown")
async def on_stop():
    client.close()

@api_router.get("/")
async def root():
    return {"service": "InstaPark", "status": "ok"}

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response