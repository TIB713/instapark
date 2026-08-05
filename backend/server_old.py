# """InstaPark Valet Parking Management Backend."""
# from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Query, Body
# from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
# from fastapi.responses import JSONResponse
# from dotenv import load_dotenv
# from starlette.middleware.cors import CORSMiddleware
# from motor.motor_asyncio import AsyncIOMotorClient
# from pymongo import ASCENDING
# from pydantic import BaseModel, EmailStr, Field
# from typing import List, Optional, Dict, Any
# from datetime import datetime, timezone, timedelta 
# from pathlib import Path
# import os, uuid, logging, asyncio, bcrypt, jwt, requests, smtplib, re
# from email.mime.text import MIMEText 
# from email.mime.multipart import MIMEMultipart 
# import cloudinary
# import cloudinary.uploader

# ROOT_DIR = Path(__file__).parent
# load_dotenv(ROOT_DIR / '.env')

# # ---- Config ----
# MONGO_URL = os.environ['MONGO_URL']
# DB_NAME = os.environ['DB_NAME']
# JWT_SECRET = os.environ['JWT_SECRET']
# JWT_EXPIRE_HOURS = int(os.environ.get('JWT_EXPIRE_HOURS', 168))
# # EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY')
# APP_NAME = os.environ.get('APP_NAME', 'instapark')
# FRONTEND_URL = os.environ.get('FRONTEND_URL', 'https://domain.com')
# SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com") 
# SMTP_PORT = int(os.environ.get("SMTP_PORT", "587")) 
# SMTP_USER = os.environ.get("SMTP_USER", "") 
# SMTP_PASS = os.environ.get("SMTP_PASS", "") 
# SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "InstaPark") 
# # STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
# # Cloudinary config
# cloudinary.config(
#     cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
#     api_key=os.environ.get('CLOUDINARY_API_KEY'),
#     api_secret=os.environ.get('CLOUDINARY_API_SECRET')
# )

# client = AsyncIOMotorClient(
#     MONGO_URL,
#     maxPoolSize=10,
#     minPoolSize=2,
#     serverSelectionTimeoutMS=5000,
#     connectTimeoutMS=5000,
#     socketTimeoutMS=30000,
# )
# db = client[DB_NAME]

# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# logger = logging.getLogger("instapark")

# app = FastAPI(title="InstaPark API")
# api_router = APIRouter(prefix="/api/v1")
# bearer = HTTPBearer(auto_error=False)

# @app.get("/health")
# def health():
#     return {
#         "status": "ok",
#         "message": "Backend is running"
#     }


# # ---- Storage ----
# # storage_key: Optional[str] = None
# # def init_storage():
# #     global storage_key
# #     if storage_key:
# #         return storage_key
# #     try:
# #         r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
# #         r.raise_for_status()
# #         storage_key = r.json()["storage_key"]
# #         return storage_key
# #     except Exception as e:
# #         logger.error(f"Storage init failed: {e}")
# #         return None

# # def put_object(path: str, data: bytes, content_type: str) -> dict:
# #     key = init_storage()
# #     if not key:
# #         raise HTTPException(500, "Storage not initialized")
# #     r = requests.put(f"{STORAGE_URL}/objects/{path}",
# #                      headers={"X-Storage-Key": key, "Content-Type": content_type},
# #                      data=data, timeout=120)
# #     r.raise_for_status()
# #     return r.json()

# def put_object(path: str, data: bytes, content_type: str) -> dict:
#     try:
#         # Convert path to cloudinary public_id (remove extension)
#         public_id = path.rsplit('.', 1)[0] if '.' in path else path
#         # Upload to Cloudinary
#         result = cloudinary.uploader.upload(
#             data,
#             public_id=f"instapark/{public_id}",
#             resource_type="image",
#             overwrite=True
#         )
#         return {
#             "url": result['secure_url'],
#             "public_id": result['public_id']
#         }
#     except Exception as e:
#         logger.error(f"Cloudinary upload failed: {e}")
#         raise HTTPException(500, f"Upload failed: {str(e)}")


# # ---- Helpers ----
# def send_sms_stub(phone: str, message: str):
#     # TODO: Replace with a real SMS provider (e.g. Twilio, MSG91, Exotel). 
#     # This stub logs the message so the full pipeline can be tested end-to-end 
#     # without incurring SMS costs. To go live, implement this function body. 
#     logger.info(f"[SMS STUB] To: {phone} | Message: {message}")

# async def send_email(to: str, subject: str, html_body: str): 
#     """Send email via SMTP. Logs to console if SMTP not configured.""" 
#     if not SMTP_USER or not SMTP_PASS: 
#         logger.info(f"[EMAIL STUB] To: {to} | Subject: {subject}") 
#         logger.info(f"[EMAIL STUB] Body: {html_body[:200]}...") 
#         return 
#     try: 
#         msg = MIMEMultipart("alternative") 
#         msg["Subject"] = subject 
#         msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>" 
#         msg["To"] = to 
#         msg.attach(MIMEText(html_body, "html")) 
#         loop = asyncio.get_event_loop() 
#         def _send(): 
#             with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server: 
#                 server.ehlo() 
#                 server.starttls() 
#                 server.login(SMTP_USER, SMTP_PASS) 
#                 server.sendmail(SMTP_USER, to, msg.as_string()) 
#         await loop.run_in_executor(None, _send) 
#         logger.info(f"[EMAIL SENT] To: {to} | Subject: {subject}") 
#     except Exception as e: 
#         logger.error(f"[EMAIL ERROR] To: {to} | Error: {e}") 

# def now_iso() -> str:
#     return datetime.now(timezone.utc).isoformat()

# def hash_password(pw: str) -> str:
#     return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

# def verify_password(pw: str, hashed: str) -> bool:
#     try:
#         return bcrypt.checkpw(pw.encode(), hashed.encode())
#     except Exception:
#         return False

# def create_token(payload: dict) -> str:
#     to_encode = payload.copy()
#     to_encode["exp"] = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
#     return jwt.encode(to_encode, JWT_SECRET, algorithm="HS256")

# def decode_token(token: str) -> dict:
#     try:
#         return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
#     except Exception:
#         raise HTTPException(401, "Invalid or expired token")

# async def get_current(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
#     if not creds:
#         raise HTTPException(401, "Not authenticated")
#     return decode_token(creds.credentials)

# def require_roles(*roles):
#     async def checker(user=Depends(get_current)):
#         if user.get("role") not in roles:
#             raise HTTPException(403, "Forbidden")
#         return user
#     return checker

# def clean(doc: dict) -> dict:
#     if doc and "_id" in doc:
#         doc.pop("_id", None)
#     return doc

# # ---- WebSocket Manager ----
# class ConnManager:
#     def __init__(self):
#         self.channels: Dict[str, List[WebSocket]] = {}

#     async def connect(self, channel: str, ws: WebSocket):
#         await ws.accept()
#         self.channels.setdefault(channel, []).append(ws)

#     def disconnect(self, channel: str, ws: WebSocket):
#         if channel in self.channels and ws in self.channels[channel]:
#             self.channels[channel].remove(ws)

#     async def broadcast(self, channel: str, message: dict):
#         for ws in list(self.channels.get(channel, [])):
#             try:
#                 await ws.send_json(message)
#             except Exception:
#                 pass

# manager = ConnManager()

# async def broadcast_car_update(car: dict):
#     cid = car["id"]
#     eid = car["event_id"]
#     await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"event:{eid}", {"type": "car_update", "data": car})
#     # For status changes that affect retrieval boards
#     if car["status"] in ("RETRIEVAL_REQUESTED", "BEING_FETCHED"):
#         await manager.broadcast(f"retrievals:{eid}", {"type": "retrieval_update", "data": car})

# # ============== AUTH ==============
# class LoginEmail(BaseModel):
#     email: str
#     password: str

# class LoginDriver(BaseModel):
#     employee_id: str
#     pin: str

# @api_router.post("/auth/superadmin/login")
# async def superadmin_login(body: LoginEmail):
#     sa = await db.superadmins.find_one({"email": body.email.lower()})
#     if not sa or not verify_password(body.password, sa["hashed_password"]):
#         raise HTTPException(401, "Invalid credentials")
#     payload = {"user_id": sa["id"], "role": "superadmin", "name": sa["name"], "email": sa["email"]}
#     token = create_token(payload)
#     return {"token": token, "superadmin": {"id": sa["id"], "name": sa["name"], "email": sa["email"]}}

# @api_router.post("/auth/admin/login")
# async def admin_login(body: LoginEmail):
#     prov = await db.providers.find_one({"email": body.email.lower()})
#     if not prov or not verify_password(body.password, prov["hashed_password"]):
#         raise HTTPException(401, "Invalid credentials")
#     if not prov.get("is_active", True):
#         raise HTTPException(403, "Provider deactivated")
#     payload = {"user_id": prov["id"], "role": "admin", "provider_id": prov["id"], "name": prov["name"]}
#     token = create_token(payload)
#     return {"token": token, "user": {"id": prov["id"], "name": prov["name"], "role": "admin", "provider_id": prov["id"]}}

# @api_router.post("/auth/driver/login")
# async def driver_login(body: LoginDriver):
#     drv = await db.drivers.find_one({"employee_id": body.employee_id.upper(), "pin": body.pin, "is_active": True})
#     if not drv:
#         raise HTTPException(401, "Invalid credentials")
#     payload = {"user_id": drv["id"], "role": drv.get("role", "driver"), "provider_id": drv["provider_id"], "name": drv["name"]}
#     token = create_token(payload)
#     return {"token": token, "driver": {"id": drv["id"], "name": drv["name"], "employee_id": drv["employee_id"], "role": drv.get("role", "driver"), "provider_id": drv["provider_id"]}}

# @api_router.get("/auth/me")
# async def me(user=Depends(get_current)):
#     return user

# # ============== PROVIDERS ==============
# class ProviderCreate(BaseModel):
#     name: str
#     email: str
#     phone: str
#     plan: str = "starter"
#     password: str

# class ProviderUpdate(BaseModel):
#     name: Optional[str] = None
#     phone: Optional[str] = None
#     plan: Optional[str] = None
#     is_active: Optional[bool] = None

# @api_router.get("/providers")
# async def list_providers(user=Depends(require_roles("superadmin"))):
#     rows = await db.providers.find({}, {"_id": 0, "hashed_password": 0}).to_list(1000)
#     return rows

# @api_router.post("/providers")
# async def create_provider(body: ProviderCreate, user=Depends(require_roles("superadmin"))):
#     if await db.providers.find_one({"email": body.email.lower()}):
#         raise HTTPException(400, "Email already exists")
#     pid = str(uuid.uuid4())
#     doc = {
#         "id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone,
#         "plan": body.plan, "is_active": True,
#         "provider_qr_token": str(uuid.uuid4()),
#         "hashed_password": hash_password(body.password),
#         "created_at": now_iso(), "updated_at": now_iso(),
#     }
#     await db.providers.insert_one(doc.copy())
#     # also create admin driver record
#     admin_drv = {
#         "id": str(uuid.uuid4()), "provider_id": pid, "name": body.name, "phone": body.phone,
#         "role": "admin", "employee_id": f"ADM{str(int(datetime.now().timestamp()))[-5:]}",
#         "pin": "0000", "is_active": True, "auth_user_id": pid, "created_at": now_iso(),
#     }
#     await db.drivers.insert_one(admin_drv)

#     # --- Email notifications ---
#     # 1. Welcome email to the new provider/admin
#     provider_welcome_html = f"""
# <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
#   <div style="background:#7C3AED;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
#     <h1 style="color:#fff;margin:0;font-size:24px;">Welcome to InstaPark! 🚗</h1> 
#   </div> 
#   <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
#     <p style="color:#374151;font-size:16px;">Hi <strong>{body.name}</strong>,</p> 
#     <p style="color:#374151;">Your InstaPark valet management account has been created. 
#     Here are your login credentials for the admin app:</p> 
#     <div style="background:#F5F3FF;border-radius:8px;padding:16px;margin:20px 0; 
#     border-left:4px solid #7C3AED;"> 
#       <p style="margin:0;color:#374151;"> 
#         <strong>Email:</strong> 
#         <span style="font-family:monospace;font-size:16px;color:#7C3AED;"> 
#           {body.email} 
#         </span> 
#       </p> 
#       <p style="margin:8px 0 0;color:#374151;"> 
#         <strong>Password:</strong> 
#         <span style="font-family:monospace;font-size:16px;color:#7C3AED;"> 
#           {body.password} 
#         </span> 
#       </p> 
#       <p style="margin:8px 0 0;color:#374151;"> 
#         <strong>Plan:</strong> 
#         <span style="font-family:monospace;font-size:16px;color:#7C3AED;"> 
#           {body.plan.upper()} 
#         </span> 
#       </p> 
#     </div> 
#     <p style="color:#6B7280;font-size:14px;"> 
#       Please log in and change your password after your first login. 
#     </p> 
#     <p style="color:#6B7280;font-size:14px;"> 
#       Download the InstaPark admin app and use your email and 
#       password to get started managing your valet operations. 
#     </p> 
#     <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
#     <p style="color:#9CA3AF;font-size:12px;text-align:center;"> 
#       InstaPark Valet Parking Management 
#     </p> 
#   </div> 
# </div>
# """
#     asyncio.create_task(send_email(
#         to=body.email,
#         subject="Welcome to InstaPark — Your Account is Ready",
#         html_body=provider_welcome_html
#     ))

#     # 2. Notification to all superadmins
#     superadmins = await db.superadmins.find(
#         {}, {"_id": 0, "email": 1, "name": 1}
#     ).to_list(100)

#     superadmin_notify_html = f"""
# <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
#   <div style="background:#0F2044;padding:24px;border-radius:12px 12px 0 0; 
#   text-align:center;"> 
#     <h1 style="color:#fff;margin:0;font-size:22px;">New Provider Onboarded</h1> 
#   </div> 
#   <div style="background:#fff;padding:24px;border:1px solid #e5e7eb; 
#   border-radius:0 0 12px 12px;"> 
#     <p style="color:#374151;"> 
#       A new valet service provider has been added to InstaPark: 
#     </p> 
#     <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
#       <p style="margin:0;color:#374151;"> 
#         <strong>Company Name:</strong> {body.name} 
#       </p> 
#       <p style="margin:8px 0 0;color:#374151;"> 
#         <strong>Email:</strong> {body.email} 
#       </p> 
#       <p style="margin:8px 0 0;color:#374151;"> 
#         <strong>Phone:</strong> {body.phone} 
#       </p> 
#       <p style="margin:8px 0 0;color:#374151;"> 
#         <strong>Plan:</strong> {body.plan.upper()} 
#       </p> 
#     </div> 
#     <p style="color:#6B7280;font-size:14px;"> 
#       Log in to your InstaPark superadmin dashboard to manage this provider. 
#     </p> 
#     <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
#     <p style="color:#9CA3AF;font-size:12px;text-align:center;"> 
#       InstaPark Valet Parking Management 
#     </p> 
#   </div> 
# </div>
# """
#     for sa in superadmins:
#         if sa.get("email"):
#             asyncio.create_task(send_email(
#                 to=sa["email"],
#                 subject=f"New Provider Onboarded — {body.name}",
#                 html_body=superadmin_notify_html
#             ))

