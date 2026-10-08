# -*- coding: utf-8 -*-
"""Google Vids (Docs Videos) client — PB_MEDIA tab Vids.

Stack (F12 2026-10-01 + SuperVeo GenMedia strings):
  - UI: docs.google.com/videos/d/<DOC_ID>/edit
  - Upload refs: docs.google.com/upload/temporaryblob/videos?...
  - Host: appsgenaiserver-pa.clients6.google.com
  - Generate: /v1/genai/generate?key=<browser_key>
  - Quota: /v1/genai/quotaSummary?key=…
  - Download: /v1/genai/download?c=… → video/mp4
  - Content-Type: application/json+protobuf
  - Auth: Cookie (SID/PSID+SAPISID) + Authorization SAPISIDHASH
    (origin https://docs.google.com)
  - Blob id: AVL_…
  - Aspect nested [16,9] / [9,16]; clip 1–10s; 720p / 1080p (Upscale)

API key: browser key from F12 (pattern AIzaSy…). NEVER commit plaintext.
  Resolve order: env PB_VIDS_API_KEY / GOOGLE_VIDS_API_KEY → capture api_key
  (if not REDACTED) → key= in generate_url (if not REDACTED)
  → %LOCALAPPDATA%/PBMedia/vids_projects/vids_api_key.txt

Không đụng Luồng / Flow Omni YhhmEf. Không auto-mint bearer.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import uuid
from copy import deepcopy
from typing import Any, Callable
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

# ─── endpoints / constants (public hosts; không nhúng secret key) ───

APPSGENAI_HOST = "https://appsgenaiserver-pa.clients6.google.com"
GENERATE_PATH = "/v1/genai/generate"
QUOTA_PATH = "/v1/genai/quotaSummary"
DOWNLOAD_PATH = "/v1/genai/download"
GENERATE_PATH_HINT = GENERATE_PATH + "?key=<API_KEY_FROM_F12_OR_ENV>"
QUOTA_SUMMARY_HINT = QUOTA_PATH
DOWNLOAD_HINT = DOWNLOAD_PATH + "?c=… → video/mp4"

TEMP_BLOB_UPLOAD = (
    "https://docs.google.com/upload/temporaryblob/videos"
    "?authuser=0&upload_protocol=resumable"
)
DOCS_VIDS_EDIT_TMPL = "https://docs.google.com/videos/d/{doc_id}/edit"
DOCS_ORIGIN = "https://docs.google.com"
ENVELOPE_HEADER = "X-Veo3-Response-Envelope"
# Static client token embedded in SuperVeo.exe beside json+protobuf (not user secret).
DEFAULT_X_SERVER_TOKEN = "CAMSGhUR9NL9N67auQayvgSuUb6_BqcGt6CSAB0H"

BLOB_ID_RE = re.compile(r"AVL_[A-Za-z0-9_\-]+")
DOC_ID_RE = re.compile(r"^1[A-Za-z0-9_\-]{20,}$")
REDACT_MARKERS = ("REDACTED_KEY", "REDACTED", "YOUR_KEY", "<API_KEY", "AIza***")

MODEL_HINT_DEFAULT = "super_veo_1_0"

ASPECT_PAIR = {
    "16:9": [16, 9],
    "9:16": [9, 16],
}

# SuperVeo-style orientation strings (optional body inject; keep [16,9] primary).
ASPECT_ORIENTATION = {
    "16:9": "landscape",
    "9:16": "portrait",
}

# Tran so anh ref gui kem mot lan generate.
#
# Cu la 6 (cung 8), dat hoi SuperVeo tu choi o ~14 anh. Nhung prompt that
# hay co nhieu hon the: `@CHAR_02 | @BG_05 | @PROP_01 | @CHAR_04 | ...`.
# Cat bot thi anh gui di khong con khop voi ma trong prompt — hong ca canh.
#
# Nang len 16 (cung 24). Chinh duoc bang CAPCUT_VIDS_MAX_REF phong khi
# Google siet lai, khoi phai sua code.
def _tran_ref_tu_env(ten: str, mac_dinh: int) -> int:
    try:
        v = int(str(os.environ.get(ten, "")).strip() or 0)
        return v if v > 0 else mac_dinh
    except (TypeError, ValueError):
        return mac_dinh


# 08/10 — người dùng chốt TỐI ĐA 10 ảnh/cảnh. Trần cứng = trần mềm để không
# đường nào gửi quá 10 (bản cũ cứng 24). Đổi bằng CAPCUT_VIDS_MAX_REF.
MAX_REF_IMAGES = _tran_ref_tu_env("CAPCUT_VIDS_MAX_REF", 10)
MAX_REF_IMAGES_HARD = MAX_REF_IMAGES

DURATION_LINE_RE = re.compile(
    r"(?im)^[ \t]*Duration[ \t]*:[ \t]*\d+[ \t]*seconds?[ \t]*$"
)
CONTRIB_RT_HOST = "contribution-rt.usercontent.google.com"
HTTPS_URL_RE = re.compile(r'https://[^\s"\'<>\\]+', re.IGNORECASE)
C_TOKEN_RE = re.compile(
    r"(?:[?&]c=|/download\?c=)([A-Za-z0-9_\-]{8,})", re.IGNORECASE
)
JOB_LIKE_RE = re.compile(
    r"(?:operations?/|jobs?/)?(?:Cg[A-Za-z0-9_\-]{10,}|AVL_[A-Za-z0-9_\-]+)"
)

LogFn = Callable[[str], None]


class VidsPayloadNotReady(RuntimeError):
    """Payload generate chưa có — cần user export F12 / key."""


class VidsAuthError(RuntimeError):
    """Thiếu cookie Google cho Docs / appsgenaiserver."""


def _log(log: LogFn | None, msg: str) -> None:
    if log:
        try:
            log(msg if msg.endswith("\n") else msg + "\n")
        except Exception:
            pass


def projects_capture_path() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "PBMedia", "vids_projects", "vids_generate_capture.json")


def normalize_resolution(resolution: str | None) -> str:
    res = (resolution or "720p").strip()
    if res in ("720", "1080"):
        res = res + "p"
    if res not in ("720p", "1080p"):
        res = "720p"
    return res


def aspect_pair(aspect: str | None) -> list[int]:
    a = (aspect or "16:9").strip()
    return list(ASPECT_PAIR.get(a, ASPECT_PAIR["16:9"]))


def aspect_orientation(aspect: str | None) -> str:
    a = (aspect or "16:9").strip()
    if a not in ASPECT_PAIR:
        a = "16:9"
    return ASPECT_ORIENTATION.get(a, "landscape")


def ensure_duration_in_prompt(prompt: str, duration_sec: int | None) -> str:
    """SuperVeo-style: ensure outbound prompt has «Duration: N seconds».

    If a Duration line already exists, replace it (no duplicate). Keep protobuf
    duration inject separately (callers do BOTH text + field).
    """
    try:
        n = int(duration_sec) if duration_sec is not None else 8
    except (TypeError, ValueError):
        n = 8
    n = max(1, min(10, n))
    line = f"Duration: {n} seconds"
    text = (prompt or "").rstrip()
    if DURATION_LINE_RE.search(text or ""):
        text = DURATION_LINE_RE.sub(line, text, count=1)
        # Drop any extra Duration lines after the first replacement.
        parts = text.splitlines()
        out_lines: list[str] = []
        seen = False
        for ln in parts:
            if DURATION_LINE_RE.match(ln):
                if seen:
                    continue
                seen = True
                out_lines.append(line)
            else:
                out_lines.append(ln)
        return "\n".join(out_lines).rstrip()
    if not text:
        return line
    return text + "\n" + line


#: body[0] chọn việc: 376 = tạo video mới, 378 = kéo dài video đã có.
VIDS_OP_TAO = 376
VIDS_OP_KEO_DAI = 378

#: Đường dẫn RIÊNG của lệnh kéo dài (tạo mới dùng 3.3.0.0.2 cho prompt).
VIDS_KD_PROMPT_PATH = (3, 2)
VIDS_KD_REFS_PATH = (2, 25)
#: Trong node ref của lệnh kéo dài:
VIDS_KD_UUID_1 = (0, 0, 7, 0)
VIDS_KD_NGUON = (0, 0, 7, 1, 25, 2)
VIDS_KD_UUID_2 = (0, 0, 7, 1, 25, 7)


def ma_nguon_tu_url(url: str):
    """URL tải → mã 48 hex của video, để đem đi kéo dài.

    Token `c=` là protobuf base64url: bên trong có "bard_storage",
    "temp_data" rồi tới mã. Bóc bằng regex chữ in được thì dính luôn byte
    ĐỘ DÀI (48 = 0x30 = ký tự "0") nên ra 49 ký tự — phải đọc byte độ dài
    rồi cắt đúng ngần ấy.
    """
    import base64
    from urllib.parse import urlsplit, parse_qs
    try:
        c = parse_qs(urlsplit(str(url or "")).query).get("c", [""])[0]
        if not c:
            return None
        raw = base64.urlsafe_b64decode(c + "=" * (-len(c) % 4))
        i = raw.find(b"temp_data")
        if i < 0:
            return None
        j = i + len(b"temp_data")
        for k in range(j, min(j + 8, len(raw))):
            n = raw[k]
            if 20 <= n <= 80 and k + 1 + n <= len(raw):
                ma = raw[k + 1:k + 1 + n]
                if re.fullmatch(rb"[0-9a-f]+", ma):
                    return ma.decode()
    except Exception:
        pass
    return None


def _node_ref_keo_dai(ma_nguon: str, uuid_moi: str) -> list:
    """Dựng node `2.25` của lệnh kéo dài: một ref trỏ video nguồn."""
    trong = [None] * 26
    trong[25] = [None, None,
                 ["bard_storage", None, "lookup_temp_data", ma_nguon],
                 None, None, None, None, uuid_moi]
    return [[[None, None, None, None, None, None, None,
              [uuid_moi, trong]]]]


def build_extend_body(ov: dict, *, ma_nguon: str, prompt: str,
                      duration_sec=None, doc_id: str = ""):
    """Body lệnh KÉO DÀI, dựng từ chính khuôn của lệnh tạo mới.

    Nhân bản khuôn rồi thay ba chỗ (xem ghi chú đầu bản vá) — tự dựng cây
    null từ số 0 thì sai một nhánh là HTTP 400, mà Google đổi schema lúc
    nào cũng không biết.
    """
    import copy
    import uuid as _uuid

    khuon = (ov or {}).get("body_template")
    if not isinstance(khuon, list) or len(khuon) < 6:
        raise RuntimeError("Thiếu body_template trong capture Vids.")
    if not ma_nguon:
        raise RuntimeError("Thiếu mã video nguồn để kéo dài.")
    body = copy.deepcopy(khuon)
    body[0] = VIDS_OP_KEO_DAI

    # prompt: lệnh kéo dài đặt NÔNG hơn lệnh tạo mới.
    body[3] = [None, None, str(prompt or "")]

    # refs: thay cả cụm ảnh bằng một node trỏ video nguồn.
    uu = str(_uuid.uuid4()).upper()
    _dat_sau(body, VIDS_KD_REFS_PATH,
             _node_ref_keo_dai(ma_nguon, uu))

    if duration_sec is not None:
        try:
            _dat_sau(body, tuple(
                int(x) for x in str(ov.get("duration_path") or "4.15.8"
                                    ).split(".")), int(duration_sec))
        except Exception:
            pass
    if doc_id:
        try:
            _dat_sau(body, tuple(
                int(x) for x in str(ov.get("doc_id_path") or "").split(".")
                if x != ""), doc_id)
        except Exception:
            pass
    return body


def clamp_ref_list(items: list | None, *, max_n: int | None = None, log: LogFn | None = None, label: str = "refs") -> list:
    """Cap reference images / blob ids at MAX_REF_IMAGES (hard MAX_REF_IMAGES_HARD)."""
    arr = list(items or [])
    cap = max_n if max_n is not None else MAX_REF_IMAGES
    try:
        cap = int(cap)
    except (TypeError, ValueError):
        cap = MAX_REF_IMAGES
    cap = max(1, min(MAX_REF_IMAGES_HARD, cap))
    if len(arr) > cap:
        _log(log, f"⚠ Vids: {label} có {len(arr)} ảnh — chỉ gửi {cap} ảnh đầu "
                  f"(trần {cap}/cảnh); mã gọi sau ảnh thứ {cap} sẽ KHÔNG có ảnh.")
        return arr[:cap]
    return arr


def map_generate_fields(
    *,
    prompt: str,
    aspect: str = "16:9",
    resolution: str = "720p",
    model: str | None = None,
    blob_ids: list[str] | None = None,
    duration_sec: int | None = None,
    doc_id: str | None = None,
) -> dict[str, Any]:
    res = normalize_resolution(resolution)
    if duration_sec is None:
        dur = 8
    else:
        try:
            dur = int(duration_sec)
        except (TypeError, ValueError):
            dur = 8
        dur = max(1, min(10, dur))
    asp = aspect if aspect in ASPECT_PAIR else "16:9"
    prompt_out = ensure_duration_in_prompt((prompt or "").strip(), dur)
    blobs = clamp_ref_list(list(blob_ids or []), label="blob_ids")
    return {
        "prompt": prompt_out,
        "aspect": asp,
        "aspect_pair": aspect_pair(asp),
        "aspect_orientation": aspect_orientation(asp),
        "resolution": res,
        "prefer_upscale_1080": res.startswith("1080"),
        "model_hint": (model or MODEL_HINT_DEFAULT).strip() or MODEL_HINT_DEFAULT,
        "blob_ids": blobs,
        "duration_sec": dur,
        "doc_id": (doc_id or "").strip(),
        "hosts": {
            "appsgenai": APPSGENAI_HOST,
            "generate": APPSGENAI_HOST + GENERATE_PATH,
            "temp_blob_upload": TEMP_BLOB_UPLOAD,
            "docs_vids_edit": DOCS_VIDS_EDIT_TMPL,
            "generate_hint": GENERATE_PATH_HINT,
            "quota_hint": QUOTA_SUMMARY_HINT,
            "download_hint": DOWNLOAD_HINT,
            "envelope_header": ENVELOPE_HEADER,
        },
    }


def _cookie_names(cookies: str) -> set[str]:
    names: set[str] = set()
    for part in (cookies or "").split(";"):
        k, _, _v = part.strip().partition("=")
        if k:
            names.add(k.strip())
    return names


def _cookie_val(cookies: str, name: str) -> str:
    for part in (cookies or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k.strip() == name:
            return v.strip()
    return ""


def google_cookie_status(cookies: str) -> tuple[bool, list[str], str]:
    names = _cookie_names(cookies)
    missing: list[str] = []
    has_sid = bool({"SID", "__Secure-1PSID", "__Secure-3PSID"} & names)
    has_hash = bool({"SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID"} & names)
    if not has_sid:
        missing.append("SID|__Secure-1PSID")
    if not has_hash:
        missing.append("SAPISID|__Secure-1PAPISID")
    if not missing:
        return True, [], (
            "Cookie Google OK (PSID/SID + SAPISID). "
            "next-auth labs không bắt buộc cho Docs Vids."
        )
    hint = (
        "Thiếu cookie Google cho Google Vids / Docs:\n"
        f"  • {', '.join(missing)}\n\n"
        "Vào «🖼 Tạo ảnh» → «⚙ Settings» → «🍪 Lấy Cookie» "
        "(cùng jar cookie; cần SID/PSID + SAPISID từ .google.com).\n"
        "Lưu ý: next-auth labs.google thường KHÔNG đủ cho docs.google.com/videos."
    )
    return False, missing, hint


def _doc_quota(than: str) -> str:
    """Phản hồi `quotaSummary` → một dòng đọc được. '' nếu không hiểu gì.

    CHỈ giải mã trường đã KIỂM ĐƯỢC: mốc reset dạng Unix. Thân lỗi 429 thật
    (03/10/2026) chứa:

        GetQuotaSummaryResponse,[[null,["0",null,"0",1,null,null,
                                  ["1793516400"],0],"0",[9],1,17,38]]

    `1793516400` → 01/11/2026 14:00 giờ VN, khớp với chu kỳ reset hàng tháng.
    Mấy số còn lại (0, 9, 1, 17, 38) CHƯA biết nghĩa — in thô, không đoán bừa,
    vì đoán sai còn tệ hơn không in.
    """
    import re as _re
    import datetime as _dt
    try:
        s = (than or "").strip()
        if not s:
            return ""
        ra = []
        mocs = [int(x) for x in _re.findall(r'"(1[7-9]\d{8})"', s)]
        if mocs:
            _t = (_dt.datetime.utcfromtimestamp(min(mocs))
                  + _dt.timedelta(hours=7))
            ra.append("reset %s (giờ VN)" % _t.strftime("%d/%m/%Y %H:%M"))
        if "QUOTA_EXHAUSTED" in s.upper():
            ra.append("ĐÃ HẾT hạn mức")
        _so = _re.findall(r"(?<![\d.])(\d{1,6})(?![\d.])", s[-120:])
        if _so:
            ra.append("số thô cuối: " + ",".join(_so[-6:]))
        return " · ".join(ra)
    except Exception:
        return ""


def sapisidhash(cookies: str, origin: str = DOCS_ORIGIN) -> str:
    sapisid = (
        _cookie_val(cookies, "SAPISID")
        or _cookie_val(cookies, "__Secure-1PAPISID")
        or _cookie_val(cookies, "__Secure-3PAPISID")
    )
    if not sapisid:
        return ""
    ts = int(time.time())
    dig = hashlib.sha1(f"{ts} {sapisid} {origin}".encode("utf-8")).hexdigest()
    return f"SAPISIDHASH {ts}_{dig}"


def f12_capture_checklist_vn() -> str:
    return (
        "=== Checklist F12 — bắt 1 lần generate thành công trên Google Vids ===\n"
        "1) Mở Chrome → https://docs.google.com/videos/ → tạo/mở 1 video.\n"
        "2) F12 → tab Network → tick Preserve log / Keep log.\n"
        "3) Filter: generate   (host appsgenaiserver-pa.clients6.google.com).\n"
        "4) Trong UI Vids: nhập prompt → bấm tạo clip.\n"
        "5) Click POST «/v1/genai/generate?key=…»:\n"
        "   • Headers: Request URL (che key=REDACTED_KEY), Cookie (CHE),\n"
        "     Authorization SAPISIDHASH, Content-Type application/json+protobuf.\n"
        "   • Payload: copy body nested; CHE secret.\n"
        "6) Cũng lưu (nếu có): quotaSummary, download?c=… (video/mp4).\n"
        "7) Lưu JSON overlay (redacted) tại:\n"
        f"   {projects_capture_path()}\n"
        "   Key live: env PB_VIDS_API_KEY hoặc vids_api_key.txt cạnh capture.\n"
        "8) Không dán secret vào chat — chỉ file local redacted.\n"
        "Filter YhhmEf = 0 hits là ĐÚNG (Flow only; Vids không dùng).\n"
    )



def vids_theo_tk_path() -> str:
    return os.path.join(os.path.dirname(projects_capture_path()), "_vids_theo_tk.json")


def load_vids_theo_tk(email: str) -> dict:
    email = (email or "").strip().lower()
    if not email:
        return {}
    p = vids_theo_tk_path()
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}
    row = (data or {}).get(email) if isinstance(data, dict) else None
    return row if isinstance(row, dict) else {}


def save_vids_theo_tk(email: str, doc_id: str = "", goog_session: str = "") -> str:
    email = (email or "").strip().lower()
    if not email:
        return ""
    p = vids_theo_tk_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    data = {}
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f) or {}
        except Exception:
            data = {}
    if not isinstance(data, dict):
        data = {}
    row = dict(data.get(email) or {})
    if doc_id:
        row["doc_id"] = doc_id
    if goog_session:
        row["goog_session_hint"] = goog_session
    row["email"] = email
    row["updated"] = int(time.time())
    data[email] = row
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return p


def extract_vids_session(text: str) -> tuple[str, str]:
    """Rút doc_id và goog_session từ HTML hoặc body generate."""
    raw = text or ""
    doc = ""
    m = re.search(r"/videos/d/(1[A-Za-z0-9_\-]{20,})", raw)
    if m:
        doc = m.group(1)
    if not doc:
        m = re.search(r'"(1[A-Za-z0-9_\-]{20,})"', raw)
        if m and DOC_ID_RE.match(m.group(1)):
            doc = m.group(1)
    sess = ""
    for pat in (
        r'"goog_session_hint"\s*:\s*"([^"]+)"',
        r'"goog_session"\s*:\s*"([^"]+)"',
        r"goog_session(?:_hint)?[=:]\s*([A-Za-z0-9_\-\.]{12,})",
    ):
        m = re.search(pat, raw)
        if m and "PLACEHOLDER" not in m.group(1).upper() and "XXXX" not in m.group(1):
            sess = m.group(1)
            break
    return doc, sess


def load_capture_overlay(path: str | None = None) -> dict | None:
    p = path or projects_capture_path()
    if not p or not os.path.isfile(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _is_redacted_key(val: str) -> bool:
    v = (val or "").strip()
    if not v:
        return True
    up = v.upper()
    if any(m.upper() in up for m in REDACT_MARKERS):
        return True
    if v.startswith("<") and v.endswith(">"):
        return True
    return False


def resolve_api_key(overlay: dict | None = None) -> str:
    for env_name in ("PB_VIDS_API_KEY", "GOOGLE_VIDS_API_KEY", "GVIDS_API_KEY"):
        v = (os.environ.get(env_name) or "").strip()
        if v and not _is_redacted_key(v):
            return v
    ov = overlay or load_capture_overlay() or {}
    env_from_ov = str(ov.get("api_key_env") or "").strip()
    if env_from_ov:
        v = (os.environ.get(env_from_ov) or "").strip()
        if v and not _is_redacted_key(v):
            return v
    ak = str(ov.get("api_key") or "").strip()
    if ak and not _is_redacted_key(ak):
        return ak
    url = str(ov.get("generate_url") or "")
    try:
        qs = parse_qs(urlparse(url).query)
        key = (qs.get("key") or [""])[0].strip()
        if key and not _is_redacted_key(key):
            return key
    except Exception:
        pass
    side = os.path.join(os.path.dirname(projects_capture_path()), "vids_api_key.txt")
    if os.path.isfile(side):
        try:
            with open(side, "r", encoding="utf-8") as f:
                key = (f.read() or "").strip().splitlines()[0].strip()
            if key and not _is_redacted_key(key):
                return key
        except Exception:
            pass
    return ""


def build_generate_url(overlay: dict | None = None, api_key: str | None = None) -> str:
    ov = overlay or {}
    key = (api_key or resolve_api_key(ov) or "").strip()
    url = str(ov.get("generate_url") or "").strip()
    if not url:
        url = f"{APPSGENAI_HOST}{GENERATE_PATH}?key=REDACTED_KEY"
    if key and not _is_redacted_key(key):
        parts = urlparse(url)
        qs = parse_qs(parts.query, keep_blank_values=True)
        qs["key"] = [key]
        flat = []
        for k, vals in qs.items():
            for v in vals:
                flat.append((k, v))
        url = urlunparse(parts._replace(query=urlencode(flat)))
    return url


def overlay_ready(overlay: dict | None) -> bool:
    if not isinstance(overlay, dict):
        return False
    url = str(overlay.get("generate_url") or "").strip()
    body = overlay.get("body_template")
    if body is None or not url or "generate" not in url.lower():
        return False
    return bool(resolve_api_key(overlay))


def overlay_ready_soft(overlay: dict | None) -> bool:
    if not isinstance(overlay, dict):
        return False
    url = str(overlay.get("generate_url") or "").strip()
    body = overlay.get("body_template")
    return bool(url) and ("generate" in url.lower()) and (body is not None)


class GoogleVidsClient:
    """Auth + temporaryblob upload + generate/poll/download via F12 overlay."""

    def __init__(self, cookies: str = "", log: LogFn | None = None):
        self.cookies = (cookies or "").strip()
        self.log = log
        self.last_error = ""
        #: URL tải + mã 48 hex của video vừa dựng — dùng cho lệnh kéo dài.
        self.last_download_url = ""
        self.last_source_id = ""
        self.overlay = load_capture_overlay()


    def bat_phien_tai_khoan(self, email: str) -> dict:
        """Mở docs.google.com/videos bằng cookie đang chạy, lưu doc_id của đúng email."""
        email = (email or "").strip().lower()
        if not email:
            return {}
        self.require_auth()
        try:
            import requests
        except Exception as e:
            raise RuntimeError("Thiếu requests để bắt phiên Vids: %s" % e)
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Cookie": self.cookies,
            "Referer": "https://docs.google.com/videos/",
        }
        resp = requests.get("https://docs.google.com/videos/", headers=headers, timeout=30, allow_redirects=True)
        doc, sess = extract_vids_session((resp.text or "") + "\n" + str(resp.url or ""))
        if not doc:
            resp2 = requests.get("https://docs.google.com/videos/u/0/", headers=headers, timeout=30, allow_redirects=True)
            doc, sess2 = extract_vids_session((resp2.text or "") + "\n" + str(resp2.url or ""))
            sess = sess or sess2
        # Trang chủ Vids đầy chuỗi "1xxxx…" không phải doc — chỉ tin doc_id
        # nằm trong link /videos/d/<id>, kẻo ghi nhầm vào sổ mãi mãi.
        _trang = (resp.text or "") + str(resp.url or "")
        try:
            _trang += (resp2.text or "") + str(resp2.url or "")
        except NameError:
            pass
        if doc and ("/videos/d/" + doc) not in _trang:
            doc = ""
        _da_tao = getattr(type(self), "_da_thu_tao_doc", None)
        if _da_tao is None:
            _da_tao = type(self)._da_thu_tao_doc = set()
        if not doc and email not in _da_tao:
            # Mỗi TK chỉ thử MỘT lần mỗi phiên tool — tạo ra mà không đọc
            # được id thì đừng rải doc trống vào Drive sau từng cảnh.
            _da_tao.add(email)
            # 08/10 — TỰ TẠO doc Vids trống cho tài khoản, khỏi bắt người
            # dùng lên web tạo tay. Giống gõ docs.google.com/videos/create
            # trên trình duyệt: Google tạo «Untitled video» trong Drive của
            # chính tài khoản rồi chuyển hướng sang /videos/d/<id>/edit.
            # Không sinh video AI, không tốn hạn mức.
            try:
                _hd_tao = dict(headers)
                _hd_tao["User-Agent"] = (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/141.0.0.0 Safari/537.36")
                _r_tao = requests.get(
                    "https://docs.google.com/videos/create",
                    headers=_hd_tao, timeout=45, allow_redirects=True)
                _url_tao = str(_r_tao.url or "")
                _m = re.search(r"/videos/d/(1[A-Za-z0-9_\-]{20,})", _url_tao)
                if not _m:
                    _m = re.search(r"/videos/d/(1[A-Za-z0-9_\-]{20,})/edit",
                                   _r_tao.text or "")
                if _m:
                    doc = _m.group(1)
                    _log(self.log, "🆕 Đã tự tạo doc Vids trống cho %s: %s…"
                         % (email, doc[:12]))
                else:
                    _log(self.log, "⚠ Tự tạo doc Vids không ra id (HTTP %s, "
                         "về %s)." % (_r_tao.status_code, _url_tao[:80]))
            except Exception as e:
                _log(self.log, "⚠ Tự tạo doc Vids lỗi: %s" % str(e)[:120])
        if doc or sess:
            path = save_vids_theo_tk(email, doc, sess)
            _log(self.log, "📌 Đã lưu phiên Vids của %s → %s (doc=%s session=%s)" % (
                email, path, (doc[:12] + "…") if doc else "chưa có", "có" if sess else "chưa có"))
        else:
            _log(self.log, "⚠ Không lấy/tạo được doc_id Vids — dùng doc mặc định.")
        return load_vids_theo_tk(email)


    def tao_mot_video_va_lay_id(self, email: str) -> dict:
        """Lần đầu: mở Vids bằng hồ sơ tài khoản, tạo 1 video chữ, lưu doc_id + session."""
        email = (email or "").strip().lower()
        if not email:
            return {}
        profile = (os.environ.get("PB_VIDS_PROFILE") or "").strip()
        if not profile:
            base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
            key = "mail_" + email.replace("@", "_").replace(".", "_")
            profile = os.path.join(base, "PBMedia", "chrome_flow_accounts", key)
        if not os.path.isdir(profile):
            _log(self.log, "⚠ Không thấy hồ sơ Chrome: %s" % profile)
            return {}
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            _log(self.log, "⚠ Chưa có Playwright. Chạy: py -m pip install playwright && py -m playwright install chromium")
            return {}
        captured = {"body": "", "url": ""}

        def _on_request(req):
            if req.method == "POST" and "genai/generate" in (req.url or ""):
                captured["body"] = req.post_data or ""
                captured["url"] = req.url or ""

        _log(self.log, "🌐 Lần đầu: mở Vids và tạo 1 video chữ để lấy doc_id của %s" % email)
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(
                profile,
                channel="chrome",
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.on("request", _on_request)
            page.goto("https://docs.google.com/videos/", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(4000)
            prompt = "A calm landscape, soft light, no text. Duration: 4 seconds"
            filled = False
            for sel in ("textarea", "[contenteditable='true']", "input[type='text']"):
                loc = page.locator(sel)
                if loc.count():
                    try:
                        loc.first.click(timeout=3000)
                        loc.first.fill(prompt, timeout=3000)
                        filled = True
                        break
                    except Exception:
                        continue
            if filled:
                for name in ("Create", "Generate", "Tạo", "Tạo video"):
                    btn = page.get_by_role("button", name=name)
                    if btn.count():
                        try:
                            btn.first.click(timeout=3000)
                            break
                        except Exception:
                            continue
                page.keyboard.press("Control+Enter")
            else:
                _log(self.log, "⚠ Chưa thấy ô prompt. Hãy bấm Tạo một video trong cửa sổ vừa mở.")
            for _ in range(45):
                if captured["body"]:
                    break
                page.wait_for_timeout(2000)
            ctx.close()
        doc, sess = extract_vids_session(captured["body"] + "\n" + captured["url"])
        if doc or sess:
            path = save_vids_theo_tk(email, doc, sess)
            _log(self.log, "📌 Đã lấy id từ video web → %s (doc=%s session=%s)" % (
                path, (doc[:12] + "…") if doc else "chưa có", "có" if sess else "chưa có"))
        else:
            _log(self.log, "⚠ Không bắt được request generate. Tạo một video trong cửa sổ Vids rồi bấm Tạo lại.")
        return load_vids_theo_tk(email)

    def require_auth(self) -> None:
        ok, _miss, hint = google_cookie_status(self.cookies)
        if not ok:
            raise VidsAuthError(hint)

    def mapped_fields(
        self,
        *,
        prompt: str,
        aspect: str = "16:9",
        resolution: str = "720p",
        blob_ids: list[str] | None = None,
        model: str | None = None,
        duration_sec: int | None = None,
        doc_id: str | None = None,
    ) -> dict[str, Any]:
        return map_generate_fields(
            prompt=prompt,
            aspect=aspect,
            resolution=resolution,
            model=model,
            blob_ids=blob_ids,
            duration_sec=duration_sec,
            doc_id=doc_id,
        )

    def upload_refs(
        self, paths: list[str], *, authuser: int = 0
    ) -> list[dict[str, str]]:
        self.require_auth()
        out: list[dict[str, str]] = []
        for i, path in enumerate(paths or []):
            if not path or not os.path.isfile(path):
                continue
            try:
                blob = self._upload_one_blob(path, authuser=authuser)
            except Exception as e:
                _log(self.log, f"⚠ Upload ref fail {os.path.basename(path)}: {e}")
                continue
            if not blob:
                continue
            name = f"Hình ảnh{i + 1}"
            out.append(
                {
                    "blob_id": blob,
                    "name": name,
                    "path": path,
                    "uuid": str(uuid.uuid4()).upper(),
                }
            )
            # IN TÊN ẢNH, không chỉ «Hình ảnh1». Bốn luồng chạy song song nên
            # mấy dòng «📎 Ref sẵn sàng» ở trên bị trộn lẫn giữa các cảnh —
            # không ghép lại được ảnh nào thuộc cảnh nào. Mỗi dòng phải tự nói
            # đủ: thứ tự + tên file + mã blob.
            _log(self.log, "✅ Upload OK → %s = %s → %s…"
                 % (name, os.path.basename(path), blob[:20]))
        return out

    def _upload_one_blob(self, path: str, *, authuser: int = 0) -> str:
        import requests

        url = (
            "https://docs.google.com/upload/temporaryblob/videos"
            f"?authuser={authuser}&upload_protocol=resumable"
        )
        size = os.path.getsize(path)
        mime = "image/jpeg"
        low = path.lower()
        if low.endswith(".png"):
            mime = "image/png"
        elif low.endswith(".webp"):
            mime = "image/webp"
        elif low.endswith(".gif"):
            mime = "image/gif"
        headers = {
            "Cookie": self.cookies,
            "Origin": DOCS_ORIGIN,
            "Referer": DOCS_ORIGIN + "/",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": mime,
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        }
        auth = sapisidhash(self.cookies, DOCS_ORIGIN)
        if auth:
            headers["Authorization"] = auth

        #: URL resumable của Google DÙNG MỘT LẦN. Thử biến thể thứ hai trên
        #: cùng URL là hỏng vì lý do khác (phiên upload đã chết), nên mỗi biến
        #: thể phải xin URL mới.
        _b1_da_ghi = [False]

        def _xin_upload_url() -> str:
            r = requests.post(url, headers=headers, data=b"", timeout=60)
            u = (r.headers.get("x-goog-upload-url")
                 or r.headers.get("X-Goog-Upload-URL") or "")
            if not _b1_da_ghi[0]:
                _b1_da_ghi[0] = True
                _log(self.log,
                     "   [upload b1] %s · HTTP %s · x-goog-upload-url=%s"
                     % (os.path.basename(path), r.status_code,
                        "có" if u else "KHÔNG"))
            if not u:
                raise RuntimeError(
                    f"Không có x-goog-upload-url (HTTP {r.status_code}). "
                    "Thiếu cookie Docs / OSID?"
                )
            return u

        with open(path, "rb") as f:
            data = f.read()

        def _boc_avl(resp) -> str:
            """Tìm AVL_ trong thân phản hồi; '' nếu không có."""
            m = BLOB_ID_RE.search(resp.text or "")
            if m:
                return m.group(0)
            try:
                return _find_first_avl(resp.json()) or ""
            except Exception:
                return ""

        # ── BƯỚC 2: nộp dữ liệu rồi finalize ──
        #
        # 02/10 — bước này trả HTTP 500 cho MỌI ảnh và bản cũ chỉ báo đúng mã
        # 500, nuốt mất thân phản hồi, nên không có gì để lần. Giờ:
        #   · in mã + thân phản hồi (Google nói lý do ở đó) + x-goog-upload-status
        #   · thử lần lượt vài biến thể đầu mục, ghi lại cái nào ăn
        # Cùng cách đã gỡ được lỗi tải 403 (xem `_cach` trong phần download):
        # thà thử 4 lần có ghi chép, hơn là đoán.
        _chung = {
            "Cookie": self.cookies,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Offset": "0",
            "Content-Type": mime,
        }

        def _bien_the():
            # (tên, đầu mục, có tách finalize riêng?)
            h1 = dict(_chung, **{
                "Origin": DOCS_ORIGIN, "Referer": DOCS_ORIGIN + "/",
                "X-Goog-Upload-Command": "upload, finalize",
                "Content-Length": str(len(data)),
            })
            if auth:
                h1["Authorization"] = auth
            yield "nhu cu", h1, False
            # Scotty cấp URL đã ký sẵn — thêm Authorization vào đó là dư,
            # và máy chủ upload hay 500 khi thấy đầu mục nó không chờ.
            h2 = {k: v for k, v in h1.items() if k != "Authorization"}
            yield "bo Authorization", h2, False
            # requests tự đặt Content-Length; đặt tay dễ thành hai dòng lệch nhau.
            h3 = {k: v for k, v in h2.items() if k != "Content-Length"}
            yield "bo Content-Length", h3, False
            # Origin/Referer của docs.google.com gửi sang host scotty là sai chỗ.
            h4 = {k: v for k, v in h3.items()
                  if k not in ("Origin", "Referer")}
            yield "bo Origin/Referer", h4, False
            # Tách hai lệnh: upload xong rồi mới finalize (đúng giao thức gốc).
            h5 = dict(h4)
            h5["X-Goog-Upload-Command"] = "upload"
            yield "tach upload roi finalize", h5, True

        # Cách đã ăn ở ảnh trước xếp lên đầu thang — không BỎ các cách còn
        # lại, vì phiên có thể đổi ý giữa mẻ.
        _thang = list(_bien_the())
        _da_chon = getattr(type(self), "_cach_upload_ok", "")
        if _da_chon:
            _thang.sort(key=lambda x: 0 if x[0] == _da_chon else 1)
        _loi_cuoi = ""
        for ten, hd, tach in _thang:
            upload_url = _xin_upload_url()
            r2 = requests.post(upload_url, headers=hd, data=data, timeout=180)
            blob = _boc_avl(r2)
            if not blob and tach:
                hf = {k: v for k, v in hd.items() if k != "Content-Type"}
                hf["X-Goog-Upload-Command"] = "finalize"
                hf["X-Goog-Upload-Offset"] = str(len(data))
                r3 = requests.post(upload_url, headers=hf, data=b"", timeout=60)
                blob = _boc_avl(r3)
                r2 = r3 if not blob else r2
            if blob:
                if ten != _da_chon:
                    type(self)._cach_upload_ok = ten
                    _log(self.log, f"   [upload b2] ăn bằng cách «{ten}».")
                return blob
            _than = (r2.text or "").strip().replace("\n", " ")[:220]
            _loi_cuoi = ("HTTP %s · upload-status=%s · %s"
                         % (r2.status_code,
                            r2.headers.get("x-goog-upload-status") or "-",
                            _than or "(thân rỗng)"))
            _log(self.log, f"   [upload b2] «{ten}» hỏng → {_loi_cuoi}")
        raise RuntimeError(
            "Upload xong nhưng không lấy được AVL_ — " + (_loi_cuoi or "?")
        )

    def generate_video(
        self,
        *,
        prompt: str,
        aspect: str = "16:9",
        resolution: str = "720p",
        blob_ids: list[str] | None = None,
        ref_paths: list[str] | None = None,
        model: str | None = None,
        duration_sec: int | None = None,
        doc_id: str | None = None,
        out_dir: str = "",
    ) -> str:
        self.require_auth()
        _log(self.log, "BAN MOI Vids: se lay doc_id cua dung tai khoan truoc khi POST.")
        # 08/10 — email lấy từ tài khoản ĐANG CHẠY (vids_studio gán
        # `account_email`). Bản cũ rơi về mặc định «buithiich1234» nên mọi tài
        # khoản đều gửi doc_id 1zNFlc77… của TK đó (log 16:37, TK then6124).
        email = (getattr(self, "account_email", "")
                 or os.environ.get("PB_VIDS_EMAIL") or "").strip().lower()
        row = load_vids_theo_tk(email) if email else {}
        stale = str(row.get("doc_id") or "").startswith("1mOXZX")
        if email and (not row.get("doc_id") or stale):
            # Lần đầu của tài khoản: đọc doc_id từ trang Vids bằng chính
            # cookie này (một GET, không tạo video, không tốn hạn mức).
            try:
                row = self.bat_phien_tai_khoan(email) or row
            except Exception as e:
                _log(self.log, "⚠ Không đọc được doc_id Vids của %s: %s"
                     % (email, str(e)[:120]))
        if row.get("doc_id") and not str(row.get("doc_id")).startswith("1mOXZX"):
            doc_id = str(row.get("doc_id"))
            _log(self.log, "📌 Dùng doc_id của đúng tài khoản %s: %s…" % (email, doc_id[:12]))
        else:
            # Chưa có doc riêng vẫn chạy được: SuperVeo dùng MỘT doc cố định
            # cho mọi người dùng, và kimnga71 chạy ngay bằng doc mượn.
            _log(self.log, "📌 %s chưa có doc_id riêng — dùng doc của bản mẫu "
                 "(đo 08/10: doc của TK khác vẫn tạo video bình thường)."
                 % (email or "TK đang chạy"))
        if row.get("goog_session_hint"):
            self._account_goog_session = str(row.get("goog_session_hint"))


        refs_meta: list[dict[str, str]] = []
        # Cap ref paths / blob ids (CHAR_/BG_/PROP_ already ordered by caller).
        paths_in = clamp_ref_list(list(ref_paths or []), log=self.log, label="ref_paths")
        blobs = clamp_ref_list(list(blob_ids or []), log=self.log, label="blob_ids")
        if paths_in and not blobs:
            refs_meta = self.upload_refs(paths_in)
            blobs = [r["blob_id"] for r in refs_meta if r.get("blob_id")]
            blobs = clamp_ref_list(blobs, log=self.log, label="blob_ids_after_upload")
            refs_meta = refs_meta[: len(blobs)]
            # 02/10 — ĐỪNG DỰNG VIDEO KHÔNG CÓ REF.
            #
            # Bản cũ: upload hỏng hết → `blobs=0` → vẫn gửi generate và ra video
            # bình thường, chỉ còn một dòng ⚠ lọt giữa hàng chục dòng khác. Đo
            # thật 17:42 (TK buithiich1234 thiếu SID/HSID/APISID): 6 video ra lò
            # mà KHÔNG mang ảnh tham chiếu nào — nhân vật sai hết, mất credit và
            # mất thời gian, mà nhìn log thì tưởng thành công.
            #
            # Prompt đã gọi mã `@CHAR_02` thì video thiếu ref là phế phẩm. Dừng
            # cảnh đó và nói thẳng lý do còn hơn.
            # Vẫn ép chạy được: set CAPCUT_VIDS_CHAY_KHI_THIEU_REF=1
            _ep = (os.environ.get("CAPCUT_VIDS_CHAY_KHI_THIEU_REF")
                   or "").strip().lower() in ("1", "yes", "on", "true")
            if not blobs and not _ep:
                try:
                    _ten_ck = _cookie_names(self.cookies)
                except Exception:
                    _ten_ck = set()
                _thieu = [x for x in ("SID", "HSID", "APISID", "SAPISID",
                                      "__Secure-1PSID")
                          if x not in _ten_ck]
                raise RuntimeError(
                    "Upload %d ảnh tham chiếu hỏng HẾT — KHÔNG dựng video thiếu "
                    "ref (prompt có gọi mã ảnh). %s Xem dòng «[upload b2]» ở "
                    "trên để biết Google trả gì. (Ép chạy: "
                    "set CAPCUT_VIDS_CHAY_KHI_THIEU_REF=1)"
                    % (len(paths_in),
                       ("Cookie đang THIẾU %s — bấm «Lấy Cookie» cho tài khoản "
                        "này ở tab Tạo ảnh → Settings." % ", ".join(_thieu))
                       if _thieu else
                       "Cookie danh tính đủ, nên lỗi không nằm ở cookie.")
                )
            if len(blobs) < len(paths_in):
                _log(self.log,
                     "⚠ CHỈ upload được %d/%d ảnh ref — video này sẽ thiếu ảnh, "
                     "nhân vật có thể sai. Xem «[upload b2]» ở trên."
                     % (len(blobs), len(paths_in)))
        elif blobs:
            for i, b in enumerate(blobs):
                refs_meta.append(
                    {
                        "blob_id": b,
                        "name": f"Hình ảnh{i + 1}",
                        "uuid": str(uuid.uuid4()).upper(),
                        "path": "",
                    }
                )

        # Duration text in prompt (also protobuf field via inject).
        prompt = ensure_duration_in_prompt(prompt, duration_sec)

        fields = self.mapped_fields(
            prompt=prompt,
            aspect=aspect,
            resolution=resolution,
            blob_ids=blobs,
            model=model,
            duration_sec=duration_sec,
            doc_id=doc_id,
        )
        fields["refs_meta"] = refs_meta
        _log(
            self.log,
            "🎬 Google Vids · fields map: "
            f"aspect={fields['aspect']} {fields['aspect_pair']} · "
            f"res={fields['resolution']} · "
            f"duration={fields.get('duration_sec')}s · "
            f"model_hint={fields['model_hint']} · "
            f"blobs={len(fields['blob_ids'])}",
        )
        # MỘT dòng tổng kết cho cảnh này: đúng thứ tự ảnh ref đính kèm.
        # Thứ tự quan trọng — nó phải khớp thứ tự mã trong dòng mã của prompt,
        # và đây là chỗ duy nhất soi được điều đó. Bốn luồng song song thì mọi
        # dòng khác đều bị trộn, nên dòng này phải tự đủ nghĩa.
        try:
            _ten_ref = [os.path.basename(m.get("path") or "")
                        for m in (refs_meta or []) if isinstance(m, dict)]
            _ten_ref = [t for t in _ten_ref if t]
            if _ten_ref:
                _log(self.log, "   📎 Ref gửi kèm (%d, đúng thứ tự): %s"
                     % (len(_ten_ref), " · ".join(_ten_ref)))
            elif fields.get("blob_ids"):
                _log(self.log, "   📎 Ref gửi kèm: %d blob (không rõ tên file)"
                     % len(fields["blob_ids"]))
        except Exception:
            pass
        _log(
            self.log,
            f"📡 Host: {APPSGENAI_HOST}{GENERATE_PATH} · upload={TEMP_BLOB_UPLOAD}",
        )

        self.overlay = load_capture_overlay()
        ov = self.overlay
        if not overlay_ready_soft(ov):
            msg = (
                "Chưa có payload Google Vids «generate» đầy đủ.\n\n"
                f"  • Host: {APPSGENAI_HOST}\n"
                f"  • Path: {GENERATE_PATH}\n"
                f"  • Upload: {TEMP_BLOB_UPLOAD}\n"
                f"  • Header: {ENVELOPE_HEADER}\n\n"
                "UI đã sẵn: thư mục lưu · 720/1080 · 16:9/9:16 · 1–10s · dự án.\n"
                + f12_capture_checklist_vn()
            )
            self.last_error = "payload_not_ready"
            raise VidsPayloadNotReady(msg)

        if not resolve_api_key(ov):
            msg = (
                "Capture generate đã có nhưng API key còn REDACTED.\n\n"
                "Cách an toàn:\n"
                "  1) set env PB_VIDS_API_KEY=<key từ F12 key=>\n"
                "  2) hoặc ghi 1 dòng key vào\n"
                f"     {os.path.join(os.path.dirname(projects_capture_path()), 'vids_api_key.txt')}\n"
                "  3) hoặc thay REDACTED_KEY trong vids_generate_capture.json local\n"
                "     (KHÔNG commit / không dán chat).\n\n"
                "Key browser Vids là kiểu AIzaSy… (F12 Query String) — "
                "khác key Flow aisandbox.\n"
            )
            self.last_error = "api_key_redacted"
            raise VidsPayloadNotReady(msg)

        return self._generate_with_overlay(ov, fields, out_dir=out_dir)

    def _build_headers(self, ov: dict) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json+protobuf",
            "Origin": DOCS_ORIGIN,
            "Referer": DOCS_ORIGIN + "/",
            "X-Goog-Authuser": "0",
            "Accept": "*/*",
        }
        for k, v in dict(ov.get("headers") or {}).items():
            if not k or v is None:
                continue
            kl = str(k).lower()
            if kl in ("cookie", "authorization"):
                continue
            headers[str(k)] = str(v)
        if "X-Server-Token" not in headers and "x-server-token" not in {
            x.lower() for x in headers
        }:
            headers["X-Server-Token"] = DEFAULT_X_SERVER_TOKEN
        # Đầu mục riêng của tài khoản (nếu có bản bắt F12 của chính nó) —
        # đặt SAU cùng để thắng giá trị mặc định lấy từ bản bắt dùng chung.
        for k, v in (getattr(self, "extra_headers", None) or {}).items():
            if k and v:
                headers[str(k)] = str(v)
        if self.cookies:
            headers["Cookie"] = self.cookies
        auth = sapisidhash(self.cookies, DOCS_ORIGIN)
        if auth:
            headers["Authorization"] = auth
        return headers

    _DOC_QUOTA_SAN = True   # đánh dấu có bộ đọc; xem `_doc_quota` cuối file

    #: Mã lệnh của `quotaSummary`. Bắt F12 ngày 03/10/2026 trên docs.google.com
    #: /videos: endpoint này KHÔNG nhận body rỗng — nó nhận **cùng hình dạng
    #: body với generate**, chỉ khác phần tử [0]:
    #:     376 = tạo mới · 378 = kéo dài · 367 = hỏi hạn mức
    #: Web UI gửi nguyên cả prompt sang để hỏi "lệnh này có lọt hạn mức không",
    #: nên muốn hỏi thì phải có sẵn một body generate.
    OP_QUOTA = 367
    #: Mốc lần hỏi hạn mức gần nhất — hỏi một lần mỗi mẻ là đủ.
    _lan_hoi_quota = 0.0
    #: Chi thu nhanh 'bo doc_id muon' MOT lan moi phien — xem
    #: `_thu_bo_doc_muon`. Thu moi canh la nhan doi luu luong vo ich.
    _da_thu_bo_doc = False
    #: Bat khi phep thu tren THANH CONG — tu do moi canh deu gui
    #: body da go doc_id/goog_session, khong can thu lai.
    _bo_doc_luon = False

    def kiem_quota(self, body=None) -> str:
        """Hỏi hạn mức Vids CÒN LẠI của tài khoản đang dùng. '' nếu không đọc được.

        Vì sao cần: hạn mức Vids nằm ở `espresso-pa`, **không** đi theo hạng
        Flow (ULTRA/PRO/FREE) mà tab Settings hiển thị — hạng đó là của
        labs.google. Tài khoản ULTRA vẫn có thể hết hạn mức Vids, và tài khoản
        hạng FREE vẫn còn. Không hỏi trước thì chỉ biết lúc ăn HTTP 429, sau
        khi đã upload xong cả đống ảnh ref (đo 03/10 11:52: hỏng sau 9 giây
        upload, mất trắng 4 lượt upload).

        Endpoint `/v1/genai/quotaSummary` đã được khai báo trong bản bắt F12 từ
        đầu nhưng chưa chỗ nào gọi. KHÔNG bao giờ được làm hỏng mẻ: mọi lỗi
        đều nuốt, trả chuỗi rỗng.
        """
        import copy
        import json as _json
        import time as _time
        import requests
        try:
            if not isinstance(body, list) or not body:
                return ""        # không có body generate thì không hỏi được
            ov = self.overlay or load_capture_overlay() or {}
            key = resolve_api_key(ov) or ""
            if not key or _is_redacted_key(key):
                return ""
            # Hỏi một lần mỗi mẻ. Mỗi lần hỏi là một request mang cả prompt —
            # gửi cho từng cảnh là nhân đôi lưu lượng vô ích.
            _gio = _time.time()
            if _gio - (type(self)._lan_hoi_quota or 0) < 60:
                return ""
            type(self)._lan_hoi_quota = _gio

            # 08/10 — chép body generate rồi đổi [0] là SAI: Google trả 400
            # «Unexpected list for single non-message field». SuperVeo gửi
            # đúng một mẩu cố định này (SUPERVEO_LENH_TAO_VIDEO.md, mục 4).
            than_body = [None, 1, [9]]
            url = "%s%s?key=%s" % (APPSGENAI_HOST, QUOTA_PATH, key)
            r = requests.post(
                url, headers=self._build_headers(ov),
                data=_json.dumps(than_body, ensure_ascii=False,
                                 separators=(",", ":")),
                timeout=30)
            than = (r.text or "").strip()
            if r.status_code >= 400 or not than:
                _log(self.log, "   [quota] không đọc được (HTTP %s) %s"
                     % (r.status_code, than[:120].replace(chr(10), " ")))
                return ""
            _doc = _doc_quota(than)
            _log(self.log, "   [quota] %s" % (_doc or than[:200]))
            # 08/10 — CHƯA biết số nào là «đã dùng». In NGUYÊN phản hồi và
            # ghi sổ theo tài khoản + giờ, để so trước/sau một video là thấy
            # ô nào nhảy. Sổ: _vids_quota_log.jsonl cạnh _vids_theo_tk.json.
            _log(self.log, "   [quota] thô: %s"
                 % than[:600].replace(chr(10), " "))
            try:
                _so = os.path.join(os.path.dirname(vids_theo_tk_path()),
                                   "_vids_quota_log.jsonl")
                with open(_so, "a", encoding="utf-8") as _f:
                    _f.write(_json.dumps({
                        "luc": _time.strftime("%Y-%m-%d %H:%M:%S"),
                        "email": (getattr(self, "account_email", "") or ""),
                        "than": than[:4000]}, ensure_ascii=False) + chr(10))
            except Exception:
                pass
            return _doc or than[:200]
        except Exception as e:
            _log(self.log, "   [quota] lỗi: %s" % str(e)[:80])
            return ""

    def _go_doc_muon(self, body, ov):
        """Go `doc_id` va `goog_session` muon cua tai khoan khac khoi body."""
        _duong = str((ov or {}).get("doc_id_path") or "").strip()
        if _duong:
            # Phai ghi None cho bang duoc: bo qua = khuon giu nguyen id cu
            # (dung cai bay da dinh voi refs sang nay).
            try:
                _set_path(body, _duong, None)
            except Exception:
                pass
        hint = str((ov or {}).get("goog_session_hint") or "").strip()

        def _xoa(node):
            if isinstance(node, list):
                return [_xoa(x) for x in node]
            if isinstance(node, dict):
                return {k: _xoa(v) for k, v in node.items()}
            if isinstance(node, str) and hint and node == hint:
                return None
            return node

        return _xoa(body)

    def _thu_bo_doc_muon(self, ov, fields, url, headers):
        """Khong go doc_id/session cua dung tai khoan dang chay."""
        if str(getattr(self, "_account_goog_session", "") or "") == "goog_1757978034":
            _log(self.log, "   Giữ doc_id + goog_1757978034 của đúng tài khoản, không gỡ.")
            return None
        if str((fields or {}).get("doc_id") or "").startswith("1zNFlc77"):
            _log(self.log, "   Giữ doc_id 1zNFlc77 của đúng tài khoản, không gỡ.")
            return None
        """Gui lai MOT lan, bo doc_id + goog_session muon cua tai khoan khac.

        03/10 — body dang vac `doc_id` (tai lieu .flix) va `goog_session_hint`
        bat tu MOT tai khoan hom 01/10. Tai khoan khac dung chung bo do thi
        espresso tra REQUEST_REFUSED.

        Chua ai biet hai o do CO BAT BUOC hay khong. Thu bo han xem sao:
          · Chay duoc  -> moi tai khoan deu chay, khoi bat F12 tung cai.
          · MALFORMED  -> hai o do bat buoc, dung la phai bat F12 rieng.
        Mot request de biet cau tra loi, re hon doan.
        """
        import json as _json
        import requests
        if type(self)._da_thu_bo_doc:
            return None
        type(self)._da_thu_bo_doc = True
        try:
            body = self._go_doc_muon(build_generate_body(ov, fields), ov)
            _log(self.log,
                 "🔎 Thu lai MOT lan: bo doc_id + goog_session muon cua tai "
                 "khoan khac, xem Google co chiu khong…")
            r = requests.post(
                url, headers=headers,
                data=_json.dumps(body, ensure_ascii=False,
                                 separators=(",", ":")),
                timeout=180)
            if r.status_code < 400:
                type(self)._bo_doc_luon = True
                _log(self.log,
                     "✅ CHAY DUOC khi BO doc_id/goog_session — hai o do "
                     "KHONG bat buoc. Khoi phai bat F12 cho tung tai "
                     "khoan. Cac canh sau se gui thang kieu nay.")
                return r
            _t = (r.text or "")[:200].replace(chr(10), " ")
            _log(self.log,
                 "   Bo doc_id cung khong duoc (HTTP %s): %s"
                 % (r.status_code, _t))
            return None
        except Exception as e:
            _log(self.log, "   thu bo doc_id loi: %s" % str(e)[:90])
            return None

    def _generate_with_overlay(
        self, ov: dict, fields: dict[str, Any], *, out_dir: str
    ) -> str:
        try:
            import requests
        except ImportError as e:
            raise RuntimeError(f"Thiếu requests: {e}") from e

        api_key = resolve_api_key(ov)
        url = build_generate_url(ov, api_key)
        headers = self._build_headers(ov)
        # `_body_ghi_de` do lệnh KÉO DÀI đặt vào: cùng endpoint, cùng
        # đường poll/tải, chỉ khác body. Đặt lại None ngay sau khi lấy
        # để lần gọi sau không vô tình dùng nhầm body cũ.
        body = getattr(self, "_body_ghi_de", None)
        if body is None:
            if getattr(self, "_account_goog_session", ""):
                fields = dict(fields)
                fields["goog_session"] = self._account_goog_session
            body = build_generate_body(ov, fields)
        else:
            self._body_ghi_de = None
            _log(self.log, "⏩ Dùng body KÉO DÀI (op %s)"
                 % (body[0] if isinstance(body, list) and body else "?"))

        # Soi cookie TRƯỚC khi gửi: generate mất 1–2 phút mới trả lời,
        # để nó chạy rồi mới báo cookie hỏng là phí thời gian của người
        # dùng (và phí cả lượt gọi).
        try:
            _ten_ck = _cookie_names(self.cookies)
            _thieu_ck = [x for x in ("SID", "HSID", "APISID", "SAPISID",
                                     "__Secure-1PSID")
                         if x not in _ten_ck]
            if _thieu_ck:
                _log(self.log,
                     "⚠ Cookie thiếu %s — nếu HTTP 401 thì bấm «Lấy "
                     "Cookie» lại ở tab Tạo ảnh → Settings."
                     % ", ".join(_thieu_ck))
        except Exception:
            pass
        # Hỏi hạn mức TRƯỚC cú generate đầu tiên của mẻ. Phải đặt ở đây vì
        # `quotaSummary` cần đúng body này (chỉ khác [0]=367) — gọi từ chỗ
        # khác thì không có body mà gửi.
        # Phep thu truoc da chung minh bo doc_id/goog_session van chay —
        # tu day moi canh gui thang kieu do, khoi dinh REQUEST_REFUSED roi
        # moi thu lai.
        if type(self)._bo_doc_luon:
            try:
                if str(getattr(self, "_account_goog_session", "") or "") == "goog_1757978034":
                    _log(self.log, "   Không gỡ session đúng tài khoản.")
                else:
                    body = self._go_doc_muon(body, ov)
                    _log(self.log, "   (da go doc_id/goog_session muon)")
            except Exception:
                pass
        try:
            self.kiem_quota(body)
        except Exception:
            pass
        _log(self.log, "➡️ POST /v1/genai/generate …")
        _log(self.log, f"   body_type={type(body).__name__}")
        try:
            r = requests.post(
                url,
                headers=headers,
                data=json.dumps(body, ensure_ascii=False, separators=(",", ":")),
                timeout=180,
            )
        except Exception as e:
            self.last_error = str(e)
            raise RuntimeError(f"Google Vids generate network: {e}") from e

        if r.status_code >= 400:
            self.last_error = f"HTTP {r.status_code}"
            _than = (r.text or "")
            # 401/SESSION_COOKIE_INVALID = cookie Google hết hạn hoặc
            # phiên đã bị đăng xuất. Quăng nguyên cục JSON của Google ra
            # thì người dùng không biết phải làm gì — nói thẳng việc cần
            # làm, và chỉ ra cookie nào đang thiếu.
            if r.status_code in (401, 403) or "SESSION_COOKIE_INVALID" in _than:
                _ten = _cookie_names(self.cookies)
                _can = ("SID", "HSID", "SSID", "APISID", "SAPISID",
                        "__Secure-1PSID", "__Secure-3PSID")
                _thieu = [x for x in _can if x not in _ten]
                raise VidsAuthError(
                    "Cookie Google không còn hợp lệ (HTTP %d — "
                    "SESSION_COOKIE_INVALID).%s%s"
                    "Phiên đăng nhập đã hết hạn hoặc tài khoản đã đăng "
                    "xuất ở nơi khác.%s%s"
                    "CÁCH CHỮA: tab «Tạo ảnh» → Settings → «🍪 Lấy "
                    "Cookie» cho tài khoản đang dùng, rồi chạy lại.%s%s"
                    "%s"
                    % (r.status_code, chr(10), chr(10), chr(10), chr(10),
                       chr(10), chr(10),
                       ("Chuỗi cookie hiện tại THIẾU: " + ", ".join(_thieu)
                        if _thieu else
                        "Chuỗi cookie có đủ tên nhưng giá trị đã hết hạn.")))
            # 429 / USER_GENAI_QUOTA_EXHAUSTED = HẾT HẠN MỨC VIDS của tài
            # khoản này. Khác hẳn credit Flow: TK còn 50 credit Flow vẫn có
            # thể hết hạn mức Vids (đo 03/10 11:52, buithiich1234). Google
            # kèm mốc reset dạng Unix trong thân lỗi — bóc ra cho người dùng
            # biết ngày nào có lại, thay vì quăng nguyên cục JSON.
            if r.status_code == 429 or "QUOTA_EXHAUSTED" in _than.upper():
                _khi = ""
                try:
                    import re as _re_q
                    import datetime as _dt_q
                    _mocs = [int(x) for x in
                             _re_q.findall(r'"(1[7-9]\d{8})"', _than)]
                    if _mocs:
                        _t = _dt_q.datetime.utcfromtimestamp(
                            min(_mocs)) + _dt_q.timedelta(hours=7)
                        _khi = _t.strftime("%d/%m/%Y %H:%M")
                except Exception:
                    _khi = ""
                raise RuntimeError(
                    "HẾT HẠN MỨC Google Vids của tài khoản này "
                    "(HTTP 429 — USER_GENAI_QUOTA_EXHAUSTED).%s%s"
                    "KHÔNG phải lỗi cookie, KHÔNG phải credit Flow, và KHÔNG "
                    "liên quan hạng ULTRA/PRO/FREE: Vids chạy trên "
                    "espresso-pa, hạn mức riêng cho từng tài khoản, hạng Flow "
                    "ở tab Settings là của labs.google nên không nói lên gì ở "
                    "đây.%s%s"
                    "%s"
                    "CÁCH CHỮA: tick tài khoản KHÁC ở Settings rồi chạy lại — "
                    "mỗi tài khoản có hạn mức Vids riêng."
                    % (chr(10), chr(10), chr(10), chr(10),
                       ("Hạn mức sẽ có lại vào %s (giờ VN).%s%s"
                        % (_khi, chr(10), chr(10))) if _khi else ""))
            # 03/10 — REQUEST_REFUSED: body DUNG hinh dang (neu sai hinh
            # dang thi espresso tra MALFORMED_REQUEST) nhung bi tu choi o
            # tang quyen. Body dang phat lai doc_id + goog_session_hint bat
            # tu MOT tai khoan hom 01/10 — tai khoan khac dung chung bo do
            # thi Google co quyen tu choi.
            _da_cuu = False
            if "REQUEST_REFUSED" in _than.upper():
                _r2 = self._thu_bo_doc_muon(ov, fields, url, headers)
                if _r2 is not None and _r2.status_code < 400:
                    r, _da_cuu = _r2, True
                    _than = ""
            _khong_anh = not (fields.get("refs_meta") or fields.get("blob_ids"))
            if not _da_cuu and "REQUEST_REFUSED" in _than.upper():
                if _khong_anh:
                    _ly_do = (
                        "Cảnh này KHÔNG có ảnh tham chiếu, đã gửi mã lệnh 374 "
                        "(chữ → video). Nếu vẫn bị từ chối thì có thể là nội "
                        "dung prompt — thử gắn 1 ảnh tham chiếu, hoặc dán "
                        "prompt lên vids.google.com bằng chính tài khoản này.")
                else:
                    _ly_do = (
                        "Cảnh CÓ ảnh mà vẫn bị từ chối — thường là bộ lọc "
                        "NỘI DUNG (người thật, trẻ em, biểu tượng…) hoặc ảnh "
                        "tham chiếu bị chê. Sửa prompt/đổi ảnh rồi chạy lại.")
                raise RuntimeError(
                    "Google Vids TỪ CHỐI cảnh này (HTTP %s — REQUEST_REFUSED)."
                    "%s%s" % (r.status_code, chr(10), _ly_do))
            if not _da_cuu:
                raise RuntimeError(
                    f"Google Vids generate HTTP {r.status_code}: "
                    f"{_than[:400]}"
                )

        parsed = parse_generate_response(r)
        job_id = parsed.get("job_id") or ""
        download_token = parsed.get("c_token") or job_id
        dl_from_resp = parsed.get("download_url") or ""
        pending = bool(parsed.get("pending"))
        dims = ""
        if parsed.get("width") and parsed.get("height"):
            dims = f" · {parsed['width']}x{parsed['height']}"
        if parsed.get("duration_sec") is not None:
            dims += f" · {parsed['duration_sec']}s"
        _log(
            self.log,
            f"✅ Generate HTTP {r.status_code} · "
            f"job/token={'(có)' if download_token else '(chưa parse)'} · "
            f"url_in_resp={'(có)' if dl_from_resp else '(không)'} · "
            f"pending={pending}{dims}",
        )

        poll_tmpl = str(ov.get("poll_url_template") or "").strip()
        if poll_tmpl and job_id and not dl_from_resp:
            _log(self.log, "⏳ Poll (poll_url_template)…")
            self._poll_overlay(requests, poll_tmpl, job_id, headers, api_key)
            # Re-fetch token/url after poll if template returned body with URL
            # (poll helper itself does not return body — keep token).
        elif not poll_tmpl:
            if dl_from_resp:
                _log(
                    self.log,
                    "⏭ poll_url_template trống nhưng response đã có download URL "
                    "→ bỏ poll, tải trực tiếp.",
                )
            elif pending or job_id:
                _log(
                    self.log,
                    "⏳ poll_url_template trống · chỉ thấy job/pending — "
                    "short retry cùng generate URL (không invent endpoint).",
                )
                r = self._short_retry_generate(
                    requests, url, headers, body, r, attempts=4, delay_s=5
                )
                parsed = parse_generate_response(r)
                job_id = parsed.get("job_id") or job_id
                download_token = parsed.get("c_token") or download_token or job_id
                dl_from_resp = parsed.get("download_url") or dl_from_resp
                if not dl_from_resp:
                    _log(
                        self.log,
                        "⚠ Poll unavailable (không có poll_url_template) và "
                        "response vẫn chưa có URL download cuối.",
                    )
            else:
                _log(
                    self.log,
                    "⚠ poll_url_template trống · không có URL download / job id "
                    "trong response — không invent fake poll endpoint.",
                )

        dl_url, dl_src = resolve_download_url(
            r, ov, download_token, api_key, prefer_url=dl_from_resp
        )
        # Giu lai de con KEO DAI video nay sau nay: ma 48 hex cua video
        # chi nam trong token `c=` cua URL tai, phan hoi generate khong co.
        self.last_download_url = dl_url or ""
        self.last_source_id = ma_nguon_tu_url(dl_url) or ""
        if self.last_source_id:
            _log(self.log, "🔗 Mã video (để kéo dài): %s…%s"
                 % (self.last_source_id[:12], self.last_source_id[-6:]))
        if dl_src == "contribution-rt":
            _log(self.log, "⬇️ Download source: contribution-rt.usercontent.google.com")
        elif dl_src == "response":
            _log(self.log, "⬇️ Download source: URL trong generate response")
        elif dl_src == "template":
            _log(self.log, "⬇️ Download source: download_url_template (+ job/c)")
        elif dl_src == "fallback_host":
            _log(self.log, "⬇️ Download source: appsgenai /v1/genai/download?c=…")
        else:
            _log(self.log, "⬇️ Download source: (unknown/empty)")

        if not dl_url:
            dbg = os.path.join(out_dir or ".", f"gvids_resp_{int(time.time())}.json")
            try:
                os.makedirs(out_dir or ".", exist_ok=True)
                with open(dbg, "w", encoding="utf-8") as f:
                    f.write((r.text or "")[:200000])
                _log(self.log, f"ℹ Đã lưu response thô: {dbg}")
            except Exception:
                pass
            raise RuntimeError(
                "Generate OK nhưng chưa parse được URL download. "
                "Thêm download_url_template hoặc bắt F12 download?c=… / "
                "contribution-rt (đã lưu response nếu có thư mục xuất)."
            )

        os.makedirs(out_dir or ".", exist_ok=True)
        stamp = time.strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(out_dir or ".", f"gvids_{stamp}.mp4")
        _log(self.log, f"⬇️ Download → {os.path.basename(out_path)}")
        # 01/10 — in TEN tham so cua URL tai (khong in gia tri) de biet
        # thieu cai gi. Ban that bat tu F12 co dang:
        #   contribution-rt.../download?c=<TOKEN>&filename=video.mp4&opi=...
        try:
            from urllib.parse import urlsplit, parse_qs
            _u = urlsplit(dl_url)
            _ps = parse_qs(_u.query or '')
            _log(self.log,
                 '   URL tai: host=%s path=%s tham_so=%s' % (
                     _u.netloc, _u.path, ','.join(sorted(_ps.keys())) or '(trong)'))
            for _ten_p in ('c', 'filename', 'opi'):
                _v = (_ps.get(_ten_p) or [''])[0]
                _log(self.log, '     %-9s %s' % (
                    _ten_p,
                    ('co (%d ky tu)' % len(_v)) if _v else 'THIEU'))
        except Exception as _e:
            _log(self.log, '   khong tach duoc URL: ' + str(_e)[:80])

        # Cookie danh tinh .google.com — thieu la request vo danh -> 403.
        try:
            _ck_raw = ''
            for _k, _v in (headers or {}).items():
                if str(_k).lower() == 'cookie':
                    _ck_raw = str(_v or '')
                    break
            _ten_ck = set()
            for _ph in _ck_raw.split(';'):
                _i = _ph.find('=')
                if _i > 0:
                    _ten_ck.add(_ph[:_i].strip())
            _can = ('SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
                    '__Secure-1PSID', '__Secure-3PSID')
            _co = [x for x in _can if x in _ten_ck]
            _thieu = [x for x in _can if x not in _ten_ck]
            _log(self.log, '   Cookie: %d cookie, danh tinh co %d/%d%s'
                 % (len(_ten_ck), len(_co), len(_can),
                    (' — THIEU: ' + ', '.join(_thieu)) if _thieu else ''))
        except Exception:
            pass
        # 01/10 — HOST NOI DUNG CAN HEADER GON (xem ghi chu dau ban va).
        #
        # Dung lai bo header cua API (Content-Type json+protobuf, Origin
        # docs.google.com, Authorization SAPISIDHASH ky cho origin KHAC)
        # lam contribution-rt tra 403. No chi can Cookie.
        _gon = {}
        for _k, _v in (headers or {}).items():
            if str(_k).lower() in ("cookie", "user-agent"):
                _gon[_k] = _v
        _gon.setdefault("Accept", "*/*")
        _gon.setdefault(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")

        ctype = ""
        _loi_cuoi = 0
        _da_tai = False
        # Lot thu 3: gia TRINH DUYET DANG TAI FILE. Mot so endpoint noi
        # dung cua Google chan request khong co bo Sec-Fetch hop le.
        _nhu_trinh_duyet = dict(_gon)
        _nhu_trinh_duyet.update({
            'Accept': ('text/html,application/xhtml+xml,application/xml;'
                       'q=0.9,image/avif,image/webp,*/*;q=0.8'),
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://docs.google.com/',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
        })
        # KHONG them lot "khong cookie": do that 01/10 cho thay no tra
        # HTTP 200 + trang dang nhap (text/html), tuc token `c=` can phien
        # dang nhap, khong tu xac thuc.
        # Bien the URL. Token con tuoi va dung tai khoan van 403, nen phai
        # thu ca phia URL lan phia cookie trong MOT lan chay.
        def _doi_tham_so(u, bo=(), them=None):
            try:
                from urllib.parse import (urlsplit, urlunsplit,
                                          parse_qsl, urlencode)
                sp = urlsplit(u)
                q = [(k, v) for k, v in
                     parse_qsl(sp.query, keep_blank_values=True)
                     if k not in bo]
                if them:
                    co = {k for k, _ in q}
                    for k, v in them:
                        if k not in co:
                            q.append((k, v))
                return urlunsplit((sp.scheme, sp.netloc, sp.path,
                                   urlencode(q), sp.fragment))
            except Exception:
                return u

        # Cookie chi giu danh tinh `.google.com`. 37 cookie co ca cookie
        # cua labs.google / next-auth — khong lien quan host noi dung.
        _ck_danh_tinh = ""
        try:
            _giu_ten = ("SID", "HSID", "SSID", "APISID", "SAPISID",
                        "__Secure-1PSID", "__Secure-3PSID",
                        "__Secure-1PSIDTS", "__Secure-3PSIDTS",
                        "__Secure-1PSIDCC", "__Secure-3PSIDCC",
                        "NID", "SIDCC")
            _raw = ""
            for _k, _v in (headers or {}).items():
                if str(_k).lower() == "cookie":
                    _raw = str(_v or "")
                    break
            _phan = []
            for _ph in _raw.split(";"):
                _ph = _ph.strip()
                _i = _ph.find("=")
                if _i > 0 and _ph[:_i].strip() in _giu_ten:
                    _phan.append(_ph)
            _ck_danh_tinh = "; ".join(_phan)
        except Exception:
            pass
        _hd_chi_danh_tinh = dict(_nhu_trinh_duyet)
        if _ck_danh_tinh:
            _hd_chi_danh_tinh["Cookie"] = _ck_danh_tinh

        # CACH CHINH, da do that 01/10: chi gui cookie danh tinh.
        #
        # Gui ca 37 cookie cua phien (co ca cookie labs.google / next-auth)
        # thi contribution-rt tra 403 voi than RONG. Loc con 13 cookie
        # `.google.com` la tai duoc ngay. Nam cach con lai deu 403.
        _cach = [
            ("cookie chi danh tinh (%d cookie)"
             % len([x for x in _ck_danh_tinh.split(";") if x.strip()]),
             dl_url, _hd_chi_danh_tinh),
        ]
        # Du phong — chi chay neu cach chinh hong (Google doi y).
        _cach += [
            ("gon (chi Cookie)", dl_url, _gon),
            ("nhu trinh duyet (Sec-Fetch)", dl_url, _nhu_trinh_duyet),
            ("bo opi", _doi_tham_so(dl_url, bo=("opi",)),
             _nhu_trinh_duyet),
            ("them authuser=0",
             _doi_tham_so(dl_url, them=(("authuser", "0"),)),
             _nhu_trinh_duyet),
            ("day du (nhu API)", dl_url, headers),
        ]
        if not _ck_danh_tinh:
            # Khong loc duoc cookie danh tinh thi bo cach chinh di, khoi
            # goi mot luot chac chan hong.
            _cach = _cach[1:]
            _log(self.log, "   ! khong loc duoc cookie danh tinh — "
                 "cookie Google co the da hong, bam «Lay Cookie» lai")
        for _nhan, _u, _hd in _cach:
            try:
                with requests.get(_u, headers=_hd, stream=True,
                                  timeout=300) as resp:
                    if resp.status_code >= 400:
                        _loi_cuoi = resp.status_code
                        # In LY DO Google noi. Tu truoc chi thay con so 403
                        # tran, khong biet no tu choi vi dieu gi.
                        _than = ""
                        try:
                            _than = (resp.text or "")[:200].replace(
                                chr(10), " ").strip()
                        except Exception:
                            pass
                        _log(self.log,
                             "   cach %s -> HTTP %d%s" % (
                                 _nhan, resp.status_code,
                                 ("  | Google noi: " + _than)
                                 if _than else "  (than loi rong)"))
                        # Than rong thi HEADER phan hoi la cho duy nhat
                        # con thong tin. In ten tat ca + gia tri cua may
                        # header noi ly do. KHONG in gia tri Set-Cookie.
                        try:
                            _hh = dict(resp.headers or {})
                            _log(self.log, "      header tra ve: "
                                 + ", ".join(sorted(_hh.keys())))
                            for _ten in ("WWW-Authenticate", "Content-Type",
                                         "X-Guploader-UploadID",
                                         "X-Goog-Error", "Server",
                                         "Content-Security-Policy",
                                         "Cross-Origin-Resource-Policy"):
                                _gt = _hh.get(_ten)
                                if _gt:
                                    _log(self.log, "      %s: %s"
                                         % (_ten, str(_gt)[:160]))
                            if resp.history:
                                from urllib.parse import urlsplit as _us2
                                _log(self.log, "      chuyen huong qua: "
                                     + " -> ".join(
                                         (_us2(h.url).netloc or "?")
                                         for h in resp.history))
                        except Exception:
                            pass
                        continue
                    ctype = (resp.headers.get("Content-Type") or "").lower()
                    # CHOT: 2xx khong co nghia la video. Google tra trang
                    # dang nhap voi HTTP 200 — ghi thang se ra file .mp4
                    # chua 200 KB HTML.
                    _host_cuoi = ""
                    try:
                        from urllib.parse import urlsplit as _us
                        _host_cuoi = (_us(resp.url).netloc or "").lower()
                    except Exception:
                        pass
                    _la_phim = ("video" in ctype
                                or "octet-stream" in ctype
                                or "application/mp4" in ctype)
                    if (not _la_phim) or "accounts.google.com" in _host_cuoi:
                        _loi_cuoi = resp.status_code
                        _log(self.log,
                             "   cach %s -> HTTP %d nhung KHONG phai video"
                             " (ctype=%s%s) — cookie het phien?"
                             % (_nhan, resp.status_code, ctype or "?",
                                ", bi day sang trang dang nhap"
                                if "accounts.google.com" in _host_cuoi
                                else ""))
                        continue
                    with open(out_path, "wb") as f:
                        for chunk in resp.iter_content(256 * 1024):
                            if chunk:
                                f.write(chunk)
                    _log(self.log, "   tai duoc bang cach: %s" % _nhan)
                    _da_tai = True
                    break
            except Exception as _e:
                _log(self.log, "   cach %s loi: %s" % (_nhan, str(_e)[:90]))
        if not _da_tai:
            raise RuntimeError(
                "Download HTTP %s — ca %d cach gui deu bi tu choi. "
                "Xem cac dong «header tra ve:» o tren — than loi cua "
                "Google rong nen ly do chi nam o do." %
                (_loi_cuoi or "?", len(_cach)))
        if not os.path.isfile(out_path) or os.path.getsize(out_path) < 1000:
            raise RuntimeError(f"File tải về quá nhỏ / lỗi (ctype={ctype or '?'}).")
        return out_path

    def _poll_overlay(
        self, requests, tmpl: str, job_id: str, headers: dict, api_key: str
    ) -> None:
        url = (
            tmpl.replace("{job_id}", job_id)
            .replace("{id}", job_id)
            .replace("REDACTED_KEY", api_key or "REDACTED_KEY")
        )
        t0 = time.time()
        while time.time() - t0 < 300:
            r = requests.get(url, headers=headers, timeout=60)
            txt = (r.text or "").lower()
            if r.status_code < 400 and any(
                x in txt for x in ("success", "complete", "ready", "done")
            ):
                return
            if any(x in txt for x in ("fail", "error", "cancel")):
                raise RuntimeError(f"Poll failed: {(r.text or '')[:200]}")
            time.sleep(5)
        raise RuntimeError("Poll timeout 300s")

    def _short_retry_generate(
        self,
        requests,
        url: str,
        headers: dict,
        body: Any,
        last_resp,
        *,
        attempts: int = 4,
        delay_s: float = 5,
    ):
        """Retry POST same generate URL briefly when poll template missing.

        Does NOT invent fake poll endpoints. Stops early if a download URL appears.
        """
        r = last_resp
        for i in range(max(1, int(attempts))):
            parsed = parse_generate_response(r)
            if parsed.get("download_url"):
                return r
            if i + 1 >= attempts:
                break
            _log(self.log, f"⏳ Retry generate {i + 1}/{attempts - 1} sau {delay_s}s…")
            time.sleep(float(delay_s))
            try:
                r = requests.post(
                    url,
                    headers=headers,
                    data=json.dumps(body, ensure_ascii=False, separators=(",", ":")),
                    timeout=180,
                )
            except Exception as e:
                _log(self.log, f"⚠ Retry generate network: {e}")
                continue
            if r.status_code >= 400:
                _log(self.log, f"⚠ Retry generate HTTP {r.status_code}")
        return r


def build_generate_body(ov: dict, fields: dict[str, Any]) -> Any:
    body = ov.get("body_template")
    try:
        body = json.loads(json.dumps(body))
    except Exception:
        body = deepcopy(body)
    # Merge session hint from capture if caller did not pass one.
    if not (fields.get("goog_session") or "").strip():
        hint = str(fields.get("_account_goog_session") or ov.get("goog_session_hint") or "").strip()
        if hint and "XXXX" not in hint and "PLACEHOLDER" not in hint.upper():
            fields = dict(fields)
            fields["goog_session"] = hint
    body = _inject_paths(body, ov, fields)
    body = _smart_inject(body, fields)
    # 08/10 — MÃ LỆNH THEO SỐ ẢNH: 374 = không ảnh · 375 = 1 ảnh · 376 = ≥2.
    # Khuôn F12 01/10 là lần tạo có 3 ảnh nên mang sẵn 376; giữ nguyên 376
    # cho cảnh không ảnh thì Google trả REQUEST_REFUSED (đo «bao2»: cùng
    # prompt, không ảnh bị từ chối, thêm ảnh là chạy). Bảng mã lấy từ code
    # SuperVeo — SUPERVEO_LENH_TAO_VIDEO.md. Chỉ đổi khi [0] là mã tạo mới:
    # kéo dài (378) và quota (367) không đụng tới.
    if isinstance(body, list) and body and body[0] in (374, 375, 376):
        _so = len(fields.get("refs_meta") or fields.get("blob_ids") or [])
        body[0] = 374 if _so == 0 else (375 if _so == 1 else 376)
        # 08/10 — đối chiếu payload F12 thật của web (Omni · Landscape · 10s):
        #   [4][15] = [0,12,null,0, 5, null,null,null, 10]  → ô [4] là TỶ LỆ:
        #             5 = ngang, 6 = dọc (khớp SuperVeo). Khuôn 01/10 mang 1.
        #   [5]     = [1,null,[[null,"1",1189]]] — web gửi 1189. Bản cũ đổi
        #             thành 1920 khi chọn 1080p là đoán mò: Google vẫn trả
        #             1280x720. Giữ đúng như web.
        try:
            _cau_hinh = body[4][15]
            if isinstance(_cau_hinh, list) and len(_cau_hinh) >= 9:
                _cau_hinh[4] = 6 if fields.get("aspect_orientation") == "portrait" else 5
        except Exception:
            pass
        if len(body) > 5:
            body[5] = [1, None, [[None, "1", 1189]]]
    return body


def _lay_khuon_ref(body: Any, duong: str):
    """Lay MOT ref mau dang nam trong body de nhan ban.

    Khuon that luon dung hinh dang voi ban Google dang chay — chac hon tu
    tay dung lai cay null (xem ghi chu _va_vids_ref_shape.py).
    """
    try:
        node = body
        for k in str(duong or '').split('.'):
            if k == '':
                continue
            node = node[int(k)]
        if isinstance(node, list) and node:
            return node[0]
    except Exception:
        pass
    return None


def _inject_paths(body: Any, ov: dict, fields: dict[str, Any]) -> Any:
    if body is None:
        return body
    # 01/10 — dung KHUON ref that trong body; het thi moi quay ve ban phang.
    _khuon = _lay_khuon_ref(body, str(ov.get('refs_path') or ''))
    _refs = _refs_payload_tu_khuon(fields, _khuon)
    if _refs is None:
        _refs = _refs_payload(fields)
    mapping = {
        "prompt_path": fields.get("prompt"),
        "aspect_path": fields.get("aspect_pair"),
        "model_path": fields.get("model_hint"),
        "resolution_path": fields.get("resolution"),
        "duration_path": fields.get("duration_sec"),
        "doc_id_path": fields.get("doc_id") or None,
        "refs_path": _refs,
    }
    # 03/10 — ME KHONG CO REF phai XOA o ref cua khuon.
    #
    # Khuon `body_template` bat tu F12 ngay 01/10 co san 3 anh tham chieu
    # (AVL_0qj…). Vong lap duoi day bo qua moi gia tri None, nen me khong
    # ref thi o do KHONG bi ghi de — body gui di van vac 3 blob cu da chet
    # tu hom kia. Espresso tra ve:
    #     HTTP 400 [3,"Request contains an invalid argument.",
    #               [... "MALFORMED_REQUEST","espresso-pa.googleapis.com"]]
    # Me co ref thi khong dinh, vi o do bi ghi de het.
    _khong_ref = not (fields.get("refs_meta") or fields.get("blob_ids"))
    for key, val in mapping.items():
        path = str(ov.get(key) or "").strip()
        if not path:
            continue
        if val is None:
            if key == "refs_path" and _khong_ref:
                try:
                    _set_path(body, path, None)
                except Exception:
                    pass
            continue
        try:
            _set_path(body, path, val)
        except Exception:
            pass
    return body


#: Vi tri cua uuid / blob / ten BEN TRONG mot ref — do tu ban capture F12
#: (xem ghi chu dau ban va 01/10). Giu o mot cho de sau nay Google doi
#: schema thi chi sua day.
VIDS_REF_DUONG_UUID = (0, 7, 0)
VIDS_REF_DUONG_BLOB = (0, 7, 1, 11, 8, 3)
VIDS_REF_DUONG_TEN = (0, 7, 1, 11, 13)


def _dat_sau(node, duong, gia_tri) -> bool:
    """Dat `gia_tri` vao vi tri `duong` (tuple chi so) trong cay list."""
    try:
        for i in duong[:-1]:
            node = node[i]
        node[duong[-1]] = gia_tri
        return True
    except Exception:
        return False


def _refs_payload_tu_khuon(fields: dict[str, Any], khuon) -> list | None:
    """Nhan ban KHUON ref that roi thay uuid/blob/ten.

    Tu tay dung cay null la sai mot nhanh -> HTTP 400 (da dinh 01/10).
    Nhan ban thi hinh dang luon dung voi ban Google dang chay.
    """
    import copy

    meta = fields.get("refs_meta") or []
    blobs = fields.get("blob_ids") or []
    if meta:
        ds = [(r.get("uuid") or str(uuid.uuid4()).upper(),
               r.get("blob_id"),
               r.get("name") or "") for r in meta]
    elif blobs:
        ds = [(str(uuid.uuid4()).upper(), b, "") for b in blobs]
    else:
        return None
    if khuon is None:
        return None
    ra = []
    for i, (u, b, ten) in enumerate(ds):
        r = copy.deepcopy(khuon)
        _dat_sau(r, VIDS_REF_DUONG_UUID, u)
        _dat_sau(r, VIDS_REF_DUONG_BLOB, b)
        _dat_sau(r, VIDS_REF_DUONG_TEN, ten or ("Hình ảnh%d" % (i + 1)))
        ra.append(r)
    return ra


def _refs_payload(fields: dict[str, Any]) -> list | None:

    meta = fields.get("refs_meta") or []
    if meta:
        rows = []
        for r in meta:
            rows.append(
                [
                    r.get("uuid") or str(uuid.uuid4()).upper(),
                    r.get("blob_id"),
                    r.get("name") or "Hình ảnh1",
                ]
            )
        return rows
    blobs = fields.get("blob_ids") or []
    if not blobs:
        return None
    return [
        [str(uuid.uuid4()).upper(), b, f"Hình ảnh{i + 1}"]
        for i, b in enumerate(blobs)
    ]


def _smart_inject(body: Any, fields: dict[str, Any]) -> Any:
    prompt = fields.get("prompt") or ""
    dur = fields.get("duration_sec")
    aspect = fields.get("aspect_pair")
    orient = (fields.get("aspect_orientation") or "").strip()
    doc_id = fields.get("doc_id") or ""
    refs = _refs_payload(fields)
    prefer1080 = bool(fields.get("prefer_upscale_1080"))
    state = {"prompt_done": False, "doc_done": False, "orient_done": False}

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            if (
                len(node) >= 9
                and node[0] == 0
                and node[1] == 12
                and node[3] == 0
                and node[4] == 1
                and dur is not None
            ):
                node = list(node)
                node[8] = int(dur)
                return [walk(x) for x in node]
            if len(node) == 2 and node in ([16, 9], [9, 16]) and aspect:
                return list(aspect)
            if (
                len(node) >= 3
                and node[0] == 1
                and isinstance(node[2], list)
                and prefer1080
            ):
                try:
                    inner = node[2][0]
                    if isinstance(inner, list) and len(inner) >= 3 and inner[1] == "1":
                        node = list(node)
                        node2 = list(node[2])
                        row = list(inner)
                        if isinstance(row[2], int) and row[2] < 2000:
                            row[2] = 1920
                        node2[0] = row
                        node[2] = node2
                except Exception:
                    pass
                return [walk(x) for x in node]
            return [walk(x) for x in node]
        if isinstance(node, str):
            if prompt and (
                node == "PROMPT_PLACEHOLDER"
                or "CHAR_" in node
                or "BG_" in node
                or "PROP_" in node
                or (len(node) > 80 and " " in node)
            ):
                if not state["prompt_done"]:
                    state["prompt_done"] = True
                    return prompt
            # Optional landscape/portrait string inject (does not touch [16,9] pairs).
            if orient and not state["orient_done"] and node in (
                "landscape", "portrait", "LANDSCAPE", "PORTRAIT",
                "ASPECT_ORIENT_PLACEHOLDER",
            ):
                state["orient_done"] = True
                return orient
            if doc_id and node == "DOC_ID_PLACEHOLDER" and not state["doc_done"]:
                state["doc_done"] = True
                return doc_id
            if node == "AVL_BLOB_PLACEHOLDER" and refs:
                return refs[0][1]
            if node == "REF_UUID_PLACEHOLDER" and refs:
                return refs[0][0]
            # GOOG_SESSION_INJECT_V1
            gs = (fields.get("goog_session") or "").strip()
            if gs and (
                node == "goog_SESSION_PLACEHOLDER"
                or (node.startswith("goog_") and "PLACEHOLDER" in node.upper())
            ):
                return gs
            return node
        return node

    body = walk(body)
    if refs:
        body = _replace_refs_list(body, refs)
    return body


def _replace_refs_list(body: Any, refs: list) -> Any:
    def is_ref_row(row: Any) -> bool:
        if not isinstance(row, list) or len(row) < 2:
            return False
        return any(isinstance(x, str) and (
            x.startswith("AVL_") or x == "AVL_BLOB_PLACEHOLDER"
        ) for x in row)

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            if node and any(is_ref_row(x) for x in node):
                if all(is_ref_row(x) or x is None for x in node):
                    return refs
            return [walk(x) for x in node]
        return node

    return walk(body)


def _set_path(obj: Any, path: str, value: Any) -> None:
    parts = [p for p in path.replace("/", ".").split(".") if p]
    cur = obj
    for i, p in enumerate(parts):
        last = i == len(parts) - 1
        idx: int | None = None
        if p.isdigit():
            idx = int(p)
        if last:
            if idx is not None:
                cur[idx] = value
            else:
                cur[p] = value
            return
        if idx is not None:
            cur = cur[idx]
        else:
            cur = cur[p]


def _find_first_avl(data: Any) -> str:
    if isinstance(data, str):
        m = BLOB_ID_RE.search(data)
        return m.group(0) if m else ""
    if isinstance(data, dict):
        for v in data.values():
            got = _find_first_avl(v)
            if got:
                return got
    if isinstance(data, list):
        for v in data:
            got = _find_first_avl(v)
            if got:
                return got
    return ""


def _resp_text(resp) -> str:
    try:
        return resp.text or ""
    except Exception:
        return ""


def _resp_json(resp) -> Any:
    try:
        return resp.json()
    except Exception:
        return None


def _unescape_url(u: str) -> str:
    s = (u or "")
    s = s.replace("\\u003d", "=").replace("\u003d", "=")
    s = s.replace("\\u0026", "&").replace("\u0026", "&")
    s = s.replace("&amp;", "&")
    s = s.replace("\\/", "/")
    junk = set(")'\",.;]:")
    while s and s[-1] in junk:
        s = s[:-1]
    return s.strip()


def _iter_strings(data: Any):
    """Yield all strings from nested list/dict/protobuf-json."""
    if isinstance(data, str):
        yield data
        return
    if isinstance(data, dict):
        for v in data.values():
            yield from _iter_strings(v)
        return
    if isinstance(data, list):
        for v in data:
            yield from _iter_strings(v)


def _collect_https_urls(text: str, data: Any = None) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        u2 = _unescape_url((u or "").strip())
        if not u2.startswith("http"):
            return
        cut = len(u2)
        for i, ch in enumerate(u2[8:], start=8):
            if ch in (" ", "\t", "\n", "\r", '"', "'", "<", ">"):
                cut = i
                break
        u2 = _unescape_url(u2[:cut])
        if u2 and u2 not in seen:
            seen.add(u2)
            found.append(u2)

    for m in HTTPS_URL_RE.finditer(text or ""):
        add(m.group(0))
    if data is not None:
        for s in _iter_strings(data):
            if "http" in (s or ""):
                for m in HTTPS_URL_RE.finditer(s):
                    add(m.group(0))
            elif (s or "").startswith("http"):
                add(s)
    return found


def _pick_best_download_url(urls: list[str]) -> str:
    """Prefer contribution-rt download, then any /download URL, then empty."""
    if not urls:
        return ""
    for u in urls:
        if CONTRIB_RT_HOST in u and "download" in u.lower():
            return u
    for u in urls:
        if CONTRIB_RT_HOST in u:
            return u
    for u in urls:
        low = u.lower()
        if "download" in low or "/v1/genai/download" in low:
            return u
    return ""


def _extract_c_token_from_text(text: str) -> str:
    m = C_TOKEN_RE.search(text or "")
    if m:
        return m.group(1)
    m = re.search(r'"(Cg[A-Za-z0-9_\-]{16,})"', text or "")
    if m:
        return m.group(1)
    return ""


def _extract_job_id_from_data(data: Any, text: str) -> str:
    if isinstance(data, dict):
        for k in ("name", "id", "operation", "jobId", "mediaId", "token", "c"):
            v = data.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    if data is not None:
        for s in _iter_strings(data):
            if not isinstance(s, str):
                continue
            s = s.strip()
            if s.startswith("AVL_") and len(s) > 8:
                return s
            if s.startswith("Cg") and len(s) >= 12 and re.match(r"^Cg[A-Za-z0-9_\-]+$", s):
                return s
            if "operations/" in s or s.startswith("jobs/"):
                return s
    m = re.search(r'"name"\s*:\s*"([^"]+)"', text or "")
    if m:
        return m.group(1)
    m = BLOB_ID_RE.search(text or "")
    if m:
        return m.group(0)
    m = re.search(r'"(Cg[A-Za-z0-9_\-]{10,})"', text or "")
    if m:
        return m.group(1)
    return ""


def _looks_pending(text: str, data: Any) -> bool:
    low = (text or "").lower()
    markers = (
        "pending",
        "processing",
        "running",
        "in_progress",
        "in progress",
        "not_ready",
        "queued",
        'status":1',
        'status": 1',
    )
    if any(m in low for m in markers):
        urls = _collect_https_urls(text, data)
        if _pick_best_download_url(urls):
            return False
        return True
    return False



def _as_duration_sec(val: Any) -> int | None:
    """Parse duration from int/str or ["10"] / [10] protobuf-ish cells."""
    if val is None:
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        n = int(val)
        return n if 1 <= n <= 600 else None
    if isinstance(val, str):
        s = val.strip()
        if s.isdigit():
            n = int(s)
            return n if 1 <= n <= 600 else None
        return None
    if isinstance(val, list) and val:
        return _as_duration_sec(val[0])
    return None


def _extract_media_dims_from_list(arr: list) -> dict[str, Any] | None:
    """Detect F12 media cell: URL + width + height + duration nearby.

    Observed shapes (2026-10-01):
      [id?, bard_storage, temp_data, lookup_temp_data, URL, 1280, 720, ["10"]]
      [bard_storage, temp_data, lookup_temp_data, id, URL, 1280, 720, ["10"]]
    URL index varies; dims are the ints immediately after the contribution-rt URL.
    """
    if not isinstance(arr, list) or not arr:
        return None
    url_idx = -1
    url = ""
    for i, cell in enumerate(arr):
        if isinstance(cell, str) and CONTRIB_RT_HOST in cell and "download" in cell.lower():
            url_idx = i
            url = _unescape_url(cell)
            break
        if isinstance(cell, str) and "http" in cell and CONTRIB_RT_HOST in cell:
            url_idx = i
            url = _unescape_url(cell)
            break
    if url_idx < 0:
        return None
    width = height = None
    duration_sec = None
    media_id = ""
    if url_idx + 1 < len(arr) and isinstance(arr[url_idx + 1], int):
        width = arr[url_idx + 1]
    if url_idx + 2 < len(arr) and isinstance(arr[url_idx + 2], int):
        height = arr[url_idx + 2]
    if url_idx + 3 < len(arr):
        duration_sec = _as_duration_sec(arr[url_idx + 3])
    markers = 0
    for cell in arr:
        if cell in ("bard_storage", "temp_data", "lookup_temp_data"):
            markers += 1
        if isinstance(cell, str) and re.fullmatch(r"[0-9a-fA-F]{16,64}", cell or ""):
            media_id = cell
    if markers == 0 and (width is None or height is None):
        return None
    out: dict[str, Any] = {"download_url": url}
    if width is not None:
        out["width"] = width
    if height is not None:
        out["height"] = height
    if duration_sec is not None:
        out["duration_sec"] = duration_sec
    if media_id:
        out["media_id"] = media_id
    return out


def _extract_media_dims_from_data(data: Any) -> dict[str, Any]:
    """Walk nested arrays; return first best media block with contribution-rt + dims."""
    best: dict[str, Any] = {}
    stack = [data]
    while stack:
        cur = stack.pop()
        if isinstance(cur, list):
            hit = _extract_media_dims_from_list(cur)
            if hit and hit.get("download_url"):
                score = (
                    (2 if hit.get("width") and hit.get("height") else 0)
                    + (1 if hit.get("duration_sec") else 0)
                    + (1 if CONTRIB_RT_HOST in (hit.get("download_url") or "") else 0)
                )
                best_score = (
                    (2 if best.get("width") and best.get("height") else 0)
                    + (1 if best.get("duration_sec") else 0)
                    + (1 if CONTRIB_RT_HOST in (best.get("download_url") or "") else 0)
                )
                if score > best_score or not best:
                    best = hit
            for v in cur:
                if isinstance(v, (list, dict)):
                    stack.append(v)
        elif isinstance(cur, dict):
            for v in cur.values():
                if isinstance(v, (list, dict)):
                    stack.append(v)
    return best


def parse_generate_response(resp) -> dict[str, Any]:
    """Flexibly parse nested json+protobuf generate response.

    Returns keys: download_url, c_token, job_id, pending, urls (list),
    width, height, duration_sec, media_id (when present in media block).
    Hardened for F12 shape: bard_storage/temp_data/lookup_temp_data +
    contribution-rt URL + width + height + ["10"] duration (duplicate blocks OK).
    """
    text = _resp_text(resp)
    data = _resp_json(resp)
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            pass
    urls = _collect_https_urls(text, data)
    download_url = _pick_best_download_url(urls)
    media = _extract_media_dims_from_data(data) if data is not None else {}
    if media.get("download_url"):
        if not download_url or (
            CONTRIB_RT_HOST in media["download_url"]
            and CONTRIB_RT_HOST not in (download_url or "")
        ):
            download_url = media["download_url"]
        elif CONTRIB_RT_HOST in media["download_url"]:
            download_url = media["download_url"]
        if media["download_url"] not in urls:
            urls.insert(0, media["download_url"])
    c_token = _extract_c_token_from_text(text)
    if not c_token and download_url:
        c_token = _extract_c_token_from_text(download_url)
    if not c_token and data is not None:
        for s in _iter_strings(data):
            t = _extract_c_token_from_text(s)
            if t:
                c_token = t
                break
    job_id = _extract_job_id_from_data(data, text)
    if not job_id and media.get("media_id"):
        job_id = str(media.get("media_id") or "")
    pending = _looks_pending(text, data)
    out: dict[str, Any] = {
        "download_url": download_url,
        "c_token": c_token,
        "job_id": job_id,
        "pending": pending,
        "urls": urls,
    }
    if media.get("width") is not None:
        out["width"] = media["width"]
    if media.get("height") is not None:
        out["height"] = media["height"]
    if media.get("duration_sec") is not None:
        out["duration_sec"] = media["duration_sec"]
    if media.get("media_id"):
        out["media_id"] = media["media_id"]
    return out


def _guess_job_id(resp) -> str:
    return parse_generate_response(resp).get("job_id") or ""


def _guess_download_token(resp) -> str:
    p = parse_generate_response(resp)
    return p.get("c_token") or p.get("job_id") or ""


def resolve_download_url(
    resp,
    ov: dict,
    token: str,
    api_key: str,
    *,
    prefer_url: str = "",
) -> tuple[str, str]:
    """Prefer response URL (contribution-rt / https download); else template / host.

    Returns (url, source) where source is contribution-rt|response|template|
    fallback_host|"".
    """
    prefer_url = _unescape_url(prefer_url or "")
    if not prefer_url:
        prefer_url = parse_generate_response(resp).get("download_url") or ""

    if prefer_url:
        src = "contribution-rt" if CONTRIB_RT_HOST in prefer_url else "response"
        return prefer_url, src

    text = _resp_text(resp)
    urls = _collect_https_urls(text, _resp_json(resp))
    picked = _pick_best_download_url(urls)
    if picked:
        src = "contribution-rt" if CONTRIB_RT_HOST in picked else "response"
        return picked, src

    tmpl = str(ov.get("download_url_template") or "").strip()
    if tmpl and token:
        u = (
            tmpl.replace("{job_id}", token)
            .replace("{id}", token)
            .replace("{c}", token)
            .replace("REDACTED_KEY", api_key or "REDACTED_KEY")
        )
        return u, "template"
    if token:
        q = urlencode({"c": token})
        if api_key and not _is_redacted_key(api_key):
            q = urlencode({"c": token, "key": api_key})
        return f"{APPSGENAI_HOST}{DOWNLOAD_PATH}?{q}", "fallback_host"
    return "", ""


def _extract_download_url(resp, ov: dict, token: str, api_key: str) -> str:
    """Back-compat wrapper."""
    u, _src = resolve_download_url(resp, ov, token, api_key)
    return u


if __name__ == "__main__":
    # Quick self-check (no network, no key required)
    f = map_generate_fields(
        prompt="test CHAR_02",
        aspect="16:9",
        resolution="1080p",
        blob_ids=["AVL_x"] * 10,
        duration_sec=8,
    )
    assert "Duration: 8 seconds" in f["prompt"], f["prompt"]
    assert len(f["blob_ids"]) <= MAX_REF_IMAGES
    assert f["aspect_orientation"] == "landscape"
    f2 = map_generate_fields(
        prompt="x\nDuration: 3 seconds\ny", duration_sec=10, aspect="9:16"
    )
    assert f2["prompt"].count("Duration:") == 1
    assert "Duration: 10 seconds" in f2["prompt"]
    assert f2["aspect_orientation"] == "portrait"
    p = ensure_duration_in_prompt("hello", 5)
    assert p.endswith("Duration: 5 seconds")

    class _FakeResp2:
        text = (
            '[[null,"pending"],'
            '["https://contribution-rt.usercontent.google.com/download?c=CgABCDEFghijklmnop"]]'
        )
        status_code = 200

        def json(self):
            raise ValueError("not json object")

    parsed = parse_generate_response(_FakeResp2())
    assert "contribution-rt" in (parsed.get("download_url") or ""), parsed
    u, src_name = resolve_download_url(
        _FakeResp2(), {}, "", "", prefer_url=parsed["download_url"]
    )
    assert src_name == "contribution-rt", src_name
    assert "contribution-rt" in u

    class _FakeRespMedia:
        # Exact F12 media-cell shape (URL + 1280 + 720 + ["10"]) nested in arrays
        text = json.dumps(
            [
                [
                    [
                        [
                            [
                                None,
                                None,
                                None,
                                None,
                                None,
                                None,
                                [
                                    None,
                                    None,
                                    None,
                                    None,
                                    [
                                        "082036e9REDACTEDMEDIAID00000000000000004270",
                                        "bard_storage",
                                        "temp_data",
                                        "lookup_temp_data",
                                        "https://contribution-rt.usercontent.google.com/"
                                        "download?c=Cg_REDACTED_SAMPLE_TOKEN_xxxxHGAE"
                                        "&filename=video.mp4&opi=10843642",
                                        1280,
                                        720,
                                        ["10"],
                                    ],
                                ],
                            ]
                        ]
                    ]
                ],
                None,
                [],
                [],
                [[None, ["10000", None, "9950", 1], "50"]],
            ]
        )
        status_code = 200

        def json(self):
            return json.loads(self.text)

    parsed_m = parse_generate_response(_FakeRespMedia())
    assert "contribution-rt" in (parsed_m.get("download_url") or ""), parsed_m
    assert parsed_m.get("width") == 1280, parsed_m
    assert parsed_m.get("height") == 720, parsed_m
    assert parsed_m.get("duration_sec") == 10, parsed_m

    # Nap du de CHAC CHAN vuot tran, du tran co duoc nang qua env.
    clamped = clamp_ref_list(list(range(MAX_REF_IMAGES_HARD + 6)),
                             label="test")
    assert len(clamped) == MAX_REF_IMAGES, len(clamped)

    print("self-check OK")
    print(
        "fields",
        json.dumps(
            {k: f[k] for k in (
                "prompt", "aspect", "aspect_pair", "aspect_orientation",
                "duration_sec", "blob_ids",
            )},
            ensure_ascii=False,
        )[:500],
    )
    ov = load_capture_overlay()
    print("overlay_soft", overlay_ready_soft(ov), "ready", overlay_ready(ov))
    print("key_resolved", bool(resolve_api_key(ov)))
    u2 = build_generate_url(ov)
    print("url", u2.split("key=")[0] + "key=REDACTED")
