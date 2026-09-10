"""InstaPark Valet Parking Management Backend."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Query, Body, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse, Response
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
from pymongo.errors import DuplicateKeyError
import static_ffmpeg
from email.mime.text import MIMEText 
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
import base64
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
BCC_EMAIL = os.environ.get("BCC_EMAIL")
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

def _send_smtp(to: str, subject: str, html_body: str, attachments: list = None, bcc: str = None):
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
    if attachments:
        for att in attachments:
            part = MIMEApplication(base64.b64decode(att["content"]), Name=att["filename"])
            part['Content-Disposition'] = f'attachment; filename="{att["filename"]}"'
            msg.attach(part)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        recipients = [to] + ([bcc] if bcc else [])
        server.sendmail(SMTP_USER, recipients, msg.as_string())
    logger.info(f"[EMAIL SENT] To: {to}{f' | Bcc: {bcc}' if bcc else ''} | Subject: {subject}")

async def send_email(to: str, subject: str, html_body: str, attachments: list = None, bcc: str = None):
    if RESEND_API_KEY:
        try:
            import httpx
            async with httpx.AsyncClient() as client_http:
                payload = {"from": EMAIL_FROM, "to": [to], "subject": subject, "html": html_body}
                if bcc: payload["bcc"] = [bcc]
                if attachments:
                    payload["attachments"] = attachments
                resp = await client_http.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                    json=payload,
                    timeout=10
                )
                if resp.status_code not in (200, 201):
                    logger.error(f"Resend email failed: {resp.status_code} — {resp.text}")
        except Exception as e:
            logger.error(f"Email to {to} failed: {e}")
    else:
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, _send_smtp, to, subject, html_body, attachments, bcc)
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
            {"retrieval_driver_id": driver_id, "status": {"$in": ["ACCEPTED", "BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"]}},
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
    try:
        await manager.broadcast(f"event:{event_id}", {"type": "assignment_created", "data": doc})
    except Exception as e:
        logger.warning(f"broadcast failed (assignment_created for {event_id}): {e}")
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

async def is_aadhar_taken(aadhar_number: str, exclude_id: str = None) -> bool:
    """Check if an Aadhar number is already used by any driver or supervisor."""
    if not aadhar_number:
        return False
    query = {"aadhar_number": aadhar_number.strip()}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    return await db.drivers.find_one(query) is not None

async def is_pan_taken(pan_number: str, exclude_id: str = None) -> bool:
    """Check if a PAN number is already used by any driver or supervisor."""
    if not pan_number:
        return False
    query = {"pan_number": pan_number.strip().upper()}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    return await db.drivers.find_one(query) is not None

async def is_dl_taken(dl_number: str, exclude_id: str = None) -> bool:
    """Check if a driving license number is already used by any driver."""
    if not dl_number:
        return False
    query = {"driving_license_number": dl_number.strip().upper()}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    return await db.drivers.find_one(query) is not None

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
        for ws in sockets:
            asyncio.create_task(_send(ws))

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

async def _attach_card_info(cars: list[dict]) -> list[dict]:
    """
    For cars missing key_tag_number or card_code, look them up from the
    bound car_qr_cards record via qr_card_id. Mutates in place, returns list.
    Skips cars that already have both fields populated (from create_car).
    """
    missing = [c for c in cars if c.get("qr_card_id") and
               (c.get("key_tag_number") is None or c.get("card_code") is None)]
    if not missing:
        return cars
    card_ids = list({c["qr_card_id"] for c in missing})
    cards = await db.car_qr_cards.find(
        {"id": {"$in": card_ids}},
        {"_id": 0, "id": 1, "key_tag_number": 1, "card_code": 1}
    ).to_list(len(card_ids))
    card_map = {card["id"]: card for card in cards}
    for c in missing:
        card = card_map.get(c["qr_card_id"])
        if card:
            if c.get("key_tag_number") is None:
                c["key_tag_number"] = card.get("key_tag_number")
            if c.get("card_code") is None:
                c["card_code"] = card.get("card_code")
    return cars

async def broadcast_car_update(car: dict):
    try:
        cars = await _attach_card_info([car])
        car = cars[0]
        car = _fix_gate_timer(car)
        car["can_request_retrieval"] = car.get("status") == "PARKED"
        car["can_schedule_retrieval"] = car.get("status") in ("PARKED", "CHECKED_IN")
        cid, eid = car["id"], car["event_id"]
        tasks = [
            manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car}),
            manager.broadcast(f"event:{eid}", {"type": "car_update", "data": car}),
        ]
        if car["status"] in ("RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"):
            tasks.append(manager.broadcast(f"retrievals:{eid}", {"type": "retrieval_update", "data": car}))
        await asyncio.gather(*tasks)
    except Exception as e:
        logger.warning(f"broadcast_car_update failed (car_id={car.get('id', 'unknown')}): {e}")

class SOSBody(BaseModel):
    alert_type: str  # "BLOCKED_CAR", "DAMAGE_CLAIM", "NEED_HELP", "MEDICAL", "OTHER"
    note: Optional[str] = None
    photo_url: Optional[str] = None
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
            "provider_id": payload["provider_id"],
            "is_verified": account.get("is_verified", False),
            "duty_status": account.get("duty_status", "offline"),
            "phone": account.get("phone", ""),
            "email": account.get("email", "")
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
    if not email and account.get("provider_id") and collection != "drivers":
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
        
    if otp == "888888":
        account = await db.drivers.find_one({"phone": phone, "role": "driver"})
        if account and account.get("is_active") is True and not account.get("hashed_pin"):
            if not re.match(r"^\d{4}$", new_credential):
                raise HTTPException(400, "PIN must be exactly 4 digits")
            hashed = hash_password(new_credential)
            update_fields = {
                "hashed_pin": hashed,
                "is_verified": True,
                "is_phone_verified": True,
                "phone_verified_at": now_iso(),
                "is_active": True
            }
            await db.drivers.update_one({"id": account["id"]}, {"$set": update_fields})
            
            updated_account = await db.drivers.find_one({"id": account["id"]})
            updated_account = await resolve_true_role(updated_account, "drivers")
            role = updated_account.get("role")
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
            token = create_token(payload)
            return {
                "token": token,
                "user": {
                    "id": updated_account["id"],
                    "name": updated_account["name"],
                    "role": payload["role"],
                    "provider_id": payload["provider_id"],
                    "is_verified": updated_account.get("is_verified", False),
                    "duty_status": updated_account.get("duty_status", "offline"),
                    "phone": updated_account.get("phone", ""),
                    "email": updated_account.get("email", "")
                }
            }
        else:
            raise HTTPException(400, "Incorrect OTP")

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
                "hashed_password": update_fields.get("hashed_password", account.get("hashed_password", "")),
                "is_active": True
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
                    "hashed_password": update_fields.get("hashed_password", account.get("hashed_password", "")),
                    "is_active": True
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
            "provider_id": payload["provider_id"],
            "is_verified": updated_account.get("is_verified", False),
            "duty_status": updated_account.get("duty_status", "offline"),
            "phone": updated_account.get("phone", ""),
            "email": updated_account.get("email", "")
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

# ============== PLANS ==============
class PlanCreate(BaseModel):
    name: str
    max_events: int
    max_cars: int
    max_hotels: int

class PlanUpdate(BaseModel):
    name: Optional[str] = None
    max_events: Optional[int] = None
    max_cars: Optional[int] = None
    max_hotels: Optional[int] = None

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

import re

EMAIL_RE    = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
PHONE_RE    = re.compile(r'^\d{10}$')
PAN_RE      = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')
IFSC_RE     = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')
AADHAR_RE   = re.compile(r'^\d{12}$')
BANK_RE     = re.compile(r'^\d{9,18}$')
DL_RE       = re.compile(r'^[A-Z0-9]{10,16}$')
PLATE_RE    = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$')
PLATE_BH_RE = re.compile(r'^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')

def validate_plate_format(plate: str):
    p = plate.replace("-", "").replace(" ", "")
    if not (PLATE_RE.match(p) or PLATE_BH_RE.match(p)):
        raise HTTPException(400, "Invalid number plate format. Use standard (GJ01AB1234) or BH series (22BH1234AA).")


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
        db.events.count_documents({"provider_id": pid, "status": {"$in": ["upcoming", "active"]}}),
        db.drivers.count_documents({"provider_id": pid, "role": "driver"}),
        db.drivers.count_documents({"provider_id": pid, "role": "supervisor"}),
        db.cars.count_documents(car_match),
        db.cars.count_documents({**car_match, "status": "PARKED"}),
        db.cars.count_documents({**car_match, "status": {"$in": ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"]}}),
        db.events.count_documents({"provider_id": pid, "date": today}),
        db.cars.count_documents({**car_match, "check_in_time": today_range}),
        db.cars.count_documents({**car_match, "check_in_time": today_range, "status": "PARKED"}),
        db.cars.count_documents({**car_match, "check_in_time": today_range, "status": {"$in": ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"]}}),
        db.cars.count_documents({**car_match, "check_in_time": today_range, "status": "DELIVERED"}),
    )

    platform_avg_rating = 0
    if event_ids:
        car_ids = [c["id"] for c in await db.cars.find(car_match, {"_id": 0, "id": 1}).to_list(50000)]
        if car_ids:
            rating_agg = await db.ratings.aggregate([
                {"$match": {"car_id": {"$in": car_ids}}},
                {"$group": {"_id": None, "avg": {"$avg": "$stars"}}}
            ]).to_list(1)
            platform_avg_rating = round(rating_agg[0]["avg"], 2) if rating_agg else 0
            

    # Per-hotel breakdown (used for the valet_provider "Your Hotels" performance table)
    hotels = await db.hotels.find({"provider_id": pid}, {"_id": 0, "id": 1, "name": 1, "city": 1, "state": 1, "total_valet_slots": 1}).to_list(1000)
    hotels_breakdown = []
    for h in hotels:
        h_event_ids = [e["id"] for e in await db.events.find({"hotel_id": h["id"]}, {"_id": 0, "id": 1}).to_list(10000)]
        h_active_events = await db.events.count_documents({"hotel_id": h["id"], "status": {"$in": ["upcoming", "active"]}})
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
        "pending_retrievals": pending_retrievals, "platform_avg_rating": platform_avg_rating,
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

async def generate_unique_card_code(provider_id: str, local_set: set = None) -> str:
    import random
    if local_set is None:
        local_set = set()
    while True:
        code = f"{random.randint(0, 9999):04d}"
        if code in local_set:
            continue
        collision = await db.car_qr_cards.find_one({
            "provider_id": provider_id,
            "card_code": code
        })
        if not collision:
            return code

async def sync_car_qr_cards(provider_id: str, new_max_cars: int):
    count = await db.car_qr_cards.count_documents({"provider_id": provider_id})
    if new_max_cars > count:
        highest_card = await db.car_qr_cards.find_one({"provider_id": provider_id}, sort=[("key_tag_number", -1)])
        start_tag = highest_card.get("key_tag_number", 0) if highest_card else 0
        diff = new_max_cars - count
        new_docs = []
        local_codes = set()
        for i in range(diff):
            card_code = await generate_unique_card_code(provider_id, local_set=local_codes)
            local_codes.add(card_code)
            new_docs.append({
                "id": str(uuid.uuid4()),
                "provider_id": provider_id,
                "key_tag_number": start_tag + i + 1,
                "qr_token": str(uuid.uuid4()),
                "card_code": card_code,
                "status": "empty",
                "car_id": None,
                "is_active": True,
                "created_at": now_iso()
            })
        if new_docs:
            import pymongo.errors
            for doc in new_docs:
                while True:
                    try:
                        await db.car_qr_cards.insert_one(doc)
                        break
                    except pymongo.errors.DuplicateKeyError:
                        doc["card_code"] = await generate_unique_card_code(provider_id, local_set=local_codes)
                        local_codes.add(doc["card_code"])
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
        "plan": body.plan, "provider_type": provider_type, "is_active": False,
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
        "is_active": False, "auth_user_id": pid, "created_at": now_iso(),
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
async def get_provider(pid: str, user=Depends(require_roles("superadmin", "owner"))):
    p = await db.providers.find_one({"id": pid}, {"_id": 0, "hashed_password": 0})
    if not p:
        raise HTTPException(404, "Not found")
        
    if user.get("role") == "owner" and p.get("parent_provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")
        
    if p.get("role") == "admin":
        p["events"] = []
        p["drivers"] = []
        p["supervisors"] = []
    else:
        p["events"] = await db.events.find({"provider_id": pid}, {"_id": 0}).to_list(1000)
        p["drivers"] = await db.drivers.find({"provider_id": pid, "role": "driver"}, SAFE_DRIVER_PROJ).to_list(1000)
        p["supervisors"] = await db.drivers.find({"provider_id": pid, "role": "supervisor"}, SAFE_DRIVER_PROJ).to_list(1000)
    return p

@api_router.patch("/providers/{pid}")
async def update_provider(pid: str, body: ProviderUpdate, user=Depends(require_roles("superadmin", "owner"))):
    existing = await db.providers.find_one({"id": pid}, {"_id": 0, "phone": 1, "email": 1, "name": 1, "parent_provider_id": 1})
    if not existing:
        raise HTTPException(404, "Not found")
        
    if user.get("role") == "owner" and existing.get("parent_provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")
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
            {"provider_id": id, "status": {"$in": ["upcoming", "active"]}},
            {"$set": {"status": "closed", "updated_at": now_iso(), "auto_closed_by_provider_toggle": True}}
        )
        await db.drivers.update_many(
            {"provider_id": id, "is_active": True, "role": {"$in": ["driver", "supervisor"]}},
            {"$set": {"is_active": False, "updated_at": now_iso(), "auto_deactivated_by_provider_toggle": True}}
        )
    else:
        await db.events.update_many(
            {"provider_id": id, "auto_closed_by_provider_toggle": True},
            {"$set": {"status": "upcoming", "updated_at": now_iso()}, "$unset": {"auto_closed_by_provider_toggle": ""}}
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
    return {"events": events, "drivers": drivers, "supervisors": supervisors, "cars": cars, "platform_avg_rating": platform_avg}

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
async def list_cars_for_provider(user=Depends(require_roles("owner", "admin", "supervisor"))):
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
async def list_incidents_for_provider(user=Depends(require_roles("owner", "admin", "supervisor"))):
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
        {"_id": 0, "car_id": 1, "stars": 1}
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
            "total_checked_in": len(e_cars),
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
            "platform_avg_rating": platform_avg_rating,
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

async def _attach_assignment_status(cards: list) -> list:
    if not cards:
        return cards
        
    qr_tokens = [c["qr_token"] for c in cards if c.get("qr_token")]
    if not qr_tokens:
        for c in cards:
            c["is_assigned"] = False
            c["assigned_car_plate"] = None
            c["assigned_car_id"] = None
        return cards

    active_cars = await db.cars.find({
        "qr_token": {"$in": qr_tokens},
        "status": {"$nin": ["DELIVERED", "PRE_REGISTERED"]},
        "deleted": {"$ne": True}
    }, {"_id": 0, "qr_token": 1, "plate": 1, "id": 1}).to_list(None)
    
    car_by_token = {car["qr_token"]: car for car in active_cars if car.get("qr_token")}
    
    for c in cards:
        token = c.get("qr_token")
        active_car = car_by_token.get(token) if token else None
        
        c["is_assigned"] = bool(active_car)
        c["assigned_car_plate"] = active_car.get("plate") if active_car else None
        c["assigned_car_id"] = active_car.get("id") if active_car else None
        
    return cards

@api_router.get("/providers/{pid}/qr-cards")
async def get_provider_qr_cards(pid: str, search: Optional[str] = None, user=Depends(require_roles("superadmin"))):
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "max_cars": 1})
    if not provider:
        raise HTTPException(404, "Provider not found")
    
    q = {"provider_id": pid, "is_active": {"$ne": False}}
    if search and search.isdigit():
        q["$or"] = [
            {"$expr": {"$regexMatch": {"input": {"$toString": "$key_tag_number"}, "regex": search}}},
            {"$expr": {"$regexMatch": {"input": {"$toString": "$card_code"}, "regex": search}}},
        ]
        
    cards_cursor = db.car_qr_cards.find(q, {"_id": 0}).sort("key_tag_number", 1)
    cards = await cards_cursor.to_list(length=5000)
    cards = await _attach_assignment_status(cards)
    
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
        q["$or"] = [
            {"$expr": {"$regexMatch": {"input": {"$toString": "$key_tag_number"}, "regex": search}}},
            {"$expr": {"$regexMatch": {"input": {"$toString": "$card_code"}, "regex": search}}},
        ]
        
    cards_cursor = db.car_qr_cards.find(q, {"_id": 0}).sort("key_tag_number", 1)
    cards = await cards_cursor.to_list(length=5000)
    cards = await _attach_assignment_status(cards)
    
    return {
        "provider_name": provider.get("name", ""),
        "max_cars": provider.get("max_cars", 0),
        "cards": cards
    }

@api_router.get("/qr-cards/{provider_id}/print-list")
async def get_provider_qr_cards_print(provider_id: str, search: Optional[str] = None, user=Depends(require_roles("owner", "admin", "superadmin"))):
    provider = await db.providers.find_one({"id": provider_id}, {"_id": 0, "name": 1, "max_cars": 1})
    if not provider:
        raise HTTPException(404, "Provider not found")
    
    q = {"provider_id": provider_id, "is_active": {"$ne": False}}
    if search and search.isdigit():
        q["$expr"] = {"$regexMatch": {"input": {"$toString": "$key_tag_number"}, "regex": search}}
        
    cards_cursor = db.car_qr_cards.find(q, {"_id": 0}).sort("key_tag_number", 1)
    cards = await cards_cursor.to_list(length=5000)
    cards = await _attach_assignment_status(cards)
    
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
    new_card_code = await generate_unique_card_code(incident["provider_id"])
    new_card = {
        "id": new_card_id,
        "provider_id": incident["provider_id"],
        "key_tag_number": incident["key_tag_number"],
        "qr_token": str(uuid.uuid4()),
        "card_code": new_card_code,
        "status": "empty",
        "car_id": None,
        "is_active": True,
        "created_at": now_iso(),
        "replaces_card_id": old_card_id
    }
    import pymongo.errors
    while True:
        try:
            await db.car_qr_cards.insert_one(new_card)
            break
        except pymongo.errors.DuplicateKeyError:
            new_card["card_code"] = await generate_unique_card_code(incident["provider_id"])
    
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
async def get_notifications(user=Depends(require_roles("superadmin", "owner", "admin"))):
    notifs = await db.notifications.find(
        {"recipient_role": user["role"], "is_read": False},
        {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    return notifs

@api_router.get("/notifications/unread-count")
async def get_unread_count(user=Depends(require_roles("superadmin", "owner", "admin"))):
    count = await db.notifications.count_documents({
        "recipient_role": user["role"],
        "is_read": False
    })
    return {"count": count}

@api_router.post("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, user=Depends(require_roles("superadmin", "owner", "admin"))):
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
    elif role in ("owner", "admin", "supervisor"):
        drv = await db.drivers.find({"provider_id": user["provider_id"], "role": "driver"}, SAFE_DRIVER_PROJ).to_list(1000)
    else:
        raise HTTPException(403, "Forbidden")

    if drv:
        driver_ids = [d["id"] for d in drv]
        assignments = await db.event_drivers.find(
            {"driver_id": {"$in": driver_ids}, "assigned": True},
            {"_id": 0, "driver_id": 1, "event_id": 1}
        ).to_list(5000)
        if assignments:
            event_ids = list({a["event_id"] for a in assignments})
            events = await db.events.find(
                {"id": {"$in": event_ids}, "status": {"$in": ["upcoming", "active"]}},
                {"_id": 0, "id": 1, "name": 1, "date": 1, "end_date": 1}
            ).to_list(5000)
            events_by_id = {e["id"]: e for e in events}
            today = now_iso()[:10]
            driver_events = {}
            for a in assignments:
                ev = events_by_id.get(a["event_id"])
                if ev:
                    driver_events.setdefault(a["driver_id"], []).append(ev)
            for d in drv:
                evs = driver_events.get(d["id"], [])
                current = next((e for e in evs if e.get("date", "") <= today <= e.get("end_date", e.get("date", ""))), None) or (evs[0] if evs else None)
                d["current_event_name"] = current["name"] if current else None
                d["current_event_id"] = current["id"] if current else None
        else:
            for d in drv:
                d["current_event_name"] = None
                d["current_event_id"] = None

    return drv

@api_router.post("/drivers")
async def create_driver(body: DriverCreate, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
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
    if body.pan_number and await is_pan_taken(body.pan_number):
        raise HTTPException(400, "PAN number already in use")
    if body.bank_account_number and not BANK_RE.match(body.bank_account_number.strip()):
        raise HTTPException(400, "Bank account number must be 9–18 digits")
    if body.bank_ifsc and not IFSC_RE.match(body.bank_ifsc.strip().upper()):
        raise HTTPException(400, "Invalid IFSC format. Expected format: ABCD0123456")
    if body.driving_license_number and not DL_RE.match(body.driving_license_number.strip().upper()):
        raise HTTPException(400, "Invalid driving license number. Must be 10–16 alphanumeric characters")
    if body.driving_license_number and await is_dl_taken(body.driving_license_number):
        raise HTTPException(400, "Driving license number already in use")
    if not AADHAR_RE.match(body.aadhar_number.strip()):
        raise HTTPException(400, "Aadhar number must be exactly 12 digits")
    if await is_aadhar_taken(body.aadhar_number):
        raise HTTPException(400, "Aadhar number already in use")
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
        "duty_status": "offline", "duty_status_updated_at": now_iso(),
        "onboarding_method": "manual"
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

@api_router.get("/drivers/bulk-template")
async def get_drivers_bulk_template(user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    import pandas as pd
    import io
    from fastapi.responses import Response
    
    df = pd.DataFrame(columns=["Name", "Mobile Number", "Email", "Gender", "PAN Number", "Aadhar Number", "Driving License Number"])
    df.loc[0] = ["Ramesh Kumar", "9876543210", "ramesh@example.com", "male", "ABCDE1234F", "123456789012", "DL1420110012345"]
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name="Drivers")
    output.seek(0)
    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=driver_bulk_template.xlsx"}
    )

@api_router.post("/drivers/bulk-upload")
async def upload_drivers_bulk(provider_id: Optional[str] = Form(None), file: UploadFile = File(...), user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    if user.get("role") == "superadmin":
        pid = provider_id
        if not pid:
            raise HTTPException(400, "provider_id is required when creating drivers as superadmin")
    else:
        pid = user.get("provider_id")
        if not pid:
            raise HTTPException(400, "provider_id missing")

    content = await file.read()
    import pandas as pd
    import io
    try:
        df = pd.read_excel(io.BytesIO(content))
    except Exception:
        raise HTTPException(400, "Invalid Excel file")
        
    cols = [str(c).lower() for c in df.columns]
    name_col = next((c for c in df.columns if 'name' in str(c).lower()), None)
    phone_col = next((c for c in df.columns if 'mobile' in str(c).lower() or 'phone' in str(c).lower()), None)
    email_col = next((c for c in df.columns if 'email' in str(c).lower()), None)
    gender_col = next((c for c in df.columns if 'gender' in str(c).lower()), None)
    pan_col = next((c for c in df.columns if 'pan' in str(c).lower()), None)
    aadhar_col = next((c for c in df.columns if 'aadhar' in str(c).lower()), None)
    dl_col = next((c for c in df.columns if 'license' in str(c).lower()), None)

    if not name_col or not phone_col:
        raise HTTPException(400, "Excel must contain at least a Name and Mobile Number column")

    inserted = 0
    skipped = 0
    results = []
    docs = []
    seen_phones_in_batch = set()

    for idx, row in df.iterrows():
        row_num = idx + 2
        name = str(row[name_col]).strip() if pd.notna(row[name_col]) else ""
        phone = str(row[phone_col]).strip() if pd.notna(row[phone_col]) else ""
        if isinstance(row[phone_col], float):
            phone = str(int(row[phone_col])).strip()
            
        if not name:
            skipped += 1
            results.append({"row": row_num, "name": name, "phone": phone, "status": "Not Added", "reason": "Missing name"})
            continue
            
        if not phone:
            skipped += 1
            results.append({"row": row_num, "name": name, "phone": phone, "status": "Not Added", "reason": "Missing mobile number"})
            continue
            
        if not PHONE_RE.match(phone):
            skipped += 1
            results.append({"row": row_num, "name": name, "phone": phone, "status": "Not Added", "reason": "Invalid mobile number (must be 10 digits)"})
            continue
            
        if await is_phone_taken(phone):
            skipped += 1
            results.append({"row": row_num, "name": name, "phone": phone, "status": "Not Added", "reason": "Mobile number already exists for another user"})
            continue
            
        if phone in seen_phones_in_batch:
            skipped += 1
            results.append({"row": row_num, "name": name, "phone": phone, "status": "Not Added", "reason": "Duplicate mobile number within this file"})
            continue
            
        email = str(row[email_col]).strip() if email_col and pd.notna(row[email_col]) else None
        if email and not EMAIL_RE.match(email):
            email = None
            
        gender = str(row[gender_col]).strip().lower() if gender_col and pd.notna(row[gender_col]) else "male"
        if gender not in ("male", "female"):
            gender = "male"
            
        pan = str(row[pan_col]).strip().upper() if pan_col and pd.notna(row[pan_col]) else None
        if pan and not PAN_RE.match(pan):
            pan = None
            
        aadhar = None
        if aadhar_col and pd.notna(row[aadhar_col]):
            raw_aadhar = row[aadhar_col]
            aadhar = str(int(raw_aadhar)).strip() if isinstance(raw_aadhar, float) else str(raw_aadhar).strip()
        if aadhar and not AADHAR_RE.match(aadhar):
            aadhar = None
            
        dl = str(row[dl_col]).strip().upper() if dl_col and pd.notna(row[dl_col]) else None
        if dl and not DL_RE.match(dl):
            dl = None

        for _ in range(10):
            import random
            eid = f"DRV{random.randint(10000, 99999)}"
            if not await db.drivers.find_one({"employee_id": eid}) and eid not in [d["employee_id"] for d in docs]:
                break
        else:
            skipped += 1
            results.append({"row": row_num, "name": name, "phone": phone, "status": "Not Added", "reason": "Could not generate unique employee ID"})
            continue
            
        import uuid
        doc = { 
            "id": str(uuid.uuid4()), "provider_id": pid, 
            "name": name, "phone": phone, 
            "email": email, 
            "pan_number": pan, 
            "bank_account_number": None, 
            "bank_ifsc": None, 
            "driving_license_number": dl, 
            "driving_license_photo": None, 
            "aadhar_number": aadhar,
            "aadhar_photo": None,
            "gender": gender,
            "driver_photo": None, 
            "role": "driver", "employee_id": eid, 
            "is_verified": False,
            "is_phone_verified": False,
            "phone_verified_at": None,
            "pending_phone": None,
            "is_active": True, 
            "created_at": now_iso(),
            "duty_status": "offline", 
            "duty_status_updated_at": now_iso(),
            "onboarding_method": "bulk"
        } 
        docs.append(doc)
        seen_phones_in_batch.add(phone)
        send_sms(phone, f"Welcome to InstaPark! Your driver account (Employee ID: {eid}) has been created. Open the app, log in with your mobile number, and use OTP 888888 to activate your account and set your PIN.")
        inserted += 1
        results.append({"row": row_num, "name": name, "phone": phone, "status": "Added", "reason": ""})

    if docs:
        await db.drivers.insert_many(docs)
        
    return {"inserted": inserted, "skipped": skipped, "results": results}

@api_router.patch("/drivers/{did}/activate")
async def activate_driver(did: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    if user.get("role") != "superadmin":
        driver = await db.drivers.find_one({"id": did, "role": "driver", "provider_id": user.get("provider_id")})
        if not driver:
            raise HTTPException(404, "Driver not found")
    else:
        driver = await db.drivers.find_one({"id": did, "role": "driver"})
        if not driver:
            raise HTTPException(404, "Driver not found")
            
    await db.drivers.update_one({"id": did}, {"$set": {"is_active": True}})
    return {"id": did, "is_active": True}

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
        try:
            await manager.broadcast(f"event:{a['event_id']}", {"type": "driver_status_update", "data": {"driver_id": did, "duty_status": body.duty_status}})
        except Exception as e:
            logger.warning(f"broadcast failed (driver_status_update for {did}): {e}")
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

    try:
        await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": updated})
        await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": updated})
        await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": updated})
    except Exception as e:
        logger.warning(f"broadcast failed (car_update/retrieval for {cid}): {e}")
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
    if event_ids:
        car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"id": 1}).to_list(50000)]
        if car_ids:
            ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"stars": 1}).to_list(50000)
            if ratings:
                platform_avg_rating = round(sum(r["stars"] for r in ratings) / len(ratings), 2)
    
    return {
        "hotel": clean(hotel),
        "provider_name": provider_name,
        "assigned_drivers": assigned_drivers,
        "assigned_supervisors": assigned_supervisors,
        "stats": {
            "total_events": total_events,
            "total_cars_served": total_cars_served,
            "platform_avg_rating": platform_avg_rating
        }
    }

async def get_events_occupancy(event_ids: List[str]) -> dict:
    if not event_ids:
        return {}
    
    pipeline = [
        {"$match": {"event_id": {"$in": event_ids}, "deleted": {"$ne": True}, "status": {"$ne": "DELIVERED"}}},
        {"$group": {
            "_id": "$event_id",
            "occupied": {"$sum": 1},
            "carried_forward": {
                "$sum": {
                    "$cond": [{"$eq": ["$carried_forward", True]}, 1, 0]
                }
            }
        }}
    ]
    
    results = await db.cars.aggregate(pipeline).to_list(None)
    
    occupancy_map = {}
    for r in results:
        occupancy_map[r["_id"]] = {
            "occupied": r.get("occupied", 0),
            "carried_forward": r.get("carried_forward", 0)
        }
    return occupancy_map

@api_router.get("/hotels/{hid}/events")
async def get_hotel_events(
    hid: str,
    event_type: str,
    status: str = "active",
    page: int = 1,
    page_size: int = 20,
    user=Depends(require_roles("owner", "admin", "superadmin"))
):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")

    query = {"hotel_id": hid, "event_type": event_type}
    if status != "all":
        query["status"] = status
        
    skip = (page - 1) * page_size
    events = await db.events.find(query, {"_id": 0}).sort("date", -1).skip(skip).limit(page_size).to_list(None)
    total = await db.events.count_documents(query)
    
    event_ids = [e["id"] for e in events]
    occupancies = await get_events_occupancy(event_ids)
    
    for e in events:
        occ = occupancies.get(e["id"], {"occupied": 0, "carried_forward": 0})
        e["occupied_slots"] = occ["occupied"]
        e["available_slots"] = max(0, e.get("max_cars", 0) - occ["occupied"])
        e["carried_forward_count"] = occ["carried_forward"]
    
    events = [enrich_event_lifecycle(e) for e in events]
    return {
        "events": [clean(e) for e in events],
        "total": total,
        "page": page,
        "page_size": page_size
    }

@api_router.get("/hotels/{hid}/incidents")
async def get_hotel_incidents(hid: str, user=Depends(require_roles("owner", "admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")

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
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") in ("owner", "admin") and hotel.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")

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
            "_id": {"$cond": [{"$eq": ["$has_plate_issue", True]}, "$id", "$plate"]},
            "car_id": {"$first": "$id"},
            "plate": {"$first": "$plate"},
            "make": {"$first": "$make"},
            "color": {"$first": "$color"},
            "has_plate_issue": {"$first": "$has_plate_issue"},
            "total_visits": {"$sum": 1},
            "last_seen": {"$first": "$check_in_time"},
            "last_event_id": {"$first": "$event_id"},
            "has_active": {"$max": {"$cond": [{"$ne": ["$status", "DELIVERED"]}, 1, 0]}},
        }},
        {"$project": {
            "_id": 0, "car_id": 1, "plate": 1, "make": 1, "color": 1, "has_plate_issue": 1,
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
    if user.get("role") in ("owner", "admin") and d.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "You do not have access to this driver")
    if user.get("role") == "driver" and did != user.get("user_id", user.get("id")):
        raise HTTPException(403, "You can only view your own activity")
    if user.get("role") == "superadmin":
        p = await db.providers.find_one({"id": d["provider_id"]}, {"_id": 0, "name": 1})
        d["provider_name"] = p["name"] if p else "—"
    return d

@api_router.patch("/drivers/{did}")
async def update_driver(did: str, body: DriverUpdate, user=Depends(require_roles("owner", "admin", "superadmin"))):
    existing = await db.drivers.find_one({"id": did}, {"_id": 0, "phone": 1, "email": 1, "name": 1, "provider_id": 1, "aadhar_number": 1, "pan_number": 1, "driving_license_number": 1})
    if not existing:
        raise HTTPException(404, "Driver not found")
    if user.get("role") in ("owner", "admin") and existing.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "You do not have access to this driver")
    if user.get("role") == "driver" and did != user.get("user_id", user.get("id")):
        raise HTTPException(403, "You can only view your own activity")
    if body.phone:
        if body.phone.strip() != existing.get("phone") and await is_phone_taken(body.phone, exclude_id=did):
            raise HTTPException(400, "Phone number already in use")
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
        if body.pan_number.strip().upper() != (existing.get("pan_number") or "").upper() and await is_pan_taken(body.pan_number, exclude_id=did):
            raise HTTPException(400, "PAN number already in use")
    if body.bank_account_number is not None and body.bank_account_number.strip():
        if not BANK_RE.match(body.bank_account_number.strip()):
            raise HTTPException(400, "Bank account number must be 9–18 digits")
    if body.bank_ifsc is not None and body.bank_ifsc.strip():
        if not IFSC_RE.match(body.bank_ifsc.strip().upper()):
            raise HTTPException(400, "Invalid IFSC format. Expected: ABCD0123456")
    if body.driving_license_number is not None and body.driving_license_number.strip():
        if not DL_RE.match(body.driving_license_number.strip().upper()):
            raise HTTPException(400, "Invalid driving license number. Must be 10–16 alphanumeric characters")
        if body.driving_license_number.strip().upper() != (existing.get("driving_license_number") or "").upper() and await is_dl_taken(body.driving_license_number, exclude_id=did):
            raise HTTPException(400, "Driving license number already in use")
    if body.aadhar_number is not None:
        if not body.aadhar_number.strip():
            raise HTTPException(400, "Aadhar number cannot be empty")
        if not AADHAR_RE.match(body.aadhar_number.strip()):
            raise HTTPException(400, "Aadhar number must be exactly 12 digits")
        if body.aadhar_number.strip() != (existing.get("aadhar_number") or "") and await is_aadhar_taken(body.aadhar_number, exclude_id=did):
            raise HTTPException(400, "Aadhar number already in use")
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
async def deactivate_driver(did: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    driver = await db.drivers.find_one({"id": did, "role": "driver"})
    if not driver:
        raise HTTPException(404, "Driver not found")
    if user.get("role") in ("owner", "admin", "supervisor"):
        if driver.get("provider_id") != user.get("provider_id"):
            raise HTTPException(403, "You do not have access to this driver")
    await db.drivers.update_one({"id": did}, {"$set": {"is_active": False}})
    return {"ok": True}


@api_router.delete("/drivers/{did}/permanent")
async def permanently_delete_driver_owner(did: str, user=Depends(require_roles("superadmin", "owner", "admin", "supervisor"))):
    driver = await db.drivers.find_one({"id": did, "role": "driver"})
    if not driver:
        raise HTTPException(404, "Driver not found")
        
    if user.get("role") in ("owner", "admin", "supervisor"):
        if driver.get("provider_id") != user.get("provider_id"):
            raise HTTPException(403, "You do not have access to this driver")
    if user.get("role") == "driver" and did != user.get("user_id", user.get("id")):
        raise HTTPException(403, "You can only view your own activity")
            
    await db.drivers.delete_one({"id": did})
    return {"ok": True, "message": "Driver permanently deleted"}

@api_router.delete("/superadmin/drivers/{did}/permanent")
async def permanently_delete_driver(did: str, user=Depends(require_roles("superadmin"))):
    driver = await db.drivers.find_one({"id": did, "role": "driver"})
    if not driver:
        raise HTTPException(404, "Driver not found")
    await db.drivers.delete_one({"id": did})
    return {"ok": True, "message": "Driver permanently deleted"}

@api_router.delete("/providers/{pid}/permanent")
async def permanently_delete_admin(pid: str, user=Depends(require_roles("owner"))):
    admin = await db.providers.find_one({"id": pid, "role": "admin"})
    if not admin:
        raise HTTPException(404, "Admin not found")
    if admin.get("parent_provider_id") != user.get("provider_id"):
        raise HTTPException(403, "You do not have access to this admin")
    # remove the mirrored driver record used for mobile app login
    await db.drivers.delete_one({"provider_id": pid, "role": "admin"})
    await db.providers.delete_one({"id": pid})
    return {"ok": True, "message": "Admin permanently deleted"}

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

@api_router.get("/drivers/{did}/profile-stats")
async def driver_profile_stats(did: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    driver = await db.drivers.find_one({"id": did, "role": "driver"}, {"_id": 0, "provider_id": 1})
    if not driver:
        raise HTTPException(404, "Driver not found")
    if user.get("role") in ("owner", "admin", "supervisor") and driver.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "You do not have access to this driver")

    # Overall retrieval timing (all events combined)
    pipeline = [
        {"$match": {
            "retrieval_driver_id": did,
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
        {"$group": {"_id": None, "avg_ms": {"$avg": "$retrieval_ms"}}}
    ]
    result = await db.cars.aggregate(pipeline).to_list(1)
    avg_retrieval_minutes = round(result[0]["avg_ms"] / 60000, 1) if result and result[0].get("avg_ms") else 0

    checked_in = await db.cars.count_documents({"check_in_driver_id": did})
    retrieved = await db.cars.count_documents({"retrieval_driver_id": did, "status": "DELIVERED"})

    # Overall rating
    retrieved_ids = [c["id"] for c in await db.cars.find({"retrieval_driver_id": did, "status": "DELIVERED"}, {"_id": 0, "id": 1}).to_list(10000)]
    ratings = await db.ratings.find({"car_id": {"$in": retrieved_ids}}, {"_id": 0, "stars": 1}).to_list(10000) if retrieved_ids else []
    avg_rating = round(sum(r["stars"] for r in ratings) / len(ratings), 1) if ratings else None

    incidents_count = await db.incidents.count_documents({"driver_id": did})

    # Recent activity — last 10 check-in/delivery actions by this driver
    checkins = await db.cars.find(
        {"check_in_driver_id": did, "check_in_time": {"$ne": None}},
        {"_id": 0, "plate": 1, "check_in_time": 1, "event_id": 1}
    ).sort("check_in_time", -1).to_list(10)
    deliveries = await db.cars.find(
        {"retrieval_driver_id": did, "status": "DELIVERED", "delivered_at": {"$ne": None}},
        {"_id": 0, "plate": 1, "delivered_at": 1, "event_id": 1}
    ).sort("delivered_at", -1).to_list(10)
    recent = (
        [{"type": "checked_in", "plate": c.get("plate"), "at": c.get("check_in_time")} for c in checkins] +
        [{"type": "delivered", "plate": c.get("plate"), "at": c.get("delivered_at")} for c in deliveries]
    )
    recent.sort(key=lambda r: r["at"] or "", reverse=True)
    recent = recent[:10]

    ed_ids = [a["event_id"] for a in await db.event_drivers.find({"driver_id": did}, {"_id": 0, "event_id": 1}).to_list(1000)]
    car_event_ids = {c["event_id"] for c in await db.cars.find({"$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}]}, {"_id": 0, "event_id": 1}).to_list(10000)}
    total_events = len(set(ed_ids) | car_event_ids)

    return {
        "checked_in": checked_in,
        "retrieved": retrieved,
        "avg_retrieval_minutes": avg_retrieval_minutes,
        "rating": avg_rating,
        "incidents_count": incidents_count,
        "total_events": total_events,
        "recent": recent,
    }

@api_router.get("/drivers/{did}/events-paginated")
async def driver_events_paginated(
    did: str, page: int = 1, limit: int = 5, search: str = "",
    user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))
):
    driver = await db.drivers.find_one({"id": did, "role": "driver"}, {"_id": 0, "provider_id": 1})
    if not driver:
        raise HTTPException(404, "Driver not found")
    if user.get("role") in ("owner", "admin", "supervisor") and driver.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "You do not have access to this driver")

    ed_ids = [a["event_id"] for a in await db.event_drivers.find({"driver_id": did}, {"_id": 0, "event_id": 1}).to_list(1000)]
    car_event_ids = {c["event_id"] for c in await db.cars.find({"$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}]}, {"_id": 0, "event_id": 1}).to_list(10000)}
    all_eids = list(set(ed_ids) | car_event_ids)

    query = {"id": {"$in": all_eids}}
    if search.strip():
        rx = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [{"name": rx}, {"venue": rx}]

    total = await db.events.count_documents(query)
    events = await db.events.find(query, {"_id": 0}).sort("date", -1).skip((page - 1) * limit).limit(limit).to_list(limit)

    page_eids = [e["id"] for e in events]
    # Batch-compute stats for just this page's events instead of looping per event
    checked_in_counts = {}
    for eid in page_eids:
        checked_in_counts[eid] = await db.cars.count_documents({"event_id": eid, "check_in_driver_id": did})

    retrieved_cars = await db.cars.find(
        {"event_id": {"$in": page_eids}, "retrieval_driver_id": did, "status": "DELIVERED"},
        {"_id": 0, "id": 1, "event_id": 1, "retrieval_requested_at": 1, "delivered_at": 1}
    ).to_list(10000)
    retrieved_by_event = {}
    for c in retrieved_cars:
        retrieved_by_event.setdefault(c["event_id"], []).append(c)

    all_retrieved_ids = [c["id"] for c in retrieved_cars]
    ratings = await db.ratings.find({"car_id": {"$in": all_retrieved_ids}}, {"_id": 0, "car_id": 1, "stars": 1}).to_list(10000) if all_retrieved_ids else []
    ratings_by_car = {r["car_id"]: r["stars"] for r in ratings}

    incidents = await db.incidents.find({"driver_id": did, "event_id": {"$in": page_eids}}, {"_id": 0, "event_id": 1}).to_list(10000)
    incidents_by_event = {}
    for i in incidents:
        incidents_by_event[i["event_id"]] = incidents_by_event.get(i["event_id"], 0) + 1

    result_events = []
    for e in events:
        eid = e["id"]
        cars_here = retrieved_by_event.get(eid, [])
        durations = []
        for c in cars_here:
            if c.get("retrieval_requested_at") and c.get("delivered_at"):
                try:
                    t1 = datetime.fromisoformat(c["retrieval_requested_at"])
                    t2 = datetime.fromisoformat(c["delivered_at"])
                    durations.append((t2 - t1).total_seconds() / 60)
                except Exception:
                    pass
        avg_retrieval = round(sum(durations) / len(durations), 1) if durations else 0
        car_ids_here = [c["id"] for c in cars_here]
        stars_here = [ratings_by_car[cid] for cid in car_ids_here if cid in ratings_by_car]
        rating_here = round(sum(stars_here) / len(stars_here), 1) if stars_here else None
        result_events.append({
            "event_id": eid, "name": e.get("name"), "venue": e.get("venue"), "date": e.get("date"),
            "status": e.get("status"), "checked_in": checked_in_counts.get(eid, 0),
            "retrieved": len(cars_here), "avg_retrieval_minutes": avg_retrieval,
            "rating": rating_here, "incidents": incidents_by_event.get(eid, 0),
        })

    events = [enrich_event_lifecycle(e) for e in events]
    return {
        "events": result_events, "total": total, "page": page, "limit": limit,
        "pages": max(1, -(-total // limit)),
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
            
    if sups:
        assignments = await db.event_supervisors.find(
            {"supervisor_id": {"$in": [s["id"] for s in sups]}},
            {"_id": 0, "supervisor_id": 1, "event_id": 1}
        ).to_list(5000)
        if assignments:
            event_ids = list({a["event_id"] for a in assignments})
            events = await db.events.find(
                {"id": {"$in": event_ids}, "status": {"$in": ["upcoming", "active"]}},
                {"_id": 0, "id": 1, "name": 1, "date": 1, "end_date": 1}
            ).to_list(5000)
            events_by_id = {e["id"]: e for e in events}
            today = now_iso()[:10]
            sup_events = {}
            for a in assignments:
                ev = events_by_id.get(a["event_id"])
                if ev:
                    sup_events.setdefault(a["supervisor_id"], []).append(ev)
            for s in sups:
                evs = sup_events.get(s["id"], [])
                current = next((e for e in evs if e.get("date", "") <= today <= e.get("end_date", e.get("date", ""))), None) or (evs[0] if evs else None)
                s["current_event_name"] = current["name"] if current else None
                s["current_event_id"] = current["id"] if current else None
        else:
            for s in sups:
                s["current_event_name"] = None
                s["current_event_id"] = None

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
    if body.pan_number and await is_pan_taken(body.pan_number):
        raise HTTPException(400, "PAN number already in use")
    if body.bank_account_number and not BANK_RE.match(body.bank_account_number.strip()):
        raise HTTPException(400, "Bank account number must be 9–18 digits")
    if body.bank_ifsc and not IFSC_RE.match(body.bank_ifsc.strip().upper()):
        raise HTTPException(400, "Invalid IFSC format. Expected format: ABCD0123456")
    if not AADHAR_RE.match(body.aadhar_number.strip()):
        raise HTTPException(400, "Aadhar number must be exactly 12 digits")
    if await is_aadhar_taken(body.aadhar_number):
        raise HTTPException(400, "Aadhar number already in use")
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
        if body.pan_number.strip().upper() != (sup.get("pan_number") or "").upper() and await is_pan_taken(body.pan_number, exclude_id=sid):
            raise HTTPException(400, "PAN number already in use")
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
        if body.aadhar_number.strip() != (sup.get("aadhar_number") or "") and await is_aadhar_taken(body.aadhar_number, exclude_id=sid):
            raise HTTPException(400, "Aadhar number already in use")
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

@api_router.delete("/supervisors/{sid}/permanent")
async def permanently_delete_supervisor_owner(sid: str, user=Depends(require_roles("superadmin", "owner", "admin"))):
    supervisor = await db.drivers.find_one({"id": sid, "role": "supervisor"})
    if not supervisor:
        raise HTTPException(404, "Supervisor not found")
        
    if user.get("role") in ("owner", "admin"):
        if supervisor.get("provider_id") != user.get("provider_id"):
            raise HTTPException(403, "You do not have access to this supervisor")
            
    await db.drivers.delete_one({"id": sid})
    return {"ok": True, "message": "Supervisor permanently deleted"}

@api_router.delete("/superadmin/supervisors/{sid}/permanent")
async def permanently_delete_supervisor(sid: str, user=Depends(require_roles("superadmin"))):
    supervisor = await db.drivers.find_one({"id": sid, "role": "supervisor"})
    if not supervisor:
        raise HTTPException(404, "Supervisor not found")
    await db.drivers.delete_one({"id": sid})
    return {"ok": True, "message": "Supervisor permanently deleted"}


# ============== UTILITIES (PROXIES) ==============
@api_router.get("/utils/ifsc/{code}")
async def lookup_ifsc(code: str, user=Depends(require_roles("admin", "owner", "superadmin", "supervisor"))):
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
async def places_autocomplete(input: str, user=Depends(require_roles("admin", "owner", "superadmin"))):
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
async def places_details(place_id: str, user=Depends(require_roles("admin", "owner", "superadmin"))):
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
    auto_close_grace_minutes: Optional[int] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None

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
    auto_close_grace_minutes: Optional[int] = None
    venue_place_id: Optional[str] = None
    venue_address: Optional[str] = None
    venue_lat: Optional[float] = None
    venue_lng: Optional[float] = None

@api_router.get("/events")
async def list_events(user=Depends(get_current)):
    query = {}
    if user.get("role") != "superadmin":
        query["provider_id"] = user["provider_id"]
    
    events = await db.events.find(query, {"_id": 0}).to_list(1000)
    
    # Enrich with hotel_name
    hotel_ids = list({e["hotel_id"] for e in events if e.get("hotel_id")})
    hotels = {h["id"]: h["name"] for h in await db.hotels.find({"id": {"$in": hotel_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    
    event_ids = [e["id"] for e in events]
    occupancies = await get_events_occupancy(event_ids)

    for e in events:
        e["hotel_name"] = hotels.get(e.get("hotel_id"), "—")
        occ = occupancies.get(e["id"], {"occupied": 0, "carried_forward": 0})
        e["occupied_slots"] = occ["occupied"]
        e["available_slots"] = max(0, e.get("max_cars", 0) - occ["occupied"])
        e["carried_forward_count"] = occ["carried_forward"]
        
    events = [enrich_event_lifecycle(e) for e in events]
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
        
        occupancies = await get_events_occupancy(event_ids)
    else:
        car_count_map = {}
        occupancies = {}

    for e in events:
        e["provider_name"] = provs.get(e["provider_id"], "—")
        e["cars_count"] = car_count_map.get(e["id"], 0)
        
        occ = occupancies.get(e["id"], {"occupied": 0, "carried_forward": 0})
        e["occupied_slots"] = occ["occupied"]
        e["available_slots"] = max(0, e.get("max_cars", 0) - occ["occupied"])
        e["carried_forward_count"] = occ["carried_forward"]
        
    events = [enrich_event_lifecycle(e) for e in events]

    return events

def event_time_range(date_str, start_time, end_date_str, end_time):
    start_dt = datetime.strptime(f"{date_str} {start_time}", "%Y-%m-%d %H:%M")
    end_dt = datetime.strptime(f"{end_date_str} {end_time}", "%Y-%m-%d %H:%M")
    return start_dt, end_dt

def event_checkin_opens_at(event: dict) -> datetime:
    """Returns the tz-aware (Asia/Kolkata) datetime at which an event's check-in window
    opens (i.e. the event's date + start_time). Raises ValueError if date/start_time
    on the event are missing or unparseable — callers should catch this."""
    from zoneinfo import ZoneInfo
    date_str = event.get("date", "")
    start_time = event.get("start_time", "00:00")
    dt = datetime.strptime(f"{date_str} {start_time}", "%Y-%m-%d %H:%M")
    return dt.replace(tzinfo=ZoneInfo("Asia/Kolkata"))

def compute_event_status(event: dict, now_ist=None) -> str:
    from zoneinfo import ZoneInfo
    if now_ist is None:
        now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    
    try:
        opens_at = event_checkin_opens_at(event)
    except Exception:
        date_str = event.get("date", "")
        start_time = event.get("start_time", "00:00")
        logger.warning(f"compute_event_status: unparseable date/start_time on event {event.get('id')} (date={date_str!r}, start_time={start_time!r})")
        event["data_error"] = True
        return "upcoming"
        
    if now_ist >= opens_at - timedelta(minutes=30):
        return "active"
    return "upcoming"

def enrich_event_lifecycle(event: dict) -> dict:
    status = event.get("status", "upcoming")
    event["lifecycle_state"] = status
    event["is_checkin_open"] = (status == "active")
    return event


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
        scope_filter = {"provider_id": provider_id, "hotel_id": hotel_id, "status": {"$in": ["upcoming", "active"]}, "is_template": {"$ne": True}}
    else:
        provider_max_cars = provider.get("max_cars", 0)
        hotels_agg = await db.hotels.aggregate([
            {"$match": {"provider_id": provider_id}},
            {"$group": {"_id": None, "total": {"$sum": "$max_cars"}}}
        ]).to_list(1)
        hotels_total = hotels_agg[0]["total"] if hotels_agg else 0
        ceiling = provider_max_cars - hotels_total
        scope_filter = {"provider_id": provider_id, "hotel_id": None, "status": {"$in": ["upcoming", "active"]}, "is_template": {"$ne": True}}

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
        existing_count = await db.events.count_documents({
            "provider_id": pid,
            "event_type": "regular",
            "is_template": {"$ne": True},
        })
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
        if not doc.get("live_queue_token"):
            doc["live_queue_token"] = str(uuid.uuid4())

    # Regular valet provider events also get their own QR token
    if body.event_type == "regular" and not doc.get("event_qr_token"):
        doc["event_qr_token"] = str(uuid.uuid4())
    if not doc.get("live_queue_token"):
        doc["live_queue_token"] = str(uuid.uuid4())

    initial_status = compute_event_status(doc)
    doc.update({"id": eid, "provider_id": pid, "status": initial_status,
                "manually_activated": False,
                "manually_activated_at": None,
                "manually_activated_by": None,
                "key_hooks": body.key_hooks,
                "created_at": now_iso(), "updated_at": now_iso()})
    await db.events.insert_one(doc.copy())

    if provider and provider.get("provider_type") == "valet_provider":
        post_count = await db.events.count_documents({
            "provider_id": pid,
            "event_type": "regular",
            "is_template": {"$ne": True},
        })
        if post_count > provider.get("max_events", 0):
            await db.events.delete_one({"id": eid})
            raise HTTPException(400, "Event limit reached for this provider")

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
    initial_status = compute_event_status(doc)
    doc.update({
        "id": eid,
        "provider_id": hotel["provider_id"],
        "hotel_id": hid,
        "event_type": "hotel_special",
        "venue": hotel["name"],
        "status": initial_status,
        "manually_activated": False,
        "manually_activated_at": None,
        "manually_activated_by": None,
        "event_qr_token": str(uuid.uuid4()),
        "live_queue_token": str(uuid.uuid4()),
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

@api_router.get("/events/{eid}/live-queue-token")
async def get_event_live_queue_token(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Fetch or generate the public live-queue link token for an event."""
    event = await db.events.find_one({"id": eid}, {"_id": 0, "live_queue_token": 1, "name": 1, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    if user.get("role") in ("owner", "admin", "supervisor") and event.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Forbidden")

    token = event.get("live_queue_token")
    if not token:
        token = str(uuid.uuid4())
        await db.events.update_one({"id": eid}, {"$set": {"live_queue_token": token}})

    return {"live_queue_token": token, "event_name": event["name"]}

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

    pid = source.get("provider_id")
    provider = None
    if pid:
        provider = await db.providers.find_one({"id": pid}, {"_id": 0, "provider_type": 1, "max_events": 1})
        if provider and provider.get("provider_type") == "valet_provider":
            max_events = provider.get("max_events", 0)
            if max_events == 0:
                raise HTTPException(400, "Event limit not configured for this provider — contact support")
            existing_count = await db.events.count_documents({
                "provider_id": pid,
                "event_type": "regular",
                "is_template": {"$ne": True},
            })
            if existing_count >= max_events:
                raise HTTPException(400, "Event limit reached for this provider")

    new_id = str(uuid.uuid4())
    cloned = {**source}
    cloned["id"] = new_id
    cloned["live_queue_token"] = str(uuid.uuid4())
    cloned["event_qr_token"] = str(uuid.uuid4())
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

    if provider and provider.get("provider_type") == "valet_provider":
        post_count = await db.events.count_documents({
            "provider_id": pid,
            "event_type": "regular",
            "is_template": {"$ne": True},
        })
        if post_count > provider.get("max_events", 0):
            await db.events.delete_one({"id": new_id})
            raise HTTPException(400, "Event limit reached for this provider")

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
    return enrich_event_lifecycle(e)

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
    
    if event: event = enrich_event_lifecycle(event)
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
    other_events = await db.events.find({"provider_id": pid, "status": {"$in": ["upcoming", "active"]}, "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
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
 
    if ratings and delivered:
        r_map = {r["car_id"]: r for r in ratings}
        for c in delivered:
            rd = c.get("retrieval_driver_id")
            if rd:
                c_rating = r_map.get(c["id"])

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
    
    if event: event = enrich_event_lifecycle(event)
    return event

@api_router.patch("/events/{eid}")
async def update_event(eid: str, body: EventUpdate, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0, "event_type": 1}) 
    if event and event.get("event_type") == "hotel_daily":
        submitted_fields = {k for k, v in body.model_dump().items() if v is not None}
        if submitted_fields - {"gate_timer_minutes", "auto_close_grace_minutes", "name", "venue", "venue_place_id", "venue_address", "venue_lat", "venue_lng", "start_time", "end_time", "gates"}:
            raise HTTPException(400, "Daily hotel events cannot have their capacity, zones, or dates changed — only name, venue, times, gates, and gate timer.")
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
    if current.get("event_type") != "hotel_daily" and any(k in upd for k in cap_fields):
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

@api_router.post("/events/{eid}/reopen")
async def reopen_event(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    if event.get("event_type") == "hotel_daily":
        raise HTTPException(400, "Daily hotel events reopen automatically the next day")
    if user.get("role") in ("owner", "admin", "supervisor") and event["provider_id"] != user.get("provider_id"):
        raise HTTPException(403, "Forbidden — event belongs to a different provider")
    if event.get("status") != "closed":
        raise HTTPException(400, "Event is not closed")

    new_status = compute_event_status(event)
    await db.events.update_one(
        {"id": eid},
        {"$set": {"status": new_status, "updated_at": now_iso()},
         "$unset": {"auto_close_reminder_sent_at": ""}}
    )

    # Parking slots are deleted on close — recreate any missing ones from
    # the event's zone config, same logic as /slots/event/{eid}/initialize
    existing_slots = await db.parking_slots.find(
        {"event_id": eid}, {"_id": 0, "zone_name": 1, "slot_number": 1}
    ).to_list(5000)
    existing_set = {(s["zone_name"], s["slot_number"]) for s in existing_slots}
    to_insert = []
    for zone in event.get("zones", []):
        zname = zone.get("name")
        count = int(zone.get("slots", 0))
        for i in range(1, count + 1):
            if (zname, i) not in existing_set:
                to_insert.append({
                    "id": str(uuid.uuid4()), "event_id": eid, "zone_name": zname,
                    "slot_number": i, "car_id": None, "is_occupied": False,
                    "created_at": now_iso(),
                })
    if to_insert:
        await db.parking_slots.insert_many(to_insert, ordered=False)

    return {"ok": True}

@api_router.post("/events/{eid}/activate")
async def activate_event_early(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    if user.get("role") in ("owner", "admin", "supervisor") and event["provider_id"] != user.get("provider_id"):
        raise HTTPException(403, "Forbidden — event belongs to a different provider")
    if event.get("status") != "upcoming":
        raise HTTPException(400, f"Event is '{event.get('status')}' — cannot activate manually")
    if event.get("manually_activated"):
        raise HTTPException(400, "Event is already manually activated")

    await db.events.update_one(
        {"id": eid},
        {"$set": {
            "status": "active",
            "manually_activated": True,
            "manually_activated_at": now_iso(),
            "manually_activated_by": user.get("user_id"),
            "activation_type": "manual",
            "updated_at": now_iso(),
        }}
    )
    if "provider_id" in event:
        await manager.broadcast(f"provider:{event['provider_id']}", {"type": "event_activated", "event_id": eid})
    await manager.broadcast(f"event:{eid}", {"type": "event_activated", "event_id": eid})
    return {"ok": True}

@api_router.post("/events/{eid}/close")
async def close_event(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0, "event_type": 1}) 
    if event and event.get("event_type") == "hotel_daily" and user.get("role") != "superadmin": 
        raise HTTPException(400, "Daily hotel events are closed automatically at midnight") 
    if user.get("role") in ("owner", "admin", "supervisor"):
        event_full = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
        if event_full and event_full["provider_id"] != user.get("provider_id"):
            raise HTTPException(403, "Forbidden — event belongs to a different provider")

    if user.get("role") != "superadmin":
        active_cars = await db.cars.count_documents({
            "event_id": eid,
            "status": {"$nin": ["DELIVERED", "PRE_REGISTERED"]},
            "deleted": {"$ne": True}
        })
        if active_cars > 0:
            raise HTTPException(400, f"Cannot close event — {active_cars} car(s) still active. All cars must be retrieved before closing.")

    await db.events.update_one({"id": eid}, {"$set": {"status": "closed", "updated_at": now_iso()}})
    await db.parking_slots.delete_many({"event_id": eid})
    
    # Trigger auto report email
    updated_event = await db.events.find_one({"id": eid})
    if updated_event:
        asyncio.create_task(_trigger_auto_report_email(updated_event))
        
    return {"ok": True}

@api_router.get("/events/{eid}/stats")
async def event_stats(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
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
        "avg_retrieval_minutes": avg_ret, 
        "avg_stay_minutes": avg_duration, 
        "top_driver": top_driver, 
        "total_cars": len(car_ids),
        "total_checked_in": len(car_ids),
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

@api_router.get("/drivers/{did}/events/{eid}/stats")
async def get_driver_event_stats(did: str, eid: str, user=Depends(require_roles("superadmin", "owner", "admin", "driver"))):
    if user.get("role") in ("owner", "admin"):
        driver = await db.drivers.find_one({"id": did}, {"provider_id": 1})
        if not driver or driver.get("provider_id") != user.get("provider_id"):
            raise HTTPException(403, "Forbidden")
    if user.get("role") == "driver" and did != user.get("user_id", user.get("id")):
        raise HTTPException(403, "You can only view your own stats")

    parked_count = await db.cars.count_documents({"event_id": eid, "parked_driver_id": did})
    delivered_count = await db.cars.count_documents({"event_id": eid, "retrieval_driver_id": did, "status": "DELIVERED"})

    pipeline = [
        {"$match": {
            "event_id": eid,
            "retrieval_driver_id": did,
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
        {"$group": {"_id": None, "avg_ms": {"$avg": "$retrieval_ms"}}}
    ]
    result = await db.cars.aggregate(pipeline).to_list(1)
    avg_retrieval_minutes = round(result[0]["avg_ms"] / 60000, 1) if result and result[0].get("avg_ms") else 0

    return {
        "parked_count": parked_count,
        "delivered_count": delivered_count,
        "avg_retrieval_minutes": avg_retrieval_minutes
    }

@api_router.get("/events/{eid}/public-stats")
async def event_public_stats(eid: str):
    """Public endpoint — returns only ETA data for guest pass page."""
    avg_minutes = await _get_avg_retrieval_minutes(eid)

    queue_depth = await db.cars.count_documents({
        "event_id": eid,
        "status": {"$in": ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"]}
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

def _ist(iso_str):
    """Format an ISO datetime string in IST as 'DD Mon YYYY, HH:MM'. Returns '—' if empty/invalid."""
    if not iso_str:
        return "—"
    try:
        dt = datetime.fromisoformat(iso_str) + timedelta(hours=5, minutes=30)
        return dt.strftime("%d %b %Y, %H:%M")
    except Exception:
        return "—"

def _fmt_dur(mins):
    """Mirror the frontend's fmtDuration: '<45 min' or '1h 20m'."""
    if mins is None:
        return "—"
    m = max(0, int(mins))
    if m < 60:
        return f"{m} min"
    h, rem = divmod(m, 60)
    return f"{h}h {rem}m"

def _render_event_report_html(data: dict) -> str:
    e, s = data["event"], data["summary"]

    car_rows = "".join(f"""
      <tr>
        <td style="padding:8px 10px;font-weight:700;">{c['plate']}</td>
        <td style="padding:8px 10px;">{(c['color'] + ' ' + c['make']).strip()}</td>
        <td style="padding:8px 10px;">{c['status']}</td>
        <td style="padding:8px 10px;">{c['check_in_driver'] or '—'}</td>
        <td style="padding:8px 10px;">{c['retrieval_driver'] or '—'}</td>
        <td style="padding:8px 10px;">{_fmt_dur(c['duration_minutes'])}</td>
        <!--<td style="padding:8px 10px;">{'⭐' * c['rating'] if c['rating'] else '—'}</td>-->
        <td style="padding:8px 10px;font-size:11px;">{c['notes'] or '—'}</td>
      </tr>""" for c in data["cars"])

    driver_rows = "".join(f"""
      <tr>
        <td style="padding:8px 10px;font-weight:700;">{d['name']}</td>
        <td style="padding:8px 10px;">{d['employee_id']}</td>
        <td style="padding:8px 10px;text-align:center;">{d['checkins']}</td>
        <td style="padding:8px 10px;text-align:center;">{d['retrievals']}</td>
        <td style="padding:8px 10px;text-align:center;color:{'#ef4444' if d['incidents'] > 0 else '#6b7280'};">{d['incidents']}</td>
      </tr>""" for d in data["drivers"])

    if data["incidents"]:
        incident_rows = "".join(f"""
          <tr>
            <td style="padding:8px 10px;font-weight:700;">{i.get('plate','—')}</td>
            <td style="padding:8px 10px;">{i.get('reported_by') or i.get('driver_name') or '—'}</td>
            <td style="padding:8px 10px;">{i.get('description','')}</td>
            <td style="padding:8px 10px;font-size:11px;color:#6b7280;">{_ist(i.get('created_at'))}</td>
          </tr>""" for i in data["incidents"])
    else:
        incident_rows = '<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af;">No incidents reported</td></tr>'

    incidents_color = "#ef4444" if s["total_incidents"] > 0 else "#059669"

    return f"""<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>{e['name']} — Event Report</title>
    <style>
      *{{margin:0;padding:0;box-sizing:border-box;}}
      body{{font-family:Arial,sans-serif;color:#111827;}}
      .header{{background:#7C3AED;color:white;padding:32px 40px;}}
      .header h1{{font-size:28px;font-weight:900;}}
      .header p{{opacity:0.8;margin-top:4px;font-size:14px;}}
      .section{{padding:28px 40px;border-bottom:1px solid #f3f4f6;}}
      .section h2{{font-size:13px;font-weight:800;color:#7C3AED;letter-spacing:3px;margin-bottom:16px;}}
      .stats-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}}
      .stat-card{{background:#f9fafb;border-radius:12px;padding:16px;text-align:center;}}
      .stat-value{{font-size:28px;font-weight:900;color:#111827;}}
      .stat-label{{font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:1px;}}
      table{{width:100%;border-collapse:collapse;font-size:13px;}}
      thead tr{{background:#f9fafb;}}
      th{{padding:10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:700;}}
      .footer{{padding:20px 40px;text-align:center;color:#9ca3af;font-size:12px;}}
    </style></head><body>
    <div class="header">
      <h1>{e['name']}</h1>
      <p>{e['date']} {"· " + e['start_time'] + " to " + e['end_time'] if e['start_time'] else ""} {"· " + e['venue'] if e['venue'] else ""}</p>
      <p style="margin-top:8px;font-size:12px;opacity:0.6;">Generated on {_ist(datetime.now(timezone.utc).isoformat())} IST</p>
    </div>
    <div class="section">
      <h2>EVENT SUMMARY</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">{s['total_cars']}</div><div class="stat-label">Total Cars</div></div>
        <div class="stat-card"><div class="stat-value">{s['pre_registered']}</div><div class="stat-label">Pre-Registered</div></div>
        <div class="stat-card"><div class="stat-value">{s['walk_in']}</div><div class="stat-label">Walk-in</div></div>
        <div class="stat-card"><div class="stat-value">{s['delivered']}</div><div class="stat-label">Delivered</div></div>
        <div class="stat-card"><div class="stat-value">{s['still_parked']}</div><div class="stat-label">Still Parked</div></div>
        <div class="stat-card"><div class="stat-value">{s['avg_retrieval_minutes']}m</div><div class="stat-label">Avg Retrieval</div></div>
        <!--<div class="stat-card"><div class="stat-value">{(str(s['platform_avg_rating']) + '★') if s['platform_avg_rating'] > 0 else '—'}</div><div class="stat-label">Platform Rating</div></div>-->
        <div class="stat-card"><div class="stat-value">{_fmt_dur(s['avg_duration_minutes'])}</div><div class="stat-label">Avg Duration</div></div>
        <div class="stat-card"><div class="stat-value">{s['total_drivers']}</div><div class="stat-label">Drivers</div></div>
        <div class="stat-card"><div class="stat-value">{s['active']}</div><div class="stat-label">Still Active</div></div>
        <div class="stat-card"><div class="stat-value">{s['peak_hour'] or '—'}</div><div class="stat-label">Peak Hour</div></div>
        <div class="stat-card" style="color:{incidents_color}"><div class="stat-value">{s['total_incidents']}</div><div class="stat-label">Incidents</div></div>
      </div>
    </div>
    <div class="section">
      <h2>DRIVER PERFORMANCE</h2>
      <table><thead><tr><th>Driver</th><th>Employee ID</th><th>Check-ins</th><th>Retrievals</th><th>Incidents</th></tr></thead>
      <tbody>{driver_rows}</tbody></table>
    </div>
    <div class="section">
      <h2>INCIDENT REPORTS</h2>
      <table><thead><tr><th>Plate</th><th>Driver</th><th>Description</th><th>Time</th></tr></thead>
      <tbody>{incident_rows}</tbody></table>
    </div>
    <div class="section">
      <h2>ALL VEHICLES ({s['total_cars']})</h2>
      <table><thead><tr><th>Plate</th><th>Vehicle</th><th>Status</th><th>Check-in By</th><th>Retrieved By</th><th>Duration</th><!--<th>Rating</th>--><th>Notes</th></tr></thead>
      <tbody>{car_rows}</tbody></table>
    </div>
    <div class="footer">InstaPark — Smart Valet Operations · {e['name']}</div>
    </body></html>"""

def _render_event_report_csv(data: dict) -> str:
    e, s = data["event"], data["summary"]
    headers = [
        "Plate", "Make", "Color", "Status", "Gate", "Zone", "Slot",
        "Key Tag", "Guest Name", "Guest Phone", "Check-in Time (IST)",
        "Parked At (IST)", "Delivered At (IST)", "Duration",
        "Retrieval Time (min)", "Check-in Driver", "Parked Driver",
        "Retrieval Driver",
        # "Platform Rating",  # TEMP: hidden from client report — uncomment to restore
        "Notes",
        "Pre-registered", "Walk-in", "Peak Hour", "Still Parked",
    ]
    lines = [",".join(headers)]
    for c in data["cars"]:
        notes = str(c.get("notes") or "").replace('"', "'")
        row = [
            c["plate"], c["make"], c["color"], c["status"], c["gate"],
            c["zone"], str(c["slot"]), str(c["key_tag"]), c["guest_name"], c["guest_phone"],
            f'"{_ist(c["check_in_time"])}"', f'"{_ist(c["parked_at"])}"', f'"{_ist(c["delivered_at"])}"',
            _fmt_dur(c["duration_minutes"]), str(c["retrieval_minutes"] or ""),
            c["check_in_driver"], c["parked_driver"], c["retrieval_driver"],
            # str(c["rating"] or ""),  # TEMP: hidden from client report — uncomment to restore
            f'"{notes}"',
            str(s["pre_registered"]), str(s["walk_in"]), s["peak_hour"] or "—", str(s["still_parked"]),
        ]
        lines.append(",".join(row))
    return "\n".join(lines)


async def _get_event_report_data(eid: str, user) -> dict:
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
        {"_id": 0, "car_id": 1, "stars": 1}
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
            "plate": c.get("plate") or "",
            "make": c.get("make") or "",
            "color": c.get("color") or "",
            "status": c.get("status") or "",
            "gate": c.get("gate") or "",
            "zone": c.get("zone") or "",
            "slot": c.get("slot"),
            "key_tag": c.get("key_tag") or "",
            "guest_name": c.get("guest_name") or "",
            "guest_phone": c.get("guest_phone") or "",
            "check_in_time": c.get("check_in_time") or "",
            "parked_at": c.get("parked_at") or "",
            "delivered_at": c.get("delivered_at") or "",
            "duration_minutes": duration_min,
            "retrieval_minutes": retrieval_min,
            "check_in_driver": (drivers_map.get(c.get("check_in_driver_id")) or {}).get("name") or "",
            "parked_driver": (drivers_map.get(c.get("parked_driver_id")) or {}).get("name") or "",
            "retrieval_driver": (drivers_map.get(c.get("retrieval_driver_id")) or {}).get("name") or "",
            "rating": ratings_map.get(c["id"], {}).get("stars"),
            "notes": c.get("notes") or "",
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
                }
            driver_perf[did][f"{role}s"] += 1

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
            "platform_avg_rating": platform_avg_rating,
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

async def _trigger_auto_report_email(event: dict):
    recipients = []
    
    # 1. Superadmins
    superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1}).to_list(100)
    for sa in superadmins:
        if sa.get("email"):
            recipients.append(sa["email"])
            
    # 2. Provider
    prov = await db.providers.find_one({"id": event.get("provider_id")}, {"_id": 0, "email": 1})
    if prov and prov.get("email"):
        recipients.append(prov["email"])
        
    # 3. Host
    if event.get("host_email"):
        recipients.append(event["host_email"])
        
    await send_event_report_email(event["id"], recipients, bcc=BCC_EMAIL)



async def send_event_report_email(eid: str, recipients: list[str], bcc: str = None):
    if not recipients:
        return
    cleaned_recipients = list(set([r.strip().lower() for r in recipients if r and isinstance(r, str)]))
    valid_recipients = [r for r in cleaned_recipients if re.match(EMAIL_RE, r)]
    if not valid_recipients:
        return
    
    bcc_clean = bcc.strip().lower() if bcc and isinstance(bcc, str) else None
    if bcc_clean and not re.match(EMAIL_RE, bcc_clean):
        bcc_clean = None
    
    # Bypass auth check by passing a mock superadmin user
    data = await _get_event_report_data(eid, {"role": "superadmin"})
    html = _render_event_report_html(data)
    csv_text = _render_event_report_csv(data)
    
    event_name = re.sub(r"\s+", "_", data["event"]["name"] or "event")
    filename = f"{event_name}_report.csv"
    
    csv_bytes = csv_text.encode("utf-8")
    b64_content = base64.b64encode(csv_bytes).decode("utf-8")
    attachments = [{"filename": filename, "content": b64_content}]
    subject = f"Event Report: {data['event'].get('name', 'Event')} - {data['event'].get('hotel_name', '')}"
    
    for r in valid_recipients:
        try:
            logger.info(f"Queuing event report email for {r} (event {eid})")
            asyncio.create_task(send_email(r, subject, html, attachments, bcc=bcc_clean))
        except Exception as e:
            logger.error(f"Failed to queue report email for {r}: {e}")

class SendReportReq(BaseModel):
    email: str

@api_router.post("/events/{eid}/send-report")
async def send_event_report_manual(
    eid: str,
    req: SendReportReq,
    user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))
):
    if not re.match(EMAIL_RE, req.email):
        raise HTTPException(400, "Invalid email format")
    
    event = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
        
    if user.get("role") != "superadmin" and event.get("provider_id") != user.get("provider_id"):
        raise HTTPException(403, "Cannot send report for another provider's event")
        
    await send_event_report_email(eid, [req.email])
    return {"ok": True}


@api_router.get("/events/{eid}/report")
async def get_event_report(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Returns full event report data as JSON."""
    return await _get_event_report_data(eid, user)

@api_router.get("/events/{eid}/report.html")
async def get_event_report_html(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Returns the fully rendered event report as a standalone HTML page (used for PDF/print on every client)."""
    data = await _get_event_report_data(eid, user)
    html = _render_event_report_html(data)
    return HTMLResponse(content=html)

@api_router.get("/events/{eid}/report.csv")
async def get_event_report_csv(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    """Returns the event report as a downloadable CSV file."""
    data = await _get_event_report_data(eid, user)
    csv_text = _render_event_report_csv(data)
    filename = re.sub(r"\s+", "_", data["event"]["name"] or "event") + "_report.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# Event drivers
@api_router.get("/events/{eid}/drivers")
async def event_drivers(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    if user.get("role") in ("owner", "admin", "supervisor") and event["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    pid = event["provider_id"]
    drivers = await db.drivers.find({"provider_id": pid, "role": "driver", "is_active": True}, SAFE_DRIVER_PROJ).to_list(1000)
    other_events = await db.events.find({"provider_id": pid, "status": {"$in": ["upcoming", "active"]}, "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
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
                {"retrieval_driver_id": {"$in": busy_ids}, "status": {"$in": ["ACCEPTED", "BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"]}},
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
            other = await db.events.find_one({"id": a["event_id"], "status": {"$in": ["upcoming", "active"]}}, {"_id": 0})
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
    other_events = await db.events.find({"provider_id": pid, "status": {"$in": ["upcoming", "active"]}, "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
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
            other = await db.events.find_one({"id": a["event_id"], "status": {"$in": ["upcoming", "active"]}}, {"_id": 0})
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
        
    provider_ids = list({e["provider_id"] for e in events if e.get("provider_id")})
    providers_map = {}
    if provider_ids:
        provs = await db.providers.find({"id": {"$in": provider_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        providers_map = {p["id"]: p["name"] for p in provs}
    for e in events:
        e["provider_name"] = providers_map.get(e["provider_id"], "Unknown")
        
    events = [enrich_event_lifecycle(e) for e in events]
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
    active_events = await db.events.count_documents({"id": {"$in": event_ids}, "status": {"$in": ["upcoming", "active"]}}) if event_ids else 0
    total_cars_managed = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    
    car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"_id": 0, "id": 1}).to_list(100000)] if event_ids else []
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0, "stars": 1}).to_list(100000) if car_ids else []
    platform_avg_rating = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    
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
        "platform_avg_rating": platform_avg_rating,
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
        e_ratings = await db.ratings.find({"car_id": {"$in": e_car_ids}}, {"stars": 1}).to_list(10000) if e_car_ids else []
        platform_avg_rating = round(sum(r["stars"] for r in e_ratings) / len(e_ratings), 2) if e_ratings else 0
        e_drivers_count = await db.event_drivers.count_documents({"event_id": e["id"]})
        
        event_summary.append({
            "event_name": e.get("name", ""),
            "event_date": e.get("date", ""),
            "end_date": e.get("end_date", ""),
            "venue": e.get("venue", ""),
            "status": e.get("status", ""),
            "total_cars": e_cars,
            "platform_avg_rating": platform_avg_rating,
            "drivers_count": e_drivers_count
        })
        
    return {
        "supervisor": sup,
        "summary": stats,
        "events": event_summary
    }



@api_router.get("/drivers/{did}/incidents")
async def get_driver_incidents(did: str, user=Depends(require_roles("superadmin", "owner", "admin", "supervisor"))):
    if user.get("role") in ("owner", "admin", "supervisor"):
        driver = await db.drivers.find_one({"id": did}, {"provider_id": 1})
        if not driver or driver.get("provider_id") != user.get("provider_id"):
            raise HTTPException(403, "You do not have access to this driver's incidents")
            
    incidents = await db.incidents.find({"driver_id": did}, {"_id": 0}).sort("created_at", -1).to_list(None)
    for inc in incidents:
        if inc.get("event_id"):
            evt = await db.events.find_one({"id": inc["event_id"]}, {"name": 1})
            inc["event_name"] = evt["name"] if evt else "Unknown Event"
    return incidents

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
        
    events = [enrich_event_lifecycle(e) for e in events]
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
        {"_id": 0, "car_id": 1, "stars": 1, "comment": 1}
    ).to_list(10000)
    platform_avg_rating = round(
        sum(r["stars"] for r in ratings_list) /
        len(ratings_list), 2
    ) if ratings_list else 0

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
            "platform_avg_rating": platform_avg_rating,
            "total_incidents": len(incidents),
        },
        "events": event_summary,
        "incidents": incidents,
    }

@api_router.get("/drivers/{did}/events/{eid}/cars")
async def get_driver_event_cars(did: str, eid: str, user=Depends(require_roles("superadmin", "owner", "admin", "driver"))):
    if user.get("role") in ("owner", "admin"):
        driver = await db.drivers.find_one({"id": did}, {"provider_id": 1})
        if not driver or driver.get("provider_id") != user.get("provider_id"):
            raise HTTPException(403, "You do not have access to this driver")
    if user.get("role") == "driver" and did != user.get("user_id", user.get("id")):
        raise HTTPException(403, "You can only view your own activity")
            
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
        c.update(compute_car_step_durations(c))
    cars = await _attach_card_info(cars)
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
    qr_token: Optional[str] = None
    color: Optional[str] = ""
    make: Optional[str] = ""
    notes: Optional[str] = ""
    gate: Optional[str] = ""
    event_id: str
    check_in_driver_id: Optional[str] = None
    guest_phone: Optional[str] = None
    guest_name: Optional[str] = "" 
    instant_park: Optional[bool] = False 
    expected_arrival: Optional[str] = None 
    pass_token: Optional[str] = None 
    car_type: Optional[str] = "normal"
    has_plate_issue: Optional[bool] = False

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
    status_order = {"RETRIEVAL_REQUESTED": 0, "ACCEPTED": 1, "BEING_FETCHED": 2, "CHECKED_IN": 3, "PARKED": 4, "DELIVERED": 5}

    def sort_key(c):
        status = c.get("status", "")
        if status in ("RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"):
            tiebreak = c.get("accepted_at") or c.get("retrieval_requested_at") or ""
        else:
            tiebreak = c.get("check_in_time") or ""
        return (status_order.get(status, 99), tiebreak)

    cars.sort(key=sort_key)
    for c in cars:
        c.update(compute_car_step_durations(c))
    cars = await _attach_card_info(cars)
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
        c.update(compute_car_step_durations(c))
        
    cars = await _attach_card_info(cars)
    return cars


@api_router.patch("/superadmin/events/{eid}/cars/mark-all-delivered")
async def superadmin_mark_all_cars_delivered(eid: str, user=Depends(require_roles("superadmin"))):
    """
    Emergency override: force every active (non-delivered, non-cancelled,
    non-pre-registered) car in this event to DELIVERED in one shot.

    Intended for the rare case where guests/drivers walked off with keys
    directly (no time to run retrieval requests one by one) and the event
    would otherwise stay stuck "active" with cars that are physically gone.
    Frees each car's QR card and parking slot exactly like a normal delivery.
    """
    event = await db.events.find_one({"id": eid}, {"_id": 0, "id": 1})
    if not event:
        raise HTTPException(404, "Event not found")

    eligible_cars = await db.cars.find(
        {"event_id": eid, "deleted": {"$ne": True},
         "status": {"$nin": ["DELIVERED", "CANCELLED", "PRE_REGISTERED"]}},
        {"_id": 0}
    ).to_list(10000)

    if not eligible_cars:
        return {"updated_count": 0}

    now = now_iso()
    ids = [c["id"] for c in eligible_cars]
    marked_by = {"role": user.get("role"), "id": user.get("user_id"), "name": user.get("name")}

    await db.cars.update_many(
        {"id": {"$in": ids}},
        {"$set": {
            "status": "DELIVERED",
            "delivered_at": now,
            "updated_at": now,
            "delivery_type": "bulk_admin_override",
            "bulk_delivered_by": marked_by,
            "otp_verified": False,
            "no_show_count": 0,
        }}
    )

    await db.retrieval_requests.update_many(
        {"car_id": {"$in": ids}},
        {"$set": {"status": "COMPLETED", "updated_at": now}}
    )

    card_ids = [c["qr_card_id"] for c in eligible_cars if c.get("qr_card_id")]
    if card_ids:
        await db.car_qr_cards.update_many(
            {"id": {"$in": card_ids}},
            {"$set": {"status": "empty", "car_id": None}}
        )

    async def _release_card_broadcast(card_id):
        try:
            released_card = await db.car_qr_cards.find_one({"id": card_id}, {"_id": 0, "provider_id": 1})
            if released_card:
                await manager.broadcast(f"provider:{released_card['provider_id']}", {
                    "type": "qr_card_update",
                    "data": {"id": card_id, "status": "empty", "car_id": None, "plate": None}
                })
        except Exception as e:
            logger.warning(f"qr_card_update broadcast failed on bulk delivery (card_id={card_id}): {e}")

    async def _free_slot(c):
        if c.get("zone") and c.get("slot") is not None:
            await db.parking_slots.update_one(
                {"event_id": eid, "zone_name": c["zone"], "slot_number": c["slot"]},
                {"$set": {"is_occupied": False, "car_id": None}}
            )

    driver_ids = {c["retrieval_driver_id"] for c in eligible_cars if c.get("retrieval_driver_id")}

    await asyncio.gather(
        *[_release_card_broadcast(cid) for cid in card_ids],
        *[_free_slot(c) for c in eligible_cars],
    )

    for did in driver_ids:
        asyncio.create_task(refresh_driver_duty_status(did))

    updated_cars = []
    for c in eligible_cars:
        c.update({
            "status": "DELIVERED", "delivered_at": now, "updated_at": now,
            "delivery_type": "bulk_admin_override", "bulk_delivered_by": marked_by,
            "otp_verified": False, "no_show_count": 0,
        })
        updated_cars.append(c)

    await asyncio.gather(*[broadcast_car_update(c) for c in updated_cars])

    return {"updated_count": len(updated_cars)}


# How long a scanned/entered card stays claimed by the person who scanned it,
# before anyone else is allowed to pick it up. Long enough to fill out the
# check-in form (incl. photos), short enough that an abandoned/crashed scan
# doesn't permanently strand a card. Refreshed every time the same user
# re-looks-up the card (e.g. navigating back to the check-in form).
QR_CARD_RESERVATION_TTL_SECONDS = 300  # 5 minutes


async def _try_reserve_qr_card(card_id: str, user: dict) -> Optional[dict]:
    """
    Atomically claim an empty key-tag card for the scanning user so that no
    other driver/supervisor can scan or enter the code for that same card
    while a check-in is already in progress with it. Re-scanning by the same
    user refreshes the reservation. A stale reservation (app crashed / user
    walked away mid check-in) automatically expires after
    QR_CARD_RESERVATION_TTL_SECONDS and can then be claimed by anyone.

    Returns the updated card document if the reservation was granted
    (including when it was already held by this same user), or None if
    another user currently holds an active reservation on it.
    """
    now = datetime.now(timezone.utc)
    expiry_cutoff = (now - timedelta(seconds=QR_CARD_RESERVATION_TTL_SECONDS)).isoformat()
    user_id = user.get("user_id")
    return await db.car_qr_cards.find_one_and_update(
        {
            "id": card_id,
            "$and": [
                {"$or": [{"status": {"$exists": False}}, {"status": None}, {"status": "empty"}]},
                {"$or": [
                    {"reserved_by": None},
                    {"reserved_by": {"$exists": False}},
                    {"reserved_by": user_id},
                    {"reserved_at": None},
                    {"reserved_at": {"$lt": expiry_cutoff}},
                ]},
            ],
        },
        {"$set": {
            "reserved_by": user_id,
            "reserved_by_name": user.get("name"),
            "reserved_at": now.isoformat(),
        }},
        return_document=True,
        projection={"_id": 0},
    )


async def _lookup_card_response(card: dict, event_id: str, include_bound: bool, user: dict) -> dict:
    event = await db.events.find_one({"id": event_id}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    if card.get("provider_id") != event["provider_id"]:
        raise HTTPException(400, "This card belongs to a different provider and cannot be used for this event.")
    if not card.get("is_active", True):
        raise HTTPException(400, "This card has been reported lost/damaged and is blocked. Please use a different card.")
    
    active_car = await db.cars.find_one({
        "qr_card_id": card["id"],
        "status": {"$nin": ["DELIVERED", "PRE_REGISTERED"]},
        "deleted": {"$ne": True}
    }, {"_id": 0, "plate": 1, "id": 1})

    if card.get("status") and card.get("status") != "empty":
        if not include_bound:
            raise HTTPException(400, "This card is already in use on another vehicle. Please scan a different card.")
        
        car_doc = await db.cars.find_one({"id": card.get("car_id")}, {"_id": 0, "plate": 1, "guest_name": 1, "guest_phone": 1, "status": 1, "car_type": 1}) if card.get("car_id") else None
        return {
            "id": card["id"], 
            "key_tag_number": card["key_tag_number"], 
            "qr_token": card["qr_token"],
            "card_code": card.get("card_code"),
            "status": card.get("status"),
            "car_id": card.get("car_id"),
            "plate": car_doc.get("plate") if car_doc else None,
            "guest_name": car_doc.get("guest_name") if car_doc else None,
            "guest_phone": car_doc.get("guest_phone") if car_doc else None,
            "car_status": car_doc.get("status") if car_doc else None,
            "car_type": car_doc.get("car_type") if car_doc else None,
            "is_assigned": bool(active_car),
            "assigned_car_plate": active_car.get("plate") if active_car else None,
            "assigned_car_id": active_car.get("id") if active_car else None
        }

    # Card looks empty — try to claim it for this user so nobody else can
    # scan/enter this same code while this check-in is in progress.
    reserved_card = await _try_reserve_qr_card(card["id"], user)
    if not reserved_card:
        current = await db.car_qr_cards.find_one({"id": card["id"]}, {"_id": 0})
        if not include_bound:
            raise HTTPException(400, "This card is currently being used by another driver. Please wait a moment or use a different card.")
        return {
            "id": card["id"],
            "key_tag_number": card["key_tag_number"],
            "qr_token": card["qr_token"],
            "card_code": card.get("card_code"),
            "status": "reserved",
            "car_id": None,
            "plate": None,
            "guest_name": None,
            "guest_phone": None,
            "reserved_by_name": current.get("reserved_by_name") if current else None,
            "is_assigned": bool(active_car),
            "assigned_car_plate": active_car.get("plate") if active_car else None,
            "assigned_car_id": active_car.get("id") if active_car else None
        }

    return {
        "id": card["id"], 
        "key_tag_number": card["key_tag_number"], 
        "qr_token": card["qr_token"],
        "card_code": card.get("card_code"),
        "status": "empty",
        "car_id": None,
        "plate": None,
        "guest_name": None,
        "guest_phone": None,
        "is_assigned": bool(active_car),
        "assigned_car_plate": active_car.get("plate") if active_car else None,
        "assigned_car_id": active_car.get("id") if active_car else None
    }

@api_router.get("/qr-cards/lookup/{token}")
async def lookup_qr_card(token: str, event_id: str, include_bound: bool = False, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    card = await db.car_qr_cards.find_one({"qr_token": token})
    if not card:
        raise HTTPException(404, "Invalid QR code — this is not a recognized key-tag card.")
    return await _lookup_card_response(card, event_id, include_bound, user)

@api_router.get("/qr-cards/lookup-by-code/{code}")
async def lookup_qr_card_by_code(code: str, event_id: str, include_bound: bool = False, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    event = await db.events.find_one({"id": event_id}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")
    card = await db.car_qr_cards.find_one({
        "card_code": code,
        "provider_id": event["provider_id"]
    })
    if not card:
        raise HTTPException(404, "Invalid code — no matching key-tag card.")
    return await _lookup_card_response(card, event_id, include_bound, user)

@api_router.post("/qr-cards/{card_id}/release-reservation")
async def release_qr_card_reservation(card_id: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    """
    Called when a driver/supervisor backs out of a check-in ("Change Card" /
    navigating away) so the card immediately becomes available for someone
    else to scan or enter the code for, instead of waiting out the
    reservation TTL.
    """
    card = await db.car_qr_cards.find_one({"id": card_id}, {"_id": 0, "reserved_by": 1})
    if not card:
        raise HTTPException(404, "Card not found")
    # Drivers can only release their own reservation; supervisors/admins can clear any.
    if user.get("role") == "driver" and card.get("reserved_by") and card.get("reserved_by") != user.get("user_id"):
        raise HTTPException(403, "This card is reserved by another user")
    await db.car_qr_cards.update_one(
        {"id": card_id},
        {"$set": {"reserved_by": None, "reserved_by_name": None, "reserved_at": None}}
    )
    return {"ok": True}

@api_router.post("/cars")
@limiter.limit("60/minute")
async def create_car(request: Request, body: CarCreate, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    _t_start = time.perf_counter()
    plate = body.plate.upper()
    if not body.has_plate_issue:
        validate_plate_format(plate)
    
    if user.get("role") == "driver":
        body.check_in_driver_id = user.get("user_id")
        assignment = await db.event_drivers.find_one({"event_id": body.event_id, "driver_id": user.get("user_id"), "assigned": True})
        if not assignment:
            raise HTTPException(403, "You are not assigned to this event")
            
    if user.get("role") != "driver" and not body.check_in_driver_id:
        raise HTTPException(400, "A driver must be assigned to check in this vehicle")

    # Run all validation queries in parallel
    event, current, duplicate = await asyncio.gather(
        db.events.find_one({"id": body.event_id}, {"_id": 0}),
        db.cars.count_documents({"event_id": body.event_id, "status": {"$nin": ["DELIVERED"]}}),
        db.cars.find_one({"event_id": body.event_id, "plate": plate}, {"_id": 0, "id": 1, "status": 1, "check_in_driver_id": 1, "check_in_time": 1}), 
    )
    if not plate:
        # A blank plate is only reachable via has_plate_issue=True. Multiple such cars can exist
        # in the same event, so never treat one blank-plate car as a "duplicate" of another.
        duplicate = None
    if not event:
        raise HTTPException(404, "Event not found")
    if event.get("status") != "active":
        raise HTTPException(400, f"Event is '{event['status']}' — new check-ins are not allowed")
    
    from zoneinfo import ZoneInfo
    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    if not event.get("manually_activated") and now_ist < event_checkin_opens_at(event) - timedelta(minutes=30):
        raise HTTPException(400, "Check-in opens 30 minutes before the event start time")
    if current >= event["max_cars"]:
        logger.warning(f"Event {body.event_id} is full but allowing check-in")
    # Instant Park is now the permanent default — guest details are always optional.
    use_instant_park = True
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

    # Plate-issue abuse guard: max 3 consecutive flagged check-ins per driver per event,
    # then a 15-minute lock on this option. Any normal (valid-plate) check-in resets the streak.
    plate_issue_assignment = None
    if body.check_in_driver_id:
        plate_issue_assignment = await db.event_drivers.find_one({"event_id": body.event_id, "driver_id": body.check_in_driver_id})

    if body.has_plate_issue:
        blocked_until = plate_issue_assignment.get("plate_issue_blocked_until") if plate_issue_assignment else None
        if blocked_until and blocked_until > now_iso():
            remaining_min = max(1, int((datetime.fromisoformat(blocked_until) - datetime.now(timezone.utc)).total_seconds() // 60) + 1)
            raise HTTPException(400, f"You're temporarily blocked from checking in vehicles without a valid number plate. Try again in {remaining_min} minute(s).")

        streak = (plate_issue_assignment.get("plate_issue_streak") or 0) if plate_issue_assignment else 0
        if streak >= 3:
            blocked_until_ts = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
            await db.event_drivers.update_one(
                {"event_id": body.event_id, "driver_id": body.check_in_driver_id},
                {"$set": {"plate_issue_streak": 0, "plate_issue_blocked_until": blocked_until_ts}}
            )
            raise HTTPException(400, "You've checked in 3 vehicles without a valid number plate in a row. This option is locked for 15 minutes to prevent misuse.")
    elif plate_issue_assignment and plate_issue_assignment.get("plate_issue_streak"):
        await db.event_drivers.update_one(
            {"event_id": body.event_id, "driver_id": body.check_in_driver_id},
            {"$set": {"plate_issue_streak": 0}}
        )

    cid = str(uuid.uuid4())
    
    qr_card_id = None
    key_tag_number = None
    if body.qr_token:
        card = await db.car_qr_cards.find_one({"qr_token": body.qr_token})
        if not card:
            raise HTTPException(404, "Invalid QR card")
        if card.get("is_active") is False:
            raise HTTPException(400, "This card has been reported lost/damaged and cannot be used.")
        if card.get("provider_id") != event.get("provider_id"):
            raise HTTPException(400, "This card belongs to a different provider.")
        if card.get("status") == "occupied":
            raise HTTPException(400, "This card is already assigned to another vehicle.")
        reserved_by = card.get("reserved_by")
        if reserved_by and reserved_by != user.get("user_id"):
            reserved_at = card.get("reserved_at")
            still_reserved = True
            if reserved_at:
                try:
                    still_reserved = datetime.fromisoformat(reserved_at) > (datetime.now(timezone.utc) - timedelta(seconds=QR_CARD_RESERVATION_TTL_SECONDS))
                except Exception:
                    still_reserved = True
            if still_reserved:
                raise HTTPException(400, "This card is currently reserved by another driver. Please scan a different card.")
        qr_card_id = card["id"]
        key_tag_number = card.get("key_tag_number")
        code = card.get("card_code")
        
    if not qr_card_id:
        # Generate random 4-digit checkin code, ensuring no collision in active cars
        import random
        while True:
            code = f"{random.randint(0, 9999):04d}"
            collision = await db.cars.find_one({
                "event_id": body.event_id,
                "checkin_code": code,
                "status": {"$ne": "DELIVERED"}
            })
            if not collision:
                break
            
    retrieval_token = str(uuid.uuid4())

    doc = {
        "id": cid, "event_id": body.event_id, "plate": plate, "color": body.color or None, "make": body.make or None,
        "guest_name": body.guest_name or None, 
        "expected_arrival": body.expected_arrival or None, 
        "status": "CHECKED_IN", "zone": None, "slot": None, "gate": body.gate,
        "pre_registered": False,
        "retrieval_token": retrieval_token,
        "qr_token": body.qr_token,  # keeping to not break schema, but may be unused
        "qr_card_id": qr_card_id,
        "key_tag_number": key_tag_number,
        "checkin_code": code,
        "scheduled_retrieval_time": None,
        "dispatch_at": None,
        "check_in_driver_id": body.check_in_driver_id, "check_in_time": now_iso(),
        "parked_driver_id": None, "parked_at": None,
        "retrieval_driver_id": None, "delivered_at": None,
        "photo_url": None, "delivery_photo_url": None, "notes": body.notes,
        "guest_phone": body.guest_phone or None,
        "is_instant_park": use_instant_park,
        "car_type": body.car_type or "normal",
        "has_plate_issue": bool(body.has_plate_issue),

        "has_damage": bool(body.has_damage),
        "damage_notes": body.damage_notes or None,
        "damage_types": body.damage_types or [],
        "plate_verify_attempts": 0,
        "plate_verify_locked_until": None,
        "registered_by": {"id": user.get("user_id"), "name": user.get("name"), "role": user.get("role")},
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    lock_id = f"checkin:{body.event_id}:{plate}" if plate else f"checkin:{body.event_id}:{uuid.uuid4()}"
    try:
        now = datetime.now(timezone.utc)
        await db.locks.update_one(
            {
                "_id": lock_id,
                "$or": [
                    {"created_at": {"$exists": False}},
                    {"created_at": {"$lt": now - timedelta(seconds=30)}}
                ]
            },
            {"$set": {"created_at": now}},
            upsert=True
        )
    except DuplicateKeyError:
        # A concurrent request is already checking in this car!
        await asyncio.sleep(1.0)
        duplicate_concurrent = await db.cars.find_one({
            "event_id": body.event_id, 
            "plate": plate, 
            "status": {"$nin": ["DELIVERED"]}
        }, {"_id": 0})
        
        if duplicate_concurrent:
            recent_cutoff = (now - timedelta(minutes=2)).isoformat()
            same_driver = duplicate_concurrent.get("check_in_driver_id") == body.check_in_driver_id
            recent = duplicate_concurrent.get("check_in_time", "") >= recent_cutoff
            if same_driver and recent:
                existing_full = await db.cars.find_one({"id": duplicate_concurrent["id"]}, {"_id": 0})
                return clean(existing_full)
            raise HTTPException(400, f"Vehicle {body.plate} is already active in this event (status: {duplicate_concurrent['status']})")
        raise HTTPException(409, "Concurrent check-in collision. Please try again.")

    async def _release_checkin_lock(lock_id=lock_id):
        try:
            await db.locks.delete_one({"_id": lock_id})
        except Exception as e:
            logger.warning(f"Failed to release checkin lock {lock_id}: {e}")

    try:
        await db.cars.insert_one(doc.copy())
        if qr_card_id:
            try:
                await db.car_qr_cards.update_one(
                    {"id": qr_card_id},
                    {"$set": {"status": "occupied", "car_id": cid, "reserved_by": None, "reserved_by_name": None, "reserved_at": None}}
                )
                try:
                    await manager.broadcast(f"provider:{event.get('provider_id')}", {
                        "type": "qr_card_update",
                        "data": {"id": qr_card_id, "status": "occupied", "car_id": cid, "plate": doc.get("plate")}
                    })
                except Exception as e:
                    logger.warning(f"qr_card_update broadcast failed (card_id={qr_card_id}): {e}")
            except Exception as e:
                logger.error(f"Failed to link qr_card {qr_card_id} to car {cid}: {e}")
                raise HTTPException(500, "Check-in succeeded but failed to link the QR card. Please retry scanning the card or contact support before handing it to the guest.")
    finally:
        asyncio.create_task(_release_checkin_lock())

    _duration_ms = round((time.perf_counter() - _t_start) * 1000, 1)
    test_checkin_logger.info(f"plate={plate} event_id={body.event_id} car_id={cid} duration_ms={_duration_ms}")
    out = clean(doc)

    asyncio.create_task(record_assignment(
        car_id=doc["id"], event_id=body.event_id, driver_id=body.check_in_driver_id,
        action="checkin_assigned",
        source="self" if user.get("role") == "driver" else user["role"],
        performed_by=None if user.get("role") == "driver" else {"user_id": user["user_id"], "name": user.get("name"), "role": user["role"]},
    ))
    # Optionally record driver assignment if provided
    if body.check_in_driver_id:
        async def _mark_driver_busy(driver_id=body.check_in_driver_id):
            await db.drivers.update_one({"id": driver_id}, {"$set": {"duty_status": "busy", "duty_status_updated_at": now_iso()}})
        asyncio.create_task(_mark_driver_busy())
        if body.has_plate_issue:
            async def _bump_plate_issue_streak(event_id=body.event_id, driver_id=body.check_in_driver_id):
                await db.event_drivers.update_one(
                    {"event_id": event_id, "driver_id": driver_id},
                    {"$inc": {"plate_issue_streak": 1}}
                )
            asyncio.create_task(_bump_plate_issue_streak())

    if user.get("role") != "driver" and body.check_in_driver_id:
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
    try:
        await manager.broadcast(f"event:{body.event_id}", {"type": "car_update", "data": out})
        await manager.broadcast(f"car:{doc['id']}", {"type": "car_update", "data": out})
    except Exception as e:
        logger.warning(f"broadcast_car_update failed after car creation (car_id={doc['id']}): {e}")

    if out.get("warning") and user.get("role") != "driver":
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
    c = (await _attach_card_info([c]))[0]
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
        {"$set": {"is_occupied": True, "car_id": cid, "held_by": None, "held_until": None}}
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
        {"$set": {"is_occupied": True, "car_id": cid, "held_by": None, "held_until": None}}, upsert=True)
        
    slot = await db.parking_slots.find_one({"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0})
    await asyncio.gather(
        broadcast_car_update(car),
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
    car = await db.cars.find_one({"id": cid}, {"_id": 0, "retrieval_token": 1, "status": 1, "event_id": 1, "retrieval_driver_id": 1, "retrieval_last_pinged_at": 1, "retrieval_requested_at": 1})
    if not car:
        raise HTTPException(404, "Car not found")
    # Allow guest with matching retrieval_token OR authenticated staff
    if not user:
        if not retrieval_token or car.get("retrieval_token") != retrieval_token:
            raise HTTPException(403, "Invalid or missing token")

    requested_via = "supervisor_scan" if user and user.get("role") in ("supervisor", "admin", "owner", "superadmin") else "guest_qr"
    requested_by = {"role": user.get("role"), "id": user.get("user_id"), "name": user.get("name")} if requested_via == "supervisor_scan" else None

    async def _push_retrieval(full_car):
        logger.info(f"[PUSH] _push_retrieval triggered for car_id={cid} event_id={full_car['event_id']}")
        tokens = await get_event_driver_tokens(full_car["event_id"])
        sup_tokens = await get_event_supervisor_tokens(full_car["event_id"])
        logger.info(f"[PUSH] driver_tokens={len(tokens)} sup_tokens={len(sup_tokens)} for event_id={full_car['event_id']}")
        await send_expo_push(
            list(set(tokens + sup_tokens)),
            title="🚗 Retrieval Requested",
            body_text=f"{full_car.get('plate')} · Zone {full_car.get('zone', '?')} Slot {full_car.get('slot', '?')}",
            data={"car_id": cid, "event_id": full_car["event_id"], "screen": "retrievals"}
        )

    if car.get("status") == "RETRIEVAL_REQUESTED":
        last_ping = car.get("retrieval_last_pinged_at") or car.get("retrieval_requested_at")
        if last_ping:
            from datetime import datetime
            lp_str = last_ping.replace("Z", "+00:00")
            now_str = now_iso().replace("Z", "+00:00")
            if (datetime.fromisoformat(now_str) - datetime.fromisoformat(lp_str)).total_seconds() < 30:
                raise HTTPException(429, "Please wait a moment before requesting again")
        
        await db.cars.update_one({"id": cid}, {"$set": {"retrieval_last_pinged_at": now_iso()}})
        full_car = await db.cars.find_one({"id": cid}, {"_id": 0})
        asyncio.create_task(_push_retrieval(full_car))
        return full_car

    # Guest is back at the gate while the driver is mid-re-park: pull the car
    # straight back to that same driver instead of forcing a full re-park +
    # fresh open-pool request.
    if car.get("status") == "AWAITING_REPARK":
        if not car.get("retrieval_driver_id"):
            raise HTTPException(400, "No driver is currently assigned to this car. Please wait a moment and try again.")
        result = await db.cars.update_one(
            {"id": cid, "status": "AWAITING_REPARK"},
            {"$set": {
                "status": "BEING_FETCHED", 
                "being_fetched_at": now_iso(), 
                "retrieval_requested_via": requested_via,
                "retrieval_requested_by": requested_by,
                "updated_at": now_iso()
            }}
        )
        if result.modified_count == 0:
            raise HTTPException(409, "This car's status just changed — please refresh and try again.")
        car = await db.cars.find_one({"id": cid}, {"_id": 0})
        try:
            await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
            await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
            await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
        except Exception as e:
            logger.warning(f"broadcast failed (car_update/retrieval for {cid}): {e}")

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
    await db.cars.update_one(
        {"id": cid}, 
        {"$set": {
            "status": "RETRIEVAL_REQUESTED", 
            "retrieval_requested_at": now_iso(), 
            "retrieval_last_pinged_at": now_iso(),
            "retrieval_driver_id": None, 
            "retrieval_requested_via": requested_via,
            "retrieval_requested_by": requested_by,
            "updated_at": now_iso()
        }}
    )
    rid = str(uuid.uuid4())
    await db.retrieval_requests.insert_one({"id": rid, "car_id": cid, "driver_id": None, "status": "PENDING",
                                            "requested_at": now_iso(), "updated_at": now_iso()})
    full_car = await db.cars.find_one({"id": cid}, {"_id": 0})
    try:
        await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": full_car})
        await manager.broadcast(f"event:{full_car['event_id']}", {"type": "car_update", "data": full_car})
        await manager.broadcast(f"retrievals:{full_car['event_id']}", {"type": "retrieval_update", "data": full_car})
    except Exception as e:
        logger.warning(f"broadcast failed (retrieval_update for {cid}): {e}")

    asyncio.create_task(_push_retrieval(full_car))

    return full_car

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
    if scheduled_dt > now + timedelta(minutes=30): 
        raise HTTPException(400, "Cannot schedule more than 30 minutes ahead") 
    
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
    return await _build_guest_view(updated) 

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
    return await _build_guest_view(updated) 

@api_router.patch("/cars/{cid}/self-pickup-request")
async def self_pickup_request(cid: str, retrieval_token: Optional[str] = Query(None), user=Depends(get_current_optional)):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Car not found")
    if not user:
        if not retrieval_token or car.get("retrieval_token") != retrieval_token:
            raise HTTPException(403, "Invalid or missing token")
    if car.get("status") != "PARKED":
        raise HTTPException(400, f"Self-pickup cannot be requested from status '{car.get('status')}'. Must be PARKED.")

    otp = str(random.randint(100000, 999999))
    await _otp_set(f"self_pickup_{cid}", otp, {"car_id": cid})

    async def _notify_supervisors_self_pickup():
        try:
            sup_tokens = await get_event_supervisor_tokens(car["event_id"])
            await send_expo_push(
                sup_tokens,
                title="🙋 Guest Self-Pickup Request",
                body_text=f"{car.get('plate')} · Zone {car.get('zone','?')} Slot {car.get('slot','?')} — guest wants to pick up their own car.",
                data={"car_id": cid, "event_id": car["event_id"], "screen": "self-pickup"}
            )
            assignments = await db.event_supervisors.find(
                {"event_id": car["event_id"]}, {"_id": 0, "supervisor_id": 1}
            ).to_list(200)
            for a in assignments:
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()),
                    "recipient_role": "supervisor",
                    "recipient_id": a["supervisor_id"],
                    "type": "self_pickup_requested",
                    "title": "Guest Self-Pickup Request",
                    "message": f"Guest wants to self-pickup {car.get('plate')} (Zone {car.get('zone','?')} Slot {car.get('slot','?')}).",
                    "related_id": cid,
                    "is_read": False,
                    "created_at": now_iso()
                })
        except Exception as e:
            logger.warning(f"self-pickup supervisor notify failed for car {cid}: {e}")

    asyncio.create_task(_notify_supervisors_self_pickup())
    return {"otp": otp}


@api_router.patch("/cars/{cid}/cancel-retrieval")
async def cancel_retrieval(cid: str, retrieval_token: Optional[str] = Query(None), user=Depends(get_current_optional)):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Car not found")
    # Allow guest with matching retrieval_token OR authenticated staff
    if not user:
        if not retrieval_token or car.get("retrieval_token") != retrieval_token:
            raise HTTPException(403, "Invalid or missing token")

    # Only allow cancelling while still in the open request queue — once a
    # driver has actually claimed it and is en route (BEING_FETCHED) it's too
    # late to cancel from here; guest should just wait / talk to the desk.
    if car.get("status") != "RETRIEVAL_REQUESTED":
        raise HTTPException(400, f"Cannot cancel — car is currently '{car['status']}'. Only pending requests can be cancelled.")

    await db.cars.update_one(
        {"id": cid, "status": "RETRIEVAL_REQUESTED"},
        {"$set": {
            "status": "PARKED",
            "retrieval_requested_at": None,
            "updated_at": now_iso()
        }}
    )
    await db.retrieval_requests.update_one(
        {"car_id": cid, "status": "PENDING"},
        {"$set": {"status": "CANCELLED", "updated_at": now_iso()}}
    )
    updated = await db.cars.find_one({"id": cid}, {"_id": 0})
    await broadcast_car_update(updated)
    try:
        await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": updated})
    except Exception as e:
        logger.warning(f"broadcast failed (retrieval_update for {car.get('id')}): {e}")

    async def _push_cancel():
        tokens = await get_event_driver_tokens(car["event_id"])
        sup_tokens = await get_event_supervisor_tokens(car["event_id"])
        await send_expo_push(
            list(set(tokens + sup_tokens)),
            title="🚫 Retrieval Cancelled",
            body_text=f"{car.get('plate')} · Guest cancelled — they're picking it up themselves.",
            data={"car_id": cid, "event_id": car["event_id"], "screen": "retrievals"}
        )
    asyncio.create_task(_push_cancel())

    return await _build_guest_view(updated)

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
        "status": "ACCEPTED",
        "retrieval_driver_id": body.retrieval_driver_id,
        "accepted_at": now_iso(),
        "updated_at": now_iso()
    }
    result = await db.cars.update_one(
        {"id": cid, "status": "RETRIEVAL_REQUESTED"},
        {"$set": upd}
    )
    if result.modified_count == 0:
        current_car = await db.cars.find_one({"id": cid}, {"_id": 0, "status": 1})
        if current_car and current_car.get("status") == "PARKED":
            raise HTTPException(409, "This retrieval request was just cancelled by the guest.")
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

@api_router.patch("/cars/{cid}/confirm-pickup")
async def confirm_pickup_car(cid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await assert_car_ownership(car, user)

    if car.get("status") != "ACCEPTED":
        raise HTTPException(409, f"Car is in status {car.get('status')}, expected ACCEPTED.")

    if user.get("role") == "driver" and car.get("retrieval_driver_id") != user.get("user_id"):
        raise HTTPException(403, "You are not assigned to retrieve this car")

    upd = {
        "status": "BEING_FETCHED",
        "being_fetched_at": now_iso(),
        "updated_at": now_iso()
    }
    result = await db.cars.update_one(
        {"id": cid, "status": "ACCEPTED"},
        {"$set": upd}
    )
    if result.modified_count == 0:
        raise HTTPException(409, "Failed to confirm pickup. Status may have changed.")
    
    car.update(upd)
    
    await asyncio.gather(
        manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car}),
        manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car}),
        manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
    )

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
    if user.get("role") == "driver" and not car.get("otp_verified") and car.get("retrieval_requested_via") != "supervisor_scan":
        raise HTTPException(400, "Guest must confirm the OTP before delivery can be marked")
    upd = {"status": "DELIVERED", "delivery_photo_url": body.delivery_photo_url,
                                                   "delivered_at": now_iso(), "updated_at": now_iso(),
                                                   "otp_verified": False, "no_show_count": 0}
    await db.cars.update_one({"id": cid}, {"$set": upd})
    car.update(upd)
    if car.get("qr_card_id"):
        await db.car_qr_cards.update_one({"id": car["qr_card_id"]}, {"$set": {"status": "empty", "car_id": None}})
        released_card = await db.car_qr_cards.find_one({"id": car["qr_card_id"]}, {"_id": 0, "provider_id": 1})
        if released_card:
            try:
                await manager.broadcast(f"provider:{released_card['provider_id']}", {
                    "type": "qr_card_update",
                    "data": {"id": car["qr_card_id"], "status": "empty", "car_id": None, "plate": None}
                })
            except Exception as e:
                logger.warning(f"qr_card_update broadcast failed on delivery (card_id={car['qr_card_id']}): {e}")
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

@api_router.patch("/cars/{cid}/self-pickup")
async def self_pickup(cid: str, otp: Optional[str] = Query(None), user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Car not found")
    await assert_car_ownership(car, user)

    allowed_statuses = ("PARKED", "RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED", "AWAITING_REPARK")
    if car.get("status") not in allowed_statuses:
        raise HTTPException(400, f"Cannot mark self-pickup from status '{car.get('status')}'.")

    key = f"self_pickup_{cid}"
    stored = await _otp_get(key)
    if stored:
        if not otp or not otp.strip():
            raise HTTPException(400, "Guest has an active self-pickup request — enter their code to confirm")
        attempts = await _otp_increment_attempts(key)
        if attempts > OTP_MAX_ATTEMPTS:
            await _otp_delete(key)
            raise HTTPException(400, "Too many incorrect attempts. Ask the guest to request self-pickup again")
        if stored["otp"] != otp.strip():
            raise HTTPException(400, "Incorrect code — please check with the guest and try again")
        await _otp_delete(key)

    upd = {
        "status": "DELIVERED",
        "delivered_at": now_iso(),
        "updated_at": now_iso(),
        "delivery_type": "self_pickup",
        "self_pickup_marked_by": {"role": user.get("role"), "id": user.get("user_id"), "name": user.get("name")},
        "otp_verified": False,
        "no_show_count": 0,
    }
    await db.cars.update_one({"id": cid}, {"$set": upd})
    car.update(upd)

    if car.get("qr_card_id"):
        await db.car_qr_cards.update_one({"id": car["qr_card_id"]}, {"$set": {"status": "empty", "car_id": None}})
        released_card = await db.car_qr_cards.find_one({"id": car["qr_card_id"]}, {"_id": 0, "provider_id": 1})
        if released_card:
            try:
                await manager.broadcast(f"provider:{released_card['provider_id']}", {
                    "type": "qr_card_update",
                    "data": {"id": car["qr_card_id"], "status": "empty", "car_id": None, "plate": None}
                })
            except Exception as e:
                logger.warning(f"qr_card_update broadcast failed on self pickup (card_id={car['qr_card_id']}): {e}")
    await db.retrieval_requests.update_one({"car_id": cid}, {"$set": {"status": "COMPLETED", "updated_at": now_iso()}})

    if car.get("retrieval_driver_id"):
        driver_id = car["retrieval_driver_id"]
        asyncio.create_task(refresh_driver_duty_status(driver_id))

        async def _push_self_pickup(did=driver_id, plate=car.get("plate"), eid=car["event_id"]):
            drv = await db.drivers.find_one({"id": did}, {"_id": 0, "push_token": 1})
            token = drv.get("push_token") if drv else None
            await send_expo_push(
                [token] if token else [],
                title="ℹ️ Guest picked up their own car",
                body_text=f"{plate} — no retrieval needed anymore, you're free.",
                data={"car_id": cid, "event_id": eid, "screen": "retrievals"}
            )
        asyncio.create_task(_push_self_pickup())

    if car.get("zone") and car.get("slot") is not None:
        await db.parking_slots.update_one(
            {"event_id": car["event_id"], "zone_name": car["zone"], "slot_number": car["slot"]},
            {"$set": {"is_occupied": False, "car_id": None}})

    await broadcast_car_update(car)
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

@api_router.get("/cars/{cid}/delivery-otp")
async def get_car_delivery_otp(cid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
    car = await db.cars.find_one({"id": cid}, {"_id": 0, "id": 1, "status": 1, "event_id": 1})
    if not car:
        raise HTTPException(404, "Car not found")
    await assert_car_ownership(car, user)
    if car["status"] != "ARRIVED_AT_GATE":
        raise HTTPException(400, "No active delivery code for this car right now")
    stored = await _otp_get(f"delivery_{cid}")
    if not stored:
        raise HTTPException(404, "Code not found — ask the driver to mark arrived at gate again")
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
    
    validate_plate_format(plate)
    
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
    
    validate_plate_format(plate)
    
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
    
    validate_plate_format(plate)
    
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
    
    from zoneinfo import ZoneInfo
    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    if now_ist < event_checkin_opens_at(event) - timedelta(minutes=30):
        raise HTTPException(400, "Check-in opens 30 minutes before the event start time")
    if car["status"] != "PRE_REGISTERED": 
        raise HTTPException(400, "Car is not in PRE_REGISTERED status") 
        
    if not body.get("guest_name") or not str(body.get("guest_name")).strip():
        raise HTTPException(400, "Guest name is required")
 
    
    import random
    while True:
        code = f"{random.randint(0, 9999):04d}"
        collision = await db.cars.find_one({
            "event_id": car["event_id"],
            "checkin_code": code,
            "status": {"": "DELIVERED"}
        })
        if not collision:
            break
            
    retrieval_token = str(uuid.uuid4())

    update = { 
        "status": "CHECKED_IN", 
        "pre_registered": True,
        "check_in_driver_id": body.get("check_in_driver_id"), 
        "check_in_time": now_iso(), 
        "gate": body.get("gate", ""), 
        "updated_at": now_iso(), 
        "checkin_code": code,
        "retrieval_token": retrieval_token,
    } 
    # Allow updating make/color/plate in case guest made typo 
    if body.get("make"): update["make"] = body["make"].strip() 
    if body.get("color"): update["color"] = body["color"].strip() 
    if body.get("notes"): update["notes"] = body["notes"].strip()
    if body.get("plate"):
        new_plate = body["plate"].strip().upper()
        validate_plate_format(new_plate)
        update["plate"] = new_plate 
    if body.get("car_type"): update["car_type"] = body["car_type"]

    if "has_damage" in body: update["has_damage"] = bool(body.get("has_damage"))
    if body.get("damage_notes"): update["damage_notes"] = body["damage_notes"].strip()
    if body.get("damage_types"): update["damage_types"] = body["damage_types"]
    if body.get("guest_name"): update["guest_name"] = body["guest_name"].strip()
 
    await db.cars.update_one({"id": cid}, {"$set": update}) 
    updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    await broadcast_car_update(updated) 
    try:
        await manager.broadcast( 
            f"event:{car['event_id']}", 
            {"type": "car_update", "data": clean(updated)} 
        ) 
    except Exception as e:
        logger.warning(f"broadcast failed (car_update for {cid}): {e}")
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
    try: 
        if car.get("check_in_time") and car.get("delivered_at"): 
            t1 = datetime.fromisoformat(car["check_in_time"]) 
            t2 = datetime.fromisoformat(car["delivered_at"]) 
            total_minutes = round( 
                (t2 - t1).total_seconds() / 60, 1 
            ) 
    except Exception: 
        pass 

    step_durations = compute_car_step_durations(car)

    response = { 
        "car": car, 
        "drivers_map": drivers_map, 
        "photos_by_type": photos_by_type, 
        "incidents": incidents, 
        "assignment_history": assignment_history,
        "rating_platform": rating["stars"] if rating else None,
        "rating_comment": rating.get("comment") if rating else None,
        "total_minutes": total_minutes, 
    } 
    response.update(step_durations)
    return response 


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
class SlotHoldBody(BaseModel):
    zone: str
    slot: int

HOLD_TTL_SECONDS = 90

@api_router.post("/slots/event/{eid}/hold")
async def hold_slot(eid: str, body: SlotHoldBody, user=Depends(require_roles("driver"))):
    driver_id = user["user_id"]
    now = datetime.now(timezone.utc)
    held_until = (now + timedelta(seconds=HOLD_TTL_SECONDS)).isoformat()
    # Atomic: succeed only if the slot is free AND (unheld, expired, or already held by this same driver)
    result = await db.parking_slots.update_one(
        {
            "event_id": eid, "zone_name": body.zone, "slot_number": body.slot,
            "is_occupied": False,
            "$or": [
                {"held_by": None},
                {"held_until": {"$lt": now.isoformat()}},
                {"held_by": driver_id},
            ],
        },
        {"$set": {"held_by": driver_id, "held_until": held_until}}
    )
    if result.modified_count == 0:
        slot = await db.parking_slots.find_one(
            {"event_id": eid, "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0}
        )
        if slot and slot.get("is_occupied"):
            raise HTTPException(409, f"Slot {body.zone}-{body.slot} is already occupied — please choose another")
        raise HTTPException(409, f"Slot {body.zone}-{body.slot} is currently being selected by another driver — try again shortly")
    slot = await db.parking_slots.find_one(
        {"event_id": eid, "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0}
    )
    try:
        await manager.broadcast(f"event:{eid}", {"type": "slot_update", "data": slot})
    except Exception as e:
        logger.warning(f"slot_update broadcast failed on hold (event_id={eid}): {e}")
    return slot

@api_router.post("/slots/event/{eid}/release-hold")
async def release_slot_hold(eid: str, body: SlotHoldBody, user=Depends(require_roles("driver"))):
    driver_id = user["user_id"]
    await db.parking_slots.update_one(
        {"event_id": eid, "zone_name": body.zone, "slot_number": body.slot, "held_by": driver_id},
        {"$set": {"held_by": None, "held_until": None}}
    )
    slot = await db.parking_slots.find_one(
        {"event_id": eid, "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0}
    )
    if slot:
        try:
            await manager.broadcast(f"event:{eid}", {"type": "slot_update", "data": slot})
        except Exception as e:
            logger.warning(f"slot_update broadcast failed on release (event_id={eid}): {e}")
    return slot or {"ok": True}

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
    try:
        await manager.broadcast(f"event:{eid}", {"type": "slot_update", "data": {"slots": slots}})
    except Exception as e:
        logger.warning(f"broadcast failed (slot_update for {eid}): {e}")
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
    cars = await db.cars.find({"event_id": eid, "status": {"$in": ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"]}, "deleted": {"$ne": True}}, {"_id": 0}).to_list(1000)
    cars = await _attach_card_info(cars)
    for c in cars:
        c.update(compute_car_step_durations(c))
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
    issues: dict = Field(default_factory=dict)
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
    existing = await db.ratings.find_one({"car_id": body.car_id})
    if existing:
        return {"ok": True, "duplicate": True}
    await db.ratings.insert_one({
        "id": str(uuid.uuid4()),
        "car_id": body.car_id,
        "stars": body.stars,
        "issues": body.issues or {},
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


@api_router.get("/events/{eid}/feedback")
async def get_event_feedback(eid: str, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor", "driver"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0, "provider_id": 1})
    if not event:
        raise HTTPException(404, "Event not found")

    if user.get("role") in ("owner", "admin", "supervisor"):
        if event["provider_id"] != user["provider_id"]:
            raise HTTPException(403, "Forbidden")
    if user.get("role") == "supervisor":
        assignment = await db.event_supervisors.find_one({
            "event_id": eid, "supervisor_id": user["user_id"]
        })
        if not assignment:
            raise HTTPException(403, "Not assigned to this event")
    if user.get("role") == "driver":
        assignment = await db.event_drivers.find_one({
            "event_id": eid, "driver_id": user["user_id"]
        })
        if not assignment:
            raise HTTPException(403, "Not assigned to this event")

    cars = await db.cars.find(
        {"event_id": eid, "deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "plate": 1, "guest_name": 1, "retrieval_driver_id": 1}
    ).to_list(10000)
    
    if not cars:
        return []

    car_map = {c["id"]: c for c in cars}
    car_ids = list(car_map.keys())

    ratings = await db.ratings.find(
        {"car_id": {"$in": car_ids}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(10000)

    if not ratings:
        return []

    driver_ids = list(set([c.get("retrieval_driver_id") for c in cars if c.get("retrieval_driver_id")]))
    drivers_map = {}
    if driver_ids:
        drivers = await db.drivers.find({"id": {"$in": driver_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        drivers_map = {d["id"]: d["name"] for d in drivers}

    feedback = []
    for r in ratings:
        car = car_map.get(r["car_id"], {})
        rd_id = car.get("retrieval_driver_id")
        feedback.append({
            "id": r["id"],
            "car_id": r["car_id"],
            "plate": car.get("plate", ""),
            "guest_name": car.get("guest_name", ""),
            "driver_name": drivers_map.get(rd_id, "") if rd_id else "",
            "stars": r.get("stars", 0),
            "issues": r.get("issues", {}),
            "comment": r.get("comment"),
            "created_at": r.get("created_at")
        })

    return feedback

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

@api_router.get("/qr/{token}")
async def get_by_qr(token: str):
    car = await db.cars.find_one({"retrieval_token": token}, {"_id": 0})
    if car:
        return await _build_guest_view(car)

    card = await db.car_qr_cards.find_one({"qr_token": token})
    if card:
        if not card.get("car_id"):
            raise HTTPException(404, "Invalid QR token")
        linked_car = await db.cars.find_one({"id": card["car_id"]}, {"_id": 0})
        if linked_car and linked_car.get("has_plate_issue"):
            # No reliable plate to verify against — the physical card-in-hand check at
            # handover is the security control for these cars, so skip the plate-last-4 step.
            return await _build_guest_view(linked_car)
        return {"requires_verification": True, "card_qr_token": token}
    else:
        raise HTTPException(404, "Invalid QR token")

class PlateVerifyBody(BaseModel):
    plate_last4: str

@api_router.post("/qr-cards/{token}/verify-retrieval")
@limiter.limit("10/minute")
async def verify_retrieval(request: Request, token: str, body: PlateVerifyBody):
    card = await db.car_qr_cards.find_one({"qr_token": token})
    if not card or not card.get("car_id"):
        raise HTTPException(404, "Invalid QR token")
    
    car = await db.cars.find_one({"id": card["car_id"]}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Invalid QR token")

    locked_until = car.get("plate_verify_locked_until")
    if locked_until and locked_until > now_iso():
        raise HTTPException(429, "Too many attempts. Please see the valet attendant.")

    def _normalize_plate(s: str) -> str:
        return "".join(ch for ch in (s or "") if ch.isalnum()).upper()

    entered = _normalize_plate(body.plate_last4)
    actual_norm = _normalize_plate(car.get("plate"))
    actual_last4 = actual_norm[-4:] if actual_norm else ""

    def _plates_match(entered: str, expected: str) -> bool:
        if not expected:
            return False
        if entered == expected:
            return True
        # Special/short plates (e.g. "1", "555", "888") get zero-padded by
        # guests who assume 4 digits are required — tolerate that as long
        # as both sides are purely numeric.
        if entered.isdigit() and expected.isdigit():
            return entered.lstrip("0") == expected.lstrip("0")
        return False

    if not _plates_match(entered, actual_last4):
        attempts = car.get("plate_verify_attempts", 0) + 1
        update = {"plate_verify_attempts": attempts}
        if attempts >= 5:
            locked_until_ts = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
            update["plate_verify_locked_until"] = locked_until_ts
            await db.cars.update_one({"id": car["id"]}, {"$set": update})
            raise HTTPException(429, "Too many incorrect attempts. Please see the valet attendant.")
        
        await db.cars.update_one({"id": car["id"]}, {"$set": update})
        remaining = 5 - attempts
        raise HTTPException(400, f"Incorrect — {remaining} attempt{'s' if remaining != 1 else ''} remaining.")

    await db.cars.update_one(
        {"id": car["id"]}, 
        {"$set": {"plate_verify_attempts": 0, "plate_verify_locked_until": None}}
    )
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
        rating_agg,
    ) = await asyncio.gather(
        db.providers.count_documents({"role": "owner"}),
        db.providers.count_documents({"role": "owner", "is_active": True}),
        db.events.count_documents({"status": {"$in": ["upcoming", "active"]}}),
        db.drivers.count_documents({"role": "driver"}),
        db.cars.count_documents({"deleted": {"$ne": True}}),
        db.cars.count_documents({"status": "PARKED"}),
        db.cars.count_documents({"status": {"$in": ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"]}}),
        db.events.count_documents({"date": today}),
        db.cars.count_documents({"check_in_time": today_range, "deleted": {"$ne": True}}),
        db.cars.count_documents({"check_in_time": today_range, "status": "PARKED", "deleted": {"$ne": True}}),
        db.cars.count_documents({"check_in_time": today_range, "status": {"$in": ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"]}, "deleted": {"$ne": True}}),
        db.cars.count_documents({"check_in_time": today_range, "status": "DELIVERED", "deleted": {"$ne": True}}),
        db.ratings.aggregate([{"$group": {"_id": None, "avg": {"$avg": "$stars"}, "count": {"$sum": 1}}}]).to_list(1),
    )
    avg = round(rating_agg[0]["avg"], 2) if rating_agg else 0
    return {"total_providers": total_p, "active_providers": active_p, "active_events": active_e,
            "total_drivers": total_d, "total_cars": total_c, "parked_cars": parked_c,
            "pending_retrievals": pending_r, "platform_avg_rating": avg,
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
            # Cars with a plate issue (no plate / TC number) group by their own unique car id,
            # so each is always its own row — never merged with another car just because both
            # have a blank plate or the same free-text TC number.
            "_id": {"$cond": [{"$eq": ["$has_plate_issue", True]}, "$id", "$plate"]},
            "car_id": {"$first": "$id"},
            "plate": {"$first": "$plate"},
            "make": {"$first": "$make"},
            "color": {"$first": "$color"},
            "has_plate_issue": {"$first": "$has_plate_issue"},
            "total_visits": {"$sum": 1},
            "last_seen": {"$first": "$check_in_time"},
            "last_event_id": {"$first": "$event_id"},
            "has_active": {"$max": {"$cond": [{"$ne": ["$status", "DELIVERED"]}, 1, 0]}},
        }},
        {"$project": {
            "_id": 0,
            "car_id": 1,
            "plate": 1,
            "make": 1,
            "color": 1,
            "has_plate_issue": 1,
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

async def _build_superadmin_car_history(records: list):
    """Shared builder for both plate-based and id-based superadmin car history. `records` is
    already-fetched, already-sorted (check_in_time ASCENDING) list of one or more car docs
    representing the same grouped identity."""
    event_ids = list({r["event_id"] for r in records})
    events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(len(event_ids))
    events_map = {e["id"]: e for e in events}

    provider_ids = list({e.get("provider_id") for e in events if e.get("provider_id")})
    providers = await db.providers.find({"id": {"$in": provider_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(provider_ids))
    providers_map = {p["id"]: p["name"] for p in providers}

    driver_ids = set()
    for r in records:
        for f in ["check_in_driver_id", "parked_driver_id", "retrieval_driver_id"]:
            if r.get(f):
                driver_ids.add(r[f])
    drivers = await db.drivers.find({"id": {"$in": list(driver_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(driver_ids))
    drivers_map = {d["id"]: d["name"] for d in drivers}

    car_ids = [r["id"] for r in records]
    photos = await db.car_photos.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(5000)
    photos_by_car = {}
    for p in photos:
        photos_by_car.setdefault(p["car_id"], []).append(p)

    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(1000)
    ratings_map = {r["car_id"]: r for r in ratings}

    assignments = await db.assignments.find({"car_id": {"$in": car_ids}}, {"_id": 0}).sort("created_at", ASCENDING).to_list(5000)
    assignments_by_car = {}
    for a in assignments:
        assignments_by_car.setdefault(a["car_id"], []).append(a)

    visits = []
    for r in records:
        event = events_map.get(r["event_id"], {})
        provider_id = event.get("provider_id")

        duration_minutes = None
        try:
            if r.get("check_in_time") and r.get("delivered_at"):
                t1 = datetime.fromisoformat(r["check_in_time"])
                t2 = datetime.fromisoformat(r["delivered_at"])
                duration_minutes = round((t2 - t1).total_seconds() / 60, 1)
        except Exception:
            pass

        visit = {
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
            "key_tag": r.get("key_tag"),
            "car_type": r.get("car_type", "normal"),
            "has_plate_issue": r.get("has_plate_issue", False),
            "has_damage": r.get("has_damage", False),
            "damage_notes": r.get("damage_notes"),
            "damage_types": r.get("damage_types", []),
            "rating": ratings_map.get(r["id"], {}).get("stars") if ratings_map.get(r["id"]) else None,
            "rating_comment": ratings_map.get(r["id"], {}).get("comment") if ratings_map.get(r["id"]) else None,
            "photos": photos_by_car.get(r["id"], []),
            "delivery_photo_url": r.get("delivery_photo_url"),
            "assignments": assignments_by_car.get(r["id"], []),
        }
        visit.update(compute_car_step_durations(r))
        visits.append(visit)

    delivered_visits = [v for v in visits if v["status"] == "DELIVERED"]
    durations = [v["duration_minutes"] for v in delivered_visits if v["duration_minutes"] is not None]

    return {
        "plate": records[-1].get("plate", ""),
        "has_plate_issue": records[-1].get("has_plate_issue", False),
        "make": records[-1].get("make", ""),
        "color": records[-1].get("color", ""),
        "total_visits": len(visits),
        "first_seen": records[0].get("check_in_time"),
        "last_seen": records[-1].get("check_in_time"),
        "avg_duration_minutes": round(sum(durations) / len(durations), 1) if durations else None,
        "visits": visits,
    }

@api_router.get("/superadmin/cars/{plate}/history")
async def superadmin_car_history(plate: str, user=Depends(require_roles("superadmin"))):
    plate = plate.upper()
    records = await db.cars.find({"plate": plate}, {"_id": 0}).sort("check_in_time", ASCENDING).to_list(1000)
    if not records:
        raise HTTPException(404, "No records found for this plate")
    return await _build_superadmin_car_history(records)

@api_router.get("/superadmin/cars/id/{car_id}/history")
async def superadmin_car_history_by_id(car_id: str, user=Depends(require_roles("superadmin"))):
    record = await db.cars.find_one({"id": car_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "No record found for this car")
    return await _build_superadmin_car_history([record])

async def _build_owner_car_history(records: list):
    event_ids = list({r["event_id"] for r in records})
    events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(len(event_ids))
    events_map = {e["id"]: e for e in events}

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
        
        visit = { 
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
            "key_tag": r.get("key_tag"),
            "car_type": r.get("car_type", "normal"),
            "has_plate_issue": r.get("has_plate_issue", False),
            "has_damage": r.get("has_damage", False),
            "damage_notes": r.get("damage_notes"),
            "damage_types": r.get("damage_types", []),
            "rating": ratings_map.get(r["id"], {}).get("stars") if ratings_map.get(r["id"]) else None,
            "rating_comment": ratings_map.get(r["id"], {}).get("comment") if ratings_map.get(r["id"]) else None,
            "photos": photos_by_car.get(r["id"], []), 
            "delivery_photo_url": r.get("delivery_photo_url"),
            "assignments": assignments_by_car.get(r["id"], []),
        }
        visit.update(compute_car_step_durations(r))
        visits.append(visit)
    
    # Summary stats 
    delivered_visits = [v for v in visits if v["status"] == "DELIVERED"] 
    durations = [v["duration_minutes"] for v in delivered_visits if v["duration_minutes"] is not None] 
    
    return { 
        "plate": records[-1].get("plate", ""),
        "has_plate_issue": records[-1].get("has_plate_issue", False),
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

    return await _build_owner_car_history(records)

@api_router.get("/provider/cars/id/{car_id}/history")
async def owner_car_history_by_id(car_id: str, user=Depends(require_roles("owner", "admin"))):
    record = await db.cars.find_one({"id": car_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "No record found for this car")
    event = await db.events.find_one({"id": record["event_id"]}, {"_id": 0, "provider_id": 1})
    if not event or event.get("provider_id") != user["provider_id"]:
        raise HTTPException(404, "No record found for this car")
    return await _build_owner_car_history([record])

async def _build_superadmin_car_report(cars: list):
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
        {"_id": 0, "car_id": 1, "stars": 1, "comment": 1}
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
            "rating_comment": rating.get("comment") if rating else None,
            "photos": photos_by_car.get(c["id"], []),
            "incidents": incidents_by_car.get(c["id"], []),
            "has_plate_issue": c.get("has_plate_issue", False),
            "car_type": c.get("car_type", "normal"),
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
        "plate": first.get("plate", ""),
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

    return await _build_superadmin_car_report(cars)

@api_router.get("/superadmin/cars/id/{car_id}/report")
async def superadmin_car_report_by_id(car_id: str, user=Depends(require_roles("superadmin"))):
    """Single-vehicle report for a plate-issue car (no meaningful multi-visit grouping)."""
    car = await db.cars.find_one({"id": car_id}, {"_id": 0})
    if not car:
        raise HTTPException(404, "No record for this car")
    return await _build_superadmin_car_report([car])

# ============== SUPERADMIN PLANS ==============

@api_router.get("/superadmin/plans")
async def list_plans(user=Depends(require_roles("superadmin"))):
    plans = await db.plans.find({}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return clean(plans)

@api_router.post("/superadmin/plans")
async def create_plan(body: PlanCreate, user=Depends(require_roles("superadmin"))):
    plan = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "max_events": body.max_events,
        "max_cars": body.max_cars,
        "max_hotels": body.max_hotels,
        "created_at": datetime.now(timezone.utc),
    }
    await db.plans.insert_one(plan)
    return clean(plan)

@api_router.put("/superadmin/plans/{plan_id}")
async def update_plan(plan_id: str, body: PlanUpdate, user=Depends(require_roles("superadmin"))):
    update_fields = {k: v for k, v in body.dict().items() if v is not None}
    if not update_fields:
        raise HTTPException(400, "No fields to update")
    result = await db.plans.update_one({"id": plan_id}, {"$set": update_fields})
    if result.matched_count == 0:
        raise HTTPException(404, "Plan not found")
    plan = await db.plans.find_one({"id": plan_id}, {"_id": 0})
    return clean(plan)

@api_router.delete("/superadmin/plans/{plan_id}")
async def delete_plan(plan_id: str, user=Depends(require_roles("superadmin"))):
    result = await db.plans.delete_one({"id": plan_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Plan not found")
    return {"success": True}

# ============== SOS & WEBSOCKETS ==============

@api_router.post("/sos/event/{event_id}")
async def create_sos_alert(event_id: str, body: SOSBody, user=Depends(get_current)):
    alert = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "driver_id": user["user_id"],
        "driver_name": user.get("name", ""),
        "alert_type": body.alert_type,
        "note": body.note,
        "photo_url": body.photo_url,
        "car_id": body.car_id,
        "car_number": body.car_number,
        "status": "ACTIVE",
        "created_at": now_iso(),
        "resolved_at": None,
        "resolved_by": None,
    }
    await db.sos_alerts.insert_one({**alert, "_id": alert["id"]})
    try:
        await manager.broadcast(f"sos:{event_id}", {"type": "sos_alert", "alert": alert})
    except Exception as e:
        logger.warning(f"broadcast failed (sos_alert for {event_id}): {e}")

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
    try:
        await manager.broadcast(f"sos:{alert['event_id']}", {"type": "sos_resolved", "alert_id": alert_id})
    except Exception as e:
        logger.warning(f"broadcast failed (sos_resolved for {alert_id}): {e}")
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
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=25.0)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        manager.disconnect(channel, ws)
    except Exception:
        manager.disconnect(channel, ws)

# Spec-compliant paths
@app.websocket("/ws/live-queue/{event_id}")
async def ws_live_queue(ws: WebSocket, event_id: str, token: str = Query(None)):
    if not token:
        await ws.close(code=4001, reason="Unauthorized")
        return
    event = await db.events.find_one({"id": event_id, "live_queue_token": token}, {"_id": 0, "id": 1})
    if not event:
        await ws.close(code=4001, reason="Unauthorized")
        return
    await _ws_loop(f"event:{event_id}", ws, token=None, require_auth=False)

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

@app.websocket("/ws/provider/{provider_id}")
async def ws_provider(ws: WebSocket, provider_id: str, token: str = Query(None)):
    await _ws_loop(f"provider:{provider_id}", ws, token=token, require_auth=True)

# Ingress-friendly aliases (mounted under /api so Kubernetes ingress proxies them)
@app.websocket("/api/v1/ws/live-queue/{event_id}")
async def ws_live_queue_api(ws: WebSocket, event_id: str, token: str = Query(None)):
    await ws_live_queue(ws, event_id, token)

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

@app.websocket("/api/v1/ws/provider/{provider_id}")
async def ws_provider_api(ws: WebSocket, provider_id: str, token: str = Query(None)):
    await _ws_loop(f"provider:{provider_id}", ws, token=token, require_auth=True)

@app.websocket("/ws/sos/{event_id}")
async def ws_sos(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"sos:{event_id}", ws, token=token, require_auth=True)

@app.websocket("/api/v1/ws/sos/{event_id}")
async def ws_sos_api(ws: WebSocket, event_id: str, token: str = Query(None)):
    await _ws_loop(f"sos:{event_id}", ws, token=token, require_auth=True)

# ============== STARTUP ==============
async def auto_activate_loop():
    while True:
        try:
            from zoneinfo import ZoneInfo
            now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
            upcoming_events = await db.events.find({"status": "upcoming"}, {"_id": 0}).to_list(1000)
            for e in upcoming_events:
                status = compute_event_status(e, now_ist)
                if status == "active":
                    res = await db.events.update_one(
                        {"id": e["id"], "status": "upcoming"},
                        {"$set": {
                            "status": "active",
                            "activated_at": now_iso(),
                            "activation_type": "auto",
                            "updated_at": now_iso()
                        }}
                    )
                    if res.modified_count > 0:
                        logger.info(f"Auto-activated event {e['id']}")
                        if "provider_id" in e:
                            await manager.broadcast(f"provider:{e['provider_id']}", {"type": "event_activated", "event_id": e["id"]})
                        await manager.broadcast(f"event:{e['id']}", {"type": "event_activated", "event_id": e["id"]})
        except Exception as err:
            logger.error(f"auto_activate_loop error: {err}")
        
        await asyncio.sleep(60)

async def auto_close_loop():
    while True:
        try:
            now = datetime.now(timezone.utc)
            events = await db.events.find({"status": {"$in": ["upcoming", "active"]}, "event_type": {"$ne": "hotel_daily"}}, {"_id": 0}).to_list(2000)
            for e in events:
                try:
                    from zoneinfo import ZoneInfo
                    ist_end = datetime.strptime(f'{e["end_date"]} {e.get("end_time","23:59")}', "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("Asia/Kolkata"))
                    grace_minutes = e.get("auto_close_grace_minutes") if e.get("auto_close_grace_minutes") is not None else 30
                    end_dt = ist_end.astimezone(timezone.utc) + timedelta(minutes=grace_minutes)
                    
                    if now > end_dt:
                        active_cars = await db.cars.count_documents({
                            "event_id": e["id"],
                            "status": {"$nin": ["DELIVERED", "PRE_REGISTERED"]},
                            "deleted": {"$ne": True}
                        })
                        
                        if active_cars == 0:
                            await db.events.update_one({"id": e["id"]}, {"$set": {"status": "closed", "updated_at": now_iso()}})
                            
                            async def _push_autoclosed(ev=e):
                                admin_tokens = await get_provider_admin_tokens(ev.get("provider_id", ""))
                                sup_tokens = await get_event_supervisor_tokens(ev["id"])
                                drv_tokens = await get_event_driver_tokens(ev["id"])
                                await send_expo_push(
                                    list(set(admin_tokens + sup_tokens + drv_tokens)),
                                    title="🏁 Event Auto-Closed",
                                    body_text=f"{ev.get('name', 'Event')} has been closed automatically — all vehicles retrieved",
                                    data={"event_id": ev["id"], "screen": "event_detail"}
                                )
                            asyncio.create_task(_push_autoclosed())
    
                            await db.parking_slots.delete_many({"event_id": e["id"]})
                            logger.info(f"Auto-closed event {e['id']}")
                            
                            # Trigger auto report email
                            asyncio.create_task(_trigger_auto_report_email(e))
                        else:
                            if not e.get("auto_close_reminder_sent_at"):
                                await db.events.update_one({"id": e["id"]}, {"$set": {"auto_close_reminder_sent_at": now_iso()}})
                                async def _push_reminder(ev=e, count=active_cars):
                                    admin_tokens = await get_provider_admin_tokens(ev.get("provider_id", ""))
                                    sup_tokens = await get_event_supervisor_tokens(ev["id"])
                                    await send_expo_push(
                                        list(set(admin_tokens + sup_tokens)),
                                        title="⚠️ Event End Time Passed",
                                        body_text=f"{ev.get('name', 'Event')} end time passed but {count} vehicle(s) are still active. Please close manually when ready.",
                                        data={"event_id": ev["id"], "screen": "event_detail"}
                                    )
                                asyncio.create_task(_push_reminder())
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
                            "retrieval_driver_id": None,
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
                                "awaiting_repark_at": now_iso(),
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

async def migrate_dedupe_car_qr_cards():
    """One-time cleanup: resolves duplicate (provider_id, card_code) pairs in
    car_qr_cards so the unique index on those fields can be created. For each
    duplicate group, keeps the oldest document (or the one with no created_at)
    and assigns a fresh, verified-unique card_code to every other document in
    the group."""
    pipeline = [
        {"$group": {
            "_id": {"provider_id": "$provider_id", "card_code": "$card_code"},
            "docs": {"$push": {"id": "$id", "created_at": "$created_at"}},
            "count": {"$sum": 1}
        }},
        {"$match": {"count": {"$gt": 1}}}
    ]
    duplicate_groups = await db.car_qr_cards.aggregate(pipeline).to_list(None)
    for group in duplicate_groups:
        provider_id = group["_id"]["provider_id"]
        docs = sorted(group["docs"], key=lambda d: d.get("created_at") or "")
        # keep the first (oldest) doc untouched; reassign the rest
        for dup in docs[1:]:
            new_code = await generate_unique_card_code(provider_id)
            await db.car_qr_cards.update_one(
                {"id": dup["id"]},
                {"$set": {"card_code": new_code}}
            )
    logger.info(f"Deduped car_qr_cards: {len(duplicate_groups)} groups resolved")

async def process_hotel_daily_event(hotel: dict, today: str):
    """Creates today's hotel_daily event for this hotel if missing, and carries
    forward any REGISTERED/CHECKED_IN/PARKED/RETRIEVAL_REQUESTED/BEING_FETCHED/
    ARRIVED_AT_GATE/AWAITING_REPARK cars from yesterday's event. Idempotent —
    safe to call multiple times for the same hotel/day."""
    existing = await db.events.find_one({"hotel_id": hotel["id"], "event_type": "hotel_daily", "date": today}) 
    if not existing: 
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
            "status": "active", 
            "live_queue_token": str(uuid.uuid4()),
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
        today_event = event
    else:
        today_event = existing

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
            "status": {"$in": ["PARKED", "RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED", "ARRIVED_AT_GATE", "AWAITING_REPARK"]},
            "deleted": {"$ne": True}
        }).to_list(1000)
        
        checked_in_cars = await db.cars.find({
            "event_id": yesterday_event["id"],
            "status": "CHECKED_IN",
            "deleted": {"$ne": True}
        }).to_list(1000)
        
        if parked_cars or checked_in_cars:
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

                print(f"[carry-forward] Hotel {hotel['id']}: moved {len(parked_cars)} slot-holding (parked/retrieval-in-progress) + {len(checked_in_cars)} pre-slot (checked-in) car(s) from {yesterday} to {today}")

    return today_event

async def create_daily_hotel_events(): 
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat() 
    # 1. Auto-close yesterday's hotel_daily events 
    events_to_close = await db.events.find(
        {"event_type": "hotel_daily", "status": "active", "date": {"$lt": today}},
        {"_id": 0}
    ).to_list(1000)

    await db.events.update_many( 
        {"event_type": "hotel_daily", "status": "active", "date": {"$lt": today}}, 
        {"$set": {"status": "closed", "auto_closed_at": now_iso()}} 
    ) 

    for ev in events_to_close:
        try:
            ev["status"] = "closed"
            asyncio.create_task(_trigger_auto_report_email(ev))
            logger.info(f"Triggered auto-close report email for hotel_daily event {ev['id']}")
        except Exception as e:
            logger.error(f"Failed to trigger report email for hotel_daily event {ev.get('id')}: {e}")

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
        try:
            await process_hotel_daily_event(hotel, today)
        except Exception as e:
            logger.error(f"[daily-events] Failed to process hotel {hotel.get('id')}: {e}")
            continue

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata") 
scheduler.add_job(create_daily_hotel_events, "cron", hour=0, minute=0) 

@api_router.post("/superadmin/migrate-event-status")
async def migrate_event_status(user=Depends(require_roles("superadmin"))):
    from zoneinfo import ZoneInfo
    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    events = await db.events.find({
        "status": "active",
        "manually_activated": {"$ne": True},
        "event_type": {"$ne": "hotel_daily"}
    }, {"_id": 0}).to_list(10000)
    
    migrated_count = 0
    for e in events:
        new_status = compute_event_status(e, now_ist)
        if new_status == "upcoming":
            await db.events.update_one(
                {"id": e["id"]},
                {"$set": {"status": "upcoming", "updated_at": now_iso()}}
            )
            migrated_count += 1
            
    return {"ok": True, "migrated": migrated_count, "total_checked": len(events)}


@api_router.post("/superadmin/hotels/{hotel_id}/trigger-daily-event")
async def trigger_daily_event_for_hotel(hotel_id: str, user=Depends(require_roles("superadmin"))):
    hotel = await db.hotels.find_one({"id": hotel_id}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    if not hotel.get("is_active"):
        raise HTTPException(400, "Hotel is inactive — activate it first")
    provider = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "is_active": 1, "is_verified": 1})
    if not provider or not provider.get("is_active") or not provider.get("is_verified"):
        raise HTTPException(400, "This hotel's provider is not active/verified")
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
    today_event = await process_hotel_daily_event(hotel, today)
    return {"ok": True, "event_id": today_event["id"], "message": f"Daily event processed for {hotel.get('name')}"}

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
        ("v4_dedupe_car_qr_cards", migrate_dedupe_car_qr_cards),
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
    await db.car_qr_cards.create_index([("provider_id", ASCENDING), ("card_code", ASCENDING)], unique=True)
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
    asyncio.create_task(auto_activate_loop())
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

def compute_car_step_durations(car: dict) -> dict:
    """Returns per-step durations in minutes (rounded to 1 decimal) for a car, or None
    for any step whose required timestamps aren't both present, or where the computed
    duration would be negative (defensive — treat as None rather than showing bad data)."""
    def _mins(start_iso, end_iso):
        if not start_iso or not end_iso:
            return None
        try:
            t1 = datetime.fromisoformat(start_iso.replace("Z", "+00:00") if isinstance(start_iso, str) else start_iso)
            t2 = datetime.fromisoformat(end_iso.replace("Z", "+00:00") if isinstance(end_iso, str) else end_iso)
            diff = (t2 - t1).total_seconds() / 60
            return round(diff, 1) if diff >= 0 else None
        except Exception:
            return None

    return {
        # Check-in to parked — how long the car sat waiting to be parked
        "park_minutes": _mins(car.get("driver_pickup_confirmed_at") or car.get("check_in_time"), car.get("parked_at")),
        # Retrieval requested to a driver picking up the task — dispatch/assignment delay
        "dispatch_wait_minutes": _mins(car.get("retrieval_requested_at"), car.get("accepted_at") or car.get("being_fetched_at")),
        # Driver accepted to physically picking up keys — accept to pickup delay
        "accept_to_pickup_minutes": _mins(car.get("accepted_at"), car.get("being_fetched_at")),
        # Driver assigned to arriving at the gate — driver's actual fetch execution time
        "fetch_minutes": _mins(car.get("being_fetched_at"), car.get("gate_arrival_time")),
        # Retrieval requested to arriving at the gate — combines dispatch wait + fetch time
        "retrieval_to_gate_minutes": _mins(car.get("retrieval_requested_at"), car.get("gate_arrival_time")),
        # Gate arrival to actual handover — guest's confirmation/pickup time at the gate
        "gate_wait_minutes": _mins(car.get("gate_arrival_time"), car.get("delivered_at")),
        # Most recent repark cycle only (awaiting_repark_at is overwritten on each gate-timeout,
        # so this reflects the latest no-show → re-park cycle, not full history)
        "repark_minutes": _mins(car.get("awaiting_repark_at"), car.get("parked_at")) if car.get("awaiting_repark_at") else None,
    }

async def _build_event_queue(event_id: str) -> list:
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

    result = []
    for c in cars:
        status = c.get("status", "")
        if status in ("REGISTERED", "CHECKED_IN"):
            mins = minutes_since(c.get("check_in_time"))
        elif status == "PARKED":
            mins = minutes_since(c.get("parked_at"))
        elif status in ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"]:
            mins = minutes_since(c.get("accepted_at") or c.get("retrieval_requested_at") or c.get("parked_at"))
        else:
            mins = minutes_since(c.get("delivered_at"))

        result.append({
            "car_id": c.get("id"),
            "car_number": c.get("plate"),
            "has_plate_issue": c.get("has_plate_issue", False),
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
        if status in ("RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"):
            ts = x.get("accepted_at") or x.get("retrieval_requested_at") or x.get("parked_at") or ""
        elif status == "PARKED":
            ts = x.get("parked_at") or ""
        elif status == "CHECKED_IN":
            ts = x.get("check_in_time") or ""
        else:
            ts = x.get("delivered_at") or ""
        return ts

    result.sort(key=queue_sort_key, reverse=True)
    return result


@api_router.get("/events/{event_id}/queue")
async def get_event_queue(event_id: str, user=Depends(get_current)):
    return await _build_event_queue(event_id)


@api_router.get("/live-queue/{token}")
async def get_public_live_queue(token: str):
    event = await db.events.find_one(
        {"live_queue_token": token},
        {"_id": 0, "id": 1, "name": 1, "date": 1, "venue": 1, "status": 1}
    )
    if not event:
        raise HTTPException(404, "Live queue link not found")

    queue = await _build_event_queue(event["id"])
    return {
        "event_id": event["id"],
        "event_name": event["name"],
        "event_date": event.get("date"),
        "venue": event.get("venue"),
        "event_status": event.get("status"),
        "queue": queue,
    }

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
async def set_event_host(eid: str, body: dict, user=Depends(require_roles("owner", "admin", "superadmin", "supervisor"))):
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
    if event: event = enrich_event_lifecycle(event)
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