#     return {"id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone, "plan": body.plan, "password": body.password}

# @api_router.get("/providers/{pid}")
# async def get_provider(pid: str, user=Depends(require_roles("superadmin"))):
#     p = await db.providers.find_one({"id": pid}, {"_id": 0, "hashed_password": 0})
#     if not p:
#         raise HTTPException(404, "Not found")
#     p["events"] = await db.events.find({"provider_id": pid}, {"_id": 0}).to_list(1000)
#     p["drivers"] = await db.drivers.find({"provider_id": pid, "role": "driver"}, {"_id": 0, "pin": 0}).to_list(1000)
#     return p

# @api_router.patch("/providers/{pid}")
# async def update_provider(pid: str, body: ProviderUpdate, user=Depends(require_roles("superadmin"))):
#     upd = {k: v for k, v in body.model_dump().items() if v is not None}
#     upd["updated_at"] = now_iso()
#     res = await db.providers.update_one({"id": pid}, {"$set": upd})
#     if res.matched_count == 0:
#         raise HTTPException(404, "Not found")
#     return {"ok": True}

# @api_router.get("/providers/{pid}/stats")
# async def provider_stats(pid: str, user=Depends(require_roles("superadmin"))):
#     events = await db.events.count_documents({"provider_id": pid})
#     drivers = await db.drivers.count_documents({"provider_id": pid, "role": "driver"})
#     event_ids = [e["id"] for e in await db.events.find({"provider_id": pid}, {"_id": 0, "id": 1}).to_list(1000)]
#     cars = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
#     car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"_id": 0, "id": 1}).to_list(10000)] if event_ids else []
#     ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
#     avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
#     return {"events": events, "drivers": drivers, "cars": cars, "avg_rating": avg}

# @api_router.get("/providers/me/qr-token") 
# async def get_my_provider_qr_token(user=Depends(require_roles("admin"))): 
#     """Admin fetches their own provider_qr_token for the pre-registration QR.""" 
#     provider = await db.providers.find_one( 
#         {"id": user["provider_id"]}, 
#         {"_id": 0, "provider_qr_token": 1, "name": 1} 
#     ) 
#     if not provider: 
#         raise HTTPException(404, "Provider not found") 
#     return { 
#         "provider_qr_token": provider["provider_qr_token"], 
#         "name": provider["name"] 
#     } 

# # ============== DRIVERS ==============
# class DriverCreate(BaseModel): 
#     name: str 
#     phone: str 
#     pin: str 
#     provider_id: Optional[str] = None 
#     email: str 
#     pan_number: Optional[str] = None 
#     bank_account_number: Optional[str] = None 
#     bank_ifsc: Optional[str] = None 
#     driving_license_number: Optional[str] = None 
#     driving_license_photo: Optional[str] = None 
#     driver_photo: Optional[str] = None 
 
# class DriverUpdate(BaseModel): 
#     name: Optional[str] = None 
#     phone: Optional[str] = None 
#     pin: Optional[str] = None 
#     email: Optional[str] = None 
#     pan_number: Optional[str] = None 
#     bank_account_number: Optional[str] = None 
#     bank_ifsc: Optional[str] = None 
#     driving_license_number: Optional[str] = None 
#     driving_license_photo: Optional[str] = None 
#     driver_photo: Optional[str] = None 

# @api_router.get("/drivers")
# async def list_drivers(user=Depends(get_current)):
#     role = user.get("role")
#     if role == "superadmin":
#         drv = await db.drivers.find({"role": "driver"}, {"_id": 0}).to_list(2000)
#         # join provider name
#         prov_ids = list({d["provider_id"] for d in drv})
#         provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
#         for d in drv:
#             d["provider_name"] = provs.get(d["provider_id"], "—")
#         return drv
#     if role in ("admin",):
#         return await db.drivers.find({"provider_id": user["provider_id"], "role": "driver"}, {"_id": 0}).to_list(1000)
#     raise HTTPException(403, "Forbidden")

# @api_router.post("/drivers")
# async def create_driver(body: DriverCreate, user=Depends(require_roles("admin", "superadmin"))):
#     if user.get("role") == "superadmin":
#         pid = body.provider_id
#         if not pid:
#             raise HTTPException(400, "provider_id is required when creating a driver as superadmin")
#     else:
#         pid = user.get("provider_id")
#         if not pid:
#             raise HTTPException(400, "provider_id missing")
#     eid = f"DRV{str(int(datetime.now().timestamp()))[-5:]}"
#     doc = { 
#         "id": str(uuid.uuid4()), "provider_id": pid, 
#         "name": body.name, "phone": body.phone, 
#         "email": body.email or None, 
#         "pan_number": body.pan_number or None, 
#         "bank_account_number": body.bank_account_number or None, 
#         "bank_ifsc": body.bank_ifsc or None, 
#         "driving_license_number": body.driving_license_number or None, 
#         "driving_license_photo": body.driving_license_photo or None, 
#         "driver_photo": body.driver_photo or None, 
#         "role": "driver", "employee_id": eid.upper(), "pin": body.pin, 
#         "is_active": True, "created_at": now_iso() 
#     } 
#     await db.drivers.insert_one(doc.copy())

#     # --- Email notifications --- 
#     # 1. Welcome email to driver with login credentials 
#     driver_email_html = f""" 
#     <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
#       <div style="background:#7C3AED;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
#         <h1 style="color:#fff;margin:0;font-size:24px;">Welcome to InstaPark! 🚗</h1> 
#       </div> 
#       <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
#         <p style="color:#374151;font-size:16px;">Hi <strong>{body.name}</strong>,</p> 
#         <p style="color:#374151;">You have been onboarded as a valet driver. Here are your login credentials:</p> 
#         <div style="background:#F5F3FF;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #7C3AED;"> 
#           <p style="margin:0;color:#374151;"><strong>Employee ID:</strong> <span style="font-family:monospace;font-size:18px;color:#7C3AED;">{eid.upper()}</span></p> 
#           <p style="margin:8px 0 0;color:#374151;"><strong>PIN:</strong> <span style="font-family:monospace;font-size:18px;color:#7C3AED;">{body.pin}</span></p> 
#         </div> 
#         <p style="color:#6B7280;font-size:14px;">Please keep these credentials safe. You will need them to log in to the InstaPark driver app.</p> 
#         <p style="color:#6B7280;font-size:14px;">Download the app and use your Employee ID and PIN to get started.</p> 
#         <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
#         <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
#       </div> 
#     </div> 
#     """ 
#     asyncio.create_task(send_email( 
#         to=body.email, 
#         subject="Welcome to InstaPark — Your Login Credentials", 
#         html_body=driver_email_html 
#     )) 
 
#     # 2. Notification email to admin (provider) 
#     provider = await db.providers.find_one({"id": pid}, {"_id": 0, "name": 1, "email": 1}) 
#     if provider and provider.get("email"): 
#         admin_email_html = f""" 
#         <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
#           <div style="background:#0F2044;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
#             <h1 style="color:#fff;margin:0;font-size:22px;">New Driver Onboarded</h1> 
#           </div> 
#           <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
#             <p style="color:#374151;">A new driver has been added to <strong>{provider['name']}</strong>:</p> 
#             <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
#               <p style="margin:0;color:#374151;"><strong>Name:</strong> {body.name}</p> 
#               <p style="margin:8px 0 0;color:#374151;"><strong>Employee ID:</strong> <span style="font-family:monospace;">{eid.upper()}</span></p> 
#               <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p> 
#               {"<p style='margin:8px 0 0;color:#374151;'><strong>Phone:</strong> " + body.phone + "</p>" if body.phone else ""} 
#             </div> 
#             <p style="color:#6B7280;font-size:14px;">Log in to your InstaPark dashboard to manage this driver.</p> 
#             <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
#             <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
#           </div> 
#         </div> 
#         """ 
#         asyncio.create_task(send_email( 
#             to=provider["email"], 
#             subject=f"New Driver Onboarded — {body.name}", 
#             html_body=admin_email_html 
#         )) 
 
#     # 3. Notification email to all superadmins 
#     superadmins = await db.superadmins.find({}, {"_id": 0, "email": 1, "name": 1}).to_list(100) 
#     superadmin_email_html = f""" 
#     <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"> 
#       <div style="background:#1A3C6E;padding:24px;border-radius:12px 12px 0 0;text-align:center;"> 
#         <h1 style="color:#fff;margin:0;font-size:22px;">Driver Onboarding Summary</h1> 
#       </div> 
#       <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;"> 
#         <p style="color:#374151;">A new driver has been onboarded on the InstaPark platform:</p> 
#         <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin:16px 0;"> 
#           <p style="margin:0;color:#374151;"><strong>Name:</strong> {body.name}</p> 
#           <p style="margin:8px 0 0;color:#374151;"><strong>Employee ID:</strong> <span style="font-family:monospace;">{eid.upper()}</span></p> 
#           <p style="margin:8px 0 0;color:#374151;"><strong>Email:</strong> {body.email}</p> 
#           <p style="margin:8px 0 0;color:#374151;"><strong>Provider:</strong> {provider['name'] if provider else '—'}</p> 
#           {"<p style='margin:8px 0 0;color:#374151;'><strong>PAN:</strong> " + body.pan_number + "</p>" if body.pan_number else ""} 
#           {"<p style='margin:8px 0 0;color:#374151;'><strong>License No:</strong> " + body.driving_license_number + "</p>" if body.driving_license_number else ""} 
#         </div> 
#         <p style="color:#6B7280;font-size:14px;">Log in to the SuperAdmin dashboard to view full driver details.</p> 
#         <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"> 
#         <p style="color:#9CA3AF;font-size:12px;text-align:center;">InstaPark Valet Parking Management</p> 
#       </div> 
#     </div> 
#     """ 
#     for sa in superadmins: 
#         if sa.get("email"): 
#             asyncio.create_task(send_email( 
#                 to=sa["email"], 
#                 subject=f"New Driver Onboarded — {body.name} ({provider['name'] if provider else '—'})", 
#                 html_body=superadmin_email_html 
#             )) 

#     return clean(doc)

# @api_router.get("/drivers/{did}")
# async def get_driver(did: str, user=Depends(get_current)):
#     d = await db.drivers.find_one({"id": did}, {"_id": 0})
#     if not d:
#         raise HTTPException(404, "Not found")
#     if user.get("role") == "superadmin":
#         p = await db.providers.find_one({"id": d["provider_id"]}, {"_id": 0, "name": 1})
#         d["provider_name"] = p["name"] if p else "—"
#     return d

# @api_router.patch("/drivers/{did}")
# async def update_driver(did: str, body: DriverUpdate, user=Depends(require_roles("admin", "superadmin"))):
#     upd = {k: v for k, v in body.model_dump().items() if v is not None}
#     res = await db.drivers.update_one({"id": did}, {"$set": upd})
#     if res.matched_count == 0:
#         raise HTTPException(404, "Not found")
#     return {"ok": True}

# @api_router.delete("/drivers/{did}")
# async def deactivate_driver(did: str, user=Depends(require_roles("admin", "superadmin"))):
#     await db.drivers.update_one({"id": did}, {"$set": {"is_active": False}})
#     return {"ok": True}

# @api_router.get("/drivers/{did}/stats")
# async def driver_stats(did: str, user=Depends(get_current)):
#     cars_in = await db.cars.count_documents({"check_in_driver_id": did})
#     cars_out = await db.cars.count_documents({"retrieval_driver_id": did, "status": "DELIVERED"})
#     return {"cars_checked_in": cars_in, "cars_retrieved": cars_out}

# @api_router.get("/drivers/{did}/stats/filtered")
# async def driver_stats_filtered(did: str, filter: str = "all", user=Depends(get_current)):
#     now = datetime.now(timezone.utc)
#     delta_map = {"week": 7, "month": 30, "quarter": 90}
#     q_in: dict = {"check_in_driver_id": did}
#     q_out: dict = {"retrieval_driver_id": did, "status": "DELIVERED"}
#     if filter in delta_map:
#         cutoff = (now - timedelta(days=delta_map[filter])).isoformat()
#         q_in["check_in_time"] = {"$gte": cutoff}
#         q_out["delivered_at"] = {"$gte": cutoff}
#     return {
#         "cars_checked_in": await db.cars.count_documents(q_in),
#         "cars_retrieved": await db.cars.count_documents(q_out),
#         "filter": filter,
#     }

# # ============== EVENTS ==============
# class EventCreate(BaseModel):
#     name: str
#     date: str
#     end_date: str
#     venue: str
#     max_cars: int
#     gates: List[str] = []
#     zones: List[Dict[str, Any]] = []
#     start_time: str = "00:00"
#     end_time: str = "23:59"
#     is_template: bool = False
#     provider_id: Optional[str] = None

# class EventUpdate(BaseModel):
#     name: Optional[str] = None
#     date: Optional[str] = None
#     end_date: Optional[str] = None
#     venue: Optional[str] = None
#     max_cars: Optional[int] = None
#     gates: Optional[List[str]] = None
#     zones: Optional[List[Dict[str, Any]]] = None
#     status: Optional[str] = None
#     start_time: Optional[str] = None
#     end_time: Optional[str] = None

# @api_router.get("/events")
# async def list_events(user=Depends(get_current)):
#     if user.get("role") == "superadmin":
#         return await db.events.find({}, {"_id": 0}).to_list(1000)
#     return await db.events.find({"provider_id": user["provider_id"]}, {"_id": 0}).to_list(1000)

# @api_router.get("/events/all")
# async def all_events(user=Depends(require_roles("superadmin"))):
#     events = await db.events.find({}, {"_id": 0}).to_list(2000)
#     pids = list({e["provider_id"] for e in events})
#     provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    
#     event_ids = [e["id"] for e in events]
#     if event_ids:
#         car_counts = await db.cars.aggregate([
#             {"$match": {"event_id": {"$in": event_ids}}},
#             {"$group": {"_id": "$event_id", "count": {"$sum": 1}}}
#         ]).to_list(len(event_ids))
#         car_count_map = {r["_id"]: r["count"] for r in car_counts}
#     else:
#         car_count_map = {}

#     for e in events:
#         e["provider_name"] = provs.get(e["provider_id"], "—")
#         e["cars_count"] = car_count_map.get(e["id"], 0)
#     return events

# @api_router.post("/events")
# async def create_event(body: EventCreate, user=Depends(require_roles("admin", "superadmin"))):
#     eid = str(uuid.uuid4())
#     doc = body.model_dump()
#     pid = body.provider_id if user.get("role") == "superadmin" and body.provider_id else user.get("provider_id")
#     doc.update({"id": eid, "provider_id": pid, "status": "active",
#                 "created_at": now_iso(), "updated_at": now_iso()})
#     await db.events.insert_one(doc.copy())
#     return clean(doc)

