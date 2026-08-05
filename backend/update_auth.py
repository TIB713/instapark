import uuid, random, time, re
import asyncio

new_auth_code = '''
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
        raise HTTPException(401, "Invalid credentials")
    payload = {"user_id": sa["id"], "role": "superadmin", "name": sa["name"], "email": sa["email"]}
    token = create_token(payload)
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
    await db.superadmins.update_one({"id": stored["superadmin_id"]}, {"": {"hashed_password": hashed}})
    await _otp_delete(key)
    return {"message": "Password reset successfully"}

@api_router.post("/auth/login")
@limiter.limit("10/minute")
async def auth_login(request: Request, body: LoginPhone):
    phone = body.phone.strip()
    if not re.match(r"^\d{10}$", phone):
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
        raise HTTPException(401, "Invalid credentials")

    if not account.get("is_verified"):
        raise HTTPException(403, {"detail": "ACCOUNT_NOT_VERIFIED", "phone": phone, "role": account.get("role")})
        
    if not account.get("is_active", True):
        raise HTTPException(403, "Account deactivated")

    # verify credential
    role = account.get("role")
    
    if role == "driver":
        hashed_pin = account.get("hashed_pin")
        if hashed_pin:
            if not verify_password(body.password, hashed_pin):
                raise HTTPException(401, "Invalid credentials")
        else:
            if account.get("pin") != body.password:
                raise HTTPException(401, "Invalid credentials")
            # migrate pin
            await db.drivers.update_one(
                {"id": account["id"]},
                {"": {"hashed_pin": hash_password(body.password)}, "": {"pin": ""}}
            )
    else:
        # provider, supervisor, admin, owner
        if not verify_password(body.password, account.get("hashed_password", "")):
            raise HTTPException(401, "Invalid credentials")

    # verify parent provider active state
    if role in ("supervisor", "driver"):
        prov = await db.providers.find_one({"id": account["provider_id"]}, {"_id": 0, "is_active": 1, "provider_type": 1})
        if not prov or prov.get("is_active") is False:
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
        "phone_verified_at": now_iso()
    })
    
    await db_col.update_one({"id": account_id}, {"": update_fields})
    await _otp_delete(key)
    
    # Generate token and return login response
    # We can fetch the updated account and use similar logic to auth_login
    updated_account = await db_col.find_one({"id": account_id})
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
        
    await db[collection].update_one({"id": target_id}, {"": {"pending_phone": new_phone}})
    
    otp = str(random.randint(100000, 999999))
    await _otp_set(f"phone_change_{target_id}", otp, {"target_id": target_id, "new_phone": new_phone, "collection": collection})
    
    email = target_account.get("email")
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
        
    await db[collection].update_one(
        {"id": target_id}, 
        {"": {"phone": new_phone, "phone_verified_at": now_iso(), "is_phone_verified": True}, "": {"pending_phone": ""}}
    )
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
        await db_col.update_one({"id": account_id}, {"": {"hashed_pin": hashed}, "": {"pin": ""}})
    else:
        if len(new_credential) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        hashed = hash_password(new_credential)
        await db_col.update_one({"id": account_id}, {"": {"hashed_password": hashed}})
        
    await _otp_delete(key)
    return {"message": "Reset successfully"}

'''

with open('d:/Admin/Desktop/InstaPark-Combined/instapark/backend/server.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = 522
end_idx = 1334

lines = lines[:start_idx] + [new_auth_code + '\n'] + lines[end_idx:]

with open('d:/Admin/Desktop/InstaPark-Combined/instapark/backend/server.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Replaced auth section")
