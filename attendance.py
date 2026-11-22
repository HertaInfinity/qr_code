import os, uuid, hmac, time, hashlib, secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import Blueprint, request, jsonify, g, current_app
from supabase import create_client
from postgrest.exceptions import APIError
from werkzeug.exceptions import HTTPException

bp = Blueprint("attendance", __name__, url_prefix="/api")
# service_role key: server-side only. It bypasses RLS, so every permission check lives in this file.
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
WINDOW = 30   # seconds a QR token stays current
GRACE = 5     # seconds a just-expired code is still accepted
IST = timezone(timedelta(hours=5, minutes=30))
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def is_uuid(v):
    try:
        uuid.UUID(str(v)); return True
    except ValueError:
        return False


def dup(e):
    return getattr(e, "code", None) == "23505" or "duplicate" in str(e).lower()


def ist_date(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(IST).date()


def make_token(secret, sid, window):
    return hmac.new(secret.encode(), f"{sid}:{window}".encode(), hashlib.sha256).hexdigest()[:16]


def valid_token(secret, sid, token):
    now = time.time(); w = int(now // WINDOW)
    ws = [w] + ([w - 1] if now % WINDOW < GRACE else [])
    return any(hmac.compare_digest(make_token(secret, sid, x), token) for x in ws)


def get_session(sid):
    if not is_uuid(sid):
        return None
    rows = supabase.table("sessions").select("*").eq("id", sid).execute().data
    return rows[0] if rows else None


def get_secret(sid):
    rows = supabase.table("session_secrets").select("secret").eq("session_id", sid).execute().data
    return rows[0]["secret"] if rows else None


def require_role(*roles):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            h = request.headers.get("Authorization", "")
            if not h.startswith("Bearer "):
                return jsonify(error="Missing login token"), 401
            try:
                user = supabase.auth.get_user(h[7:]).user
            except Exception:
                user = None
            if user is None:
                return jsonify(error="Invalid or expired login"), 401
            rows = supabase.table("profiles").select("role, device_id").eq("id", user.id).execute().data
            role = rows[0]["role"] if rows else None
            if role not in roles:
                return jsonify(error="Not allowed"), 403
            g.user_id, g.role, g.device_id = user.id, role, rows[0]["device_id"]
            return fn(*a, **kw)
        return wrapper
    return deco


@bp.errorhandler(Exception)
def on_error(e):
    if isinstance(e, HTTPException):
        return e
    current_app.logger.exception("API error")
    return jsonify(error="Internal server error"), 500


def body():
    return request.get_json(silent=True) or {}


@bp.get("/me")
@require_role("student", "teacher", "admin")
def me():
    return jsonify(user_id=g.user_id, role=g.role)


@bp.post("/device")
@require_role("student")
def register_device():
    d = str(body().get("device_id") or "")[:64]
    if len(d) < 16:
        return jsonify(error="device_id required"), 400
    if g.device_id == d:
        return jsonify(ok=True)
    if g.device_id:
        return jsonify(error="This account is linked to another device. Ask your teacher to reset it."), 403
    try:
        supabase.table("profiles").update({"device_id": d}).eq("id", g.user_id).execute()
    except APIError as e:
        if dup(e):
            return jsonify(error="This device is already linked to another student account."), 403
        raise
    return jsonify(ok=True)


@bp.post("/classes")
@require_role("teacher")
def create_class():
    name = str(body().get("name") or "").strip()[:100]
    if not name:
        return jsonify(error="Class name required"), 400
    for _ in range(5):
        try:
            row = supabase.table("classes").insert({"name": name, "teacher_id": g.user_id,
                  "join_code": "".join(secrets.choice(CODE_CHARS) for _ in range(6))}).execute().data[0]
            return jsonify(id=row["id"], join_code=row["join_code"]), 201
        except APIError as e:
            if not dup(e):
                raise
    return jsonify(error="Could not create class, try again"), 500


@bp.post("/classes/join")
@require_role("student")
def join_class():
    code = str(body().get("code") or "").strip().upper()
    rows = supabase.table("classes").select("id, name").eq("join_code", code).execute().data
    if not rows:
        return jsonify(error="No class found for that code"), 404
    try:
        supabase.table("enrollments").insert({"class_id": rows[0]["id"], "student_id": g.user_id}).execute()
    except APIError as e:
        if dup(e):
            return jsonify(message="You are already in " + rows[0]["name"])
        raise
    return jsonify(message="Joined " + rows[0]["name"]), 201


@bp.get("/classes/<class_id>/report")
@require_role("teacher")
def class_report(class_id):
    if not is_uuid(class_id):
        return jsonify(error="Class not found"), 404
    cls = supabase.table("classes").select("id, name").eq("id", class_id).eq("teacher_id", g.user_id).execute().data
    if not cls:
        return jsonify(error="Class not found"), 404
    enrolled = (supabase.table("enrollments").select("student_id, joined_at, profiles(full_name, enrollment_no)")
                .eq("class_id", class_id).execute().data)
    sessions = supabase.table("sessions").select("id, started_at").eq("class_id", class_id).execute().data
    sdate = {s["id"]: ist_date(s["started_at"]) for s in sessions}
    rows = supabase.table("attendance").select("session_id, student_id").in_("session_id", list(sdate)).execute().data if sdate else []
    present, held = set(), set()
    for r in rows:   # same-day sessions merge: present in any session that day = present
        d = sdate[r["session_id"]]; held.add(d); present.add((r["student_id"], d))
    dates = sorted(held)
    out = []
    for e in enrolled:
        p = e.get("profiles") or {}
        joined = ist_date(e["joined_at"]); marks, total, here = {}, 0, 0
        for d in dates:
            if d < joined:
                marks[d.isoformat()] = None; continue
            total += 1
            ok = (e["student_id"], d) in present
            here += ok; marks[d.isoformat()] = "P" if ok else "A"
        out.append({"roll": p.get("enrollment_no") or "", "name": p.get("full_name") or "Unnamed student",
                    "marks": marks, "total": total, "present": here,
                    "percent": round(100 * here / total, 1) if total else None})
    out.sort(key=lambda s: (s["roll"].zfill(20), s["name"]))
    return jsonify(class_name=cls[0]["name"], dates=[d.isoformat() for d in dates], students=out)


@bp.post("/sessions")
@require_role("teacher")
def start_session():
    cid = body().get("class_id")
    if not is_uuid(cid):
        return jsonify(error="class_id required"), 400
    if not supabase.table("classes").select("id").eq("id", cid).eq("teacher_id", g.user_id).execute().data:
        return jsonify(error="Class not found"), 404
    row = supabase.table("sessions").insert({"class_id": cid, "teacher_id": g.user_id}).execute().data[0]
    supabase.table("session_secrets").insert({"session_id": row["id"], "secret": secrets.token_hex(32)}).execute()
    return jsonify(session_id=row["id"]), 201


@bp.get("/sessions/<sid>/token")
@require_role("teacher")
def current_token(sid):
    s = get_session(sid)
    if not s or s["teacher_id"] != g.user_id or not s["is_active"]:
        return jsonify(error="Session not found or ended"), 404
    now = time.time()
    return jsonify(token=make_token(get_secret(sid), sid, int(now // WINDOW)), expires_in=WINDOW - int(now % WINDOW))


@bp.post("/sessions/<sid>/end")
@require_role("teacher")
def end_session(sid):
    s = get_session(sid)
    if not s or s["teacher_id"] != g.user_id:
        return jsonify(error="Session not found"), 404
    supabase.table("sessions").update({"is_active": False, "ended_at": datetime.now(timezone.utc).isoformat()}).eq("id", sid).execute()
    return jsonify(ok=True)


@bp.post("/sessions/<sid>/mark")
@require_role("teacher")
def mark(sid):
    s = get_session(sid)
    if not s or s["teacher_id"] != g.user_id:
        return jsonify(error="Session not found"), 404
    b = body(); stu = b.get("student_id")
    if not is_uuid(stu):
        return jsonify(error="student_id required"), 400
    if not supabase.table("enrollments").select("student_id").eq("class_id", s["class_id"]).eq("student_id", stu).execute().data:
        return jsonify(error="Student is not in this class"), 404
    if b.get("present"):
        try:
            supabase.table("attendance").insert({"session_id": sid, "student_id": stu, "method": "manual", "marked_by": g.user_id}).execute()
        except APIError as e:
            if not dup(e):
                raise
    else:
        supabase.table("attendance").delete().eq("session_id", sid).eq("student_id", stu).execute()
    return jsonify(ok=True)

@bp.get("/my-attendance")
@require_role("student")
def my_attendance():
    enr = (supabase.table("enrollments").select("class_id, joined_at, classes(name)")
           .eq("student_id", g.user_id).execute().data)
    out = []
    for e in enr:
        cid = e["class_id"]
        sessions = supabase.table("sessions").select("id, started_at").eq("class_id", cid).execute().data
        sdate = {s["id"]: ist_date(s["started_at"]) for s in sessions}
        rows = (supabase.table("attendance").select("session_id, student_id")
                .in_("session_id", list(sdate)).execute().data) if sdate else []
        held = {sdate[r["session_id"]] for r in rows}  # a date counts once anyone was present
        mine = {sdate[r["session_id"]] for r in rows if r["student_id"] == g.user_id}
        joined = ist_date(e["joined_at"])
        days = [{"date": d.isoformat(), "present": d in mine} for d in sorted(held) if d >= joined]
        here = sum(x["present"] for x in days)
        out.append({"class_id": cid, "name": (e.get("classes") or {}).get("name", "Class"),
                    "days": days, "total": len(days), "present": here,
                    "percent": round(100 * here / len(days), 1) if days else None})
    return jsonify(classes=out)

@bp.post("/attend")
@require_role("student")
def attend():
    b = body(); sid, token, dev = b.get("session_id"), str(b.get("token") or ""), str(b.get("device_id") or "")
    if not g.device_id or dev != g.device_id:
        return jsonify(error="This device is not linked to your account"), 403
    s = get_session(sid)
    if not s or not s["is_active"]:
        return jsonify(error="This session is not active"), 404
    if not supabase.table("enrollments").select("student_id").eq("class_id", s["class_id"]).eq("student_id", g.user_id).execute().data:
        return jsonify(error="You are not enrolled in this class"), 403
    if not valid_token(get_secret(sid), sid, token):
        return jsonify(error="QR code expired. Scan the current code."), 400
    try:
        supabase.table("attendance").insert({"session_id": sid, "student_id": g.user_id, "device_id": dev, "method": "qr"}).execute()
    except APIError as e:
        if dup(e):
            return jsonify(message="Already marked present")
        raise
    return jsonify(message="Marked present"), 201