# @api_router.get("/events/{eid}")
# async def get_event(eid: str, user=Depends(get_current)):
#     e = await db.events.find_one({"id": eid}, {"_id": 0})
#     if not e:
#         raise HTTPException(404, "Not found")
#     return e

# @api_router.get("/superadmin/events/{eid}/detail")
# async def get_event_detail(eid: str, user=Depends(require_roles("superadmin"))):
#     event = await db.events.find_one({"id": eid}, {"_id": 0})
#     if not event:
#         raise HTTPException(404, "Event not found")
    
#     # Provider name
#     provider = await db.providers.find_one({"id": event["provider_id"]}, {"_id": 0, "name": 1})
#     event["provider_name"] = provider["name"] if provider else "Unknown"
    
#     # Stats
#     car_ids = [c["id"] for c in await db.cars.find({"event_id": eid}, {"_id": 0, "id": 1}).to_list(10000)]
#     ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
#     avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
#     delivered = await db.cars.find({"event_id": eid, "status": "DELIVERED"}, {"_id": 0}).to_list(10000)
#     times = []
#     for c in delivered:
#         try:
#             t1 = datetime.fromisoformat(c.get("check_in_time")) if c.get("check_in_time") else None
#             t2 = datetime.fromisoformat(c.get("delivered_at")) if c.get("delivered_at") else None
#             if t1 and t2:
#                 times.append((t2 - t1).total_seconds() / 60)
#         except Exception:
#             pass
#     avg_ret = round(sum(times) / len(times), 1) if times else 0
#     # top driver
#     pipeline = [{"$match": {"event_id": eid}}, {"$group": {"_id": "$check_in_driver_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 1}]
#     top = await db.cars.aggregate(pipeline).to_list(1)
#     top_driver = None
#     if top and top[0]["_id"]:
#         d = await db.drivers.find_one({"id": top[0]["_id"]}, {"_id": 0, "name": 1})
#         top_driver = d["name"] if d else None
    
#     event["total_cars"] = len(car_ids)
#     event["stats"] = {
#         "avg_rating": avg,
#         "avg_retrieval_minutes": avg_ret,
#         "top_driver": top_driver
#     }
    
#     # Drivers
#     pid = event["provider_id"]
#     drivers = await db.drivers.find({"provider_id": pid, "role": "driver", "is_active": True}, {"_id": 0}).to_list(1000)
#     other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
#     assignments = {a["driver_id"]: a for a in await db.event_drivers.find({"event_id": {"$in": [e["id"] for e in other_events]}}, {"_id": 0}).to_list(2000)}
#     e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
#     e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
#     other_map = {e["id"]: e for e in other_events}
#     # Batch: cars checked in per driver for this event 
#     ci_pipeline = [ 
#         {"$match": {"event_id": eid}}, 
#         {"$group": {"_id": "$check_in_driver_id", "count": {"$sum": 1}}} 
#     ] 
#     ci_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(ci_pipeline).to_list(1000)} 
 
#     # Batch: cars retrieved per driver for this event 
#     cr_pipeline = [ 
#         {"$match": {"event_id": eid, "status": "DELIVERED"}}, 
#         {"$group": {"_id": "$retrieval_driver_id", "count": {"$sum": 1}}} 
#     ] 
#     cr_map = {r["_id"]: r["count"] for r in await db.cars.aggregate(cr_pipeline).to_list(1000)} 
 
#     # Batch: assigned drivers for this event 
#     assigned_ids = {a["driver_id"] for a in await db.event_drivers.find({"event_id": eid}, {"_id": 0, "driver_id": 1}).to_list(1000)} 
 
#     for d in drivers:
#         conflict = None
#         if d["id"] in assignments:
#             other = other_map.get(assignments[d["id"]]["event_id"])
#             if other:
#                 o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
#                 o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
#                 if e_start < o_end and e_end > o_start:
#                     conflict = other["name"]
#         d["available"] = conflict is None
#         d["conflict_event_name"] = conflict
#         d["cars_checked_in"] = ci_map.get(d["id"], 0)
#         d["cars_retrieved"] = cr_map.get(d["id"], 0)
#         d["assigned"] = d["id"] in assigned_ids
    
#     event["drivers"] = drivers
#     return event

# @api_router.patch("/events/{eid}")
# async def update_event(eid: str, body: EventUpdate, user=Depends(require_roles("admin", "superadmin"))):
#     upd = {k: v for k, v in body.model_dump().items() if v is not None}
#     upd["updated_at"] = now_iso()
#     res = await db.events.update_one({"id": eid}, {"$set": upd})
#     if res.matched_count == 0:
#         raise HTTPException(404, "Not found")
#     return {"ok": True}

# @api_router.post("/events/{eid}/close")
# async def close_event(eid: str, user=Depends(require_roles("admin", "superadmin"))):
#     await db.events.update_one({"id": eid}, {"$set": {"status": "closed", "updated_at": now_iso()}})
#     await db.parking_slots.delete_many({"event_id": eid})
#     return {"ok": True}

# @api_router.get("/events/{eid}/stats")
# async def event_stats(eid: str, user=Depends(get_current)):
#     car_ids = [c["id"] for c in await db.cars.find({"event_id": eid}, {"_id": 0, "id": 1}).to_list(10000)]
#     ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
#     avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
#     delivered = await db.cars.find({"event_id": eid, "status": "DELIVERED"}, {"_id": 0}).to_list(10000)
#     times = []
#     for c in delivered:
#         try:
#             t1 = datetime.fromisoformat(c.get("check_in_time")) if c.get("check_in_time") else None
#             t2 = datetime.fromisoformat(c.get("delivered_at")) if c.get("delivered_at") else None
#             if t1 and t2:
#                 times.append((t2 - t1).total_seconds() / 60)
#         except Exception:
#             pass
#     avg_ret = round(sum(times) / len(times), 1) if times else 0
#     # top driver
#     pipeline = [{"$match": {"event_id": eid}}, {"$group": {"_id": "$check_in_driver_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 1}]
#     top = await db.cars.aggregate(pipeline).to_list(1)
#     top_driver = None
#     if top and top[0]["_id"]:
#         d = await db.drivers.find_one({"id": top[0]["_id"]}, {"_id": 0, "name": 1})
#         top_driver = d["name"] if d else None
#     return {"avg_rating": avg, "avg_retrieval_minutes": avg_ret, "top_driver": top_driver, "total_cars": len(car_ids)}

# # Event drivers
# @api_router.get("/events/{eid}/drivers")
# async def event_drivers(eid: str, user=Depends(get_current)):
#     event = await db.events.find_one({"id": eid}, {"_id": 0})
#     if not event:
#         raise HTTPException(404, "Event not found")
#     pid = event["provider_id"]
#     drivers = await db.drivers.find({"provider_id": pid, "role": "driver", "is_active": True}, {"_id": 0}).to_list(1000)
#     other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
#     assignments = {a["driver_id"]: a for a in await db.event_drivers.find({"event_id": {"$in": [e["id"] for e in other_events]}}, {"_id": 0}).to_list(2000)}
#     e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
#     e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
#     other_map = {e["id"]: e for e in other_events}
#     for d in drivers:
#         conflict = None
#         if d["id"] in assignments:
#             other = other_map.get(assignments[d["id"]]["event_id"])
#             if other:
#                 o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
#                 o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
#                 if e_start < o_end and e_end > o_start:
#                     conflict = other["name"]
#         d["available"] = conflict is None
#         d["conflict_event_name"] = conflict
#         d["cars_checked_in"] = await db.cars.count_documents({"event_id": eid, "check_in_driver_id": d["id"]})
#         d["cars_retrieved"] = await db.cars.count_documents({"event_id": eid, "retrieval_driver_id": d["id"], "status": "DELIVERED"})
#         d["assigned"] = await db.event_drivers.find_one({"event_id": eid, "driver_id": d["id"]}) is not None
#     return drivers

# @api_router.post("/events/{eid}/drivers/{did}")
# async def assign_driver(eid: str, did: str, user=Depends(require_roles("admin", "superadmin"))):
#     if await db.event_drivers.find_one({"event_id": eid, "driver_id": did}):
#         return {"ok": True}
#     await db.event_drivers.insert_one({"id": str(uuid.uuid4()), "event_id": eid, "driver_id": did, "status": "active"})
#     return {"ok": True}

# @api_router.delete("/events/{eid}/drivers/{did}")
# async def unassign_driver(eid: str, did: str, user=Depends(require_roles("admin", "superadmin"))):
#     await db.event_drivers.delete_many({"event_id": eid, "driver_id": did})
#     return {"ok": True}

# @api_router.get("/drivers/{did}/events")
# async def get_driver_events(did: str, user=Depends(require_roles("superadmin"))):
#     # event_ids from event_drivers
#     ed_ids = [a["event_id"] for a in await db.event_drivers.find({"driver_id": did}, {"_id": 0, "event_id": 1}).to_list(1000)]
#     # event_ids from cars (check-in or retrieval)
#     car_events = await db.cars.find({"$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}]}, {"_id": 0, "event_id": 1}).to_list(10000)
#     car_ids = [c["event_id"] for c in car_events]
    
#     all_eids = list(set(ed_ids + car_ids))
#     events = await db.events.find({"id": {"$in": all_eids}}, {"_id": 0}).to_list(1000)
    
#     for e in events:
#         eid = e["id"]
#         # provider name
#         provider = await db.providers.find_one({"id": e["provider_id"]}, {"_id": 0, "name": 1})
#         e["provider_name"] = provider["name"] if provider else "Unknown"
#         # stats for this driver
#         e["cars_checked_in"] = await db.cars.count_documents({"event_id": eid, "check_in_driver_id": did})
#         e["cars_retrieved"] = await db.cars.count_documents({"event_id": eid, "retrieval_driver_id": did, "status": "DELIVERED"})
        
#     return events

# @api_router.get("/drivers/{did}/events/{eid}/cars")
# async def get_driver_event_cars(did: str, eid: str, user=Depends(require_roles("superadmin"))):
#     cars = await db.cars.find({"event_id": eid, "$or": [{"check_in_driver_id": did}, {"retrieval_driver_id": did}]}, {"_id": 0}).sort("check_in_time", ASCENDING).to_list(5000)
#     for c in cars:
#         is_ci = c.get("check_in_driver_id") == did
#         is_re = c.get("retrieval_driver_id") == did
#         if is_ci and is_re:
#             c["role_in_event"] = "both"
#         elif is_ci:
#             c["role_in_event"] = "check_in"
#         else:
#             c["role_in_event"] = "retrieval"
#     return cars

# # ============== CARS ==============
# class CarCreate(BaseModel):
#     plate: str
#     color: str
#     make: str
#     notes: Optional[str] = ""
#     gate: Optional[str] = ""
#     event_id: str
#     check_in_driver_id: str
#     guest_phone: Optional[str] = None
#     guest_name: Optional[str] = None 
#     expected_arrival: Optional[str] = None 
#     pass_token: Optional[str] = None 

# class SendSmsBody(BaseModel): 
#     phone: Optional[str] = None 
 
# class ParkBody(BaseModel):
#     zone: str
#     slot: int
#     parked_driver_id: str
#     key_tag: Optional[str] = None
#     parked_photo_url: Optional[str] = None

# class PickupBody(BaseModel):
#     retrieval_driver_id: str

# class DeliverBody(BaseModel):
#     delivery_photo_url: Optional[str] = ""

# @api_router.get("/cars/event/{eid}")
# async def cars_event(eid: str, user=Depends(get_current)):
#     return await db.cars.find({"event_id": eid}, {"_id": 0}).to_list(5000)

# @api_router.get("/superadmin/events/{eid}/cars")
# async def superadmin_event_cars(eid: str, user=Depends(require_roles("superadmin"))):
#     cars = await db.cars.find({"event_id": eid}, {"_id": 0}).to_list(10000)
#     # Sort in Python: sorted(cars, key=lambda c: c.get("check_in_time") or "")
#     cars = sorted(cars, key=lambda c: c.get("check_in_time") or "")
    
#     # Batch driver lookups: collect all unique driver ids first
#     driver_ids = set()
#     for c in cars:
#         if c.get("check_in_driver_id"):
#             driver_ids.add(c["check_in_driver_id"])
#         if c.get("retrieval_driver_id"):
#             driver_ids.add(c["retrieval_driver_id"])
    
#     drivers_map = {}
#     if driver_ids:
#         # Fetch them all in one query
#         drivers_list = await db.drivers.find({"id": {"$in": list(driver_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(driver_ids))
#         drivers_map = {d["id"]: d["name"] for d in drivers_list}
        
#     for c in cars:
#         c["check_in_driver_name"] = drivers_map.get(c.get("check_in_driver_id"), "—")
#         c["retrieval_driver_name"] = drivers_map.get(c.get("retrieval_driver_id"), "—")
        
#     return cars

# @api_router.post("/cars")
# async def create_car(body: CarCreate, user=Depends(get_current)):
#     plate = body.plate.upper()
#     # Run all validation queries in parallel
#     event, current, duplicate = await asyncio.gather(
#         db.events.find_one({"id": body.event_id}, {"_id": 0}),
#         db.cars.count_documents({"event_id": body.event_id}),
#         db.cars.find_one({"event_id": body.event_id, "plate": plate}, {"_id": 0, "id": 1, "status": 1}), 
#     )
#     if not event:
#         raise HTTPException(404, "Event not found")
#     if current >= event["max_cars"]:
#         raise HTTPException(400, "Event is full")
#     if duplicate: 
#         if duplicate.get("status") == "PRE_REGISTERED": 
#             # Return existing pre-registered car for driver to complete check-in 
#             existing_car = await db.cars.find_one({"id": duplicate["id"]}, {"_id": 0}) 
#             return clean(existing_car) 
#         raise HTTPException(400, "Duplicate plate in this event") 

#     cid = str(uuid.uuid4())
#     qr_token = str(uuid.uuid4())
#     doc = {
#         "id": cid, "event_id": body.event_id, "plate": plate, "color": body.color, "make": body.make,
#         "guest_name": body.guest_name or None, 
#         "expected_arrival": body.expected_arrival or None, 
#         "status": "CHECKED_IN", "zone": None, "slot": None, "gate": body.gate,
#         "qr_token": qr_token,
#         "scheduled_retrieval_time": None,
#         "check_in_driver_id": body.check_in_driver_id, "check_in_time": now_iso(),
#         "parked_driver_id": None, "parked_at": None,
#         "retrieval_driver_id": None, "delivered_at": None,
#         "photo_url": None, "delivery_photo_url": None, "notes": body.notes,
#         "guest_phone": body.guest_phone or None,
#         "created_at": now_iso(), "updated_at": now_iso(),
#     }
#     await db.cars.insert_one(doc.copy())
#     out = clean(doc)
#     out["warning"] = current + 1 >= event["max_cars"] * 0.8
#     await manager.broadcast(f"event:{body.event_id}", {"type": "car_update", "data": out})

