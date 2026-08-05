"""InstaPark Valet Parking Management Backend."""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Query, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
import os, uuid, logging, asyncio, bcrypt, jwt, requests, smtplib, re, random, time
from email.mime.text import MIMEText 
from email.mime.multipart import MIMEMultipart 
import cloudinary
import cloudinary.uploader
from apscheduler.schedulers.asyncio import AsyncIOScheduler

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---- Config ----
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_EXPIRE_HOURS = int(os.environ.get('JWT_EXPIRE_HOURS', 168))
# EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY')
APP_NAME = os.environ.get('APP_NAME', 'instapark')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://domain.com')
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com") 
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587")) 
SMTP_USER = os.environ.get("SMTP_USER", "") 
SMTP_PASS = os.environ.get("SMTP_PASS", "") 
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "InstaPark") 
# STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
# Cloudinary config
cloudinary.config(
    cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key=os.environ.get('CLOUDINARY_API_KEY'),
    api_secret=os.environ.get('CLOUDINARY_API_SECRET')
)

client = AsyncIOMotorClient(
    MONGO_URL,
    maxPoolSize=10,
    minPoolSize=2,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    socketTimeoutMS=30000,
)
db = client[DB_NAME]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("instapark")

app = FastAPI(title="InstaPark API")
api_router = APIRouter(prefix="/api/v1")
bearer = HTTPBearer(auto_error=False)

@app.get("/health")
def health():
    return {
        "status": "ok",
        "message": "Backend is running"
    }


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

def put_object(path: str, data: bytes, content_type: str) -> dict:
    try:
        # Convert path to cloudinary public_id (remove extension)
        public_id = path.rsplit('.', 1)[0] if '.' in path else path
        # Upload to Cloudinary
        result = cloudinary.uploader.upload(
            data,
            public_id=f"instapark/{public_id}",
            resource_type="image",
            overwrite=True
        )
        return {
            "url": result['secure_url'],
            "public_id": result['public_id']
        }
    except Exception as e:
        logger.error(f"Cloudinary upload failed: {e}")
        raise HTTPException(500, f"Upload failed: {str(e)}")


# ---- Helpers ----
def send_sms_stub(phone: str, message: str):
    # TODO: Replace with a real SMS provider (e.g. Twilio, MSG91, Exotel). 
    # This stub logs the message so the full pipeline can be tested end-to-end 
    # without incurring SMS costs. To go live, implement this function body. 
    logger.info(f"[SMS STUB] To: {phone} | Message: {message}")

async def send_email(to: str, subject: str, html_body: str): 
    """Send email via SMTP. Logs to console if SMTP not configured.""" 
    if not SMTP_USER or not SMTP_PASS: 
        logger.info(f"[EMAIL STUB] To: {to} | Subject: {subject}") 
        logger.info(f"[EMAIL STUB] Body: {html_body[:200]}...") 
        return 
    try: 
        msg = MIMEMultipart("alternative") 
        msg["Subject"] = subject 
        msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>" 
        msg["To"] = to 
        msg.attach(MIMEText(html_body, "html")) 
        loop = asyncio.get_event_loop() 
        def _send(): 
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server: 
                server.ehlo() 
                server.starttls() 
                server.login(SMTP_USER, SMTP_PASS) 
                server.sendmail(SMTP_USER, to, msg.as_string()) 
        await loop.run_in_executor(None, _send) 
        logger.info(f"[EMAIL SENT] To: {to} | Subject: {subject}") 
    except Exception as e: 
        logger.error(f"[EMAIL ERROR] To: {to} | Error: {e}") 

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

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
    return decode_token(creds.credentials)

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
        for ws in list(self.channels.get(channel, [])):
            try:
                await ws.send_json(message)
            except Exception:
                pass

manager = ConnManager()

_otp_store: dict = {}
OTP_EXPIRY_SECONDS = 600  # 10 minutes

async def broadcast_car_update(car: dict):
    cid = car["id"]
    eid = car["event_id"]
    await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
    await manager.broadcast(f"event:{eid}", {"type": "car_update", "data": car})
    # For status changes that affect retrieval boards
    if car["status"] in ("RETRIEVAL_REQUESTED", "BEING_FETCHED"):
        await manager.broadcast(f"retrievals:{eid}", {"type": "retrieval_update", "data": car})

# ============== AUTH ==============
class LoginEmail(BaseModel):
    email: str
    password: str

class LoginDriver(BaseModel):
    employee_id: str
    pin: str

@api_router.post("/auth/superadmin/login")
async def superadmin_login(body: LoginEmail):
    sa = await db.superadmins.find_one({"email": body.email.lower()})
    if not sa or not verify_password(body.password, sa["hashed_password"]):
        raise HTTPException(401, "Invalid credentials")
    payload = {"user_id": sa["id"], "role": "superadmin", "name": sa["name"], "email": sa["email"]}
    token = create_token(payload)
    return {"token": token, "superadmin": {"id": sa["id"], "name": sa["name"], "email": sa["email"]}}


@api_router.post("/auth/superadmin/forgot-password")
async def superadmin_forgot_password(
    body: dict = Body(...)
):
    """Send OTP to superadmin email for password reset."""
    email = body.get("email", "").strip().lower()
    if not email:
        raise HTTPException(400, "Email is required")

    sa = await db.superadmins.find_one(
        {"email": email},
        {"_id": 0, "id": 1, "name": 1}
    )
    if sa:
        otp = str(random.randint(100000, 999999))
        _otp_store[f"superadmin_{email}"] = {
            "otp": otp,
            "expires": time.time() + OTP_EXPIRY_SECONDS,
            "superadmin_id": sa["id"]
        }
        html = f"""
        <div style="font-family:Arial,sans-serif;
          max-width:480px;margin:0 auto;padding:20px;">
          <div style="background:#0F2044;padding:20px;
            border-radius:12px 12px 0 0;
            text-align:center;">
            <h2 style="color:#fff;margin:0;">
              InstaPark Superadmin Password Reset
            </h2>
          </div>
          <div style="background:#fff;padding:24px;
            border:1px solid #e5e7eb;
            border-radius:0 0 12px 12px;">
            <p>Hi {sa['name']},</p>
            <p style="margin-top:12px;">
              Your superadmin password reset OTP is:
            </p>
            <div style="background:#EFF6FF;
              border-radius:10px;padding:20px;
              text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:900;
                letter-spacing:8px;color:#0F2044;">
                {otp}
              </span>
            </div>
            <p style="color:#6b7280;font-size:13px;">
              This OTP expires in 10 minutes.
              If you did not request this,
              ignore this email.
            </p>
          </div>
        </div>"""
        asyncio.create_task(send_email(
            to=email,
            subject="InstaPark — Superadmin Password Reset",
            html_body=html
        ))
    return {
        "message":
          "If this email exists, an OTP has been sent"
    }


@api_router.post("/auth/superadmin/reset-password")
async def superadmin_reset_password(
    body: dict = Body(...)
):
    """Verify OTP and reset superadmin password."""
    email = body.get("email", "").strip().lower()
    otp = body.get("otp", "").strip()
    new_password = body.get("new_password", "").strip()

    if not all([email, otp, new_password]):
        raise HTTPException(
            400,
            "Email, OTP and new password are required"
        )
    if len(new_password) < 6:
        raise HTTPException(
            400, "Password must be at least 6 characters"
        )

    key = f"superadmin_{email}"
    stored = _otp_store.get(key)
    if not stored:
        raise HTTPException(400, "Invalid or expired OTP")
    if time.time() > stored["expires"]:
        del _otp_store[key]
        raise HTTPException(400, "OTP has expired")
    if stored["otp"] != otp:
        raise HTTPException(400, "Incorrect OTP")

    hashed = bcrypt.hashpw(
        new_password.encode(), bcrypt.gensalt()
    ).decode()
    await db.superadmins.update_one(
        {"id": stored["superadmin_id"]},
        {"$set": {"hashed_password": hashed}}
    )
    del _otp_store[key]
    return {"message": "Password reset successfully"}

@api_router.post("/auth/admin/login")
async def admin_login(body: LoginEmail):
    prov = await db.providers.find_one({"email": body.email.lower()})
    if not prov or not verify_password(body.password, prov["hashed_password"]):
        raise HTTPException(401, "Invalid credentials")
    if not prov.get("is_active", True):
        raise HTTPException(403, "Provider deactivated")
    payload = {
        "user_id": prov["id"], 
        "role": "admin", 
        "provider_id": prov["id"], 
        "name": prov["name"],
        "provider_type": prov.get("provider_type", "valet_provider")
    }
    token = create_token(payload)
    return {
        "token": token, 
        "user": {
            "id": prov["id"], 
            "name": prov["name"], 
            "role": "admin", 
            "provider_id": prov["id"],
            "provider_type": prov.get("provider_type", "valet_provider")
        }
    }

@api_router.post("/auth/driver/login")
async def driver_login(body: LoginDriver):
    drv = await db.drivers.find_one({"employee_id": body.employee_id.upper(), "pin": body.pin, "is_active": True})
    if not drv:
        raise HTTPException(401, "Invalid credentials")
    payload = {"user_id": drv["id"], "role": drv.get("role", "driver"), "provider_id": drv["provider_id"], "name": drv["name"]}
    token = create_token(payload)
    return {"token": token, "driver": {"id": drv["id"], "name": drv["name"], "employee_id": drv["employee_id"], "role": drv.get("role", "driver"), "provider_id": drv["provider_id"]}}

@api_router.post("/auth/supervisor/login")
async def supervisor_login(body: LoginEmail):
    sup = await db.drivers.find_one({"email": body.email.lower(), "role": "supervisor", "is_active": True})
    if not sup or not verify_password(body.password, sup["hashed_password"]):
        raise HTTPException(401, "Invalid credentials")
    payload = {"user_id": sup["id"], "role": "supervisor", "provider_id": sup["provider_id"], "name": sup["name"], "email": sup["email"]}
    token = create_token(payload)
    return {"token": token, "user": {"id": sup["id"], "name": sup["name"], "role": "supervisor", "provider_id": sup["provider_id"], "email": sup["email"]}}

