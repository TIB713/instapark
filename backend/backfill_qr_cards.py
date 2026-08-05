import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(".env")
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'instapark')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

async def main():
    result = await db.car_qr_cards.update_many(
        {"is_active": {"$exists": False}},
        {"$set": {"is_active": True}}
    )
    print(f"Matched: {result.matched_count}, Modified: {result.modified_count}")

if __name__ == "__main__":
    asyncio.run(main())