#     # Send SMS to guest if phone was provided at check-in 
#     if body.guest_phone: 
#         retrieval_link = f"{FRONTEND_URL}/v/{qr_token}" 
#         sms_message = ( 
#             f"Your {body.color} {body.make} is safely parked at {event['name']}. " 
#             f"Click here to request retrieval when you're ready: {retrieval_link}" 
#         ) 
#         send_sms_stub(body.guest_phone, sms_message) 

#     return out

# @api_router.post("/cars/{cid}/send-sms") 
# async def resend_car_sms(cid: str, body: SendSmsBody = SendSmsBody(), user=Depends(get_current)): 
#     """Send/resend the retrieval SMS. If a new phone is provided, update the record first.""" 
#     car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     if not car: 
#         raise HTTPException(404, "Car not found") 
 
#     # If admin provides a new/corrected number, update it on the car record 
#     phone_to_use = car.get("guest_phone") 
#     if body.phone: 
#         await db.cars.update_one( 
#             {"id": cid}, 
#             {"$set": {"guest_phone": body.phone, "updated_at": now_iso()}} 
#         ) 
#         phone_to_use = body.phone 
 
#     if not phone_to_use: 
#         raise HTTPException(400, "No guest phone number on file for this car") 
 
#     event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0}) 
#     event_name = event["name"] if event else "your event" 
#     retrieval_link = f"{FRONTEND_URL}/v/{car['qr_token']}" 
#     sms_message = ( 
#         f"Your {car['color']} {car['make']} is safely parked at {event_name}. " 
#         f"Click here to request retrieval when you're ready: {retrieval_link}" 
#     ) 
#     send_sms_stub(phone_to_use, sms_message) 
#     return {"status": "sent", "phone": phone_to_use} 

# @api_router.get("/cars/{cid}")
# async def get_car(cid: str, user=Depends(get_current)):
#     c = await db.cars.find_one({"id": cid}, {"_id": 0})
#     if not c:
#         raise HTTPException(404, "Not found")
#     return c