@api_router.post("/auth/admin/forgot-password")
async def admin_forgot_password(body: dict = Body(...)):
    """Send OTP to admin email for password reset."""
    email = body.get("email", "").strip().lower()
    if not email:
        raise HTTPException(400, "Email is required")

    admin = await db.providers.find_one(
        {"email": email}, {"_id": 0, "id": 1, "name": 1}
    )
    # Always return success to prevent email enumeration
    if admin:
        otp = str(random.randint(100000, 999999))
        _otp_store[f"admin_{email}"] = {
            "otp": otp,
            "expires": time.time() + OTP_EXPIRY_SECONDS,
            "admin_id": admin["id"]
        }
        html = f"""
        <div style="font-family:Arial,sans-serif;
          max-width:480px;margin:0 auto;padding:20px;">
          <div style="background:#7C3AED;padding:20px;
            border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#fff;margin:0;">
              InstaPark Password Reset
            </h2>
          </div>
          <div style="background:#fff;padding:24px;
            border:1px solid #e5e7eb;
            border-radius:0 0 12px 12px;">
            <p>Hi {admin['name']},</p>
            <p style="margin-top:12px;">
              Your password reset OTP is:
            </p>
            <div style="background:#F5F3FF;
              border-radius:10px;padding:20px;
              text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:900;
                letter-spacing:8px;color:#7C3AED;">
                {otp}
              </span>
            </div>
            <p style="color:#6b7280;font-size:13px;">
              This OTP expires in 10 minutes.
              If you did not request this, ignore this email.
            </p>
          </div>
        </div>"""
        asyncio.create_task(send_email(
            to=email,
            subject="InstaPark — Password Reset OTP",
            html_body=html
        ))
    return {"message": "If this email exists, an OTP has been sent"}

@api_router.post("/auth/admin/reset-password")
async def admin_reset_password(body: dict = Body(...)):
    """Verify OTP and reset admin password."""
    email = body.get("email", "").strip().lower()
    otp = body.get("otp", "").strip()
    new_password = body.get("new_password", "").strip()

    if not all([email, otp, new_password]):
        raise HTTPException(
            400, "Email, OTP and new password are required"
        )
    if len(new_password) < 6:
        raise HTTPException(
            400, "Password must be at least 6 characters"
        )

    key = f"admin_{email}"
    stored = _otp_store.get(key)
    if not stored:
        raise HTTPException(400, "Invalid or expired OTP")
    if time.time() > stored["expires"]:
        del _otp_store[key]
        raise HTTPException(400, "OTP has expired")
    if stored["otp"] != otp:
        raise HTTPException(400, "Incorrect OTP")

    hashed = bcrypt.hashpw(
        new_password.encode(), bcrypt.gensalt()
    ).decode()
    await db.providers.update_one(
        {"id": stored["admin_id"]},
        {"$set": {"hashed_password": hashed}}
    )
    del _otp_store[key]
    return {"message": "Password reset successfully"}

@api_router.post("/auth/driver/forgot-pin")
async def driver_forgot_pin(body: dict = Body(...)):
    """Send OTP to driver email for PIN reset."""
    employee_id = body.get("employee_id", "").strip().upper()
    if not employee_id:
        raise HTTPException(400, "Employee ID is required")

    driver = await db.drivers.find_one(
        {"employee_id": employee_id},
        {"_id": 0, "id": 1, "name": 1, "email": 1}
    )
    if driver and driver.get("email"):
        otp = str(random.randint(100000, 999999))
        _otp_store[f"driver_{employee_id}"] = {
            "otp": otp,
            "expires": time.time() + OTP_EXPIRY_SECONDS,
            "driver_id": driver["id"]
        }
        html = f"""
        <div style="font-family:Arial,sans-serif;
          max-width:480px;margin:0 auto;padding:20px;">
          <div style="background:#059669;padding:20px;
            border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#fff;margin:0;">
              InstaPark PIN Reset
            </h2>
          </div>
          <div style="background:#fff;padding:24px;
            border:1px solid #e5e7eb;
            border-radius:0 0 12px 12px;">
            <p>Hi {driver['name']},</p>
            <p style="margin-top:12px;">
              Your PIN reset OTP is:
            </p>
            <div style="background:#ECFDF5;
              border-radius:10px;padding:20px;
              text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:900;
                letter-spacing:8px;color:#059669;">
                {otp}
              </span>
            </div>
            <p style="color:#6b7280;font-size:13px;">
              This OTP expires in 10 minutes.
              If you did not request this, ignore this email.
            </p>
          </div>
        </div>"""
        asyncio.create_task(send_email(
            to=driver["email"],
            subject="InstaPark — PIN Reset OTP",
            html_body=html
        ))
    return {"message": "If this Employee ID exists, an OTP has been sent"}

@api_router.post("/auth/driver/reset-pin")
async def driver_reset_pin(body: dict = Body(...)):
    """Verify OTP and reset driver PIN."""
    employee_id = body.get("employee_id", "").strip().upper()
    otp = body.get("otp", "").strip()
    new_pin = body.get("new_pin", "").strip()

    if not all([employee_id, otp, new_pin]):
        raise HTTPException(
            400, "Employee ID, OTP and new PIN are required"
        )
    if not re.match(r"^\d{4}$", new_pin):
        raise HTTPException(400, "PIN must be exactly 4 digits")

    key = f"driver_{employee_id}"
    stored = _otp_store.get(key)
    if not stored:
        raise HTTPException(400, "Invalid or expired OTP")
    if time.time() > stored["expires"]:
        del _otp_store[key]
        raise HTTPException(400, "OTP has expired")
    if stored["otp"] != otp:
        raise HTTPException(400, "Incorrect OTP")

    hashed = bcrypt.hashpw(
        new_pin.encode(), bcrypt.gensalt()
    ).decode()
    await db.drivers.update_one(
        {"id": stored["driver_id"]},
        {"$set": {"hashed_pin": hashed}}
    )
    del _otp_store[key]
    return {"message": "PIN reset successfully"}

@api_router.get("/auth/me")
async def me(user=Depends(get_current)):
    if "user_id" in user and "id" not in user:
        user["id"] = user["user_id"]
    if user.get("role") == "admin" and "provider_type" not in user:
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
    password: str

class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    plan: Optional[str] = None
    provider_type: Optional[str] = None
    is_active: Optional[bool] = None

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
    operating_hours_start: str  # HH:MM
    operating_hours_end: str    # HH:MM
    hotel_photo: Optional[str] = None
    provider_id: Optional[str] = None  # required for superadmin, auto-set for admin

class HotelUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    contact_person_name: Optional[str] = None
    contact_person_phone: Optional[str] = None
    contact_person_email: Optional[str] = None
    total_valet_slots: Optional[int] = None
    operating_hours_start: Optional[str] = None
    operating_hours_end: Optional[str] = None
    hotel_photo: Optional[str] = None
    provider_id: Optional[str] = None
    is_active: Optional[bool] = None

@api_router.get("/providers")
async def list_providers(user=Depends(require_roles("superadmin"))):
    rows = await db.providers.find({}, {"_id": 0, "hashed_password": 0}).to_list(1000)
    return rows

@api_router.post("/providers")
async def create_provider(body: ProviderCreate, user=Depends(require_roles("superadmin"))):
    if await db.providers.find_one({"email": body.email.lower()}):
        raise HTTPException(400, "Email already exists")
    pid = str(uuid.uuid4())
    doc = {
        "id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone,
        "plan": body.plan, "provider_type": body.provider_type, "is_active": True,
        "provider_qr_token": str(uuid.uuid4()),
        "hashed_password": hash_password(body.password),
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.providers.insert_one(doc.copy())
    # also create admin driver record
    admin_drv = {
        "id": str(uuid.uuid4()), "provider_id": pid, "name": body.name, "phone": body.phone,
        "role": "admin", "employee_id": f"ADM{str(int(datetime.now().timestamp()))[-5:]}",
        "pin": "0000", "is_active": True, "auth_user_id": pid, "created_at": now_iso(),
    }
    await db.drivers.insert_one(admin_drv)

    # --- Email notifications ---
    # 1. Welcome email to the new provider/admin
    provider_welcome_html = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
  <div style="background:#7C3AED;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
    <h1 style="color:#fff;margin:0;font-size:24px;">Welcome to InstaPark! 🚗</h1> 
  </div> 
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
    <p style="color:#374151;font-size:16px;">Hi <strong>{body.name}</strong>,</p> 
    <p style="color:#374151;">Your InstaPark valet management account has been created. 
    Here are your login credentials for the admin app:</p> 
    <div style="background:#F5F3FF;border-radius:8px;padding:16px;margin:20px 0; 
    border-left:4px solid #7C3AED;"> 
      <p style="margin:0;color:#374151;"> 
        <strong>Email:</strong> 
        <span style="font-family:monospace;font-size:16px;color:#7C3AED;"> 
          {body.email} 
        </span> 
      </p> 
      <p style="margin:8px 0 0;color:#374151;"> 
        <strong>Password:</strong> 
        <span style="font-family:monospace;font-size:16px;color:#7C3AED;"> 
          {body.password} 
        </span> 
      </p> 
      <p style="margin:8px 0 0;color:#374151;"> 
        <strong>Plan:</strong> 
        <span style="font-family:monospace;font-size:16px;color:#7C3AED;"> 
          {body.plan.upper()} 
        </span> 
      </p> 
    </div> 
    <p style="color:#6B7280;font-size:14px;"> 
      Please log in and change your password after your first login. 
    </p> 
    <p style="color:#6B7280;font-size:14px;"> 
      Download the InstaPark admin app and use your email and 
      password to get started managing your valet operations. 
    </p> 
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
    <p style="color:#9CA3AF;font-size:12px;text-align:center;"> 
      InstaPark Valet Parking Management 
    </p> 
  </div> 
</div>
"""
    asyncio.create_task(send_email(
        to=body.email,
        subject="Welcome to InstaPark — Your Account is Ready",
        html_body=provider_welcome_html
    ))

    # 2. Notification to all superadmins
    superadmins = await db.superadmins.find(
        {}, {"_id": 0, "email": 1, "name": 1}
    ).to_list(100)

    superadmin_notify_html = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
  <div style="background:#0F2044;padding:24px;border-radius:12px 12px 0 0; 
  text-align:center;"> 
    <h1 style="color:#fff;margin:0;font-size:22px;">New Provider Onboarded</h1> 
  </div> 
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb; 
  border-radius:0 0 12px 12px;"> 
    <p style="color:#374151;"> 
      A new valet service provider has been added to InstaPark: 
    </p> 
    <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
      <p style="margin:0;color:#374151;"> 
        <strong>Company Name:</strong> {body.name} 
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
  </div> 
</div>
"""
    for sa in superadmins:
        if sa.get("email"):
            asyncio.create_task(send_email(
                to=sa["email"],
                subject=f"New Provider Onboarded — {body.name}",
                html_body=superadmin_notify_html
            ))

    return {"id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone, "plan": body.plan, "password": body.password}

@api_router.get("/providers/{pid}")
async def get_provider(pid: str, user=Depends(require_roles("superadmin"))):
    p = await db.providers.find_one({"id": pid}, {"_id": 0, "hashed_password": 0})
    if not p:
        raise HTTPException(404, "Not found")
    p["events"] = await db.events.find({"provider_id": pid}, {"_id": 0}).to_list(1000)
    p["drivers"] = await db.drivers.find({"provider_id": pid, "role": "driver"}, {"_id": 0, "pin": 0}).to_list(1000)
    p["supervisors"] = await db.drivers.find({"provider_id": pid, "role": "supervisor"}, {"_id": 0, "hashed_password": 0}).to_list(1000)
    return p

@api_router.patch("/providers/{pid}")
async def update_provider(pid: str, body: ProviderUpdate, user=Depends(require_roles("superadmin"))):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    upd["updated_at"] = now_iso()
    res = await db.providers.update_one({"id": pid}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

@api_router.get("/providers/{pid}/stats")
async def provider_stats(pid: str, user=Depends(require_roles("superadmin"))):
    events = await db.events.count_documents({"provider_id": pid})
    drivers = await db.drivers.count_documents({"provider_id": pid, "role": "driver"})
    supervisors = await db.drivers.count_documents({"provider_id": pid, "role": "supervisor"})
    event_ids = [e["id"] for e in await db.events.find({"provider_id": pid}, {"_id": 0, "id": 1}).to_list(1000)]
    cars = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"_id": 0, "id": 1}).to_list(10000)] if event_ids else []
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
    avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    return {"events": events, "drivers": drivers, "supervisors": supervisors, "cars": cars, "avg_rating": avg}

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
        {"_id": 0, "pin": 0}
    ).to_list(1000)

    supervisors = await db.drivers.find(
        {"provider_id": pid, "role": "supervisor"},
        {"_id": 0, "hashed_password": 0}
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
    avg_rating = round(
        sum(ratings_map.values()) / len(ratings_map), 2
    ) if ratings_map else 0

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
            "avg_rating": avg_rating,
            "avg_duration_minutes": avg_duration,
        },
        "events": event_summary,
        "drivers": drivers,
        "supervisors": supervisors,
        "incidents": incidents[:50],
    }

