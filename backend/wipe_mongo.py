import os, asyncio, uuid
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
MONGO_URL = os.environ.get("MONGO_URL")

def now_iso():
    return datetime.utcnow().isoformat() + "Z"

async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client.instapark
    
    print("Deleting existing providers...")
    res1 = await db.providers.delete_many({})
    print(f"Deleted {res1.deleted_count} providers")
    
    print("Deleting existing drivers...")
    res2 = await db.drivers.delete_many({})
    print(f"Deleted {res2.deleted_count} drivers")
    
    print("Creating a fresh test provider...")
    pid = str(uuid.uuid4())
    doc = {
        "id": pid, "name": "Test Owner", "email": "testowner@example.com", "phone": "1234567890",
        "plan": "starter", "provider_type": "valet_provider", "is_active": True,
        "role": "owner", "parent_provider_id": None,
        "provider_qr_token": str(uuid.uuid4()),
        "is_verified": False,
        "is_phone_verified": False,
        "phone_verified_at": None,
        "pending_phone": None,
        "created_at": now_iso(), "updated_at": now_iso(),
        "address": "123 Main St", "city": "Cityville", "state": "CA",
    }
    await db.providers.insert_one(doc.copy())
    
    # also create admin driver record
    admin_drv = {
        "id": str(uuid.uuid4()), "provider_id": pid, "name": "Test Owner", "phone": "1234567890",
        "email": "testowner@example.com",
        "role": "admin", "employee_id": f"ADM{str(int(datetime.now().timestamp()))[-5:]}",
        "is_active": True, "auth_user_id": pid, "created_at": now_iso(),
        "is_phone_verified": False,
        "phone_verified_at": None,
        "pending_phone": None,
    }
    await db.drivers.insert_one(admin_drv)
    print(f"Created provider and admin driver with phone: {doc['phone']}")
        
if __name__ == '__main__':
    
    asyncio.run(main())