# @api_router.patch("/cars/{cid}/park")
# async def park_car(cid: str, body: ParkBody, user=Depends(get_current)):
#     upd = {
#         "status": "PARKED",
#         "zone": body.zone,
#         "slot": body.slot,
#         "parked_driver_id": body.parked_driver_id,
#         "parked_at": now_iso(),
#         "updated_at": now_iso(),
#         "key_tag": body.key_tag,
#         "parked_photo_url": body.parked_photo_url
#     }
#     await db.cars.update_one({"id": cid}, {"$set": upd})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await db.parking_slots.update_one(
#         {"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot},
#         {"$set": {"is_occupied": True, "car_id": cid}}, upsert=True)
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     slot = await db.parking_slots.find_one({"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "slot_update", "data": slot})
#     return car

# @api_router.patch("/cars/{cid}/request-retrieval")
# async def request_retrieval(cid: str):
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     if not car:
#         raise HTTPException(404, "Not found")
#     await db.cars.update_one({"id": cid}, {"$set": {"status": "RETRIEVAL_REQUESTED", "updated_at": now_iso()}})
#     rid = str(uuid.uuid4())
#     await db.retrieval_requests.insert_one({"id": rid, "car_id": cid, "driver_id": None, "status": "PENDING",
#                                             "requested_at": now_iso(), "updated_at": now_iso()})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
#     return car

# @api_router.patch("/cars/{cid}/schedule-retrieval") 
# async def schedule_retrieval(cid: str, body: dict = Body(...)): 
#     car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     if not car: 
#         raise HTTPException(404, "Car not found") 
#     if car["status"] not in ("PARKED",): 
#         raise HTTPException(400, "Car must be parked to schedule retrieval") 
    
#     scheduled_time_str = body.get("scheduled_time") 
#     if not scheduled_time_str: 
#         raise HTTPException(400, "scheduled_time is required") 
    
#     # Normalize the datetime string — add :00 seconds if missing 
#     # (datetime-local input sends "2026-05-20T15:30" without seconds) 
#     try: 
#         if len(scheduled_time_str) == 16: 
#             scheduled_time_str = scheduled_time_str + ":00" 
#         # Handle both with and without timezone suffix 
#         if scheduled_time_str.endswith("Z"): 
#             scheduled_time_str = scheduled_time_str[:-1] + "+00:00" 
#         scheduled_dt = datetime.fromisoformat(scheduled_time_str) 
#         if scheduled_dt.tzinfo is None: 
#             scheduled_dt = scheduled_dt.replace(tzinfo=timezone.utc) 
#     except ValueError: 
#         raise HTTPException(400, "Invalid datetime format. Expected ISO format.") 
 
#     # Validate time constraints OUTSIDE the try/except so 
#     # HTTPException is not accidentally caught 
#     now = datetime.now(timezone.utc) 
#     if scheduled_dt <= now: 
#         raise HTTPException(400, "Scheduled time must be in the future") 
#     if scheduled_dt > now + timedelta(hours=12): 
#         raise HTTPException(400, "Cannot schedule more than 12 hours ahead") 
    
#     await db.cars.update_one( 
#         {"id": cid}, 
#         {"$set": { 
#             "scheduled_retrieval_time": scheduled_dt, 
#             "status": "PARKED", 
#             "updated_at": now_iso() 
#         }} 
#     ) 
#     updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     await broadcast_car_update(updated) 
#     return clean(updated) 

# @api_router.patch("/cars/{cid}/schedule-retrieval/cancel") 
# async def cancel_scheduled_retrieval(cid: str): 
#     car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     if not car: 
#         raise HTTPException(404, "Car not found") 
#     if not car.get("scheduled_retrieval_time"): 
#         raise HTTPException(400, "No scheduled retrieval to cancel") 
#     await db.cars.update_one( 
#         {"id": cid}, 
#         {"$set": { 
#             "scheduled_retrieval_time": None, 
#             "updated_at": now_iso() 
#         }} 
#     ) 
#     updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     await broadcast_car_update(updated) 
#     return clean(updated) 

# @api_router.patch("/cars/{cid}/pickup")
# async def pickup_car(cid: str, body: PickupBody, user=Depends(get_current)):
#     await db.cars.update_one({"id": cid}, {"$set": {"status": "BEING_FETCHED", "retrieval_driver_id": body.retrieval_driver_id, "updated_at": now_iso()}})
#     await db.retrieval_requests.update_one({"car_id": cid, "status": "PENDING"},
#                                            {"$set": {"status": "ASSIGNED", "driver_id": body.retrieval_driver_id, "updated_at": now_iso()}})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
#     return car

# @api_router.patch("/cars/{cid}/deliver")
# async def deliver_car(cid: str, body: DeliverBody, user=Depends(get_current)):
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     if not car:
#         raise HTTPException(404, "Not found")
#     await db.cars.update_one({"id": cid}, {"$set": {"status": "DELIVERED", "delivery_photo_url": body.delivery_photo_url,
#                                                    "delivered_at": now_iso(), "updated_at": now_iso()}})
#     await db.retrieval_requests.update_one({"car_id": cid}, {"$set": {"status": "COMPLETED", "updated_at": now_iso()}})
#     if car.get("zone") and car.get("slot") is not None:
#         await db.parking_slots.update_one(
#             {"event_id": car["event_id"], "zone_name": car["zone"], "slot_number": car["slot"]},
#             {"$set": {"is_occupied": False, "car_id": None}})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     return car

# @api_router.patch("/cars/{cid}/update-photo")
# async def update_car_photo(cid: str, body: dict, user=Depends(get_current)):
#     await db.cars.update_one(
#         {"id": cid},
#         {"$set": {"delivery_photo_url": body.get("delivery_photo_url", ""), "updated_at": now_iso()}}
#     )
#     return {"ok": True}

# @api_router.delete("/cars/{cid}")
# async def delete_car(cid: str, user=Depends(get_current)):
#     await db.cars.delete_one({"id": cid})
#     return {"ok": True}

# @api_router.get("/pre-register/{provider_qr_token}") 
# async def get_preregister_page(provider_qr_token: str): 
#     """Public route — returns provider info + active/upcoming events.""" 
#     provider = await db.providers.find_one( 
#         {"provider_qr_token": provider_qr_token}, 
#         {"_id": 0, "id": 1, "name": 1, "phone": 1} 
#     ) 
#     if not provider: 
#         raise HTTPException(404, "Invalid registration link") 
#     events = await db.events.find( 
#         { 
#             "provider_id": provider["id"], 
#             "status": {"$in": ["active", "upcoming"]} 
#         }, 
#         {"_id": 0, "id": 1, "name": 1, "date": 1, "venue": 1, "start_time": 1} 
#     ).to_list(50) 
#     return {"provider": provider, "events": events} 
 
 
# @api_router.post("/pre-register/{provider_qr_token}") 
# async def create_preregistration(provider_qr_token: str, body: dict = Body(...)): 
#     """Public route — guest pre-registers their vehicle.""" 
#     provider = await db.providers.find_one( 
#         {"provider_qr_token": provider_qr_token}, 
#         {"_id": 0, "id": 1, "name": 1} 
#     ) 
#     if not provider: 
#         raise HTTPException(404, "Invalid registration link") 
 
#     event_id = body.get("event_id") 
#     guest_name = body.get("guest_name", "").strip() 
#     guest_phone = body.get("guest_phone", "").strip() 
#     plate = body.get("plate", "").strip().upper() 
#     make = body.get("make", "").strip() 
#     color = body.get("color", "").strip() 
#     expected_arrival = body.get("expected_arrival", "") 
 
#     # Validate required fields 
#     if not all([event_id, guest_name, guest_phone, plate, make, color]): 
#         raise HTTPException(400, "All fields are required") 
#     if not re.match(r"^\d{10}$", guest_phone): 
#         raise HTTPException(400, "Invalid phone number — must be 10 digits") 
 
#     # Validate event belongs to provider 
#     event = await db.events.find_one( 
#         {"id": event_id, "provider_id": provider["id"]}, 
#         {"_id": 0, "name": 1, "max_cars": 1} 
#     ) 
#     if not event: 
#         raise HTTPException(404, "Event not found") 
 
#     # Check if already pre-registered for this event 
#     existing = await db.cars.find_one( 
#         {"event_id": event_id, "plate": plate}, 
#         {"_id": 0, "id": 1, "qr_token": 1, "status": 1} 
#     ) 
#     if existing: 
#         if existing["status"] == "PRE_REGISTERED": 
#             # Already pre-registered — resend SMS and return pass token 
#             retrieval_link = f"{FRONTEND_URL}/pass/{existing['qr_token']}" 
#             sms_message = ( 
#                 f"Hi {guest_name}! Your {color} {make} ({plate}) is pre-registered " 
#                 f"for {event['name']}. Show this QR to the valet on arrival: {retrieval_link}" 
#             ) 
#             send_sms_stub(guest_phone, sms_message) 
#             return {"pass_token": existing["qr_token"], "already_registered": True} 
#         else: 
#             raise HTTPException(400, "This plate is already checked in for this event") 
 
#     # Check event capacity 
#     current_count = await db.cars.count_documents({"event_id": event_id}) 
#     if current_count >= event["max_cars"]: 
#         raise HTTPException(400, "Event is at full capacity") 
 
#     # Create pre-registered car record 
#     cid = str(uuid.uuid4()) 
#     pass_token = str(uuid.uuid4()) 
#     doc = { 
#         "id": cid, 
#         "event_id": event_id, 
#         "plate": plate, 
#         "color": color, 
#         "make": make, 
#         "guest_name": guest_name, 
#         "guest_phone": guest_phone, 
#         "expected_arrival": expected_arrival or None, 
#         "status": "PRE_REGISTERED", 
#         "qr_token": pass_token, 
#         "scheduled_retrieval_time": None, 
#         "zone": None, "slot": None, "gate": None, 
#         "check_in_driver_id": None, "check_in_time": None, 
#         "parked_driver_id": None, "parked_at": None, 
#         "retrieval_driver_id": None, "delivered_at": None, 
#         "photo_url": None, "delivery_photo_url": None, 
#         "notes": "", 
#         "created_at": now_iso(), "updated_at": now_iso(), 
#     } 
#     await db.cars.insert_one(doc.copy()) 
 
#     # Send SMS with pass link 
#     pass_link = f"{FRONTEND_URL}/pass/{pass_token}" 
#     sms_message = ( 
#         f"Hi {guest_name}! Your {color} {make} ({plate}) is pre-registered " 
#         f"for {event['name']} at {provider['name']}. " 
#         f"Show this QR to the valet on arrival for fast check-in: {pass_link} " 
#         f"Please wait while they photograph your vehicle." 
#     ) 
#     send_sms_stub(guest_phone, sms_message) 
 
#     return {"pass_token": pass_token, "already_registered": False} 

# @api_router.get("/pass/{pass_token}") 
# async def get_pass(pass_token: str): 
#     """Public route — returns car details for driver QR scanner.""" 
#     car = await db.cars.find_one({"qr_token": pass_token}, {"_id": 0}) 
#     if not car: 
#         raise HTTPException(404, "Invalid pass") 
#     event = await db.events.find_one( 
#         {"id": car["event_id"]}, 
#         {"_id": 0, "name": 1, "venue": 1, "date": 1} 
#     ) 
#     return { 
#         "car_id": car["id"], 
#         "pass_token": pass_token, 
#         "plate": car["plate"], 
#         "make": car["make"], 
#         "color": car["color"], 
#         "guest_name": car.get("guest_name"), 
#         "guest_phone": car.get("guest_phone"), 
#         "expected_arrival": car.get("expected_arrival"), 
#         "status": car["status"], 
#         "event_id": car["event_id"], 
#         "event_name": event["name"] if event else "—", 
#         "event_venue": event["venue"] if event else "—", 
#     } 

# @api_router.patch("/cars/{cid}/complete-checkin") 
# async def complete_checkin(cid: str, body: dict = Body(...), user=Depends(get_current)): 
#     """Driver completes check-in for a PRE_REGISTERED car.""" 
#     car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     if not car: 
#         raise HTTPException(404, "Car not found") 
#     if car["status"] != "PRE_REGISTERED": 
#         raise HTTPException(400, "Car is not in PRE_REGISTERED status") 
 
#     update = { 
#         "status": "CHECKED_IN", 
#         "check_in_driver_id": body.get("check_in_driver_id"), 
#         "check_in_time": now_iso(), 
#         "gate": body.get("gate", ""), 
#         "updated_at": now_iso(), 
#     } 
#     # Allow updating make/color/plate in case guest made typo 
#     if body.get("make"): update["make"] = body["make"] 
#     if body.get("color"): update["color"] = body["color"] 
#     if body.get("notes"): update["notes"] = body["notes"] 
 
#     await db.cars.update_one({"id": cid}, {"$set": update}) 
#     updated = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     await broadcast_car_update(updated) 
#     await manager.broadcast( 
#         f"event:{car['event_id']}", 
#         {"type": "car_update", "data": clean(updated)} 
#     ) 
#     return clean(updated) 

# # ============== CAR PHOTOS ==============
# class PhotosBody(BaseModel):
#     urls: List[str]
#     type: str

# @api_router.post("/cars/{cid}/photos")
# async def save_photos(cid: str, body: PhotosBody, user=Depends(get_current)):
#     docs = [{"id": str(uuid.uuid4()), "car_id": cid, "url": u, "type": body.type, "created_at": now_iso()} for u in body.urls]
#     if docs:
#         await db.car_photos.insert_many(docs)
#     if body.type == "checkin" and body.urls:
#         await db.cars.update_one({"id": cid}, {"$set": {"photo_url": body.urls[0]}})
#     return {"ok": True, "count": len(docs)}

# @api_router.get("/cars/{cid}/photos")
# async def get_photos(cid: str, user=Depends(get_current)):
#     return await db.car_photos.find({"car_id": cid}, {"_id": 0}).to_list(1000)

# @api_router.get("/cars/{cid}/log") 
# async def get_car_log(cid: str, user=Depends(get_current)): 
#     """Returns complete timeline log for a single car.""" 
#     car = await db.cars.find_one({"id": cid}, {"_id": 0}) 
#     if not car: 
#         raise HTTPException(404, "Car not found") 

#     # Fetch all driver names in one query 
#     driver_ids = list(filter(None, [ 
#         car.get("check_in_driver_id"), 
#         car.get("parked_driver_id"), 
#         car.get("retrieval_driver_id"), 
#     ])) 
#     drivers_list = await db.drivers.find( 
#         {"id": {"$in": driver_ids}}, 
#         {"_id": 0, "id": 1, "name": 1} 
#     ).to_list(10) 
#     drivers_map = {d["id"]: d["name"] for d in drivers_list} 

#     # Fetch photos grouped by type 
#     photos = await db.car_photos.find( 
#         {"car_id": cid}, {"_id": 0} 
#     ).to_list(100) 
#     photos_by_type = {} 
#     for p in photos: 
#         photos_by_type.setdefault(p["type"], []).append(p["url"]) 

#     # Fetch incidents for this car 
#     incidents = await db.incidents.find( 
#         {"car_id": cid}, {"_id": 0} 
#     ).sort("created_at", 1).to_list(50) 

#     # Fetch rating 
#     rating = await db.ratings.find_one( 
#         {"car_id": cid}, {"_id": 0} 
#     ) 

#     # Calculate durations 
#     total_minutes = None 
#     retrieval_minutes = None 
#     try: 
#         if car.get("check_in_time") and car.get("delivered_at"): 
#             t1 = datetime.fromisoformat(car["check_in_time"]) 
#             t2 = datetime.fromisoformat(car["delivered_at"]) 
#             total_minutes = round( 
#                 (t2 - t1).total_seconds() / 60, 1 
#             ) 
#         if car.get("updated_at") and car.get("parked_at"): 
#             if car.get("status") in [ 
#                 "RETRIEVAL_REQUESTED", "BEING_FETCHED", "DELIVERED" 
#             ]: 
#                 t1 = datetime.fromisoformat(car["parked_at"]) 
#                 t2 = datetime.fromisoformat( 
#                     car.get("delivered_at") or car["updated_at"] 
#                 ) 
#                 retrieval_minutes = round( 
#                     (t2 - t1).total_seconds() / 60, 1 
#                 ) 
#     except Exception: 
#         pass 

#     return { 
#         "car": car, 
#         "drivers_map": drivers_map, 
#         "photos_by_type": photos_by_type, 
#         "incidents": incidents, 
#         "rating": rating["stars"] if rating else None, 
#         "total_minutes": total_minutes, 
#         "retrieval_minutes": retrieval_minutes, 
#     } 

# # ============== SLOTS ==============
# @api_router.get("/slots/event/{eid}")
# async def slots_event(eid: str, user=Depends(get_current)):
#     return await db.parking_slots.find({"event_id": eid}, {"_id": 0}).to_list(5000)

# @api_router.post("/slots/event/{eid}/initialize")
# async def init_slots(eid: str, user=Depends(get_current)):
#     event = await db.events.find_one({"id": eid}, {"_id": 0})
#     if not event:
#         raise HTTPException(404, "Event not found")
#     # Bulk fetch all existing slots in one query
#     existing_slots = await db.parking_slots.find(
#         {"event_id": eid}, {"_id": 0, "zone_name": 1, "slot_number": 1}
#     ).to_list(5000)
#     existing_set = {(s["zone_name"], s["slot_number"]) for s in existing_slots}
#     # Build all missing slots at once
#     to_insert = []
#     for zone in event.get("zones", []):
#         zname = zone.get("name")
#         count = int(zone.get("slots", 0))
#         for i in range(1, count + 1):
#             if (zname, i) not in existing_set:
#                 to_insert.append({
#                     "id": str(uuid.uuid4()), "event_id": eid, "zone_name": zname,
#                     "slot_number": i, "car_id": None, "is_occupied": False, "created_at": now_iso(),
#                 })
#     # Single bulk insert instead of N inserts
#     if to_insert:
#         await db.parking_slots.insert_many(to_insert, ordered=False)
#     slots = await db.parking_slots.find({"event_id": eid}, {"_id": 0}).to_list(5000)
#     await manager.broadcast(f"event:{eid}", {"type": "slot_update", "data": {"slots": slots}})
#     return {"ok": True, "created": len(to_insert), "total": len(slots)}

# # ============== RETRIEVALS ==============
# @api_router.get("/retrievals/event/{eid}")
# async def event_retrievals(eid: str, user=Depends(get_current)):
#     return await db.cars.find({"event_id": eid, "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}}, {"_id": 0}).to_list(1000)

# class RetrievalBody(BaseModel):
#     car_id: str

# @api_router.post("/retrievals")
# async def create_retrieval(body: RetrievalBody):
#     return await request_retrieval(body.car_id)  # type: ignore

# # ============== RATINGS ==============
# class RatingBody(BaseModel):
#     car_id: str
#     stars: int

# @api_router.post("/ratings")
# async def post_rating(body: RatingBody):
#     if body.stars < 1 or body.stars > 5:
#         raise HTTPException(400, "Stars must be 1-5")
#     existing = await db.ratings.find_one({"car_id": body.car_id})
#     if existing:
#         return {"ok": True, "duplicate": True}
#     await db.ratings.insert_one({"id": str(uuid.uuid4()), "car_id": body.car_id, "stars": body.stars, "created_at": now_iso()})
#     return {"ok": True}

# # ============== INCIDENTS ==============

# @api_router.post("/incidents") 
# async def create_incident( 
#     body: dict = Body(...), 
#     user=Depends(require_roles("admin")) 
# ): 
#     event_id = body.get("event_id") 
#     car_id = body.get("car_id") 
#     driver_id = body.get("driver_id") 
#     description = body.get("description", "").strip() 
#     photo_url = body.get("photo_url", None) 

#     if not all([event_id, car_id, description]): 
#         raise HTTPException( 
#             400, "event_id, car_id and description are required" 
#         ) 

#     car = await db.cars.find_one( 
#         {"id": car_id, "event_id": event_id}, 
#         {"_id": 0, "plate": 1, "make": 1, "color": 1} 
#     ) 
#     if not car: 
#         raise HTTPException(404, "Car not found in this event") 

#     event = await db.events.find_one( 
#         {"id": event_id}, {"_id": 0, "name": 1} 
#     ) 

#     driver_name = None 
#     if driver_id: 
#         drv = await db.drivers.find_one( 
#             {"id": driver_id}, {"_id": 0, "name": 1} 
#         ) 
#         driver_name = drv["name"] if drv else None 

#     incident = { 
#         "id": str(uuid.uuid4()), 
#         "event_id": event_id, 
#         "event_name": event["name"] if event else "", 
#         "car_id": car_id, 
#         "plate": car["plate"], 
#         "make": car.get("make", ""), 
#         "color": car.get("color", ""), 
#         "driver_id": driver_id or None, 
#         "driver_name": driver_name, 
#         "description": description, 
#         "photo_url": photo_url, 
#         "reported_by_provider": user["provider_id"], 
#         "created_at": now_iso(), 
#     } 
#     await db.incidents.insert_one(incident.copy()) 
#     incident.pop("_id", None) 
#     return incident 

# @api_router.get("/incidents/event/{eid}") 
# async def get_event_incidents( 
#     eid: str, 
#     user=Depends(require_roles("admin")) 
# ): 
#     incidents = await db.incidents.find( 
#         {"event_id": eid}, {"_id": 0} 
#     ).sort("created_at", -1).to_list(1000) 
#     return incidents 

# @api_router.get("/incidents/car/{cid}") 
# async def get_car_incidents(cid: str, user=Depends(get_current)): 
#     incidents = await db.incidents.find( 
#         {"car_id": cid}, {"_id": 0} 
#     ).sort("created_at", -1).to_list(100) 
#     return incidents

# # ============== QR (no auth) ==============
# @api_router.get("/qr/{token}")
# async def get_by_qr(token: str):
#     car = await db.cars.find_one({"qr_token": token}, {"_id": 0})
#     if not car:
#         raise HTTPException(404, "Invalid QR token")
#     event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0, "name": 1})
#     car["event_name"] = event["name"] if event else "Event"
#     return car

# # ============== UPLOAD ==============
# # @api_router.post("/upload")
# # async def upload(file: UploadFile = File(...), folder: str = Form("misc"), user=Depends(get_current)):
# #     ext = file.filename.split(".")[-1] if "." in (file.filename or "") else "bin"
# #     path = f"{APP_NAME}/{folder}/{uuid.uuid4()}.{ext}"
# #     data = await file.read()
# #     result = put_object(path, data, file.content_type or "application/octet-stream")
# #     public_url = f"{STORAGE_URL}/objects/{result['path']}"
# #     return {"url": public_url, "path": result["path"]}

# @api_router.post("/upload")
# async def upload(file: UploadFile = File(...), folder: str = Form("misc"), user=Depends(get_current)):
#     data = await file.read()
#     ext = file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg'
#     path = f"{folder}/{uuid.uuid4()}.{ext}"
#     result = put_object(path, data, file.content_type or "application/octet-stream")
#     return {"url": result["url"], "path": path}



# # ============== SUPERADMIN STATS ==============
# @api_router.get("/superadmin/stats")
# async def super_stats(user=Depends(require_roles("superadmin"))):
#     total_p = await db.providers.count_documents({})
#     active_p = await db.providers.count_documents({"is_active": True})
#     active_e = await db.events.count_documents({"status": "active"})
#     total_d = await db.drivers.count_documents({"role": "driver"})
#     total_c = await db.cars.count_documents({})
#     ratings = await db.ratings.find({}, {"_id": 0}).to_list(20000)
#     avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
#     return {"total_providers": total_p, "active_providers": active_p, "active_events": active_e,
#             "total_drivers": total_d, "total_cars": total_c, "platform_avg_rating": avg}

# @api_router.get("/superadmin/cars") 
# async def superadmin_cars_list(user=Depends(require_roles("superadmin"))): 
#     # Get all cars 
#     all_cars = await db.cars.find({}, {"_id": 0}).to_list(50000) 
    
#     # Group by plate 
#     plate_map = {} 
#     for c in all_cars: 
#         plate = c["plate"] 
#         if plate not in plate_map: 
#             plate_map[plate] = { 
#                 "plate": plate, 
#                 "make": c.get("make", ""), 
#                 "color": c.get("color", ""), 
#                 "total_visits": 0, 
#                 "last_seen": None, 
#                 "last_event_id": None, 
#                 "has_active": False, 
#             } 
#         plate_map[plate]["total_visits"] += 1 
#         # Track latest check-in 
#         ci = c.get("check_in_time") 
#         if ci and (plate_map[plate]["last_seen"] is None or ci > plate_map[plate]["last_seen"]): 
#             plate_map[plate]["last_seen"] = ci 
#             plate_map[plate]["last_event_id"] = c.get("event_id") 
#         # If any record is not delivered, it's currently active 
#         if c.get("status") != "DELIVERED": 
#             plate_map[plate]["has_active"] = True 
    
#     # Enrich with event names for last_event_id 
#     event_ids = list({v["last_event_id"] for v in plate_map.values() if v["last_event_id"]}) 
#     events_map = {} 
#     if event_ids: 
#         evs = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(event_ids)) 
#         events_map = {e["id"]: e["name"] for e in evs} 
    
#     result = [] 
#     for v in plate_map.values(): 
#         v["last_event_name"] = events_map.get(v["last_event_id"], "—") 
#         result.append(v) 
    
#     # Sort by last_seen descending 
#     result.sort(key=lambda x: x["last_seen"] or "", reverse=True) 
#     return result 

# @api_router.get("/superadmin/cars/{plate}/history") 
# async def superadmin_car_history(plate: str, user=Depends(require_roles("superadmin"))): 
#     plate = plate.upper() 
#     # All records for this plate 
#     records = await db.cars.find({"plate": plate}, {"_id": 0}).sort("check_in_time", ASCENDING).to_list(1000) 
#     if not records: 
#         raise HTTPException(404, "No records found for this plate") 
    
#     # Batch fetch events 
#     event_ids = list({r["event_id"] for r in records}) 
#     events = await db.events.find({"id": {"$in": event_ids}}, {"_id": 0}).to_list(len(event_ids)) 
#     events_map = {e["id"]: e for e in events} 
    
#     # Batch fetch provider names 
#     provider_ids = list({e.get("provider_id") for e in events if e.get("provider_id")}) 
#     providers = await db.providers.find({"id": {"$in": provider_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(provider_ids)) 
#     providers_map = {p["id"]: p["name"] for p in providers} 
    
#     # Batch fetch all driver ids 
#     driver_ids = set() 
#     for r in records: 
#         for f in ["check_in_driver_id", "parked_driver_id", "retrieval_driver_id"]: 
#             if r.get(f): 
#                 driver_ids.add(r[f]) 
#     drivers = await db.drivers.find({"id": {"$in": list(driver_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(driver_ids)) 
#     drivers_map = {d["id"]: d["name"] for d in drivers} 
    
#     # Batch fetch all photos for these car ids 
#     car_ids = [r["id"] for r in records] 
#     photos = await db.car_photos.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(5000) 
#     photos_by_car = {} 
#     for p in photos: 
#         photos_by_car.setdefault(p["car_id"], []).append(p) 
    
#     # Batch fetch ratings 
#     ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(1000) 
#     ratings_map = {r["car_id"]: r["stars"] for r in ratings} 
    
#     # Build enriched visit records 
#     visits = [] 
#     for r in records: 
#         event = events_map.get(r["event_id"], {}) 
#         provider_id = event.get("provider_id") 
        
#         # Calculate duration in minutes 
#         duration_minutes = None 
#         try: 
#             if r.get("check_in_time") and r.get("delivered_at"): 
#                 t1 = datetime.fromisoformat(r["check_in_time"]) 
#                 t2 = datetime.fromisoformat(r["delivered_at"]) 
#                 duration_minutes = round((t2 - t1).total_seconds() / 60, 1) 
#         except Exception: 
#             pass 
        
#         visits.append({ 
#             "car_id": r["id"], 
#             "event_id": r["event_id"], 
#             "event_name": event.get("name", "—"), 
#             "event_date": event.get("date", "—"), 
#             "provider_name": providers_map.get(provider_id, "—"), 
#             "status": r.get("status"), 
#             "gate": r.get("gate", "—"), 
#             "zone": r.get("zone"), 
#             "slot": r.get("slot"), 
#             "check_in_time": r.get("check_in_time"), 
#             "parked_at": r.get("parked_at"), 
#             "delivered_at": r.get("delivered_at"), 
#             "duration_minutes": duration_minutes, 
#             "check_in_driver": drivers_map.get(r.get("check_in_driver_id"), "—"), 
#             "parked_by": drivers_map.get(r.get("parked_driver_id"), "—"), 
#             "retrieved_by": drivers_map.get(r.get("retrieval_driver_id"), "—"), 
#             "notes": r.get("notes", ""), 
#             "rating": ratings_map.get(r["id"]), 
#             "photos": photos_by_car.get(r["id"], []), 
#         }) 
    
#     # Summary stats 
#     delivered_visits = [v for v in visits if v["status"] == "DELIVERED"] 
#     durations = [v["duration_minutes"] for v in delivered_visits if v["duration_minutes"] is not None] 
    
#     return { 
#         "plate": plate, 
#         "make": records[-1].get("make", ""), 
#         "color": records[-1].get("color", ""), 
#         "total_visits": len(visits), 
#         "first_seen": records[0].get("check_in_time"), 
#         "last_seen": records[-1].get("check_in_time"), 
#         "avg_duration_minutes": round(sum(durations) / len(durations), 1) if durations else None, 
#         "visits": visits, 
#     }

# # ============== WEBSOCKETS ==============
# async def _ws_loop(channel: str, ws: WebSocket):
#     await manager.connect(channel, ws)
#     try:
#         while True:
#             await ws.receive_text()
#     except WebSocketDisconnect:
#         manager.disconnect(channel, ws)

# # Spec-compliant paths
# @app.websocket("/ws/event/{event_id}")
# async def ws_event(ws: WebSocket, event_id: str):
#     await _ws_loop(f"event:{event_id}", ws)

# @app.websocket("/ws/car/{car_id}")
# async def ws_car(ws: WebSocket, car_id: str):
#     await _ws_loop(f"car:{car_id}", ws)

# @app.websocket("/ws/retrievals/{event_id}")
# async def ws_retrievals(ws: WebSocket, event_id: str):
#     await _ws_loop(f"retrievals:{event_id}", ws)

# # Ingress-friendly aliases (mounted under /api so Kubernetes ingress proxies them)
# @app.websocket("/api/v1/ws/event/{event_id}")
# async def ws_event_api(ws: WebSocket, event_id: str):
#     await _ws_loop(f"event:{event_id}", ws)

# @app.websocket("/api/v1/ws/car/{car_id}")
# async def ws_car_api(ws: WebSocket, car_id: str):
#     await _ws_loop(f"car:{car_id}", ws)

# @app.websocket("/api/v1/ws/retrievals/{event_id}")
# async def ws_retrievals_api(ws: WebSocket, event_id: str):
#     await _ws_loop(f"retrievals:{event_id}", ws)

# # ============== STARTUP ==============
# async def auto_close_loop():
#     while True:
#         try:
#             now = datetime.now(timezone.utc)
#             events = await db.events.find({"status": "active"}, {"_id": 0}).to_list(2000)
#             for e in events:
#                 try:
#                     end_dt = datetime.fromisoformat(f'{e["end_date"]}T{e.get("end_time","23:59")}:00+00:00')
#                     if now > end_dt:
#                         await db.events.update_one({"id": e["id"]}, {"$set": {"status": "closed", "updated_at": now_iso()}})
#                         await db.parking_slots.delete_many({"event_id": e["id"]})
#                         logger.info(f"Auto-closed event {e['id']}")
#                 except Exception as ex:
#                     logger.warning(f"auto_close parse error {e.get('id')}: {ex}")
#         except Exception as e:
#             logger.error(f"auto_close_loop error: {e}")
#         await asyncio.sleep(3600)

# async def scheduled_retrieval_loop(): 
#     while True: 
#         try: 
#             now = datetime.now(timezone.utc) 
#             # Find all parked cars with a scheduled retrieval time in the past 
#             cars = await db.cars.find( 
#                 { 
#                     "status": "PARKED", 
#                     "scheduled_retrieval_time": {"$ne": None, "$lte": now} 
#                 }, 
#                 {"_id": 0} 
#             ).to_list(1000) 
#             if cars: 
#                 logger.info(f"[SCHEDULER] Found {len(cars)} car(s) due for retrieval") 
#             for car in cars: 
#                 try: 
#                     await db.cars.update_one( 
#                         {"id": car["id"]}, 
#                         {"$set": { 
#                             "status": "RETRIEVAL_REQUESTED", 
#                             "scheduled_retrieval_time": None, 
#                             "updated_at": now_iso() 
#                         }} 
#                     ) 
#                     updated = await db.cars.find_one({"id": car["id"]}, {"_id": 0}) 
#                     await broadcast_car_update(updated) 
#                     logger.info(f"Scheduled retrieval triggered for car {car['id']}") 
#                 except Exception as ex: 
#                     logger.warning(f"Scheduled retrieval error for car {car['id']}: {ex}") 
#         except Exception as e: 
#             logger.error(f"scheduled_retrieval_loop error: {e}") 
#         await asyncio.sleep(30)  # check every 30 seconds 

# @app.on_event("startup")
# async def on_start():
#     # init_storage()
#     # indexes
#     await db.parking_slots.create_index([("event_id", ASCENDING), ("zone_name", ASCENDING), ("slot_number", ASCENDING)], unique=True)
#     await db.cars.create_index([("qr_token", ASCENDING)], unique=True)
#     await db.cars.create_index([("event_id", ASCENDING)])
#     await db.cars.create_index([("event_id", ASCENDING), ("plate", ASCENDING)])
#     await db.cars.create_index([("event_id", ASCENDING), ("status", ASCENDING)])
#     await db.cars.create_index([("check_in_driver_id", ASCENDING)])
#     await db.cars.create_index([("retrieval_driver_id", ASCENDING)])
#     await db.ratings.create_index([("car_id", ASCENDING)], unique=True)
#     await db.providers.create_index([("email", ASCENDING)], unique=True)
#     await db.drivers.create_index([("employee_id", ASCENDING)])
#     await db.drivers.create_index([("provider_id", ASCENDING)])
#     await db.events.create_index([("provider_id", ASCENDING)])
#     await db.events.create_index([("status", ASCENDING)])
#     await db.event_drivers.create_index([("event_id", ASCENDING)])
#     await db.event_drivers.create_index([("driver_id", ASCENDING)])
#     await db.parking_slots.create_index([("event_id", ASCENDING)])
#     await db.superadmins.create_index([("email", ASCENDING)], unique=True)
#     # Backfill provider_qr_token for existing providers 
#     providers_without_qr = await db.providers.find( 
#         {"provider_qr_token": {"$exists": False}}, {"_id": 0, "id": 1} 
#     ).to_list(1000) 
#     for p in providers_without_qr: 
#         await db.providers.update_one( 
#             {"id": p["id"]}, 
#             {"$set": {"provider_qr_token": str(uuid.uuid4())}} 
#         ) 
#     # seed superadmin
#     if not await db.superadmins.find_one({"email": "superadmin@instapark.com"}):
#         await db.superadmins.insert_one({
#             "id": str(uuid.uuid4()), "name": "Super Admin",
#             "email": "superadmin@instapark.com",
#             "hashed_password": hash_password("Admin@123"),
#             "created_at": now_iso(),
#         })
#         logger.info("Seeded superadmin")
#     asyncio.create_task(auto_close_loop())
#     asyncio.create_task(scheduled_retrieval_loop())

# @app.on_event("shutdown")
# async def on_stop():
#     client.close()

# @api_router.get("/")
# async def root():
#     return {"service": "InstaPark", "status": "ok"}

# app.include_router(api_router)
# app.add_middleware(
#     CORSMiddleware,
#     allow_credentials=True,
#     allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
#     allow_methods=["*"],
#     allow_headers=["*"],
# )



































# """InstaPark Valet Parking Management Backend."""
# from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Query
# from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
# from fastapi.responses import JSONResponse
# from dotenv import load_dotenv
# from starlette.middleware.cors import CORSMiddleware
# from motor.motor_asyncio import AsyncIOMotorClient
# from pymongo import ASCENDING
# from pydantic import BaseModel, EmailStr, Field
# from typing import List, Optional, Dict, Any
# from datetime import datetime, timezone, timedelta
# from pathlib import Path
# import os, uuid, logging, asyncio, bcrypt, jwt, requests
# import cloudinary
# import cloudinary.uploader

# ROOT_DIR = Path(__file__).parent
# load_dotenv(ROOT_DIR / '.env')

# # ---- Config ----
# MONGO_URL = os.environ['MONGO_URL']
# DB_NAME = os.environ['DB_NAME']
# JWT_SECRET = os.environ['JWT_SECRET']
# JWT_EXPIRE_HOURS = int(os.environ.get('JWT_EXPIRE_HOURS', 168))
# # EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY')
# APP_NAME = os.environ.get('APP_NAME', 'instapark')
# # STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
# # Cloudinary config
# cloudinary.config(
#     cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
#     api_key=os.environ.get('CLOUDINARY_API_KEY'),
#     api_secret=os.environ.get('CLOUDINARY_API_SECRET')
# )

# client = AsyncIOMotorClient(MONGO_URL)
# db = client[DB_NAME]

# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# logger = logging.getLogger("instapark")

# app = FastAPI(title="InstaPark API")
# api_router = APIRouter(prefix="/api/v1")
# bearer = HTTPBearer(auto_error=False)

# @app.get("/health")
# def health():
#     return {
#         "status": "ok",
#         "message": "Backend is running"
#     }


# # ---- Storage ----
# # storage_key: Optional[str] = None
# # def init_storage():
# #     global storage_key
# #     if storage_key:
# #         return storage_key
# #     try:
# #         r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
# #         r.raise_for_status()
# #         storage_key = r.json()["storage_key"]
# #         return storage_key
# #     except Exception as e:
# #         logger.error(f"Storage init failed: {e}")
# #         return None

# # def put_object(path: str, data: bytes, content_type: str) -> dict:
# #     key = init_storage()
# #     if not key:
# #         raise HTTPException(500, "Storage not initialized")
# #     r = requests.put(f"{STORAGE_URL}/objects/{path}",
# #                      headers={"X-Storage-Key": key, "Content-Type": content_type},
# #                      data=data, timeout=120)
# #     r.raise_for_status()
# #     return r.json()

# def put_object(path: str, data: bytes, content_type: str) -> dict:
#     try:
#         # Convert path to cloudinary public_id (remove extension)
#         public_id = path.rsplit('.', 1)[0] if '.' in path else path
#         # Upload to Cloudinary
#         result = cloudinary.uploader.upload(
#             data,
#             public_id=f"instapark/{public_id}",
#             resource_type="image",
#             overwrite=True
#         )
#         return {
#             "url": result['secure_url'],
#             "public_id": result['public_id']
#         }
#     except Exception as e:
#         logger.error(f"Cloudinary upload failed: {e}")
#         raise HTTPException(500, f"Upload failed: {str(e)}")


# # ---- Helpers ----
# def now_iso() -> str:
#     return datetime.now(timezone.utc).isoformat()

# def hash_password(pw: str) -> str:
#     return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

# def verify_password(pw: str, hashed: str) -> bool:
#     try:
#         return bcrypt.checkpw(pw.encode(), hashed.encode())
#     except Exception:
#         return False

# def create_token(payload: dict) -> str:
#     to_encode = payload.copy()
#     to_encode["exp"] = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
#     return jwt.encode(to_encode, JWT_SECRET, algorithm="HS256")

# def decode_token(token: str) -> dict:
#     try:
#         return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
#     except Exception:
#         raise HTTPException(401, "Invalid or expired token")

# async def get_current(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
#     if not creds:
#         raise HTTPException(401, "Not authenticated")
#     return decode_token(creds.credentials)

# def require_roles(*roles):
#     async def checker(user=Depends(get_current)):
#         if user.get("role") not in roles:
#             raise HTTPException(403, "Forbidden")
#         return user
#     return checker

# def clean(doc: dict) -> dict:
#     if doc and "_id" in doc:
#         doc.pop("_id", None)
#     return doc

# # ---- WebSocket Manager ----
# class ConnManager:
#     def __init__(self):
#         self.channels: Dict[str, List[WebSocket]] = {}

#     async def connect(self, channel: str, ws: WebSocket):
#         await ws.accept()
#         self.channels.setdefault(channel, []).append(ws)

#     def disconnect(self, channel: str, ws: WebSocket):
#         if channel in self.channels and ws in self.channels[channel]:
#             self.channels[channel].remove(ws)

#     async def broadcast(self, channel: str, message: dict):
#         for ws in list(self.channels.get(channel, [])):
#             try:
#                 await ws.send_json(message)
#             except Exception:
#                 pass

# manager = ConnManager()

# # ============== AUTH ==============
# class LoginEmail(BaseModel):
#     email: str
#     password: str

# class LoginDriver(BaseModel):
#     employee_id: str
#     pin: str

# @api_router.post("/auth/superadmin/login")
# async def superadmin_login(body: LoginEmail):
#     sa = await db.superadmins.find_one({"email": body.email.lower()})
#     if not sa or not verify_password(body.password, sa["hashed_password"]):
#         raise HTTPException(401, "Invalid credentials")
#     payload = {"user_id": sa["id"], "role": "superadmin", "name": sa["name"], "email": sa["email"]}
#     token = create_token(payload)
#     return {"token": token, "superadmin": {"id": sa["id"], "name": sa["name"], "email": sa["email"]}}

# @api_router.post("/auth/admin/login")
# async def admin_login(body: LoginEmail):
#     prov = await db.providers.find_one({"email": body.email.lower()})
#     if not prov or not verify_password(body.password, prov["hashed_password"]):
#         raise HTTPException(401, "Invalid credentials")
#     if not prov.get("is_active", True):
#         raise HTTPException(403, "Provider deactivated")
#     payload = {"user_id": prov["id"], "role": "admin", "provider_id": prov["id"], "name": prov["name"]}
#     token = create_token(payload)
#     return {"token": token, "user": {"id": prov["id"], "name": prov["name"], "role": "admin", "provider_id": prov["id"]}}

# @api_router.post("/auth/driver/login")
# async def driver_login(body: LoginDriver):
#     drv = await db.drivers.find_one({"employee_id": body.employee_id.upper(), "pin": body.pin, "is_active": True})
#     if not drv:
#         raise HTTPException(401, "Invalid credentials")
#     payload = {"user_id": drv["id"], "role": drv.get("role", "driver"), "provider_id": drv["provider_id"], "name": drv["name"]}
#     token = create_token(payload)
#     return {"token": token, "driver": {"id": drv["id"], "name": drv["name"], "employee_id": drv["employee_id"], "role": drv.get("role", "driver"), "provider_id": drv["provider_id"]}}

# @api_router.get("/auth/me")
# async def me(user=Depends(get_current)):
#     return user

# # ============== PROVIDERS ==============
# class ProviderCreate(BaseModel):
#     name: str
#     email: str
#     phone: str
#     plan: str = "starter"
#     password: str

# class ProviderUpdate(BaseModel):
#     name: Optional[str] = None
#     phone: Optional[str] = None
#     plan: Optional[str] = None
#     is_active: Optional[bool] = None

# @api_router.get("/providers")
# async def list_providers(user=Depends(require_roles("superadmin"))):
#     rows = await db.providers.find({}, {"_id": 0, "hashed_password": 0}).to_list(1000)
#     return rows

# @api_router.post("/providers")
# async def create_provider(body: ProviderCreate, user=Depends(require_roles("superadmin"))):
#     if await db.providers.find_one({"email": body.email.lower()}):
#         raise HTTPException(400, "Email already exists")
#     pid = str(uuid.uuid4())
#     doc = {
#         "id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone,
#         "plan": body.plan, "is_active": True,
#         "hashed_password": hash_password(body.password),
#         "created_at": now_iso(), "updated_at": now_iso(),
#     }
#     await db.providers.insert_one(doc.copy())
#     # also create admin driver record
#     admin_drv = {
#         "id": str(uuid.uuid4()), "provider_id": pid, "name": body.name, "phone": body.phone,
#         "role": "admin", "employee_id": f"ADM{str(int(datetime.now().timestamp()))[-5:]}",
#         "pin": "0000", "is_active": True, "auth_user_id": pid, "created_at": now_iso(),
#     }
#     await db.drivers.insert_one(admin_drv)
#     return {"id": pid, "name": body.name, "email": body.email.lower(), "phone": body.phone, "plan": body.plan, "password": body.password}

# @api_router.get("/providers/{pid}")
# async def get_provider(pid: str, user=Depends(require_roles("superadmin"))):
#     p = await db.providers.find_one({"id": pid}, {"_id": 0, "hashed_password": 0})
#     if not p:
#         raise HTTPException(404, "Not found")
#     p["events"] = await db.events.find({"provider_id": pid}, {"_id": 0}).to_list(1000)
#     p["drivers"] = await db.drivers.find({"provider_id": pid, "role": "driver"}, {"_id": 0}).to_list(1000)
#     return p

# @api_router.patch("/providers/{pid}")
# async def update_provider(pid: str, body: ProviderUpdate, user=Depends(require_roles("superadmin"))):
#     upd = {k: v for k, v in body.model_dump().items() if v is not None}
#     upd["updated_at"] = now_iso()
#     res = await db.providers.update_one({"id": pid}, {"$set": upd})
#     if res.matched_count == 0:
#         raise HTTPException(404, "Not found")
#     return {"ok": True}

# @api_router.get("/providers/{pid}/stats")
# async def provider_stats(pid: str, user=Depends(require_roles("superadmin"))):
#     events = await db.events.count_documents({"provider_id": pid})
#     drivers = await db.drivers.count_documents({"provider_id": pid, "role": "driver"})
#     event_ids = [e["id"] for e in await db.events.find({"provider_id": pid}, {"_id": 0, "id": 1}).to_list(1000)]
#     cars = await db.cars.count_documents({"event_id": {"$in": event_ids}}) if event_ids else 0
#     car_ids = [c["id"] for c in await db.cars.find({"event_id": {"$in": event_ids}}, {"_id": 0, "id": 1}).to_list(10000)] if event_ids else []
#     ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
#     avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
#     return {"events": events, "drivers": drivers, "cars": cars, "avg_rating": avg}

# # ============== DRIVERS ==============
# class DriverCreate(BaseModel):
#     name: str
#     phone: str
#     pin: str

# class DriverUpdate(BaseModel):
#     name: Optional[str] = None
#     phone: Optional[str] = None
#     pin: Optional[str] = None

# @api_router.get("/drivers")
# async def list_drivers(user=Depends(get_current)):
#     role = user.get("role")
#     if role == "superadmin":
#         drv = await db.drivers.find({"role": "driver"}, {"_id": 0}).to_list(2000)
#         # join provider name
#         prov_ids = list({d["provider_id"] for d in drv})
#         provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": prov_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
#         for d in drv:
#             d["provider_name"] = provs.get(d["provider_id"], "—")
#         return drv
#     if role in ("admin",):
#         return await db.drivers.find({"provider_id": user["provider_id"], "role": "driver"}, {"_id": 0}).to_list(1000)
#     raise HTTPException(403, "Forbidden")

# @api_router.post("/drivers")
# async def create_driver(body: DriverCreate, user=Depends(require_roles("admin", "superadmin"))):
#     pid = user.get("provider_id")
#     if not pid:
#         raise HTTPException(400, "provider_id missing")
#     eid = f"DRV{str(int(datetime.now().timestamp()))[-5:]}"
#     doc = {"id": str(uuid.uuid4()), "provider_id": pid, "name": body.name, "phone": body.phone,
#            "role": "driver", "employee_id": eid.upper(), "pin": body.pin,
#            "is_active": True, "created_at": now_iso()}
#     await db.drivers.insert_one(doc.copy())
#     return clean(doc)

# @api_router.get("/drivers/{did}")
# async def get_driver(did: str, user=Depends(get_current)):
#     d = await db.drivers.find_one({"id": did}, {"_id": 0})
#     if not d:
#         raise HTTPException(404, "Not found")
#     return d

# @api_router.patch("/drivers/{did}")
# async def update_driver(did: str, body: DriverUpdate, user=Depends(require_roles("admin", "superadmin"))):
#     upd = {k: v for k, v in body.model_dump().items() if v is not None}
#     res = await db.drivers.update_one({"id": did}, {"$set": upd})
#     if res.matched_count == 0:
#         raise HTTPException(404, "Not found")
#     return {"ok": True}

# @api_router.delete("/drivers/{did}")
# async def deactivate_driver(did: str, user=Depends(require_roles("admin", "superadmin"))):
#     await db.drivers.update_one({"id": did}, {"$set": {"is_active": False}})
#     return {"ok": True}

# @api_router.get("/drivers/{did}/stats")
# async def driver_stats(did: str, user=Depends(get_current)):
#     cars_in = await db.cars.count_documents({"check_in_driver_id": did})
#     cars_out = await db.cars.count_documents({"retrieval_driver_id": did, "status": "DELIVERED"})
#     return {"cars_checked_in": cars_in, "cars_retrieved": cars_out}

# @api_router.get("/drivers/{did}/stats/filtered")
# async def driver_stats_filtered(did: str, filter: str = "all", user=Depends(get_current)):
#     now = datetime.now(timezone.utc)
#     delta_map = {"week": 7, "month": 30, "quarter": 90}
#     q_in: dict = {"check_in_driver_id": did}
#     q_out: dict = {"retrieval_driver_id": did, "status": "DELIVERED"}
#     if filter in delta_map:
#         cutoff = (now - timedelta(days=delta_map[filter])).isoformat()
#         q_in["check_in_time"] = {"$gte": cutoff}
#         q_out["delivered_at"] = {"$gte": cutoff}
#     return {
#         "cars_checked_in": await db.cars.count_documents(q_in),
#         "cars_retrieved": await db.cars.count_documents(q_out),
#         "filter": filter,
#     }

# # ============== EVENTS ==============
# class EventCreate(BaseModel):
#     name: str
#     date: str
#     end_date: str
#     venue: str
#     max_cars: int
#     gates: List[str] = []
#     zones: List[Dict[str, Any]] = []
#     start_time: str = "00:00"
#     end_time: str = "23:59"
#     is_template: bool = False

# class EventUpdate(BaseModel):
#     name: Optional[str] = None
#     date: Optional[str] = None
#     end_date: Optional[str] = None
#     venue: Optional[str] = None
#     max_cars: Optional[int] = None
#     gates: Optional[List[str]] = None
#     zones: Optional[List[Dict[str, Any]]] = None
#     status: Optional[str] = None
#     start_time: Optional[str] = None
#     end_time: Optional[str] = None

# @api_router.get("/events")
# async def list_events(user=Depends(get_current)):
#     if user.get("role") == "superadmin":
#         return await db.events.find({}, {"_id": 0}).to_list(1000)
#     return await db.events.find({"provider_id": user["provider_id"]}, {"_id": 0}).to_list(1000)

# @api_router.get("/events/all")
# async def all_events(user=Depends(require_roles("superadmin"))):
#     events = await db.events.find({}, {"_id": 0}).to_list(2000)
#     pids = list({e["provider_id"] for e in events})
#     provs = {p["id"]: p["name"] for p in await db.providers.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
#     for e in events:
#         e["provider_name"] = provs.get(e["provider_id"], "—")
#     return events

# @api_router.post("/events")
# async def create_event(body: EventCreate, user=Depends(require_roles("admin", "superadmin"))):
#     eid = str(uuid.uuid4())
#     doc = body.model_dump()
#     doc.update({"id": eid, "provider_id": user.get("provider_id"), "status": "active",
#                 "created_at": now_iso(), "updated_at": now_iso()})
#     await db.events.insert_one(doc.copy())
#     return clean(doc)

# @api_router.get("/events/{eid}")
# async def get_event(eid: str, user=Depends(get_current)):
#     e = await db.events.find_one({"id": eid}, {"_id": 0})
#     if not e:
#         raise HTTPException(404, "Not found")
#     return e

# @api_router.patch("/events/{eid}")
# async def update_event(eid: str, body: EventUpdate, user=Depends(require_roles("admin", "superadmin"))):
#     upd = {k: v for k, v in body.model_dump().items() if v is not None}
#     upd["updated_at"] = now_iso()
#     res = await db.events.update_one({"id": eid}, {"$set": upd})
#     if res.matched_count == 0:
#         raise HTTPException(404, "Not found")
#     return {"ok": True}

# @api_router.post("/events/{eid}/close")
# async def close_event(eid: str, user=Depends(require_roles("admin", "superadmin"))):
#     await db.events.update_one({"id": eid}, {"$set": {"status": "closed", "updated_at": now_iso()}})
#     await db.parking_slots.delete_many({"event_id": eid})
#     return {"ok": True}

# @api_router.get("/events/{eid}/stats")
# async def event_stats(eid: str, user=Depends(get_current)):
#     car_ids = [c["id"] for c in await db.cars.find({"event_id": eid}, {"_id": 0, "id": 1}).to_list(10000)]
#     ratings = await db.ratings.find({"car_id": {"$in": car_ids}}, {"_id": 0}).to_list(10000) if car_ids else []
#     avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
#     delivered = await db.cars.find({"event_id": eid, "status": "DELIVERED"}, {"_id": 0}).to_list(10000)
#     times = []
#     for c in delivered:
#         try:
#             t1 = datetime.fromisoformat(c.get("check_in_time")) if c.get("check_in_time") else None
#             t2 = datetime.fromisoformat(c.get("delivered_at")) if c.get("delivered_at") else None
#             if t1 and t2:
#                 times.append((t2 - t1).total_seconds() / 60)
#         except Exception:
#             pass
#     avg_ret = round(sum(times) / len(times), 1) if times else 0
#     # top driver
#     pipeline = [{"$match": {"event_id": eid}}, {"$group": {"_id": "$check_in_driver_id", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}, {"$limit": 1}]
#     top = await db.cars.aggregate(pipeline).to_list(1)
#     top_driver = None
#     if top and top[0]["_id"]:
#         d = await db.drivers.find_one({"id": top[0]["_id"]}, {"_id": 0, "name": 1})
#         top_driver = d["name"] if d else None
#     return {"avg_rating": avg, "avg_retrieval_minutes": avg_ret, "top_driver": top_driver, "total_cars": len(car_ids)}

# # Event drivers
# @api_router.get("/events/{eid}/drivers")
# async def event_drivers(eid: str, user=Depends(get_current)):
#     event = await db.events.find_one({"id": eid}, {"_id": 0})
#     if not event:
#         raise HTTPException(404, "Event not found")
#     pid = event["provider_id"]
#     drivers = await db.drivers.find({"provider_id": pid, "role": "driver", "is_active": True}, {"_id": 0}).to_list(1000)
#     other_events = await db.events.find({"provider_id": pid, "status": "active", "id": {"$ne": eid}}, {"_id": 0}).to_list(1000)
#     assignments = {a["driver_id"]: a for a in await db.event_drivers.find({"event_id": {"$in": [e["id"] for e in other_events]}}, {"_id": 0}).to_list(2000)}
#     e_start = f'{event["date"]}T{event.get("start_time","00:00")}'
#     e_end = f'{event["end_date"]}T{event.get("end_time","23:59")}'
#     other_map = {e["id"]: e for e in other_events}
#     for d in drivers:
#         conflict = None
#         if d["id"] in assignments:
#             other = other_map.get(assignments[d["id"]]["event_id"])
#             if other:
#                 o_start = f'{other["date"]}T{other.get("start_time","00:00")}'
#                 o_end = f'{other["end_date"]}T{other.get("end_time","23:59")}'
#                 if e_start < o_end and e_end > o_start:
#                     conflict = other["name"]
#         d["available"] = conflict is None
#         d["conflict_event_name"] = conflict
#         d["cars_checked_in"] = await db.cars.count_documents({"event_id": eid, "check_in_driver_id": d["id"]})
#         d["cars_retrieved"] = await db.cars.count_documents({"event_id": eid, "retrieval_driver_id": d["id"], "status": "DELIVERED"})
#         d["assigned"] = await db.event_drivers.find_one({"event_id": eid, "driver_id": d["id"]}) is not None
#     return drivers

# @api_router.post("/events/{eid}/drivers/{did}")
# async def assign_driver(eid: str, did: str, user=Depends(require_roles("admin", "superadmin"))):
#     if await db.event_drivers.find_one({"event_id": eid, "driver_id": did}):
#         return {"ok": True}
#     await db.event_drivers.insert_one({"id": str(uuid.uuid4()), "event_id": eid, "driver_id": did, "status": "active"})
#     return {"ok": True}

# @api_router.delete("/events/{eid}/drivers/{did}")
# async def unassign_driver(eid: str, did: str, user=Depends(require_roles("admin", "superadmin"))):
#     await db.event_drivers.delete_many({"event_id": eid, "driver_id": did})
#     return {"ok": True}

# # ============== CARS ==============
# class CarCreate(BaseModel):
#     plate: str
#     color: str
#     make: str
#     notes: Optional[str] = ""
#     gate: Optional[str] = ""
#     event_id: str
#     check_in_driver_id: str

# class ParkBody(BaseModel):
#     zone: str
#     slot: int
#     parked_driver_id: str

# class PickupBody(BaseModel):
#     retrieval_driver_id: str

# class DeliverBody(BaseModel):
#     delivery_photo_url: Optional[str] = ""

# @api_router.get("/cars/event/{eid}")
# async def cars_event(eid: str, user=Depends(get_current)):
#     return await db.cars.find({"event_id": eid}, {"_id": 0}).to_list(5000)

# @api_router.post("/cars")
# async def create_car(body: CarCreate, user=Depends(get_current)):
#     event = await db.events.find_one({"id": body.event_id}, {"_id": 0})
#     if not event:
#         raise HTTPException(404, "Event not found")
#     current = await db.cars.count_documents({"event_id": body.event_id})
#     if current >= event["max_cars"]:
#         raise HTTPException(400, "Event is full")
#     plate = body.plate.upper()
#     if await db.cars.find_one({"event_id": body.event_id, "plate": plate}):
#         raise HTTPException(400, "Duplicate plate in this event")
#     cid = str(uuid.uuid4())
#     doc = {
#         "id": cid, "event_id": body.event_id, "plate": plate, "color": body.color, "make": body.make,
#         "status": "CHECKED_IN", "zone": None, "slot": None, "gate": body.gate,
#         "qr_token": str(uuid.uuid4()),
#         "check_in_driver_id": body.check_in_driver_id, "check_in_time": now_iso(),
#         "parked_driver_id": None, "parked_at": None,
#         "retrieval_driver_id": None, "delivered_at": None,
#         "photo_url": None, "delivery_photo_url": None, "notes": body.notes,
#         "created_at": now_iso(), "updated_at": now_iso(),
#     }
#     await db.cars.insert_one(doc.copy())
#     out = clean(doc)
#     out["warning"] = current + 1 >= event["max_cars"] * 0.8
#     await manager.broadcast(f"event:{body.event_id}", {"type": "car_update", "data": out})
#     return out

# @api_router.get("/cars/{cid}")
# async def get_car(cid: str, user=Depends(get_current)):
#     c = await db.cars.find_one({"id": cid}, {"_id": 0})
#     if not c:
#         raise HTTPException(404, "Not found")
#     return c

# @api_router.patch("/cars/{cid}/park")
# async def park_car(cid: str, body: ParkBody, user=Depends(get_current)):
#     upd = {"status": "PARKED", "zone": body.zone, "slot": body.slot,
#            "parked_driver_id": body.parked_driver_id, "parked_at": now_iso(), "updated_at": now_iso()}
#     await db.cars.update_one({"id": cid}, {"$set": upd})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await db.parking_slots.update_one(
#         {"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot},
#         {"$set": {"is_occupied": True, "car_id": cid}}, upsert=True)
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     slot = await db.parking_slots.find_one({"event_id": car["event_id"], "zone_name": body.zone, "slot_number": body.slot}, {"_id": 0})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "slot_update", "data": slot})
#     return car