@api_router.get("/providers/me/qr-token") 
async def get_my_provider_qr_token(user=Depends(require_roles("admin", "supervisor"))): 
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

# ============== DRIVERS ==============
class DriverCreate(BaseModel): 
    name: str 
    phone: str 
    pin: str 
    provider_id: Optional[str] = None 
    email: str 
    pan_number: Optional[str] = None 
    bank_account_number: Optional[str] = None 
    bank_ifsc: Optional[str] = None 
    driving_license_number: Optional[str] = None 
    driving_license_photo: Optional[str] = None 
    driver_photo: Optional[str] = None 
 
class DriverUpdate(BaseModel): 
    name: Optional[str] = None 
    phone: Optional[str] = None 
    pin: Optional[str] = None 
    email: Optional[str] = None 
    pan_number: Optional[str] = None 
    bank_account_number: Optional[str] = None 
    bank_ifsc: Optional[str] = None 
    driving_license_number: Optional[str] = None 
    driving_license_photo: Optional[str] = None 
    driver_photo: Optional[str] = None 

# ============== SUPERVISORS ==============
class SupervisorCreate(BaseModel):
    name: str
    email: str
    phone: str
    password: str
    provider_id: Optional[str] = None
    supervisor_photo: Optional[str] = None

class SupervisorUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    supervisor_photo: Optional[str] = None

@api_router.get("/drivers")
async def list_drivers(user=Depends(get_current)):
    role = user.get("role")
    if role == "superadmin":
        drv = await db.drivers.find({"role": "driver"}, {"_id": 0}).to_list(2000)
        # join provider name
        prov_ids = list({d["provider_id"] for d in drv})
        provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
        for d in drv:
            d["provider_name"] = provs.get(d["provider_id"], "—")
        return drv
    if role in ("admin", "supervisor"):
        return await db.drivers.find({"provider_id": user["provider_id"], "role": "driver"}, {"_id": 0}).to_list(1000)
    raise HTTPException(403, "Forbidden")

@api_router.post("/drivers")
async def create_driver(body: DriverCreate, user=Depends(require_roles("admin", "superadmin"))):
    if user.get("role") == "superadmin":
        pid = body.provider_id
        if not pid:
            raise HTTPException(400, "provider_id is required when creating a driver as superadmin")
    else:
        pid = user.get("provider_id")
        if not pid:
            raise HTTPException(400, "provider_id missing")
    eid = f"DRV{str(int(datetime.now().timestamp()))[-5:]}"
    doc = { 
        "id": str(uuid.uuid4()), "provider_id": pid, 
        "name": body.name, "phone": body.phone, 
        "email": body.email or None, 
        "pan_number": body.pan_number or None, 
        "bank_account_number": body.bank_account_number or None, 
        "bank_ifsc": body.bank_ifsc or None, 
        "driving_license_number": body.driving_license_number or None, 
        "driving_license_photo": body.driving_license_photo or None, 
        "driver_photo": body.driver_photo or None, 
        "role": "driver", "employee_id": eid.upper(), "pin": body.pin, 
        "is_active": True, "created_at": now_iso() 
    } 
    await db.drivers.insert_one(doc.copy())

    # --- Email notifications --- 
    # 1. Welcome email to driver with login credentials 
    driver_email_html = f""" 
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
      <div style="background:#7C3AED;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
        <h1 style="color:#fff;margin:0;font-size:24px;">Welcome to InstaPark! 🚗</h1> 
      </div> 
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
        <p style="color:#374151;font-size:16px;">Hi <strong>{body.name}</strong>,</p> 
        <p style="color:#374151;">You have been onboarded as a valet driver. Here are your login credentials:</p> 
        <div style="background:#F5F3FF;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #7C3AED;"> 
          <p style="margin:0;color:#374151;"><strong>Employee ID:</strong> <span style="font-family:monospace;font-size:18px;color:#7C3AED;">{eid.upper()}</span></p> 
          <p style="margin:8px 0 0;color:#374151;"><strong>PIN:</strong> <span style="font-family:monospace;font-size:18px;color:#7C3AED;">{body.pin}</span></p> 
        </div> 
        <p style="color:#6B7280;font-size:14px;">Please keep these credentials safe. You will need them to log in to the InstaPark driver app.</p> 
        <p style="color:#6B7280;font-size:14px;">Download the app and use your Employee ID and PIN to get started.</p> 
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
      </div> 
    </div> 
    """ 
    asyncio.create_task(send_email( 
        to=body.email, 
        subject="Welcome to InstaPark — Your Login Credentials", 
        html_body=driver_email_html 
    )) 
 
    # 2. Notification email to admin (provider) 
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "email": 1}) 
    if provider and provider.get("email"): 
        admin_email_html = f""" 
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
          <div style="background:#0F2044;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
            <h1 style="color:#fff;margin:0;font-size:22px;">New Driver Onboarded</h1> 
          </div> 
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
            <p style="color:#374151;">A new driver has been added to <strong>{provider['name']}</strong>:</p> 
            <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
              <p style="margin:0;color:#374151;"><strong>Name:</strong> {body.name}</p> 
              <p style="margin:8px 0 0;color:#374151;"><strong>Employee ID:</strong> <span style="font-family:monospace;">{eid.upper()}</span></p> 
              <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p> 
              {"<p style='margin:8px 0 0;color:#374151;'><strong>Phone:</strong> " + body.phone + "</p>" if body.phone else ""} 
            </div> 
            <p style="color:#6B7280;font-size:14px;">Log in to your InstaPark dashboard to manage this driver.</p> 
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
            <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
          </div> 
        </div> 
        """ 
        asyncio.create_task(send_email( 
            to=provider["email"], 
            subject=f"New Driver Onboarded — {body.name}", 
            html_body=admin_email_html 
        )) 
 
    # 3. Notification email to all superadmins 
    superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1, "name": 1}).to_list(100) 
    superadmin_email_html = f""" 
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
      <div style="background:#1A3C6E;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
        <h1 style="color:#fff;margin:0;font-size:22px;">Driver Onboarding Summary</h1> 
      </div> 
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
        <p style="color:#374151;">A new driver has been onboarded on the InstaPark platform:</p> 
        <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
          <p style="margin:0;color:#374151;"><strong>Name:</strong> {body.name}</p> 
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
    </div> 
    """ 
    for sa in superadmins: 
        if sa.get("email"): 
            asyncio.create_task(send_email( 
                to=sa["email"], 
                subject=f"New Driver Onboarded — {body.name} ({provider['name'] if provider else '—'})", 
                html_body=superadmin_email_html 
            )) 

    return clean(doc)

# ============== HOTELS ENDPOINTS ==============

@api_router.get("/hotels")
async def list_hotels(user=Depends(require_roles("admin", "superadmin"))):
    role = user.get("role")
    query = {}
    if role == "admin":
        query["provider_id"] = user["provider_id"]
    
    hotels = await db.hotels.find(query, {"_id": 0}).to_list(1000)
    
    # Enrich with provider_name
    prov_ids = list({h["provider_id"] for h in hotels if h.get("provider_id")})
    provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    for h in hotels:
        h["provider_name"] = provs.get(h["provider_id"], "—")
            
    return [clean(h) for h in hotels]

@api_router.get("/hotels/{hid}")
async def get_hotel(hid: str, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    
    # Enrich with provider_name
    prov = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "name": 1})
    hotel["provider_name"] = prov["name"] if prov else "—"
    
    # Enrich with assigned_drivers
    driver_ids = hotel.get("assigned_driver_ids", [])
    hotel["assigned_drivers"] = [clean(d) for d in await db.drivers.find({"id": {"$in": driver_ids}}, {"_id": 0, "pin": 0}).to_list(1000)]
    
    # Enrich with assigned_supervisors
    supervisor_ids = hotel.get("assigned_supervisor_ids", [])
    hotel["assigned_supervisors"] = [clean(s) for s in await db.drivers.find({"id": {"$in": supervisor_ids}, "role": "supervisor"}, {"_id": 0, "hashed_password": 0}).to_list(1000)]
    
    return clean(hotel)

