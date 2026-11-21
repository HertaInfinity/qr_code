import os
import uuid
import hmac
import time
import hashlib
import secrets
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, request, jsonify, g, current_app
from supabase import create_client
from postgrest.exceptions import APIError
from werkzeug.exceptions import HTTPException

bp = Blueprint("attendance", __name__, url_prefix="/api")

# service_role key: server-side only. It bypasses RLS, so every check happens in this file.
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
WINDOW = 30  # seconds each QR token stays current


# ---------- helpers ----------
def is_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def make_token(secret, session_id, window):
    msg = f"{session_id}:{window}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()[:16]


def valid_token(secret, session_id, token):
    # Accept the current window and the previous one (covers scan delay and clock drift).
    now = int(time.time() // WINDOW)
    return any(hmac.compare_digest(make_token(secret, session_id, w), token) for w in (now, now - 1))


def get_session(session_id):
    if not is_uuid(session_id):
        return None
    rows = supabase.table("sessions").select("*").eq("id", session_id).execute().data
    return rows[0] if rows else None


def get_secret(session_id):
    rows = supabase.table("session_secrets").select("secret").eq("session_id", session_id).execute().data
    return rows[0]["secret"] if rows else None


def require_role(*roles):
    """Verify the Supabase login token, look up the role in profiles, enforce it."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                return jsonify(error="Missing login token"), 401
            try:
                user = supabase.auth.get_user(header[7:]).user
            except Exception:
                user = None
            if user is None:
                return jsonify(error="Invalid or expired login"), 401
            rows = supabase.table("profiles").select("role, device_id").eq("id", user.id).execute().data
            role = rows[0]["role"] if rows else None
            if role not in roles:
                return jsonify(error="Not allowed"), 403
            g.user_id, g.role = user.id, role
            g.device_id = rows[0]["device_id"]
            return fn(*args, **kwargs)
        return wrapper
    return deco


@bp.errorhandler(Exception)
def on_error(e):
    if isinstance(e, HTTPException):
        return e
    current_app.logger.exception("API error")
    return jsonify(error="Internal server error"), 500


# ---------- routes ----------
@bp.get("/me")
@require_role("student", "teacher", "admin")
def me():
    return jsonify(user_id=g.user_id, role=g.role)


@bp.post("/sessions")
@require_role("teacher")
def start_session():
    class_id = (request.get_json(silent=True) or {}).get("class_id")
    if not is_uuid(class_id):
        return jsonify(error="class_id required"), 400
    owned = (supabase.table("classes").select("id")
             .eq("id", class_id).eq("teacher_id", g.user_id).execute().data)
    if not owned:
        return jsonify(error="Class not found"), 404
    row = supabase.table("sessions").insert({"class_id": class_id, "teacher_id": g.user_id}).execute().data[0]
    supabase.table("session_secrets").insert({"session_id": row["id"], "secret": secrets.token_hex(32)}).execute()
    return jsonify(session_id=row["id"]), 201


@bp.get("/sessions/<session_id>/token")
@require_role("teacher")
def current_token(session_id):
    s = get_session(session_id)
    if not s or s["teacher_id"] != g.user_id or not s["is_active"]:
        return jsonify(error="Session not found or ended"), 404
    now = time.time()
    token = make_token(get_secret(session_id), session_id, int(now // WINDOW))
    return jsonify(token=token, expires_in=WINDOW - int(now % WINDOW))


@bp.post("/sessions/<session_id>/end")
@require_role("teacher")
def end_session(session_id):
    s = get_session(session_id)
    if not s or s["teacher_id"] != g.user_id:
        return jsonify(error="Session not found"), 404
    (supabase.table("sessions")
     .update({"is_active": False, "ended_at": datetime.now(timezone.utc).isoformat()})
     .eq("id", session_id).execute())
    return jsonify(ok=True)

@bp.post("/device")
@require_role("student")
def register_device():
    device_id = str((request.get_json(silent=True) or {}).get("device_id") or "")[:64]
    if len(device_id) < 16:
        return jsonify(error="device_id required"), 400
    if g.device_id == device_id:
        return jsonify(ok=True)
    if g.device_id:
        return jsonify(error="This account is linked to another device. Ask your teacher to reset it."), 403
    try:
        supabase.table("profiles").update({"device_id": device_id}).eq("id", g.user_id).execute()
    except APIError as e:
        if getattr(e, "code", None) == "23505" or "duplicate" in str(e).lower():
            return jsonify(error="This device is already linked to another student account."), 403
        raise
    return jsonify(ok=True)

CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no look-alike characters


def new_join_code():
    return "".join(secrets.choice(CODE_CHARS) for _ in range(6))


@bp.post("/classes")
@require_role("teacher")
def create_class():
    name = str((request.get_json(silent=True) or {}).get("name") or "").strip()[:100]
    if not name:
        return jsonify(error="Class name required"), 400
    for _ in range(5):  # retry in the unlikely event of a code clash
        try:
            row = supabase.table("classes").insert(
                {"name": name, "teacher_id": g.user_id, "join_code": new_join_code()}).execute().data[0]
            return jsonify(id=row["id"], join_code=row["join_code"]), 201
        except APIError as e:
            if not (getattr(e, "code", None) == "23505" or "duplicate" in str(e).lower()):
                raise
    return jsonify(error="Could not create class, try again"), 500


@bp.post("/classes/join")
@require_role("student")
def join_class():
    code = str((request.get_json(silent=True) or {}).get("code") or "").strip().upper()
    rows = supabase.table("classes").select("id, name").eq("join_code", code).execute().data
    if not rows:
        return jsonify(error="No class found for that code"), 404
    try:
        supabase.table("enrollments").insert({"class_id": rows[0]["id"], "student_id": g.user_id}).execute()
    except APIError as e:
        if getattr(e, "code", None) == "23505" or "duplicate" in str(e).lower():
            return jsonify(message="You are already in " + rows[0]["name"])
        raise
    return jsonify(message="Joined " + rows[0]["name"]), 201

@bp.post("/attend")
@require_role("student")
def attend():
    body = request.get_json(silent=True) or {}
    session_id, token = body.get("session_id"), str(body.get("token") or "")
    device_id = str(body.get("device_id") or "")
    if not g.device_id or device_id != g.device_id:
        return jsonify(error="This device is not linked to your account"), 403
    s = get_session(session_id)
    if not s or not s["is_active"]:
        return jsonify(error="This session is not active"), 404
    enrolled = (supabase.table("enrollments").select("student_id")
                .eq("class_id", s["class_id"]).eq("student_id", g.user_id).execute().data)
    if not enrolled:
        return jsonify(error="You are not enrolled in this class"), 403
    if not valid_token(get_secret(session_id), session_id, token):
        return jsonify(error="QR code expired. Scan the current code."), 400
    try:
        supabase.table("attendance").insert({"session_id": session_id, "student_id": g.user_id,
                                     "device_id": device_id, "method": "qr"}).execute()
    except APIError as e:
        if getattr(e, "code", None) == "23505" or "duplicate" in str(e).lower():
            return jsonify(message="Already marked present")
        raise
    return jsonify(message="Marked present"), 201