# @api_router.patch("/cars/{cid}/request-retrieval")
# async def request_retrieval(cid: str):
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     if not car:
#         raise HTTPException(404, "Not found")
#     await db.cars.update_one({"id": cid}, {"$set": {"status": "RETRIEVAL_REQUESTED", "updated_at": now_iso()}})
#     rid = str(uuid.uuid4())
#     await db.retrieval_requests.insert_one({"id": rid, "car_id": cid, "driver_id": None, "status": "PENDING",
#                                             "requested_at": now_iso(), "updated_at": now_iso()})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
#     return car

# @api_router.patch("/cars/{cid}/pickup")
# async def pickup_car(cid: str, body: PickupBody, user=Depends(get_current)):
#     await db.cars.update_one({"id": cid}, {"$set": {"status": "BEING_FETCHED", "retrieval_driver_id": body.retrieval_driver_id, "updated_at": now_iso()}})
#     await db.retrieval_requests.update_one({"car_id": cid, "status": "PENDING"},
#                                            {"$set": {"status": "ASSIGNED", "driver_id": body.retrieval_driver_id, "updated_at": now_iso()}})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"retrievals:{car['event_id']}", {"type": "retrieval_update", "data": car})
#     return car

# @api_router.patch("/cars/{cid}/deliver")
# async def deliver_car(cid: str, body: DeliverBody, user=Depends(get_current)):
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     if not car:
#         raise HTTPException(404, "Not found")
#     await db.cars.update_one({"id": cid}, {"$set": {"status": "DELIVERED", "delivery_photo_url": body.delivery_photo_url,
#                                                    "delivered_at": now_iso(), "updated_at": now_iso()}})
#     await db.retrieval_requests.update_one({"car_id": cid}, {"$set": {"status": "COMPLETED", "updated_at": now_iso()}})
#     if car.get("zone") and car.get("slot") is not None:
#         await db.parking_slots.update_one(
#             {"event_id": car["event_id"], "zone_name": car["zone"], "slot_number": car["slot"]},
#             {"$set": {"is_occupied": False, "car_id": None}})
#     car = await db.cars.find_one({"id": cid}, {"_id": 0})
#     await manager.broadcast(f"car:{cid}", {"type": "car_update", "data": car})
#     await manager.broadcast(f"event:{car['event_id']}", {"type": "car_update", "data": car})
#     return car