@api_router.get("/hotels/{hid}/detail")
async def get_hotel_detail(hid: str, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    
    # Enrich with provider_name
    prov = await db.providers.find_one({"id": hotel["provider_id"]}, {"_id": 0, "name": 1})
    provider_name = prov["name"] if prov else "—"
    
    # Enrich with assigned_drivers
    driver_ids = hotel.get("assigned_driver_ids", [])
    assigned_drivers = [clean(d) for d in await db.drivers.find({"id": {"$in": driver_ids}}, {"_id": 0, "pin": 0}).to_list(1000)]
    
    # Enrich with assigned_supervisors
    supervisor_ids = hotel.get("assigned_supervisor_ids", [])
    assigned_supervisors = [clean(s) for s in await db.drivers.find({"id": {"$in": supervisor_ids}, "role": "supervisor"}, {"_id": 0, "hashed_password": 0}).to_list(1000)]
    
    # Recent 5 events
    recent_events = [clean(e) for e in await db.events.find({"hotel_id": hid}, {"_id": 0}).sort("date", -1).limit(5).to_list(5)]
    
    # Stats
    total_events = await db.events.count_documents({"hotel_id": hid})
    event_ids = [e["id"] for e in await db.events.find({"hotel_id": hid}, {"id": 1}).to_list(10000)]
    total_cars_served = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    
    # Avg rating
    avg_rating = 0
    if event_ids:
        car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"id": 1}).to_list(50000)]
        if car_ids:
            ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"stars": 1}).to_list(50000)
            if ratings:
                avg_rating = round(sum(r["stars"] for r in ratings) / len(ratings), 2)
    
    return {
        "hotel": clean(hotel),
        "provider_name": provider_name,
        "assigned_drivers": assigned_drivers,
        "assigned_supervisors": assigned_supervisors,
        "recent_events": recent_events,
        "stats": {
            "total_events": total_events,
            "total_cars_served": total_cars_served,
            "avg_rating": avg_rating
        }
    }

@api_router.post("/hotels")
async def create_hotel(body: HotelCreate, user=Depends(require_roles("admin", "superadmin"))):
    if user.get("role") == "superadmin":
        pid = body.provider_id
        if not pid:
            raise HTTPException(400, "provider_id is required for superadmin")
    else:
        pid = user.get("provider_id")
    
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
        "operating_hours_start": body.operating_hours_start,
        "operating_hours_end": body.operating_hours_end,
        "hotel_photo": body.hotel_photo,
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
      <div style="background:#0F2044;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">New Hotel Added</h1>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
        <p style="color:#374151;">A new hotel has been added to the InstaPark platform:</p>
        <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#374151;"><strong>Hotel Name:</strong> {body.name}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Provider:</strong> {provider['name'] if provider else '—'}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Address:</strong> {body.address}, {body.city}, {body.state}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Contact:</strong> {body.contact_person_name} ({body.contact_person_phone})</p>
        </div>
        <p style="color:#6B7280;font-size:14px;">Log in to the SuperAdmin dashboard to view full details.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
      </div>
    </div>
    """
    for sa in superadmins:
        if sa.get("email"):
            asyncio.create_task(send_email(
                to=sa["email"],
                subject=f"New Hotel Added — {body.name}",
                html_body=email_html
            ))
            
    return clean(doc)

@api_router.patch("/hotels/{hid}")
async def update_hotel(hid: str, body: HotelUpdate, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    upd["updated_at"] = now_iso()
    await db.hotels.update_one({"id": hid}, {"$set": upd})
    return {"ok": True}

@api_router.delete("/hotels/{hid}")
async def deactivate_hotel(hid: str, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    return {"ok": True}

@api_router.post("/hotels/{hid}/drivers/{did}")
async def assign_driver_to_hotel(hid: str, did: str, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$addToSet": {"assigned_driver_ids": did}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.delete("/hotels/{hid}/drivers/{did}")
async def remove_driver_from_hotel(hid: str, did: str, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$pull": {"assigned_driver_ids": did}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.post("/hotels/{hid}/supervisors/{sid}")
async def assign_supervisor_to_hotel(hid: str, sid: str, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$addToSet": {"assigned_supervisor_ids": sid}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.delete("/hotels/{hid}/supervisors/{sid}")
async def remove_supervisor_from_hotel(hid: str, sid: str, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    await db.hotels.update_one({"id": hid}, {"$pull": {"assigned_supervisor_ids": sid}, "$set": {"updated_at": now_iso()}})
    return {"ok": True}

@api_router.get("/drivers/{did}")
async def get_driver(did: str, user=Depends(get_current)):
    d = await db.drivers.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    if user.get("role") == "superadmin":
        p = await db.providers.find_one({"id": d["provider_id"]}, {"_id": 0, "name": 1})
        d["provider_name"] = p["name"] if p else "—"
    return d

@api_router.patch("/drivers/{did}")
async def update_driver(did: str, body: DriverUpdate, user=Depends(require_roles("admin", "superadmin"))):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    res = await db.drivers.update_one({"id": did}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

@api_router.delete("/drivers/{did}")
async def deactivate_driver(did: str, user=Depends(require_roles("admin", "superadmin"))):
    await db.drivers.update_one({"id": did}, {"$set": {"is_active": False}})
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
async def list_supervisors(user=Depends(require_roles("admin", "superadmin"))):
    role = user.get("role")
    query = {"role": "supervisor"}
    if role == "admin":
        query["provider_id"] = user["provider_id"]
    
    sups = await db.drivers.find(query, {"_id": 0, "hashed_password": 0}).to_list(1000)
    
    if role == "superadmin":
        # join provider name
        prov_ids = list({s["provider_id"] for s in sups})
        provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
        for s in sups:
            s["provider_name"] = provs.get(s["provider_id"], "—")
            
    return sups

@api_router.get("/supervisors/{sid}")
async def get_supervisor(sid: str, user=Depends(require_roles("admin", "superadmin"))):
    query = {"id": sid, "role": "supervisor"}
    if user.get("role") == "admin":
        query["provider_id"] = user["provider_id"]
        
    sup = await db.drivers.find_one(query, {"_id": 0, "hashed_password": 0})
    if not sup:
        raise HTTPException(404, "Supervisor not found")
        
    if user.get("role") == "superadmin":
        p = await db.providers.find_one({"id": sup["provider_id"]}, {"_id": 0, "name": 1})
        sup["provider_name"] = p["name"] if p else "—"
        
    return sup

@api_router.post("/supervisors")
async def create_supervisor(body: SupervisorCreate, user=Depends(require_roles("admin", "superadmin"))):
    if user.get("role") == "superadmin":
        pid = body.provider_id
        if not pid:
            raise HTTPException(400, "provider_id is required when creating a supervisor as superadmin")
    else:
        pid = user.get("provider_id")
        if not pid:
            raise HTTPException(400, "provider_id missing")

    if await db.drivers.find_one({"email": body.email.lower(), "role": "supervisor"}):
        raise HTTPException(400, "Email already exists for a supervisor")

    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "provider_id": pid,
        "name": body.name,
        "email": body.email.lower(),
        "phone": body.phone,
        "role": "supervisor",
        "hashed_password": hash_password(body.password),
        "supervisor_photo": body.supervisor_photo or None,
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso()
    }
    await db.drivers.insert_one(doc.copy())

    # Welcome Email
    welcome_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#0F2044;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;">Welcome to InstaPark! 🚗</h1>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
        <p style="color:#374151;font-size:16px;">Hi <strong>{body.name}</strong>,</p>
        <p style="color:#374151;">You have been onboarded as a <strong>Supervisor</strong> for InstaPark valet management.</p>
        <p style="color:#374151;">Here are your login credentials for the supervisor portal:</p>
        <div style="background:#F5F3FF;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #0F2044;">
          <p style="margin:0;color:#374151;"><strong>Email:</strong> <span style="font-family:monospace;font-size:16px;color:#0F2044;">{body.email}</span></p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Temporary Password:</strong> <span style="font-family:monospace;font-size:16px;color:#0F2044;">{body.password}</span></p>
        </div>
        <p style="color:#6B7280;font-size:14px;">Please log in and change your password as soon as possible.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
      </div>
    </div>
    """
    asyncio.create_task(send_email(
        to=body.email,
        subject="Welcome to InstaPark — Your Supervisor Account is Ready",
        html_body=welcome_html
    ))

    # Notification to admin (provider)
    provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "email": 1})
    if provider and provider.get("email"):
        admin_email_html = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#0F2044;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;">New Supervisor Onboarded</h1>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <p style="color:#374151;">A new supervisor has been added to <strong>{provider['name']}</strong>:</p>
            <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:0;color:#374151;"><strong>Name:</strong> {body.name}</p>
              <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p>
              {"<p style='margin:8px 0 0;color:#374151;'><strong>Phone:</strong> " + body.phone + "</p>" if body.phone else ""}
            </div>
            <p style="color:#6B7280;font-size:14px;">Log in to your InstaPark dashboard to manage this supervisor.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
            <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
          </div>
        </div>
        """
        asyncio.create_task(send_email(
            to=provider["email"],
            subject=f"New Supervisor Onboarded — {body.name}",
            html_body=admin_email_html
        ))

    # Notification to all superadmins
    superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1, "name": 1}).to_list(100)
    superadmin_email_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#1A3C6E;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Supervisor Onboarding Summary</h1>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
        <p style="color:#374151;">A new supervisor has been onboarded on the InstaPark platform:</p>
        <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;color:#374151;"><strong>Name:</strong> {body.name}</p>
          <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p>
          {"<p style='margin:8px 0 0;color:#374151;'><strong>Phone:</strong> " + body.phone + "</p>" if body.phone else ""}
          <p style="margin:8px 0 0;color:#374151;"><strong>Provider:</strong> {provider['name'] if provider else '—'}</p>
        </div>
        <p style="color:#6B7280;font-size:14px;">Log in to the SuperAdmin dashboard to view full supervisor details.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
        <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p>
      </div>
    </div>
    """
    for sa in superadmins:
        if sa.get("email"):
            asyncio.create_task(send_email(
                to=sa["email"],
                subject=f"New Supervisor Onboarded — {body.name} ({provider['name'] if provider else '—'})",
                html_body=superadmin_email_html
            ))

    return clean(doc)

