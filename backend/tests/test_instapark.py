"""InstaPark backend e2e API tests."""
import os, json, uuid, asyncio
import pytest, requests, websockets

BASE = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE = BASE.rstrip("/")
WS_BASE = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api/v1"
API = f"{BASE}/api/v1"

state = {}

def H(tok): return {"Authorization": f"Bearer {tok}"}

# ---- AUTH ----
def test_superadmin_login():
    r = requests.post(f"{API}/auth/superadmin/login", json={"email":"superadmin@instapark.com","password":"Admin@123"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "token" in d and d["superadmin"]["email"] == "superadmin@instapark.com"
    state["sa_token"] = d["token"]

def test_auth_me():
    r = requests.get(f"{API}/auth/me", headers=H(state["sa_token"]))
    assert r.status_code == 200
    assert r.json()["role"] == "superadmin"

def test_missing_token_401():
    assert requests.get(f"{API}/auth/me").status_code == 401

def test_invalid_token_401():
    assert requests.get(f"{API}/auth/me", headers=H("garbage")).status_code == 401

# ---- PROVIDERS ----
def test_create_provider():
    email = f"TEST_prov_{uuid.uuid4().hex[:6]}@i.com"
    r = requests.post(f"{API}/providers", headers=H(state["sa_token"]),
        json={"name":"TEST Prov","email":email,"phone":"123","plan":"starter","password":"Pass@123"})
    assert r.status_code == 200, r.text
    d = r.json()
    state["provider_id"] = d["id"]; state["provider_email"] = email; state["provider_pw"] = "Pass@123"

def test_list_providers_forbidden_no_auth():
    assert requests.get(f"{API}/providers").status_code == 401

def test_list_providers_ok():
    r = requests.get(f"{API}/providers", headers=H(state["sa_token"]))
    assert r.status_code == 200 and any(p["id"] == state["provider_id"] for p in r.json())

def test_get_provider_with_events_drivers():
    r = requests.get(f"{API}/providers/{state['provider_id']}", headers=H(state["sa_token"]))
    assert r.status_code == 200
    d = r.json()
    assert "events" in d and "drivers" in d

def test_provider_stats():
    r = requests.get(f"{API}/providers/{state['provider_id']}/stats", headers=H(state["sa_token"]))
    assert r.status_code == 200 and "events" in r.json()

def test_patch_provider_toggle():
    r = requests.patch(f"{API}/providers/{state['provider_id']}", headers=H(state["sa_token"]), json={"is_active": True})
    assert r.status_code == 200

# ---- ADMIN LOGIN ----
def test_admin_login():
    r = requests.post(f"{API}/auth/admin/login", json={"email": state["provider_email"], "password": state["provider_pw"]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == "admin"
    state["admin_token"] = d["token"]

def test_non_superadmin_providers_403():
    r = requests.get(f"{API}/providers", headers=H(state["admin_token"]))
    assert r.status_code == 403

# ---- DRIVERS ----
def test_create_driver():
    r = requests.post(f"{API}/drivers", headers=H(state["admin_token"]), json={"name":"TEST Drv","phone":"999","pin":"1234"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["employee_id"].startswith("DRV")
    state["driver_id"] = d["id"]; state["employee_id"] = d["employee_id"]

def test_driver_login():
    r = requests.post(f"{API}/auth/driver/login", json={"employee_id": state["employee_id"].lower(), "pin":"1234"})
    assert r.status_code == 200, r.text
    state["driver_token"] = r.json()["token"]

# ---- EVENTS ----
def test_create_event():
    r = requests.post(f"{API}/events", headers=H(state["admin_token"]),
        json={"name":"TEST Event","date":"2030-01-01","end_date":"2030-01-02","venue":"V","max_cars":5,
              "gates":["G1"],"zones":[{"name":"A","slots":3}]})
    assert r.status_code == 200, r.text
    state["event_id"] = r.json()["id"]

def test_list_events():
    r = requests.get(f"{API}/events", headers=H(state["admin_token"]))
    assert r.status_code == 200 and len(r.json()) >= 1

def test_events_all_superadmin():
    r = requests.get(f"{API}/events/all", headers=H(state["sa_token"]))
    assert r.status_code == 200

def test_events_all_admin_403():
    assert requests.get(f"{API}/events/all", headers=H(state["admin_token"])).status_code == 403

def test_patch_event():
    r = requests.patch(f"{API}/events/{state['event_id']}", headers=H(state["admin_token"]), json={"venue":"V2"})
    assert r.status_code == 200

def test_init_slots():
    r = requests.post(f"{API}/slots/event/{state['event_id']}/initialize", headers=H(state["admin_token"]))
    assert r.status_code == 200 and r.json()["created"] >= 3
    # idempotent
    r2 = requests.post(f"{API}/slots/event/{state['event_id']}/initialize", headers=H(state["admin_token"]))
    assert r2.json()["created"] == 0

def test_event_drivers_and_assign():
    r = requests.post(f"{API}/events/{state['event_id']}/drivers/{state['driver_id']}", headers=H(state["admin_token"]))
    assert r.status_code == 200
    r = requests.get(f"{API}/events/{state['event_id']}/drivers", headers=H(state["admin_token"]))
    assert r.status_code == 200
    drv = next((d for d in r.json() if d["id"] == state["driver_id"]), None)
    assert drv and drv["assigned"] is True and "available" in drv

# ---- CARS ----
def test_create_car():
    r = requests.post(f"{API}/cars", headers=H(state["admin_token"]),
        json={"plate":"abc123","color":"Red","make":"Toyota","gate":"G1","event_id":state["event_id"],"check_in_driver_id":state["driver_id"]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["plate"] == "ABC123" and d["qr_token"]
    state["car_id"] = d["id"]; state["qr_token"] = d["qr_token"]

def test_duplicate_plate():
    r = requests.post(f"{API}/cars", headers=H(state["admin_token"]),
        json={"plate":"ABC123","color":"R","make":"T","event_id":state["event_id"],"check_in_driver_id":state["driver_id"]})
    assert r.status_code == 400

def test_capacity_warning():
    # current=1, max=5 -> at 4 (>=80%) warning expected
    plates = []
    for i in range(3):
        r = requests.post(f"{API}/cars", headers=H(state["admin_token"]),
            json={"plate":f"WRN{i}","color":"R","make":"T","event_id":state["event_id"],"check_in_driver_id":state["driver_id"]})
        assert r.status_code == 200
        plates.append(r.json())
    # 4th car (4/5 = 80%) should have warning=true
    assert plates[-1]["warning"] is True

def test_event_full():
    # add 1 more (5th, full); next one should fail
    requests.post(f"{API}/cars", headers=H(state["admin_token"]),
        json={"plate":"FULL5","color":"R","make":"T","event_id":state["event_id"],"check_in_driver_id":state["driver_id"]})
    r = requests.post(f"{API}/cars", headers=H(state["admin_token"]),
        json={"plate":"OVER6","color":"R","make":"T","event_id":state["event_id"],"check_in_driver_id":state["driver_id"]})
    assert r.status_code == 400 and "full" in r.text.lower()

def test_park_car():
    r = requests.patch(f"{API}/cars/{state['car_id']}/park", headers=H(state["admin_token"]),
        json={"zone":"A","slot":1,"parked_driver_id":state["driver_id"]})
    assert r.status_code == 200 and r.json()["status"] == "PARKED"

def test_request_retrieval_no_auth():
    r = requests.patch(f"{API}/cars/{state['car_id']}/request-retrieval")
    assert r.status_code == 200 and r.json()["status"] == "RETRIEVAL_REQUESTED"

def test_pickup_and_deliver():
    r = requests.patch(f"{API}/cars/{state['car_id']}/pickup", headers=H(state["admin_token"]),
        json={"retrieval_driver_id": state["driver_id"]})
    assert r.status_code == 200 and r.json()["status"] == "BEING_FETCHED"
    r = requests.patch(f"{API}/cars/{state['car_id']}/deliver", headers=H(state["admin_token"]), json={"delivery_photo_url":""})
    assert r.status_code == 200 and r.json()["status"] == "DELIVERED"
    # slot freed
    s = requests.get(f"{API}/slots/event/{state['event_id']}", headers=H(state["admin_token"])).json()
    slot = next((x for x in s if x["zone_name"]=="A" and x["slot_number"]==1), None)
    assert slot and slot["is_occupied"] is False

# ---- RATINGS ----
def test_rating_and_duplicate():
    r = requests.post(f"{API}/ratings", json={"car_id": state["car_id"], "stars": 5})
    assert r.status_code == 200 and r.json().get("ok")
    r2 = requests.post(f"{API}/ratings", json={"car_id": state["car_id"], "stars": 4})
    assert r2.status_code == 200 and r2.json().get("duplicate") is True

# ---- QR ----
def test_qr_invalid():
    assert requests.get(f"{API}/qr/not-a-token").status_code == 404

def test_qr_valid():
    r = requests.get(f"{API}/qr/{state['qr_token']}")
    assert r.status_code == 200
    d = r.json()
    assert d["id"] == state["car_id"] and "event_name" in d

# ---- PHOTOS ----
def test_photos_checkin_updates_photo_url():
    url = "https://example.com/x.jpg"
    r = requests.post(f"{API}/cars/{state['car_id']}/photos", headers=H(state["admin_token"]),
        json={"urls":[url], "type":"checkin"})
    assert r.status_code == 200
    car = requests.get(f"{API}/cars/{state['car_id']}", headers=H(state["admin_token"])).json()
    assert car["photo_url"] == url

# ---- SUPERADMIN STATS ----
def test_superadmin_stats_forbidden():
    assert requests.get(f"{API}/superadmin/stats", headers=H(state["admin_token"])).status_code == 403

def test_superadmin_stats_ok():
    r = requests.get(f"{API}/superadmin/stats", headers=H(state["sa_token"]))
    assert r.status_code == 200 and "total_providers" in r.json()

# ---- EVENT STATS / CLOSE ----
def test_event_stats():
    r = requests.get(f"{API}/events/{state['event_id']}/stats", headers=H(state["admin_token"]))
    assert r.status_code == 200 and "avg_rating" in r.json()

def test_close_event_deletes_slots():
    r = requests.post(f"{API}/events/{state['event_id']}/close", headers=H(state["admin_token"]))
    assert r.status_code == 200
    s = requests.get(f"{API}/slots/event/{state['event_id']}", headers=H(state["admin_token"])).json()
    assert s == []

# ---- WEBSOCKET ----
def test_ws_event_slot_update():
    async def run():
        # new event for clean ws test
        e = requests.post(f"{API}/events", headers=H(state["admin_token"]),
            json={"name":"WS","date":"2030-02-01","end_date":"2030-02-02","venue":"V","max_cars":3,
                  "zones":[{"name":"Z","slots":2}]}).json()
        eid = e["id"]
        requests.post(f"{API}/slots/event/{eid}/initialize", headers=H(state["admin_token"]))
        car = requests.post(f"{API}/cars", headers=H(state["admin_token"]),
            json={"plate":"WS1","color":"R","make":"T","event_id":eid,"check_in_driver_id":state["driver_id"]}).json()
        async with websockets.connect(f"{WS_BASE}/ws/event/{eid}") as ws:
            await asyncio.sleep(0.5)
            requests.patch(f"{API}/cars/{car['id']}/park", headers=H(state["admin_token"]),
                json={"zone":"Z","slot":1,"parked_driver_id":state["driver_id"]})
            slot_seen = False
            for _ in range(5):
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                if msg.get("type") == "slot_update":
                    slot_seen = True; break
            assert slot_seen
        state["ws_car_id"] = car["id"]
    asyncio.run(run())

def test_ws_car_update_on_retrieval():
    async def run():
        cid = state["ws_car_id"]
        async with websockets.connect(f"{WS_BASE}/ws/car/{cid}") as ws:
            await asyncio.sleep(0.5)
            requests.patch(f"{API}/cars/{cid}/request-retrieval")
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            assert msg.get("type") == "car_update"
    asyncio.run(run())

def test_ws_retrieval_update_on_request():
    async def run():
        # fresh event + car for retrieval channel
        e = requests.post(f"{API}/events", headers=H(state["admin_token"]),
            json={"name":"WSR","date":"2030-03-01","end_date":"2030-03-02","venue":"V","max_cars":3,
                  "zones":[{"name":"Z","slots":2}]}).json()
        eid = e["id"]
        requests.post(f"{API}/slots/event/{eid}/initialize", headers=H(state["admin_token"]))
        car = requests.post(f"{API}/cars", headers=H(state["admin_token"]),
            json={"plate":"WSR1","color":"R","make":"T","event_id":eid,"check_in_driver_id":state["driver_id"]}).json()
        async with websockets.connect(f"{WS_BASE}/ws/retrievals/{eid}") as ws:
            await asyncio.sleep(0.5)
            requests.patch(f"{API}/cars/{car['id']}/request-retrieval")
            seen = False
            for _ in range(5):
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                if msg.get("type") == "retrieval_update":
                    seen = True; break
            assert seen
    asyncio.run(run())