# @api_router.patch("/cars/{cid}/update-photo")
# async def update_car_photo(cid: str, body: dict, user=Depends(get_current)):
#     await db.cars.update_one(
#         {"id": cid},
#         {"$set": {"delivery_photo_url": body.get("delivery_photo_url", ""), "updated_at": now_iso()}}
#     )
#     return {"ok": True}

# @api_router.delete("/cars/{cid}")
# async def delete_car(cid: str, user=Depends(get_current)):
#     await db.cars.delete_one({"id": cid})
#     return {"ok": True}

# # ============== CAR PHOTOS ==============
# class PhotosBody(BaseModel):
#     urls: List[str]
#     type: str

# @api_router.post("/cars/{cid}/photos")
# async def save_photos(cid: str, body: PhotosBody, user=Depends(get_current)):
#     docs = [{"id": str(uuid.uuid4()), "car_id": cid, "url": u, "type": body.type, "created_at": now_iso()} for u in body.urls]
#     if docs:
#         await db.car_photos.insert_many(docs)
#     if body.type == "checkin" and body.urls:
#         await db.cars.update_one({"id": cid}, {"$set": {"photo_url": body.urls[0]}})
#     return {"ok": True, "count": len(docs)}

# @api_router.get("/cars/{cid}/photos")
# async def get_photos(cid: str, user=Depends(get_current)):
#     return await db.car_photos.find({"car_id": cid}, {"_id": 0}).to_list(1000)