@api_router.patch("/supervisors/{sid}")
async def update_supervisor(sid: str, body: SupervisorUpdate, user=Depends(require_roles("admin", "superadmin"))):
    query = {"id": sid, "role": "supervisor"}
    if user.get("role") == "admin":
        query["provider_id"] = user["provider_id"]

    sup = await db.drivers.find_one(query)
    if not sup:
        raise HTTPException(404, "Supervisor not found")

    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "email" in upd:
        upd["email"] = upd["email"].lower()
    upd["updated_at"] = now_iso()

    await db.drivers.update_one({"id": sid}, {"$set": upd})
    return {"ok": True}

@api_router.delete("/supervisors/{sid}")
async def deactivate_supervisor(sid: str, user=Depends(require_roles("admin", "superadmin"))):
    query = {"id": sid, "role": "supervisor"}
    if user.get("role") == "admin":
        query["provider_id"] = user["provider_id"]

    sup = await db.drivers.find_one(query)
    if not sup:
        raise HTTPException(404, "Supervisor not found")

    await db.drivers.update_one({"id": sid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    return {"ok": True}

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
            {"$match": {"event_id": {"$in": event_ids}}},
            {"$group": {"_id": "$event_id", "count": {"$sum": 1}}}
        ]).to_list(len(event_ids))
        car_count_map = {r["_id"]: r["count"] for r in car_counts}
    else:
        car_count_map = {}

    for e in events:
        e["provider_name"] = provs.get(e["provider_id"], "—")
        e["cars_count"] = car_count_map.get(e["id"], 0)
    return events

@api_router.post("/events")
async def create_event(body: EventCreate, user=Depends(require_roles("admin", "superadmin"))):
    if body.event_type == "hotel_daily":
        raise HTTPException(400, "hotel_daily events are created automatically")
        
    eid = str(uuid.uuid4())
    doc = body.model_dump()
    pid = body.provider_id if user.get("role") == "superadmin" and body.provider_id else user.get("provider_id")
    doc.update({"id": eid, "provider_id": pid, "status": "active",
                "key_hooks": body.key_hooks,
                "created_at": now_iso(), "updated_at": now_iso()})
    await db.events.insert_one(doc.copy())
    return clean(doc)

