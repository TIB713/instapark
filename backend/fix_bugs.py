with open('d:/Admin/Desktop/InstaPark-Combined/instapark/backend/server.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(len(lines)):
    line = lines[i]
    if 'await db.superadmins.update_one({"id": stored["superadmin_id"]}, {"": {"hashed_password": hashed}})' in line:
        lines[i] = line.replace('{"": {"hashed_password": hashed}}', '{"": {"hashed_password": hashed}}')
    elif '{"": {"hashed_pin": hash_password(body.password)}, "": {"pin": ""}}' in line:
        lines[i] = line.replace('{"": {"hashed_pin": hash_password(body.password)}, "": {"pin": ""}}', '{"": {"hashed_pin": hash_password(body.password)}, "": {"pin": ""}}')
    elif 'await db_col.update_one({"id": account_id}, {"": update_fields})' in line:
        lines[i] = line.replace('{"": update_fields}', '{"": update_fields}')
    elif 'await db[collection].update_one({"id": target_id}, {"": {"pending_phone": new_phone}})' in line:
        lines[i] = line.replace('{"": {"pending_phone": new_phone}}', '{"": {"pending_phone": new_phone}}')
    elif '{"": {"phone": new_phone, "phone_verified_at": now_iso(), "is_phone_verified": True}, "": {"pending_phone": ""}}' in line:
        lines[i] = line.replace('{"": {"phone": new_phone, "phone_verified_at": now_iso(), "is_phone_verified": True}, "": {"pending_phone": ""}}', '{"": {"phone": new_phone, "phone_verified_at": now_iso(), "is_phone_verified": True}, "": {"pending_phone": ""}}')
    elif 'await db_col.update_one({"id": account_id}, {"": {"hashed_pin": hashed}, "": {"pin": ""}})' in line:
        lines[i] = line.replace('{"": {"hashed_pin": hashed}, "": {"pin": ""}}', '{"": {"hashed_pin": hashed}, "": {"pin": ""}}')
    elif 'await db_col.update_one({"id": account_id}, {"": {"hashed_password": hashed}})' in line:
        lines[i] = line.replace('{"": {"hashed_password": hashed}}', '{"": {"hashed_password": hashed}}')

new_endpoint = '''
class CheckPhone(BaseModel):
    phone: str

@api_router.post("/auth/check-phone")
async def check_phone(body: CheckPhone):
    phone = body.phone.strip()
    if not re.match(r"^\d{10}$", phone):
        return {"exists": False}
        
    account = await db.drivers.find_one({"phone": phone}, {"id": 1, "is_verified": 1, "role": 1})
    if not account:
        account = await db.providers.find_one({"phone": phone}, {"id": 1, "is_verified": 1, "role": 1})
        
    if not account:
        return {"exists": False}
        
    return {
        "exists": True,
        "is_verified": account.get("is_verified", False),
        "role": account.get("role")
    }
'''

# Find the end of reset_password_unified
insert_idx = -1
for i in range(len(lines)):
    if 'def reset_password_unified' in lines[i]:
        # find the end of the function
        for j in range(i, len(lines)):
            if 'return {"message": "Reset successfully"}' in lines[j]:
                insert_idx = j + 1
                break
        break

if insert_idx != -1:
    lines.insert(insert_idx, new_endpoint + '\n')

with open('d:/Admin/Desktop/InstaPark-Combined/instapark/backend/server.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)