# # ============== SLOTS ==============
# @api_router.get("/slots/event/{eid}")
# async def slots_event(eid: str, user=Depends(get_current)):
#     return await db.parking_slots.find({"event_id": eid}, {"_id": 0}).to_list(5000)

# @api_router.post("/slots/event/{eid}/initialize")
# async def init_slots(eid: str, user=Depends(get_current)):
#     event = await db.events.find_one({"id": eid}, {"_id": 0})
#     if not event:
#         raise HTTPException(404, "Event not found")
#     created = 0
#     for zone in event.get("zones", []):
#         zname = zone.get("name")
#         count = int(zone.get("slots", 0))
#         for i in range(1, count + 1):
#             existing = await db.parking_slots.find_one({"event_id": eid, "zone_name": zname, "slot_number": i})
#             if existing:
#                 continue
#             await db.parking_slots.insert_one({
#                 "id": str(uuid.uuid4()), "event_id": eid, "zone_name": zname,
#                 "slot_number": i, "car_id": None, "is_occupied": False, "created_at": now_iso(),
#             })
#             created += 1
#     slots = await db.parking_slots.find({"event_id": eid}, {"_id": 0}).to_list(5000)
#     await manager.broadcast(f"event:{eid}", {"type": "slot_update", "data": {"slots": slots}})
#     return {"ok": True, "created": created, "total": len(slots)}

# # ============== RETRIEVALS ==============
# @api_router.get("/retrievals/event/{eid}")
# async def event_retrievals(eid: str, user=Depends(get_current)):
#     return await db.cars.find({"event_id": eid, "status": {"$in": ["RETRIEVAL_REQUESTED", "BEING_FETCHED"]}}, {"_id": 0}).to_list(1000)

# class RetrievalBody(BaseModel):
#     car_id: str

# @api_router.post("/retrievals")
# async def create_retrieval(body: RetrievalBody):
#     return await request_retrieval(body.car_id)  # type: ignore

# # ============== RATINGS ==============
# class RatingBody(BaseModel):
#     car_id: str
#     stars: int

# @api_router.post("/ratings")
# async def post_rating(body: RatingBody):
#     if body.stars < 1 or body.stars > 5:
#         raise HTTPException(400, "Stars must be 1-5")
#     existing = await db.ratings.find_one({"car_id": body.car_id})
#     if existing:
#         return {"ok": True, "duplicate": True}
#     await db.ratings.insert_one({"id": str(uuid.uuid4()), "car_id": body.car_id, "stars": body.stars, "created_at": now_iso()})
#     return {"ok": True}

# # ============== QR (no auth) ==============
# @api_router.get("/qr/{token}")
# async def get_by_qr(token: str):
#     car = await db.cars.find_one({"qr_token": token}, {"_id": 0})
#     if not car:
#         raise HTTPException(404, "Invalid QR token")
#     event = await db.events.find_one({"id": car["event_id"]}, {"_id": 0, "name": 1})
#     car["event_name"] = event["name"] if event else "Event"
#     return car

# # ============== UPLOAD ==============
# # @api_router.post("/upload")
# # async def upload(file: UploadFile = File(...), folder: str = Form("misc"), user=Depends(get_current)):
# #     ext = file.filename.split(".")[-1] if "." in (file.filename or "") else "bin"
# #     path = f"{APP_NAME}/{folder}/{uuid.uuid4()}.{ext}"
# #     data = await file.read()
# #     result = put_object(path, data, file.content_type or "application/octet-stream")
# #     public_url = f"{STORAGE_URL}/objects/{result['path']}"
# #     return {"url": public_url, "path": result["path"]}

# @api_router.post("/upload")
# async def upload(file: UploadFile = File(...), folder: str = Form("misc"), user=Depends(get_current)):
#     data = await file.read()
#     ext = file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg'
#     path = f"{folder}/{uuid.uuid4()}.{ext}"
#     result = put_object(path, data, file.content_type or "application/octet-stream")
#     return {"url": result["url"], "path": path}



# # ============== SUPERADMIN STATS ==============
# @api_router.get("/superadmin/stats")
# async def super_stats(user=Depends(require_roles("superadmin"))):
#     total_p = await db.providers.count_documents({})
#     active_p = await db.providers.count_documents({"is_active": True})
#     active_e = await db.events.count_documents({"status": "active"})
#     total_d = await db.drivers.count_documents({"role": "driver"})
#     total_c = await db.cars.count_documents({})
#     ratings = await db.ratings.find({}, {"_id": 0}).to_list(20000)
#     avg = round(sum(r["stars"] for r in ratings) / len(ratings), 2) if ratings else 0
#     return {"total_providers": total_p, "active_providers": active_p, "active_events": active_e,
#             "total_drivers": total_d, "total_cars": total_c, "platform_avg_rating": avg}

# # ============== WEBSOCKETS ==============
# async def _ws_loop(channel: str, ws: WebSocket):
#     await manager.connect(channel, ws)
#     try:
#         while True:
#             await ws.receive_text()
#     except WebSocketDisconnect:
#         manager.disconnect(channel, ws)

# # Spec-compliant paths
# @app.websocket("/ws/event/{event_id}")
# async def ws_event(ws: WebSocket, event_id: str):
#     await _ws_loop(f"event:{event_id}", ws)

# @app.websocket("/ws/car/{car_id}")
# async def ws_car(ws: WebSocket, car_id: str):
#     await _ws_loop(f"car:{car_id}", ws)

# @app.websocket("/ws/retrievals/{event_id}")
# async def ws_retrievals(ws: WebSocket, event_id: str):
#     await _ws_loop(f"retrievals:{event_id}", ws)

# # Ingress-friendly aliases (mounted under /api so Kubernetes ingress proxies them)
# @app.websocket("/api/v1/ws/event/{event_id}")
# async def ws_event_api(ws: WebSocket, event_id: str):
#     await _ws_loop(f"event:{event_id}", ws)

# @app.websocket("/api/v1/ws/car/{car_id}")
# async def ws_car_api(ws: WebSocket, car_id: str):
#     await _ws_loop(f"car:{car_id}", ws)

# @app.websocket("/api/v1/ws/retrievals/{event_id}")
# async def ws_retrievals_api(ws: WebSocket, event_id: str):
#     await _ws_loop(f"retrievals:{event_id}", ws)

# # ============== STARTUP ==============
# async def auto_close_loop():
#     while True:
#         try:
#             now = datetime.now(timezone.utc)
#             events = await db.events.find({"status": "active"}, {"_id": 0}).to_list(2000)
#             for e in events:
#                 try:
#                     end_dt = datetime.fromisoformat(f'{e["end_date"]}T{e.get("end_time","23:59")}:00+00:00')
#                     if now > end_dt:
#                         await db.events.update_one({"id": e["id"]}, {"$set": {"status": "closed", "updated_at": now_iso()}})
#                         await db.parking_slots.delete_many({"event_id": e["id"]})
#                         logger.info(f"Auto-closed event {e['id']}")
#                 except Exception as ex:
#                     logger.warning(f"auto_close parse error {e.get('id')}: {ex}")
#         except Exception as e:
#             logger.error(f"auto_close_loop error: {e}")
#         await asyncio.sleep(3600)

# @app.on_event("startup")
# async def on_start():
#     # init_storage()
#     # indexes
#     await db.parking_slots.create_index([("event_id", ASCENDING), ("zone_name", ASCENDING), ("slot_number", ASCENDING)], unique=True)
#     await db.cars.create_index([("qr_token", ASCENDING)], unique=True)
#     await db.ratings.create_index([("car_id", ASCENDING)], unique=True)
#     await db.providers.create_index([("email", ASCENDING)], unique=True)
#     await db.drivers.create_index([("employee_id", ASCENDING)])
#     await db.superadmins.create_index([("email", ASCENDING)], unique=True)
#     # seed superadmin
#     if not await db.superadmins.find_one({"email": "superadmin@instapark.com"}):
#         await db.superadmins.insert_one({
#             "id": str(uuid.uuid4()), "name": "Super Admin",
#             "email": "superadmin@instapark.com",
#             "hashed_password": hash_password("Admin@123"),
#             "created_at": now_iso(),
#         })
#         logger.info("Seeded superadmin")
#     asyncio.create_task(auto_close_loop())

# @app.on_event("shutdown")
# async def on_stop():
#     client.close()

# @api_router.get("/")
# async def root():
#     return {"service": "InstaPark", "status": "ok"}

# app.include_router(api_router)
# app.add_middleware(
#     CORSMiddleware,
#     allow_credentials=True,
#     allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
#     allow_methods=["*"],
#     allow_headers=["*"],
# )