@api_router.post("/hotels/{hid}/events")
async def create_hotel_special_event(hid: str, body: EventCreate, user=Depends(require_roles("admin", "superadmin"))):
    hotel = await db.hotels.find_one({"id": hid}, {"_id": 0})
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    
    if user.get("role") == "admin" and hotel["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
    
    eid = str(uuid.uuid4())
    doc = body.model_dump()
    doc.update({
        "id": eid,
        "provider_id": hotel["provider_id"],
        "hotel_id": hid,
        "event_type": "hotel_special",
        "venue": hotel["address"],
        "status": "active",
        "created_at": now_iso(),
        "updated_at": now_iso()
    })
    await db.events.insert_one(doc.copy())
    return clean(doc)

@api_router.post("/events/{eid}/clone")
async def clone_event(
    eid: str,
    user=Depends(require_roles("admin"))
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
async def get_event_detail(eid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    
    # Provider name
    provider = await db.providers.find_one({"id": event["provider_id"]}, {"_id": 0, "name": 1})
    event["provider_name"] = provider["name"] if provider else "Unknown"
    
    # Stats
    car_ids = [c["id"] for c in await db.cars.find({"event_id": eid}, {"_id": 0, "id": 1}).to_list(10000)]
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
    avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    delivered = await db.cars.find({"event_id": eid, "status": "DELIVERED"}, {"_id": 0}).to_list(10000)
    times = []
    for c in delivered:
        try:
            t1 = datetime.fromisoformat(c.get("check_in_time")) if c.get("check_in_time") else None
            t2 = datetime.fromisoformat(c.get("delivered_at")) if c.get("delivered_at") else None
            if t1 and t2:
                times.append((t2 - t1).total_seconds() / 60)
        except Exception:
            pass
    avg_ret = round(sum(times) / len(times), 1) if times else 0
    # top driver
    pipeline = [{"$match": {"event_id": eid}}, {"$group": {"_id": "$check_in_driver_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 1}]
    top = await db.cars.aggregate(pipeline).to_list(1)
    top_driver = None
    if top and top[0]["_id"]:
        d = await db.drivers.find_one({"id": top[0]["_id"]}, {"_id": 0, "name": 1})
        top_driver = d["name"] if d else None
    
    event["total_cars"] = len(car_ids)
    event["stats"] = {
        "avg_rating": avg,
        "avg_retrieval_minutes": avg_ret,
        "top_driver": top_driver
    }
    
    # Drivers
    pid = event["provider_id"]
    drivers = await db.drivers.find({"provider_id": pid, "role": "driver", "is_active": True}, {"_id": 0}).to_list(1000)
    other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
    assignments = {a["driver_id"]: a for a in await db.event_drivers.find({"event_id": {"$in": [e["id"] for e in other_events]}}, {"_id": 0}).to_list(2000)}
    e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
    e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
    other_map = {e["id"]: e for e in other_events}
    # Batch: cars checked in per driver for this event 
    ci_pipeline = [ 
        {"$match": {"event_id": eid}}, 
        {"$group": {"_id": "$check_in_driver_id", "count": {"$sum": 1}}} 
    ] 
    ci_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(ci_pipeline).to_list(1000)} 
 
    # Batch: cars retrieved per driver for this event 
    cr_pipeline = [ 
        {"$match": {"event_id": eid, "status": "DELIVERED"}}, 
        {"$group": {"_id": "$retrieval_driver_id", "count": {"$sum": 1}}} 
    ] 
    cr_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(cr_pipeline).to_list(1000)} 
 
    # Batch: assigned drivers for this event 
    assigned_ids = {a["driver_id"] for a in await db.event_drivers.find({"event_id": eid}, {"_id": 0, "driver_id": 1}).to_list(1000)} 
 
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
    
    event["drivers"] = drivers

    # Supervisors block
    supervisors = await db.drivers.find({"provider_id": pid, "role": "supervisor", "is_active": True}, {"_id": 0, "hashed_password": 0}).to_list(1000)
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
async def update_event(eid: str, body: EventUpdate, user=Depends(require_roles("admin", "superadmin"))):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.key_hooks is not None:
        upd["key_hooks"] = body.key_hooks
    upd["updated_at"] = now_iso()
    res = await db.events.update_one({"id": eid}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

@api_router.post("/events/{eid}/close")
async def close_event(eid: str, user=Depends(require_roles("admin", "superadmin"))):
    await db.events.update_one({"id": eid}, {"$set": {"status": "closed", "updated_at": now_iso()}})
    await db.parking_slots.delete_many({"event_id": eid})
    return {"ok": True}

@api_router.get("/events/{eid}/stats")
async def event_stats(eid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    car_ids = [c["id"] for c in await db.cars.find({"event_id": eid}, {"_id": 0, "id": 1}).to_list(10000)]
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
    avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    delivered = await db.cars.find({"event_id": eid, "status": "DELIVERED"}, {"_id": 0}).to_list(10000)
    times = []
    for c in delivered:
        try:
            t1 = datetime.fromisoformat(c.get("check_in_time")) if c.get("check_in_time") else None
            t2 = datetime.fromisoformat(c.get("delivered_at")) if c.get("delivered_at") else None
            if t1 and t2:
                times.append((t2 - t1).total_seconds() / 60)
        except Exception:
            pass
    avg_ret = round(sum(times) / len(times), 1) if times else 0
    # top driver
    pipeline = [{"$match": {"event_id": eid}}, {"$group": {"_id": "$check_in_driver_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 1}]
    top = await db.cars.aggregate(pipeline).to_list(1)
    top_driver = None
    if top and top[0]["_id"]:
        d = await db.drivers.find_one({"id": top[0]["_id"]}, {"_id": 0, "name": 1})
        top_driver = d["name"] if d else None
    return {"avg_rating": avg, "avg_retrieval_minutes": avg_ret, "top_driver": top_driver, "total_cars": len(car_ids)}

@api_router.get("/events/{eid}/keys")
async def get_event_keys(
    eid: str,
    user=Depends(require_roles("admin", "superadmin", "supervisor"))
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
async def get_event_report(eid: str, user=Depends(get_current)):
    """Returns full event report data for PDF/CSV export."""
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")

    cars = await db.cars.find(
        {"event_id": eid}, {"_id": 0}
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
    ratings_map = {r["car_id"]: r["stars"] for r in ratings_list}

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
            "rating": ratings_map.get(c["id"], None),
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
    avg_rating = round(
        sum(ratings_map.values()) / len(ratings_map), 2
    ) if ratings_map else 0

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
            "avg_rating": avg_rating,
            "total_incidents": len(incidents),
            "total_drivers": len(driver_perf),
        },
        "cars": car_rows,
        "drivers": list(driver_perf.values()),
        "incidents": incidents,
    }

# Event drivers
@api_router.get("/events/{eid}/drivers")
async def event_drivers(eid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    pid = event["provider_id"]
    drivers = await db.drivers.find({"provider_id": pid, "role": "driver", "is_active": True}, {"_id": 0}).to_list(1000)
    other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
    assignments = {a["driver_id"]: a for a in await db.event_drivers.find({"event_id": {"$in": [e["id"] for e in other_events]}}, {"_id": 0}).to_list(2000)}
    e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
    e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
    other_map = {e["id"]: e for e in other_events}
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
        d["cars_checked_in"] = await db.cars.count_documents({"event_id": eid, "check_in_driver_id": d["id"]})
        d["cars_retrieved"] = await db.cars.count_documents({"event_id": eid, "retrieval_driver_id": d["id"], "status": "DELIVERED"})
        d["assigned"] = await db.event_drivers.find_one({"event_id": eid, "driver_id": d["id"]}) is not None
    return drivers

@api_router.post("/events/{eid}/drivers/{did}")
async def assign_driver(eid: str, did: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    if await db.event_drivers.find_one({"event_id": eid, "driver_id": did}):
        return {"ok": True}
    await db.event_drivers.insert_one({"id": str(uuid.uuid4()), "event_id": eid, "driver_id": did, "status": "active"})
    return {"ok": True}

@api_router.delete("/events/{eid}/drivers/{did}")
async def unassign_driver(eid: str, did: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    await db.event_drivers.delete_many({"event_id": eid, "driver_id": did})
    return {"ok": True}

# Event supervisors
@api_router.get("/events/{eid}/supervisors")
async def event_supervisors(eid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    
    pid = event["provider_id"]
    if user.get("role") == "admin" and pid != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    supervisors = await db.drivers.find({"provider_id": pid, "role": "supervisor", "is_active": True}, {"_id": 0, "hashed_password": 0}).to_list(1000)
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
async def assign_supervisor(eid: str, sid: str, user=Depends(require_roles("admin", "superadmin"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
        
    if user.get("role") == "admin" and event["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    if await db.event_supervisors.find_one({"event_id": eid, "supervisor_id": sid}):
        return {"ok": True}
        
    # Check for conflicts
    supervisors = await db.drivers.find({"id": sid, "role": "supervisor"}, {"_id": 0}).to_list(1)
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
    return {"ok": True}

@api_router.delete("/events/{eid}/supervisors/{sid}")
async def unassign_supervisor(eid: str, sid: str, user=Depends(require_roles("admin", "superadmin"))):
    await db.event_supervisors.delete_many({"event_id": eid, "supervisor_id": sid})
    return {"ok": True}

@api_router.get("/supervisors/{sid}/events")
async def get_supervisor_events(sid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    query = {"supervisor_id": sid}
    es_records = await db.event_supervisors.find(query, {"_id": 0, "event_id": 1}).to_list(1000)
    event_ids = [r["event_id"] for r in es_records]
    
    events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(1000)
    
    if user.get("role") == "admin":
        events = [e for e in events if e["provider_id"] == user["provider_id"]]
        
    for e in events:
        provider = await db.providers.find_one({"id": e["provider_id"]}, {"_id": 0, "name": 1})
        e["provider_name"] = provider["name"] if provider else "Unknown"
        
    return events

@api_router.get("/supervisors/{sid}/stats")
async def get_supervisor_stats(sid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    sup = await db.drivers.find_one({"id": sid, "role": "supervisor"})
    if not sup:
        raise HTTPException(404, "Supervisor not found")
        
    if user.get("role") == "admin" and sup["provider_id"] != user["provider_id"]:
        raise HTTPException(403, "Forbidden")
        
    es_records = await db.event_supervisors.find({"supervisor_id": sid}, {"_id": 0, "event_id": 1}).to_list(2000)
    event_ids = [r["event_id"] for r in es_records]
    
    total_events = len(event_ids)
    active_events = await db.events.count_documents({"id": {"$in": event_ids}, "status": "active"}) if event_ids else 0
    total_cars_managed = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    
    car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"_id": 0, "id": 1}).to_list(100000)] if event_ids else []
    ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0, "stars": 1}).to_list(100000) if car_ids else []
    avg_rating = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    
    total_drivers_overseen = await db.event_drivers.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
    # The requirement says "count of distinct drivers who worked in their supervised events"
    if event_ids:
        distinct_drivers = await db.event_drivers.distinct("driver_id", {"event_id": {"$in": event_ids}})
        total_drivers_overseen = len(distinct_drivers)
    else:
        total_drivers_overseen = 0
        
    return {
        "total_events": total_events,
        "active_events": active_events,
        "total_cars_managed": total_cars_managed,
        "avg_rating": avg_rating,
        "total_drivers_overseen": total_drivers_overseen
    }

@api_router.get("/supervisors/{sid}/report")
async def get_supervisor_report(sid: str, user=Depends(require_roles("admin", "superadmin"))):
    sup = await db.drivers.find_one({"id": sid, "role": "supervisor"}, {"_id": 0, "hashed_password": 0})
    if not sup:
        raise HTTPException(404, "Supervisor not found")
        
    if user.get("role") == "admin" and sup["provider_id"] != user["provider_id"]:
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
        e_avg_rating = round(sum(r["stars"] for r in e_ratings) / len(e_ratings), 2) if e_ratings else 0
        e_drivers_count = await db.event_drivers.count_documents({"event_id": e["id"]})
        
        event_summary.append({
            "event_name": e.get("name", ""),
            "event_date": e.get("date", ""),
            "end_date": e.get("end_date", ""),
            "venue": e.get("venue", ""),
            "status": e.get("status", ""),
            "total_cars": e_cars,
            "avg_rating": e_avg_rating,
            "drivers_count": e_drivers_count
        })
        
    return {
        "supervisor": sup,
        "summary": stats,
        "events": event_summary
    }

@api_router.get("/drivers/{did}/events")
async def get_driver_events(did: str, user=Depends(require_roles("superadmin"))):
    # event_ids from event_drivers
    ed_ids = [a["event_id"] for a in await db.event_drivers.find({"driver_id": did}, {"_id": 0, "event_id": 1}).to_list(1000)]
    # event_ids from cars (check-in or retrieval)
    car_events = await db.cars.find({"$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}]}, {"_id": 0, "event_id": 1}).to_list(10000)
    car_ids = [c["event_id"] for c in car_events]
    
    all_eids = list(set(ed_ids + car_ids))
    events = await db.events.find({"id": {"$in": all_eids}}, {"_id": 0}).to_list(1000)
    
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
        {"_id": 0, "car_id": 1, "stars": 1, "comment": 1}
    ).to_list(10000)
    avg_rating = round(
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
            "avg_rating": avg_rating,
            "total_incidents": len(incidents),
        },
        "events": event_summary,
        "incidents": incidents,
    }

@api_router.get("/drivers/{did}/events/{eid}/cars")
async def get_driver_event_cars(did: str, eid: str, user=Depends(require_roles("superadmin"))):
    cars = await db.cars.find({"event_id": eid, "$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}]}, {"_id": 0}).sort("check_in_time", ASCENDING).to_list(5000)
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

# ============== CARS ==============
class CarCreate(BaseModel):
    plate: str
    color: str
    make: str
    notes: Optional[str] = ""
    gate: Optional[str] = ""
    event_id: str
    check_in_driver_id: str
    guest_phone: Optional[str] = None
    guest_name: Optional[str] = None 
    expected_arrival: Optional[str] = None 
    pass_token: Optional[str] = None 

class SendSmsBody(BaseModel): 
    phone: Optional[str] = None 
 
class ParkBody(BaseModel):
    zone: str
    slot: int
    parked_driver_id: str
    key_tag: Optional[str] = None
    parked_photo_url: Optional[str] = None

class PickupBody(BaseModel):
    retrieval_driver_id: str

class DeliverBody(BaseModel):
    delivery_photo_url: Optional[str] = ""

@api_router.get("/cars/event/{eid}")
async def cars_event(eid: str, user=Depends(get_current)):
    return await db.cars.find({"event_id": eid}, {"_id": 0}).to_list(5000)

@api_router.get("/superadmin/events/{eid}/cars")
async def superadmin_event_cars(eid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
    cars = await db.cars.find({"event_id": eid}, {"_id": 0}).to_list(10000)
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

@api_router.post("/cars")
async def create_car(body: CarCreate, user=Depends(get_current)):
    plate = body.plate.upper()
    # Run all validation queries in parallel
    event, current, duplicate = await asyncio.gather(
        db.events.find_one({"id": body.event_id}, {"_id": 0}),
        db.cars.count_documents({"event_id": body.event_id}),
        db.cars.find_one({"event_id": body.event_id, "plate": plate}, {"_id": 0, "id": 1, "status": 1}), 
    )
    if not event:
        raise HTTPException(404, "Event not found")
    if current >= event["max_cars"]:
        raise HTTPException(400, "Event is full")
    if duplicate: 
        if duplicate.get("status") == "PRE_REGISTERED": 
            # Return existing pre-registered car for driver to complete check-in 
            existing_car = await db.cars.find_one({"id": duplicate["id"]}, {"_id": 0}) 
            return clean(existing_car) 
        raise HTTPException(400, "Duplicate plate in this event") 

    cid = str(uuid.uuid4())
    qr_token = str(uuid.uuid4())
    doc = {
        "id": cid, "event_id": body.event_id, "plate": plate, "color": body.color, "make": body.make,
        "guest_name": body.guest_name or None, 
        "expected_arrival": body.expected_arrival or None, 
        "status": "CHECKED_IN", "zone": None, "slot": None, "gate": body.gate,
        "qr_token": qr_token,
        "scheduled_retrieval_time": None,
        "check_in_driver_id": body.check_in_driver_id, "check_in_time": now_iso(),
        "parked_driver_id": None, "parked_at": None,
        "retrieval_driver_id": None, "delivered_at": None,
        "photo_url": None, "delivery_photo_url": None, "notes": body.notes,
        "guest_phone": body.guest_phone or None,
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.cars.insert_one(doc.copy())
    out = clean(doc)
    out["warning"] = current + 1 >= event["max_cars"] * 0.8
    await manager.broadcast(f"event:{body.event_id}", {"type": "car_update", "data": out})

    # Send SMS to guest if phone was provided at check-in 
    if body.guest_phone: 
        retrieval_link = f"{FRONTEND_URL}/v/{qr_token}" 
        sms_message = ( 
            f"Your {body.color} {body.make} is safely parked at {event['name']}. " 
            f"Click here to request retrieval when you're ready: {retrieval_link}" 
        ) 
        send_sms_stub(body.guest_phone, sms_message) 

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
    retrieval_link = f"{FRONTEND_URL}/v/{car['qr_token']}" 
    sms_message = ( 
        f"Your {car['color']} {car['make']} is safely parked at {event_name}. " 
        f"Click here to request retrieval when you're ready: {retrieval_link}" 
    ) 
    send_sms_stub(phone_to_use, sms_message) 
    return {"status": "sent", "phone": phone_to_use} 

@api_router.get("/cars/{cid}")
async def get_car(cid: str, user=Depends(get_current)):
    c = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Not found")
    return c

@api_router.patch("/cars/{cid}/park")
async def park_car(cid: str, body: ParkBody, user=Depends(get_current)):
    upd = {
        "status": "PARKED",
        "zone": body.zone,
        "slot": body.slot,
        "parked_driver_id": body.parked_driver_id,
        "parked_at": now_iso(),
        "updated_at": now_iso(),
        "key_tag": body.key_tag,
        "parked_photo_url": body.parked_photo_url
    }
    await db.cars.update_one({"id": cid}, {"$set": upd})
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    await db.parking_slots.update_one(
        {"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot},
        {"$set": {"is_occupied": True, "car_id": cid}}, upsert=True)
    await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
    slot = await db.parking_slots.find_one({"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0})
    await manager.broadcast(f"event:{car['event_id']}", {"type": "slot_update", "data": slot})
    return car

@api_router.patch("/cars/{cid}/park-photo") 
async def update_park_photo(cid: str, body: dict = Body(...), 
user=Depends(get_current)): 
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
    user=Depends(get_current)
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
async def request_retrieval(cid: str):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await db.cars.update_one({"id": cid}, {"$set": {"status": "RETRIEVAL_REQUESTED", "retrieval_requested_at": now_iso(), "updated_at": now_iso()}})
    rid = str(uuid.uuid4())
    await db.retrieval_requests.insert_one({"id": rid, "car_id": cid, "driver_id": None, "status": "PENDING",
                                            "requested_at": now_iso(), "updated_at": now_iso()})
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
    await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
    await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
    return car

@api_router.patch("/cars/{cid}/schedule-retrieval") 
async def schedule_retrieval(cid: str, body: dict = Body(...)): 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 
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
    
    await db.cars.update_one( 
        {"id": cid}, 
        {"$set": { 
            "scheduled_retrieval_time": scheduled_dt, 
            "status": "PARKED", 
            "updated_at": now_iso() 
        }} 
    ) 
    updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    await broadcast_car_update(updated) 
    return clean(updated) 

@api_router.patch("/cars/{cid}/schedule-retrieval/cancel") 
async def cancel_scheduled_retrieval(cid: str): 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 
    if not car.get("scheduled_retrieval_time"): 
        raise HTTPException(400, "No scheduled retrieval to cancel") 
    await db.cars.update_one( 
        {"id": cid}, 
        {"$set": { 
            "scheduled_retrieval_time": None, 
            "updated_at": now_iso() 
        }} 
    ) 
    updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    await broadcast_car_update(updated) 
    return clean(updated) 

@api_router.patch("/cars/{cid}/pickup")
async def pickup_car(cid: str, body: PickupBody, user=Depends(get_current)):
    await db.cars.update_one({"id": cid}, {"$set": {"status": "BEING_FETCHED", "retrieval_driver_id": body.retrieval_driver_id, "being_fetched_at": now_iso(), "updated_at": now_iso()}})
    await db.retrieval_requests.update_one({"car_id": cid, "status": "PENDING"},
                                           {"$set": {"status": "ASSIGNED", "driver_id": body.retrieval_driver_id, "updated_at": now_iso()}})
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
    await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
    await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
    return car

@api_router.patch("/cars/{cid}/deliver")
async def deliver_car(cid: str, body: DeliverBody, user=Depends(get_current)):
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Not found")
    await db.cars.update_one({"id": cid}, {"$set": {"status": "DELIVERED", "delivery_photo_url": body.delivery_photo_url,
                                                   "delivered_at": now_iso(), "updated_at": now_iso()}})
    await db.retrieval_requests.update_one({"car_id": cid}, {"$set": {"status": "COMPLETED", "updated_at": now_iso()}})
    if car.get("zone") and car.get("slot") is not None:
        await db.parking_slots.update_one(
            {"event_id": car["event_id"], "zone_name": car["zone"], "slot_number": car["slot"]},
            {"$set": {"is_occupied": False, "car_id": None}})
    car = await db.cars.find_one({"id": cid}, {"_id": 0})
    await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
    await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
    return car

@api_router.patch("/cars/{cid}/update-photo")
async def update_car_photo(cid: str, body: dict, user=Depends(get_current)):
    await db.cars.update_one(
        {"id": cid},
        {"$set": {"delivery_photo_url": body.get("delivery_photo_url", ""), "updated_at": now_iso()}}
    )
    return {"ok": True}

@api_router.delete("/cars/{cid}")
async def delete_car(cid: str, user=Depends(get_current)):
    await db.cars.delete_one({"id": cid})
    return {"ok": True}

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
            "status": {"$in": ["active", "upcoming"]} 
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
    guest_notes = body.get("guest_notes", "").strip()
 
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
 
    # Check if already pre-registered for this event 
    existing = await db.cars.find_one( 
        {"event_id": event_id, "plate": plate}, 
        {"_id": 0, "id": 1, "qr_token": 1, "status": 1} 
    ) 
    if existing: 
        if existing["status"] == "PRE_REGISTERED": 
            # Already pre-registered — resend SMS and return pass token 
            retrieval_link = f"{FRONTEND_URL}/pass/{existing['qr_token']}" 
            sms_message = ( 
                f"Hi {guest_name}! Your {color} {make} ({plate}) is pre-registered " 
                f"for {event['name']}. Show this QR to the valet on arrival: {retrieval_link}" 
            ) 
            send_sms_stub(guest_phone, sms_message) 
            return {"pass_token": existing["qr_token"], "already_registered": True} 
        else: 
            raise HTTPException(400, "This plate is already checked in for this event") 
 
    # Check event capacity 
    current_count = await db.cars.count_documents({"event_id": event_id}) 
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
        "qr_token": pass_token, 
        "scheduled_retrieval_time": None, 
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
    pass_link = f"{FRONTEND_URL}/pass/{pass_token}" 
    sms_message = ( 
        f"Hi {guest_name}! Your {color} {make} ({plate}) is pre-registered " 
        f"for {event['name']} at {provider['name']}. " 
        f"Show this QR to the valet on arrival for fast check-in: {pass_link} " 
        f"Please wait while they photograph your vehicle." 
    ) 
    send_sms_stub(guest_phone, sms_message) 
 
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
    } 

@api_router.patch("/cars/{cid}/complete-checkin") 
async def complete_checkin(cid: str, body: dict = Body(...), user=Depends(get_current)): 
    """Driver completes check-in for a PRE_REGISTERED car.""" 
    car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
    if not car: 
        raise HTTPException(404, "Car not found") 
    if car["status"] != "PRE_REGISTERED": 
        raise HTTPException(400, "Car is not in PRE_REGISTERED status") 
 
    update = { 
        "status": "CHECKED_IN", 
        "check_in_driver_id": body.get("check_in_driver_id"), 
        "check_in_time": now_iso(), 
        "gate": body.get("gate", ""), 
        "updated_at": now_iso(), 
    } 
    # Allow updating make/color/plate in case guest made typo 
    if body.get("make"): update["make"] = body["make"] 
    if body.get("color"): update["color"] = body["color"] 
    if body.get("notes"): update["notes"] = body["notes"] 
 
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

@api_router.post("/cars/{cid}/photos")
async def save_photos(cid: str, body: PhotosBody, user=Depends(get_current)):
    docs = [{"id": str(uuid.uuid4()), "car_id": cid, "url": u, "type": body.type, "created_at": now_iso()} for u in body.urls]
    if docs:
        await db.car_photos.insert_many(docs)
    if body.type == "checkin" and body.urls:
        await db.cars.update_one({"id": cid}, {"$set": {"photo_url": body.urls[0]}})
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
        "rating": rating["stars"] if rating else None,
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
        return {"position": 0, "total_waiting": 0}

    # Count cars that requested retrieval BEFORE this car
    requested_at = car.get("retrieval_requested_at")
    if not requested_at:
        return {"position": 1, "total_waiting": 1}

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

    return {
        "position": cars_ahead + 1,
        "total_waiting": total_waiting,
        "being_fetched": car["status"] == "BEING_FETCHED"
    }

# ============== SLOTS ==============
@api_router.get("/slots/event/{eid}")
async def slots_event(eid: str, user=Depends(require_roles("admin", "superadmin", "supervisor"))):
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
async def event_retrievals(eid: str, user=Depends(get_current)):
    return await db.cars.find({"event_id": eid, "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}}, {"_id": 0}).to_list(1000)

class RetrievalBody(BaseModel):
    car_id: str

@api_router.post("/retrievals")
async def create_retrieval(body: RetrievalBody):
    return await request_retrieval(body.car_id)  # type: ignore

# ============== RATINGS ==============
class RatingBody(BaseModel):
    car_id: str
    stars: int
    comment: Optional[str] = None

@api_router.post("/ratings")
async def post_rating(body: RatingBody):
    if body.stars < 1 or body.stars > 5:
        raise HTTPException(400, "Stars must be 1-5")
    existing = await db.ratings.find_one({"car_id": body.car_id})
    if existing:
        return {"ok": True, "duplicate": True}
    await db.ratings.insert_one({
        "id": str(uuid.uuid4()),
        "car_id": body.car_id,
        "stars": body.stars,
        "comment": body.comment or None,
        "created_at": now_iso()
    })
    return {"ok": True}

# ============== INCIDENTS ==============

@api_router.get("/incidents/event/{eid}") 
async def get_event_incidents( 
    eid: str, 
    user=Depends(require_roles("admin", "superadmin", "supervisor")) 
): 
    incidents = await db.incidents.find( 
        {"event_id": eid}, {"_id": 0} 
    ).sort("created_at", -1).to_list(1000) 
    return incidents 

@api_router.post("/incidents") 
async def create_incident( 
    body: dict = Body(...), 
    user=Depends(require_roles("admin", "superadmin", "supervisor")) 
): 
    event_id = body.get("event_id") 
    car_id = body.get("car_id") 
    driver_id = body.get("driver_id") 
    description = body.get("description", "").strip() 
    photo_url = body.get("photo_url", None) 

    if not all([event_id, car_id, description]): 
        raise HTTPException( 
            400, "event_id, car_id and description are required" 
        ) 

    car = await db.cars.find_one( 
        {"id": car_id, "event_id": event_id}, 
        {"_id": 0, "plate": 1, "make": 1, "color": 1} 
    ) 
    if not car: 
        raise HTTPException(404, "Car not found in this event") 

    event = await db.events.find_one( 
        {"id": event_id}, {"_id": 0, "name": 1} 
    ) 

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
        "description": description, 
        "photo_url": photo_url, 
        "reported_by_provider": user.get("provider_id"), 
        "created_at": now_iso(), 
    } 
    await db.incidents.insert_one(incident.copy()) 
    incident.pop("_id", None) 
    return incident 

@api_router.get("/incidents/car/{cid}") 
async def get_car_incidents(cid: str, user=Depends(get_current)): 
    incidents = await db.incidents.find( 
        {"car_id": cid}, {"_id": 0} 
    ).sort("created_at", -1).to_list(100) 
    return incidents

# ============== QR (no auth) ==============
@api_router.get("/qr/{token}")
async def get_by_qr(token: str):
    car = await db.cars.find_one({"qr_token": token}, {"_id": 0})
    if not car:
        raise HTTPException(404, "Invalid QR token")
    event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0, "name": 1})
    car["event_name"] = event["name"] if event else "Event"
    return car

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
async def upload(file: UploadFile = File(...), folder: str = Form("misc"), user=Depends(get_current)):
    data = await file.read()
    ext = file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg'
    path = f"{folder}/{uuid.uuid4()}.{ext}"
    result = put_object(path, data, file.content_type or "application/octet-stream")
    return {"url": result["url"], "path": path}



# ============== SUPERADMIN STATS ==============
@api_router.get("/superadmin/stats")
async def super_stats(user=Depends(require_roles("superadmin"))):
    total_p = await db.providers.count_documents({})
    active_p = await db.providers.count_documents({"is_active": True})
    active_e = await db.events.count_documents({"status": "active"})
    total_d = await db.drivers.count_documents({"role": "driver"})
    total_c = await db.cars.count_documents({})
    parked_c = await db.cars.count_documents({"status": "PARKED"})
    pending_r = await db.cars.count_documents({"status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}})
    ratings = await db.ratings.find({}, {"_id": 0}).to_list(20000)
    avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
    return {"total_providers": total_p, "active_providers": active_p, "active_events": active_e,
            "total_drivers": total_d, "total_cars": total_c, "parked_cars": parked_c,
            "pending_retrievals": pending_r, "platform_avg_rating": avg}

@api_router.get("/superadmin/stats/activity")
async def super_stats_activity(user=Depends(require_roles("superadmin"))):
    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=6)
    cutoff = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc).isoformat()

    pipeline = [
        {"$match": {"check_in_time": {"$exists": True, "$ne": None, "$gte": cutoff}}},
        {"$group": {"_id": {"$substr": ["$check_in_time", 0, 10]}, "checkins": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.cars.aggregate(pipeline).to_list(1000)
    counts = {r["_id"]: r["checkins"] for r in rows}

    days = [(start_date + timedelta(days=i)).isoformat() for i in range(7)]
    return [{"date": d, "checkins": counts.get(d, 0)} for d in days]

@api_router.get("/superadmin/cars") 
async def superadmin_cars_list(user=Depends(require_roles("superadmin"))): 
    # Get all cars 
    all_cars = await db.cars.find({}, {"_id": 0}).to_list(50000) 
    
    # Group by plate 
    plate_map = {} 
    for c in all_cars: 
        plate = c["plate"] 
        if plate not in plate_map: 
            plate_map[plate] = { 
                "plate": plate, 
                "make": c.get("make", ""), 
                "color": c.get("color", ""), 
                "total_visits": 0, 
                "last_seen": None, 
                "last_event_id": None, 
                "has_active": False, 
            } 
        plate_map[plate]["total_visits"] += 1 
        # Track latest check-in 
        ci = c.get("check_in_time") 
        if ci and (plate_map[plate]["last_seen"] is None or ci > plate_map[plate]["last_seen"]): 
            plate_map[plate]["last_seen"] = ci 
            plate_map[plate]["last_event_id"] = c.get("event_id") 
        # If any record is not delivered, it's currently active 
        if c.get("status") != "DELIVERED": 
            plate_map[plate]["has_active"] = True 
    
    # Enrich with event names for last_event_id 
    event_ids = list({v["last_event_id"] for v in plate_map.values() if v["last_event_id"]}) 
    events_map = {} 
    if event_ids: 
        evs = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(event_ids)) 
        events_map = {e["id"]: e["name"] for e in evs} 
    
    result = [] 
    for v in plate_map.values(): 
        v["last_event_name"] = events_map.get(v["last_event_id"], "—") 
        result.append(v) 
    
    # Sort by last_seen descending 
    result.sort(key=lambda x: x["last_seen"] or "", reverse=True) 
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
            "rating": ratings_map.get(r["id"], {}).get("stars") if ratings_map.get(r["id"]) else None,
            "rating_comment": ratings_map.get(r["id"], {}).get("comment") if ratings_map.get(r["id"]) else None,
            "photos": photos_by_car.get(r["id"], []), 
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
            "rating": rating["stars"] if rating else None,
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

# ============== WEBSOCKETS ==============
async def _ws_loop(channel: str, ws: WebSocket):
    await manager.connect(channel, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(channel, ws)

# Spec-compliant paths
@app.websocket("/ws/event/{event_id}")
async def ws_event(ws: WebSocket, event_id: str):
    await _ws_loop(f"event:{event_id}", ws)

@app.websocket("/ws/car/{car_id}")
async def ws_car(ws: WebSocket, car_id: str):
    await _ws_loop(f"car:{car_id}", ws)

@app.websocket("/ws/retrievals/{event_id}")
async def ws_retrievals(ws: WebSocket, event_id: str):
    await _ws_loop(f"retrievals:{event_id}", ws)

# Ingress-friendly aliases (mounted under /api so Kubernetes ingress proxies them)
@app.websocket("/api/v1/ws/event/{event_id}")
async def ws_event_api(ws: WebSocket, event_id: str):
    await _ws_loop(f"event:{event_id}", ws)

@app.websocket("/api/v1/ws/car/{car_id}")
async def ws_car_api(ws: WebSocket, car_id: str):
    await _ws_loop(f"car:{car_id}", ws)

@app.websocket("/api/v1/ws/retrievals/{event_id}")
async def ws_retrievals_api(ws: WebSocket, event_id: str):
    await _ws_loop(f"retrievals:{event_id}", ws)

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
                        await db.parking_slots.delete_many({"event_id": e["id"]})
                        logger.info(f"Auto-closed event {e['id']}")
                except Exception as ex:
                    logger.warning(f"auto_close parse error {e.get('id')}: {ex}")
        except Exception as e:
            logger.error(f"auto_close_loop error: {e}")
        await asyncio.sleep(3600)

async def scheduled_retrieval_loop(): 
    while True: 
        try: 
            now = datetime.now(timezone.utc) 
            # Find all parked cars with a scheduled retrieval time in the past 
            cars = await db.cars.find( 
                { 
                    "status": "PARKED", 
                    "scheduled_retrieval_time": {"$ne": None, "$lte": now} 
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
                            "scheduled_retrieval_time": None, 
                            "updated_at": now_iso() 
                        }} 
                    ) 
                    updated = await db.cars.find_one({"id": car["id"]}, {"_id": 0}) 
                    await broadcast_car_update(updated) 
                    logger.info(f"Scheduled retrieval triggered for car {car['id']}") 
                except Exception as ex: 
                    logger.warning(f"Scheduled retrieval error for car {car['id']}: {ex}") 
        except Exception as e: 
            logger.error(f"scheduled_retrieval_loop error: {e}") 
        await asyncio.sleep(30)  # check every 30 seconds 

async def migrate_provider_types(): 
    await db.providers.update_many( 
        {"provider_type": {"$exists": False}}, 
        {"$set": {"provider_type": "valet_provider"}} 
    )

async def create_daily_hotel_events(): 
    today = date.today().isoformat() 
    # 1. Auto-close yesterday's hotel_daily events 
    await db.events.update_many( 
        {"event_type": "hotel_daily", "status": "active", "date": {"$lt": today}}, 
        {"$set": {"status": "closed", "auto_closed_at": now_iso()}} 
    ) 
    # 2. Create today's event for each active hotel 
    hotels = await db.hotels.find({"is_active": True}).to_list(1000) 
    for hotel in hotels: 
        existing = await db.events.find_one({"hotel_id": hotel["id"], "event_type": "hotel_daily", "date": today}) 
        if existing: 
            continue 
        event_id = str(uuid.uuid4()) 
        event = { 
            "id": event_id, 
            "provider_id": hotel["provider_id"], 
            "hotel_id": hotel["id"], 
            "event_type": "hotel_daily", 
            "name": f"{hotel['name']} — {today}", 
            "date": today, 
            "end_date": today, 
            "start_time": hotel["operating_hours_start"], 
            "end_time": hotel["operating_hours_end"], 
            "venue": hotel["address"], 
            "max_cars": hotel["total_valet_slots"], 
            "status": "active", 
            "created_at": now_iso() 
        } 
        await db.events.insert_one(event) 
        for did in hotel.get("assigned_driver_ids", []): 
            await db.event_drivers.insert_one({"id": str(uuid.uuid4()), "event_id": event_id, "driver_id": did, "status": "active"}) 
        for sid in hotel.get("assigned_supervisor_ids", []): 
            await db.event_supervisors.insert_one({"id": str(uuid.uuid4()), "event_id": event_id, "supervisor_id": sid, "status": "active"}) 

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata") 
scheduler.add_job(create_daily_hotel_events, "cron", hour=0, minute=0) 

@api_router.post("/superadmin/trigger-daily-events")
async def trigger_daily_events(user=Depends(require_roles("superadmin"))):
    await create_daily_hotel_events()
    return {"ok": True, "message": "Daily hotel events processed"}

@app.on_event("startup")
async def on_start():
    # init_storage()
    # Migration: backfill provider types
    await migrate_provider_types()
    # start scheduler
    scheduler.start()
    # indexes
    await db.parking_slots.create_index([("event_id", ASCENDING), ("zone_name", ASCENDING), ("slot_number", ASCENDING)], unique=True)
    await db.cars.create_index([("qr_token", ASCENDING)], unique=True)
    await db.cars.create_index([("event_id", ASCENDING)])
    await db.cars.create_index([("event_id", ASCENDING), ("plate", ASCENDING)])
    await db.cars.create_index([("event_id", ASCENDING), ("status", ASCENDING)])
    await db.cars.create_index([("check_in_driver_id", ASCENDING)])
    await db.cars.create_index([("retrieval_driver_id", ASCENDING)])
    await db.ratings.create_index([("car_id", ASCENDING)], unique=True)
    await db.providers.create_index([("email", ASCENDING)], unique=True)
    await db.drivers.create_index([("employee_id", ASCENDING)])
    await db.drivers.create_index([("provider_id", ASCENDING)])
    await db.events.create_index([("provider_id", ASCENDING)])
    await db.events.create_index([("status", ASCENDING)])
    await db.event_drivers.create_index([("event_id", ASCENDING)])
    await db.event_drivers.create_index([("driver_id", ASCENDING)])
    await db.parking_slots.create_index([("event_id", ASCENDING)])
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
    # seed superadmin
    if not await db.superadmins.find_one({"email": "superadmin@instapark.com"}):
        await db.superadmins.insert_one({
            "id": str(uuid.uuid4()), "name": "Super Admin",
            "email": "superadmin@instapark.com",
            "hashed_password": hash_password("Admin@123"),
            "created_at": now_iso(),
        })
        logger.info("Seeded superadmin")
    asyncio.create_task(auto_close_loop())
    asyncio.create_task(scheduled_retrieval_loop())

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