# -*- coding: utf-8 -*-
"""Cầu nối giữa giao diện PB_MEDIA_TAURI và code Python của tool cũ.

Giao diện mới (React, localhost:1420) không tự gọi Google: mọi việc thật —
tài khoản, cookie, Vids, Flow — đã có sẵn và đang chạy tốt trong
PB_MEDIA_SRT_clean. Máy chủ này import thẳng các module đó rồi mở vài
endpoint JSON trên 127.0.0.1:1431. Vite chuyển `/api/*` sang đây.

Chạy tay (Vite tự bật khi `npm run dev`):
    py scripts\\pb_bridge.py
Đổi thư mục tool: set PB_TOOL_DIR=...   Đổi cổng: set PB_BRIDGE_PORT=...
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOOL_DIR = os.environ.get("PB_TOOL_DIR") or r"C:\Users\Admin\Downloads\PB_MEDIA_SRT_clean"
PORT = int(os.environ.get("PB_BRIDGE_PORT") or 1431)
LOCAL = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
REF_DIR = os.path.join(LOCAL, "PBMedia", "pb_bridge_refs")
OUT_MAC_DINH = os.path.join(os.path.expanduser("~"), "Videos", "PB_MEDIA")

if TOOL_DIR not in sys.path:
    sys.path.insert(0, TOOL_DIR)

# ── Đúc token kiểu SuperVeo — CHỈ cho cầu nối, không đụng file tool cũ ──
#
# Công thức đã chạy 01/10 (HTTP 200, không 403): đúc reCAPTCHA trên
# flow.google.com/about bằng Chrome hồ sơ TẠM chưa đăng nhập, tự chèn
# enterprise.js — đúng như tiến trình SuperVeo đo được. Code đó nằm trong bộ
# mint_* bản 02/10; tool cũ hiện chạy bộ 28–30/09 (không có). Bộ 02/10 được
# chép vào scripts/flow_overlay và nạp TRƯỚC tool cũ. Tắt: PB_MINT_ABOUT=0.
OVERLAY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flow_overlay")
MINT_ABOUT = (os.environ.get("PB_MINT_ABOUT") or "1").strip() not in ("0", "off", "no")
if MINT_ABOUT and os.path.isdir(OVERLAY_DIR):
    sys.path.insert(0, OVERLAY_DIR)
    # y như CHAY_THU_MINT_ABOUT.bat của tool cũ
    os.environ.setdefault("CAPCUT_MINT_ABOUT", "1")
    os.environ.setdefault("CAPCUT_EP_MINT_KHAC_PHIEN", "1")
    os.environ.setdefault("CAPCUT_CHAY_KHI_LECH", "1")
    try:
        import puppeteer_minter as _pm   # bản overlay
        # ổ K: không tạo junction được → chỉ thẳng node_modules của tool cũ
        _pm._MODULE_DIRS.append(os.path.join(TOOL_DIR, "node_modules"))
    except Exception:
        pass

# ───────────────────────── nhật ký ─────────────────────────

_LOG: list[dict] = []
_LOG_LOCK = threading.Lock()
_LOG_ID = [0]


def log(msg: str, level: str = "INFO", tag: str = "bridge") -> None:
    for dong in str(msg).splitlines() or [""]:
        dong = dong.rstrip()
        if not dong:
            continue
        lv = level
        if level == "INFO" and (dong.lstrip().startswith(("❌", "⛔"))
                                or "HTTP 4" in dong or "HTTP 5" in dong):
            lv = "LỖI"
        elif level == "INFO" and dong.lstrip().startswith("⚠"):
            lv = "WARN"
        with _LOG_LOCK:
            _LOG_ID[0] += 1
            _LOG.append({"id": _LOG_ID[0], "time": time.strftime("%H:%M:%S"),
                         "level": lv, "tag": tag, "msg": dong})
            del _LOG[:-2000]
        try:
            print("[%s] %s" % (tag, dong), flush=True)
        except Exception:
            pass


# ───────────────────────── tài khoản ─────────────────────────

def _pool():
    import flow_api
    return flow_api, flow_api.AccountPool.load()


def ds_tai_khoan() -> list[dict]:
    import google_vids_api as gva
    flow_api, pool = _pool()
    bat = set(pool.enabled_indices() or [])
    ra = []
    for i, a in enumerate(pool.accounts):
        try:
            ck = pool.best_cookies(i) or a.get("cookies") or ""
        except Exception:
            ck = a.get("cookies") or ""
        try:
            ok = bool(gva.google_cookie_status(ck)[0])
        except Exception:
            ok = False
        try:
            duc = bool(pool.la_tk_duc(i))
        except Exception:
            duc = False
        # KHÔNG bao giờ trả cookie/bearer ra giao diện — chỉ trạng thái.
        ra.append({
            "idx": i,
            "id": a.get("id") or "",
            "email": (a.get("email") or "").strip().lower(),
            "ten": flow_api.ten_tk(a, i),
            "name": a.get("name") or "",
            "bat": i in bat,
            "cookie_ok": ok,
            "so_cookie": len([x for x in ck.split(";") if "=" in x]),
            "bearer_ok": bool(a.get("bearer")) and not a.get("bearer_stale"),
            "credits": a.get("credits"),
            "credits_luc": a.get("credits_luc") or 0,
            "tier": a.get("tier") or a.get("hang") or "",
            "tier_status": a.get("tier_status") or "",
            "captured": a.get("capturedAt") or 0,
            "profile_key": a.get("profile_key") or "",
            "chi_duc_token": duc,
        })
    return ra


# ── Quản lý tài khoản: gọi THẲNG AccountPool của tool cũ (cùng một sổ) ──
#
# Mọi hàm của AccountPool tự save() — giao diện mới và tool cũ thấy y nhau.
# Việc phải mở Chrome (đăng nhập TK mới, lấy cookie mới, mở trình duyệt TK)
# chạy nền, báo tiến độ qua nhật ký tag «tk».

def _tk_idx(pool, d: dict) -> int:
    """Tìm TK theo id (bền) rồi mới theo idx (đổi khi xoá dòng khác)."""
    tid = str(d.get("id") or "")
    if tid:
        for i, a in enumerate(pool.accounts):
            if str(a.get("id") or "") == tid:
                return i
    i = int(d.get("idx", -1))
    if not (0 <= i < len(pool.accounts)):
        raise RuntimeError("Không thấy tài khoản này (sổ đã đổi?) — tải lại danh sách.")
    return i


def tk_hanh_dong(viec: str, d: dict) -> dict:
    flow_api, pool = _pool()
    ghi = lambda m: log(m, "INFO", "tk")        # noqa: E731
    if viec == "add-cookie":
        ck = str(d.get("cookie") or "").strip()
        if len(ck) < 20:
            raise RuntimeError("Cookie quá ngắn — dán nguyên chuỗi cookie (header / JSON / cookies.txt).")
        acc = pool.add_cookie(ck, name=str(d.get("name") or ""), log=ghi)
        if not acc:
            raise RuntimeError("Cookie không dùng được (thiếu SID/PSID hoặc đã hết hạn).")
        return {"email": acc.get("email") or acc.get("name") or ""}
    if viec in ("login-new", "refresh-cookie", "open"):
        i = -1 if viec == "login-new" else _tk_idx(pool, d)
        ten = "đăng nhập TK mới" if i < 0 else "%s · %s" % (
            "lấy cookie mới" if viec == "refresh-cookie" else "mở trình duyệt",
            flow_api.ten_tk(pool.accounts[i], i))
        v = VIEC._moi("tk", ten)

        def chay():
            try:
                _f, p = _pool()
                if viec == "login-new":
                    ghi("🌐 Mở Chrome hồ sơ trống — đăng nhập Google trong cửa sổ vừa mở…")
                    ok, msg, _data = p.them_tk_moi(log=ghi, timeout_s=300)
                elif viec == "refresh-cookie":
                    ghi("🍪 Mở Chrome hồ sơ của TK để lấy cookie mới…")
                    ok, msg = p.lay_cookie_moi(i, log=ghi, timeout_s=240)
                else:
                    ok, msg = p.mo_trinh_duyet_tk(i, log=ghi, timeout_s=300)
                v.update(status="xong" if ok else "loi", msg=str(msg)[:300])
                ghi(("✅ " if ok else "❌ ") + str(msg))
            except Exception as e:
                v.update(status="loi", msg=str(e)[:300])
                ghi("❌ %s: %s" % (ten, e))

        threading.Thread(target=chay, daemon=True).start()
        return {"job": v["id"]}
    i = _tk_idx(pool, d)
    if viec == "test":
        song, ly_do, info = pool.kiem_phien(i, log=ghi)
        bearer = False
        if song:
            try:
                bearer = bool(pool.refresh_bearer(i, log=ghi))
            except Exception as e:
                ghi("⚠ xin bearer: %s" % e)
        _f, p2 = _pool()
        a = p2.accounts[i] if i < len(p2.accounts) else {}
        return {"song": bool(song), "ly_do": str(ly_do), "bearer": bearer,
                "tier": a.get("tier") or "", "credits": a.get("credits")}
    if viec == "toggle":
        pool.set_enabled(i, bool(d.get("on")))
        return {}
    if viec == "token-only":
        pool.set_chi_duc_token(i, bool(d.get("on")))
        return {}
    if viec == "rename":
        pool.rename(i, str(d.get("name") or "").strip())
        return {}
    if viec == "delete":
        pool.remove(i)
        return {}
    raise RuntimeError("Không có việc «%s»" % viec)


def gemini_keys(moi: str | None = None) -> list[str]:
    """Khoá Gemini — đọc/ghi CHUNG cấu hình TTS của tool cũ (tts.load_config).

    Không có tool cũ (thiếu module tts) thì lưu ở pb_bridge.json của cầu nối."""
    try:
        import tts
    except ImportError:
        if moi is not None:
            cau_hinh({"gemini_keys": "\n".join(_ds_khoa(moi))})
        return _ds_khoa(cau_hinh().get("gemini_keys"))
    cfg = tts.load_config() or {}
    if moi is not None:
        ds = [x.strip() for x in moi.replace(",", "\n").splitlines() if x.strip()]
        cfg["gemini_keys"] = "\n".join(ds)
        cfg["gemini_key"] = ds[0] if ds else ""
        tts.save_config(cfg)
    raw = cfg.get("gemini_keys") or cfg.get("gemini_key") or ""
    return [x.strip() for x in str(raw).splitlines() if x.strip()]


def phien_tk(email: str = "", bo_qua: set | None = None):
    """(email, cookies) của TK được chọn, hoặc TK đang tick đầu tiên còn dùng được."""
    bo_qua = bo_qua or set()
    flow_api, pool = _pool()
    thu = list(pool.enabled_indices() or []) or list(range(len(pool.accounts)))
    if email:
        thu = [i for i in range(len(pool.accounts))
               if (pool.accounts[i].get("email") or "").strip().lower() == email.lower()] + thu
    for i in thu:
        a = pool.accounts[i]
        em = (a.get("email") or flow_api.ten_tk(a, i) or "").strip().lower()
        if em in bo_qua:
            continue
        try:
            ck = pool.best_cookies(i) or a.get("cookies") or ""
        except Exception:
            ck = a.get("cookies") or ""
        if ck.strip():
            return em, ck
    return "", ""


# ───────────────────────── ảnh tham chiếu ─────────────────────────

_MA = re.compile(r"(?:CHAR|BG|PROP|ENV|STYLE)_\d{1,3}", re.I)


def ma_cua_anh(ten_file: str) -> str:
    goc = os.path.splitext(os.path.basename(ten_file))[0]
    m = _MA.search(goc)
    return (m.group(0) if m else goc).upper()


def chon_ref(prompt: str, refs: list[dict], tran: int = 10) -> list[str]:
    """Ảnh mà prompt GỌI TÊN, theo thứ tự xuất hiện trong prompt."""
    up = prompt.upper()
    co = []
    for r in refs:
        p = r.get("path") or ""
        if not os.path.isfile(p):
            continue
        ma = ma_cua_anh(p)
        tag = str(r.get("tag") or "").lstrip("@").upper()
        vi_tri = -1
        for khoa in (ma, tag):
            if not khoa:
                continue
            m = re.search(r"@?\b" + re.escape(khoa) + r"\b", up)
            if m:
                vi_tri = m.start()
                break
        if vi_tri >= 0:
            co.append((vi_tri, p))
    co.sort()
    ra, da = [], set()
    for _, p in co:
        if p not in da:
            da.add(p)
            ra.append(p)
    return ra[:tran]


# ───────────────────────── hàng đợi Vids ─────────────────────────

class HangVids:
    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self.thu_tu: list[str] = []
        self.lock = threading.Lock()
        self.dung = threading.Event()
        self.het_quota: set[str] = set()
        self._cho: list[str] = []
        self._dang = 0
        self._song_song = 4

    def danh_sach(self):
        with self.lock:
            return [self._cong_khai(self.jobs[k]) for k in self.thu_tu if k in self.jobs]

    @staticmethod
    def _cong_khai(j):
        return {k: v for k, v in j.items() if k not in ("refs",)}

    def them(self, d: dict) -> list[str]:
        prompts = [str(p).strip() for p in (d.get("prompts") or []) if str(p).strip()]
        out_dir = str(d.get("out_dir") or "").strip()
        if not out_dir or not os.path.isabs(out_dir):
            out_dir = os.path.join(OUT_MAC_DINH, "Vids", re.sub(r'[\\/:*?"<>|]+', "_",
                                   str(d.get("project") or "du_an")))
        os.makedirs(out_dir, exist_ok=True)
        ids = []
        with self.lock:
            for i, p in enumerate(prompts):
                jid = uuid.uuid4().hex[:10]
                self.jobs[jid] = {
                    "id": jid, "stt": len(self.thu_tu) + 1, "prompt": p,
                    "aspect": d.get("aspect") or "16:9",
                    "resolution": d.get("resolution") or "1080p",
                    "duration": int(d.get("duration") or 8),
                    "doc_id": str(d.get("doc_id") or "").strip(),
                    "email": str(d.get("email") or "").strip().lower(),
                    "out_dir": out_dir, "refs": list(d.get("refs") or []),
                    "status": "cho", "buoc": "chờ", "error": "", "out_path": "",
                    "tk": "", "bat_dau": 0, "ket_thuc": 0,
                }
                self.thu_tu.insert(0, jid)
                self._cho.append(jid)
                ids.append(jid)
        self._song_song = max(1, min(10, int(d.get("parallel") or 4)))
        self.dung.clear()
        self._bom()
        return ids

    def chay_lai(self, ids: list[str]) -> int:
        n = 0
        with self.lock:
            for jid in ids:
                j = self.jobs.get(jid)
                if j and j["status"] in ("loi", "tu_choi", "cho"):
                    j.update(status="cho", buoc="chờ", error="")
                    if jid not in self._cho:
                        self._cho.append(jid)
                    n += 1
        self.dung.clear()
        self._bom()
        return n

    def xoa(self, ids: list[str] | None) -> None:
        with self.lock:
            bo = set(ids) if ids else {k for k, j in self.jobs.items() if j["status"] != "dang_chay"}
            for k in bo:
                if self.jobs.get(k, {}).get("status") == "dang_chay":
                    continue
                self.jobs.pop(k, None)
                if k in self._cho:
                    self._cho.remove(k)
            self.thu_tu = [k for k in self.thu_tu if k in self.jobs]

    def dung_lai(self) -> None:
        self.dung.set()
        with self.lock:
            for k in self._cho:
                j = self.jobs.get(k)
                if j:
                    j.update(status="loi", error="Đã bấm Dừng", buoc="dừng")
            self._cho.clear()
        log("⏹ Đã dừng — các cảnh đang chạy sẽ xong nốt.", "WARN", "vids")

    def _bom(self):
        while True:
            with self.lock:
                if self.dung.is_set() or not self._cho or self._dang >= self._song_song:
                    return
                jid = self._cho.pop(0)
                self._dang += 1
            threading.Thread(target=self._chay, args=(jid,), daemon=True).start()

    def _chay(self, jid: str):
        try:
            self._chay_mot(jid)
        finally:
            with self.lock:
                self._dang -= 1
            self._bom()

    def _chay_mot(self, jid: str):
        import google_vids_api as gva
        j = self.jobs.get(jid)
        if not j:
            return
        j.update(status="dang_chay", buoc="gửi lệnh", bat_dau=time.time(), error="")
        so = "%03d" % j["stt"]
        m = re.match(r"\s*(\d{1,4})\s*[.)\-:]", j["prompt"])
        if m:
            so = "%03d" % int(m.group(1))
        tag = "vids#" + so

        def _log(s):
            s = s if isinstance(s, str) else str(s)
            if "Upload OK" in s:
                j["buoc"] = "tải ref"
            elif "POST /v1/genai/generate" in s:
                j["buoc"] = "đang dựng"
            elif "Download" in s and "→" in s:
                j["buoc"] = "đang tải"
            log(s, "INFO", tag)

        ref_paths = chon_ref(j["prompt"], j["refs"])
        if ref_paths:
            log("📎 %d ảnh tham chiếu: %s" % (len(ref_paths), ", ".join(
                os.path.basename(p) for p in ref_paths)), "INFO", tag)

        loi_cuoi = ""
        for _lan in range(4):
            email, ck = phien_tk(j["email"], self.het_quota)
            if not ck:
                loi_cuoi = ("Không có tài khoản nào dùng được (cookie trống hoặc "
                            "mọi TK đã hết hạn mức Vids). Thêm/lấy cookie ở tool cũ.")
                break
            j["tk"] = email
            try:
                prompt = gva.ensure_duration_in_prompt(j["prompt"], j["duration"])
            except Exception:
                prompt = j["prompt"]
            client = gva.GoogleVidsClient(cookies=ck, log=_log)
            client.account_email = email
            doc = j["doc_id"] if len(j["doc_id"]) >= 25 else None
            try:
                out = client.generate_video(
                    prompt=prompt, aspect=j["aspect"],
                    resolution=gva.normalize_resolution(j["resolution"]),
                    ref_paths=ref_paths, duration_sec=j["duration"],
                    doc_id=doc, out_dir=j["out_dir"])
            except Exception as e:
                loi_cuoi = str(e)
                up = loi_cuoi.upper()
                if "QUOTA_EXHAUSTED" in up or "HẾT HẠN MỨC" in up:
                    self.het_quota.add(email)
                    log("🔄 «%s» hết hạn mức Vids — thử tài khoản khác." % email, "WARN", tag)
                    continue
                break
            if out and os.path.isfile(out):
                dich = os.path.join(j["out_dir"], so + ".mp4")
                n = 2
                while os.path.exists(dich) and os.path.abspath(dich) != os.path.abspath(out):
                    dich = os.path.join(j["out_dir"], "%s_%d.mp4" % (so, n))
                    n += 1
                try:
                    if os.path.abspath(dich) != os.path.abspath(out):
                        os.replace(out, dich)
                        out = dich
                except Exception:
                    pass
                j.update(status="xong", buoc="xong", out_path=out, ket_thuc=time.time())
                log("✅ Xong → %s" % out, "INFO", tag)
                return
            loi_cuoi = gva_last_error(client) or "Không có file trả về"
            break
        tu_choi = "REQUEST_REFUSED" in loi_cuoi.upper()
        j.update(status="tu_choi" if tu_choi else "loi", buoc="lỗi",
                 error=loi_cuoi[:600], ket_thuc=time.time())
        log("❌ " + loi_cuoi.splitlines()[0][:300] if loi_cuoi else "❌ lỗi", "LỖI", tag)


def gva_last_error(client) -> str:
    return str(getattr(client, "last_error", "") or "")


HANG = HangVids()


# ───────────────────────── Flow: Tạo ảnh + Veo3 ─────────────────────────
#
# Dùng NGUYÊN `image_gen.MediaBatch` của tool cũ — cùng bộ đúc reCAPTCHA,
# cùng xoay tài khoản, cùng tải file — y như gui.py dựng nó (gui.py ~21540).
# Mỗi lúc chỉ MỘT mẻ: hai mẻ song song tranh nhau Chrome đúc token.

IMG_MODEL = {          # nhãn giao diện mới → mã Flow (flow_api.IMAGE_MODELS)
    "Banana 2": "BELUGA",
    "Banana 2 Lite": "HARBOR_SEAL",
    "Banana Pro": "GEM_PIX_2",
}
VID_BAC = {            # nhãn giao diện mới → bậc trong flow_api.VIDEO_BAC
    "Veo 3.1 Fast": "Veo 3.1 Fast",
    "Veo 3.1 Lite": "Veo 3.1 Lite",
    "Veo 3.1 Relax": "Veo 3.1 Lite",      # Google bỏ Relax 24/09
    "Veo 3.1 Quality": "Veo 3.1 Quality",
    "✨ Omni Flash": "✨ Omni Flash",
}


TEN_CHE_DO = {
    "t2i": "Tạo ảnh", "auto": "Veo3 Text To Video", "i2v": "Veo3 Image To Video",
    "chars": "Veo3 Ingredients", "v2v": "Veo3 Video To Video",
}
I2V_NHAN = {           # nhãn ô Model của các mode ảnh → bậc trong flow_api.I2V_BAC
    "Veo 3.1 Fast": "Veo 3.1 Fast",
    "Veo 3.1": "Veo 3.1 Fast",
    "Veo 3.1 Lite": "Veo 3.1 Lite",
    "Veo 3 Quality": "Veo 3.1 Quality",
    "Omni (abra_edit)": "✨ Omni Flash",
}


def ma_i2v(nhan: str, giay: str) -> str:
    import flow_api
    bac = (flow_api.I2V_BAC or {}).get(I2V_NHAN.get(nhan, nhan)) or {}
    return bac.get((giay or "8s").strip()) or bac.get("8s") or next(
        iter(bac.values()), "veo_3_1_i2v_lite")


def ma_video(nhan: str, giay: str) -> str:
    import flow_api
    bac = (flow_api.VIDEO_BAC or {}).get(VID_BAC.get(nhan, nhan)) or {}
    giay = (giay or "8s").strip()
    return bac.get(giay) or bac.get("8s") or next(iter(bac.values()), "veo_3_1_t2v_lite")


class LoFlow:
    def __init__(self):
        self.lock = threading.Lock()
        self.batch = None
        self.chay = False
        self.items: dict[str, dict] = {}   # khoá: "<kind>:<cảnh>"
        self.kind = ""
        self.out_dir = ""

    def trang_thai(self, kind: str) -> dict:
        with self.lock:
            ds = [dict(v) for v in self.items.values() if v["kind"] == kind]
        for v in ds:
            if v["status"] == "xong" and not v.get("files"):
                v["files"] = self._file_canh(v["out_dir"], v["scene"], v["kind"])
        ds.sort(key=lambda v: v["t"], reverse=True)
        return {"running": self.chay and self.kind == kind, "busy": self.chay,
                "busy_kind": self.kind if self.chay else "", "items": ds}

    @staticmethod
    def _file_canh(out_dir: str, scene: str, kind: str) -> list[str]:
        try:
            import image_gen
            ds = image_gen.scene_files(out_dir, scene) or []
        except Exception:
            ds = []
        duoi = (".mp4",) if kind == "veo3" else (".png", ".jpg", ".jpeg", ".webp")
        return [p for p in ds if p.lower().endswith(duoi)]

    @staticmethod
    def _so_lon_nhat(out_dir: str) -> int:
        lon = 0
        try:
            for f in os.listdir(out_dir):
                m = re.match(r"(\d{1,4})", f)
                if m:
                    lon = max(lon, int(m.group(1)))
        except Exception:
            pass
        return lon

    def bat_dau(self, kind: str, d: dict) -> dict:
        import image_gen
        with self.lock:
            if self.chay:
                return {"ok": False, "error": "Đang chạy mẻ %s — chờ xong hoặc bấm Dừng."
                        % ("Tạo ảnh" if self.kind == "anh" else "Veo3")}
            self.chay = True
            self.kind = kind
        try:
            mode = str(d.get("mode") or ("t2i" if kind == "anh" else "auto"))
            out_dir = str(d.get("out_dir") or "").strip()
            if not out_dir or not os.path.isabs(out_dir):
                out_dir = os.path.join(OUT_MAC_DINH, "Tao_anh" if kind == "anh" else "Veo3")
            os.makedirs(out_dir, exist_ok=True)
            bu = self._so_lon_nhat(out_dir)

            if mode == "i2v":
                # Mỗi ảnh = một cảnh. Prompt trống thì cho một câu chuyển động
                # chung — image_gen bỏ cảnh không có chữ.
                anh = [x for x in (d.get("images") or []) if os.path.isfile(str(x.get("path") or ""))]
                if not anh:
                    raise ValueError("Chưa có ảnh nào cho Image To Video")
                prompts = [(str(bu + i + 1), str(x.get("prompt") or "").strip()
                            or "Bring this image to life with natural, cinematic motion.")
                           for i, x in enumerate(anh)]
            elif mode == "chars" and d.get("ingredients"):
                # Mỗi ingredient = prompt + bộ ảnh riêng. image_gen ghép ảnh
                # theo @tag khớp TÊN FILE, nên đặt tên ảnh = tag và gắn tag
                # vào prompt (image_gen tự gỡ tag trước khi gửi Google).
                prompts = []
                for i, ing in enumerate(d.get("ingredients") or []):
                    so = str(bu + i + 1)
                    tags = []
                    for k, p in enumerate(ing.get("images") or []):
                        if os.path.isfile(str(p)):
                            tags.append("@ingr%sx%d" % (so, k + 1))
                    t = str(ing.get("prompt") or "").strip() or "Cinematic shot featuring the reference subjects."
                    prompts.append((so, (" ".join(tags) + " " + t).strip()))
            else:
                text = "\n".join(str(p).strip() for p in (d.get("prompts") or []) if str(p).strip())
                prompts = image_gen.parse_prompt_text(text)
                # Prompt không đánh số → đánh tiếp sau số lớn nhất đã có trong
                # thư mục, kẻo lần chạy sau đè/bỏ qua cảnh 1, 2… lần trước.
                if prompts and bu and not re.match(r"\d{1,4}\s*[.)\-:]", text.lstrip()[:6]):
                    prompts = [(str(int(n) + bu), t) if str(n).isdigit() else (n, t)
                               for n, t in prompts]
            if not prompts:
                raise ValueError("Chưa có prompt")

            # File đầu vào chép sang thư mục riêng của mẻ, đặt tên theo đúng
            # luật image_gen dò: ảnh i2v theo SỐ CẢNH, ảnh nhân vật theo TAG.
            lo_dir = os.path.join(REF_DIR, "lo_" + uuid.uuid4().hex[:8])
            os.makedirs(lo_dir, exist_ok=True)

            def _chep(src: str, ten: str) -> str:
                dst = os.path.join(lo_dir, ten + os.path.splitext(src)[1].lower())
                shutil.copy2(src, dst)
                return dst

            d = dict(d)
            if mode == "i2v":
                d["scene_images"] = [_chep(str(x.get("path")), "%s_i2v" % n)
                                     for (n, _t), x in zip(prompts, anh)]
            if mode == "chars" and d.get("ingredients"):
                refs = []
                for (n, _t), ing in zip(prompts, d.get("ingredients") or []):
                    k = 0
                    for p in ing.get("images") or []:
                        if os.path.isfile(str(p)):
                            k += 1
                            refs.append({"path": _chep(str(p), "ingr%sx%d" % (n, k))})
                d["refs"] = refs
            elif mode in ("chars", "v2v") and d.get("refs"):
                # Ảnh nhân vật đặt tên theo tag người dùng gõ (@nhanvat1).
                ra = []
                for r in d.get("refs") or []:
                    p = str(r.get("path") or "")
                    if not os.path.isfile(p):
                        continue
                    tag = re.sub(r"[^\w\-]+", "", str(r.get("tag") or "").lstrip("@"))
                    ra.append({"path": _chep(p, tag) if tag else p})
                d["refs"] = ra
            d["mode"] = mode
            self.out_dir = out_dir
            now = time.time()
            with self.lock:
                for i, (n, t) in enumerate(prompts):
                    self.items["%s:%s" % (kind, n)] = {
                        "kind": kind, "scene": str(n), "prompt": t, "status": "cho",
                        "msg": "⏸ Chờ", "out_dir": out_dir, "files": [], "t": now + i / 1000.0,
                    }
            threading.Thread(target=self._chay, args=(kind, prompts, out_dir, d),
                             daemon=True).start()
            return {"ok": True, "n": len(prompts), "out_dir": out_dir}
        except Exception as e:
            with self.lock:
                self.chay = False
            return {"ok": False, "error": str(e)}

    def dung(self) -> None:
        b = self.batch
        if b is not None:
            try:
                b.stop()
            except Exception:
                pass
        log("⏹ Đã bấm Dừng mẻ Flow.", "WARN", "flow")

    def _chay(self, kind: str, prompts, out_dir: str, d: dict):
        import flow_api
        import image_gen
        tag = "anh" if kind == "anh" else "veo3"
        minter = None
        try:
            try:
                flow_api.DUNG.clear()           # cờ dừng chung của lần bấm Dừng trước
            except Exception:
                pass
            pool = flow_api.AccountPool.load()
            if not pool.accounts:
                raise RuntimeError("Sổ tài khoản Flow trống — thêm tài khoản ở tool cũ.")
            try:
                pool.dam_bao_tick_tren_dia()
            except Exception:
                pass
            bat = list(pool.enabled_indices() or []) or [0]
            a = pool.accounts[bat[0]]
            try:
                cookies = pool.best_cookies(bat[0]) or a.get("cookies") or ""
            except Exception:
                cookies = a.get("cookies") or ""
            bearer = (a.get("bearer") or "").strip()
            pid = (a.get("projectId") or "").strip() or str(uuid.uuid4())
            mode = str(d.get("mode") or ("t2i" if kind == "anh" else "auto"))
            log("▶ %s · %d cảnh · TK %s · lưu %s" % (
                TEN_CHE_DO.get(mode, mode), len(prompts),
                flow_api.ten_tk(a, bat[0]), out_dir), "INFO", tag)

            img_model = IMG_MODEL.get(str(d.get("model") or ""), "BELUGA")
            vid_model = ma_video(str(d.get("model") or "Veo 3.1 Lite"), str(d.get("duration") or "8s"))
            i2v_model = None
            if mode == "i2v":
                i2v_model = ma_i2v(str(d.get("model") or "Veo 3.1 Lite"), str(d.get("duration") or "8s"))
            elif mode == "v2v":
                i2v_model = str(d.get("v2v_model") or "abra_edit")
            if kind == "veo3":
                log("🎬 Model: %s" % (i2v_model or vid_model), "INFO", tag)

            ly_do = {"": ""}

            def _log(m):
                log(m, "INFO", tag)
                # Nhớ lý do hỏng gần nhất để gắn vào thẻ kết quả — dòng
                # «❌ Lỗi» của image_gen không nói vì sao.
                t = str(m).strip()
                if ("↳" in t or "⛔" in t or "UNUSUAL" in t or "HTTP 4" in t
                        or "HTTP 5" in t) and len(t) > 12:
                    ly_do[""] = t.lstrip("↳ ").strip()[:240]

            def on_item(scene, status, state):
                k = "%s:%s" % (kind, scene)
                with self.lock:
                    it = self.items.get(k)
                    if not it:
                        return
                    it["msg"] = str(status)
                    it["status"] = {"run": "dang_chay", "wait": "cho", "ok": "xong"}.get(
                        state, "loi" if state in ("fail", "err") else it["status"])
                    if it["status"] == "loi" and ly_do[""] and ly_do[""] not in it["msg"]:
                        it["msg"] = "%s — %s" % (it["msg"], ly_do[""])

            can_mint = True
            try:
                can_mint = image_gen.batch_needs_recaptcha_minter(mode, vid_model)
            except Exception:
                pass
            if can_mint:
                minter = flow_api.make_minter(logger=_log, visible=False, project_id=pid)
                try:
                    flow_api.nap_mint_profile_tu_pool(minter, pool, log=_log)
                except Exception as e:
                    _log("[minter] gắn hồ sơ: %s" % e)
                minter.start()

            refs = [r.get("path") for r in (d.get("refs") or []) if os.path.isfile(r.get("path") or "")]
            v2v_videos = [p for p in (d.get("v2v_videos") or []) if os.path.isfile(str(p))]
            try:
                v2v_giay = float(str(d.get("v2v_seconds") or 8).rstrip("s"))
            except Exception:
                v2v_giay = 8.0
            batch = image_gen.MediaBatch(
                prompts=prompts, out_dir=out_dir, project_id=pid, bearer=bearer,
                cookies=cookies, mode=mode, img_model=img_model, vid_model=vid_model,
                i2v_model=i2v_model,
                ratio=str(d.get("ratio") or "16:9"),
                # Kiểu SuperVeo: token không còn là chỗ nghẽn (đúc ở /about ~1–9s)
                # nên cho nhiều luồng; image_gen tự gửi theo lô trượt.
                workers=max(1, min(20, int(d.get("workers") or (5 if kind == "anh" else 8)))),
                log=_log, on_item=on_item, minter=minter, pool=pool, ref_images=refs,
                scene_images=list(d.get("scene_images") or []),
                v2v_videos=v2v_videos, v2v_seconds=v2v_giay,
                v2v_voice=str(d.get("voice") or "").strip().lower(),
                prefer_1080=bool(d.get("prefer_1080")),
                lo_cho_xong=False,
            )
            self.batch = batch
            ok = batch.run()
            log("🏁 Mẻ %s xong: %s ok · %s lỗi" % (
                tag, getattr(batch, "ok_count", "?"), getattr(batch, "fail_count", "?")),
                "INFO" if ok else "WARN", tag)
        except Exception as e:
            log("❌ " + str(e), "LỖI", tag)
            traceback.print_exc()
            with self.lock:
                for v in self.items.values():
                    if v["kind"] == kind and v["status"] in ("cho", "dang_chay"):
                        v.update(status="loi", msg="❌ " + str(e)[:200])
        finally:
            try:
                if minter is not None:
                    minter.stop()
            except Exception:
                pass
            with self.lock:
                for v in self.items.values():
                    if v["kind"] == kind and v["status"] in ("cho", "dang_chay"):
                        v.update(status="loi", msg=v.get("msg") or "Không xong")
                self.batch = None
                self.chay = False

    def xoa(self, kind: str) -> None:
        with self.lock:
            for k in [k for k, v in self.items.items()
                      if v["kind"] == kind and v["status"] not in ("cho", "dang_chay")]:
                self.items.pop(k, None)


FLOW = LoFlow()


# ───────────────────────── Muse (muse.ai) ─────────────────────────
#
# Dùng tool Muse riêng ở K:\MUSE TOOL: Chrome hồ sơ `_ho_so_muse` (đã đăng
# nhập), mượn `sendRequest` của chính trang muse.ai qua CDP. KHÔNG đi qua máy
# chủ app.cleoo.dev như SuperVeo — cookie muse.ai không rời khỏi máy.

MUSE_DIR = os.environ.get("PB_MUSE_DIR") or r"K:\MUSE TOOL"
_muse_mod = [None]


def muse_mod():
    if _muse_mod[0] is None:
        # Thêm SAU tool chính: K:\MUSE TOOL cũng có image_gen/flow_api riêng,
        # mình muốn bản của tool chính thắng.
        if MUSE_DIR not in sys.path:
            sys.path.append(MUSE_DIR)
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "muse_video", os.path.join(MUSE_DIR, "muse_video.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _muse_mod[0] = m
    return _muse_mod[0]


class HangMuse:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs: dict[str, dict] = {}
        self.thu_tu: list[str] = []
        self.cho: list[str] = []
        self.dung = threading.Event()
        self.giu: dict = {}            # {"m": Muse} — giữ kết nối Chrome giữa các mẻ
        self.chay = False
        self.moi_lan = 1
        self.an_chrome = False

    KHOA_AN = ("ds_anh",)

    def danh_sach(self):
        with self.lock:
            ra = []
            for k in self.thu_tu:
                j = self.jobs.get(k)
                if not j:
                    continue
                ra.append({
                    "id": k, "so": j.get("so"), "prompt": j.get("prompt_goc") or j.get("prompt"),
                    "loai": j.get("loai"), "ti_le": j.get("ti_le"),
                    "status": j.get("trang_thai"), "buoc": j.get("buoc", ""),
                    "error": j.get("loi", ""), "out_path": j.get("out_path", ""),
                    "so_anh": len(j.get("ds_anh") or []),
                    "bat_dau": j.get("bat_dau", 0), "ket_thuc": j.get("ket_thuc", 0),
                })
            return ra

    def them(self, d: dict) -> list[str]:
        mv = muse_mod()
        mode = str(d.get("mode") or "t2v")
        ti_le = str(d.get("aspect") or "16:9")
        out_dir = str(d.get("out_dir") or "").strip()
        if not out_dir or not os.path.isabs(out_dir):
            out_dir = os.path.join(OUT_MAC_DINH, "Muse", re.sub(r'[\\/:*?"<>|]+', "_",
                                   str(d.get("project") or "du_an")))
        os.makedirs(out_dir, exist_ok=True)
        refs = [r for r in (d.get("refs") or []) if os.path.isfile(str(r.get("path") or ""))]
        text = "\n".join(str(p).strip() for p in (d.get("prompts") or []) if str(p).strip())
        canh = mv.tach_prompt_text(text) or []
        # tach_prompt_text trả [(số, prompt)] — đánh số theo prompt người dùng
        ids = []
        with self.lock:
            da = {str(j.get("so")) for j in self.jobs.values() if j.get("out_dir") == out_dir}
            for i, (so, prompt) in enumerate(canh):
                so = str(so)
                while so in da:
                    so = so + "b"
                da.add(so)
                anh = chon_ref(prompt, refs, tran=8)
                if not anh and mode == "i2v" and refs:
                    # Ảnh → Video không gọi @tag: ảnh thứ i cho prompt thứ i.
                    anh = [refs[i % len(refs)]["path"]]
                jid = uuid.uuid4().hex[:10]
                self.jobs[jid] = {
                    "so": so, "prompt": prompt, "prompt_goc": prompt,
                    "ds_anh": anh if mode != "t2v" or anh else [],
                    "out_dir": out_dir, "loai": "anh" if mode == "t2i" else "video",
                    "ti_le": ti_le, "trang_thai": "cho", "buoc": "chờ", "loi": "",
                }
                self.thu_tu.insert(0, jid)
                self.cho.append(jid)
                ids.append(jid)
        self.moi_lan = max(1, min(10, int(d.get("parallel") or 1)))
        self.an_chrome = bool(d.get("an_chrome"))
        self.dung.clear()
        self._bat_tho()
        return ids

    def chay_lai(self, ids: list[str]) -> int:
        n = 0
        with self.lock:
            for k in ids:
                j = self.jobs.get(k)
                if j and j.get("trang_thai") in ("loi", "cho"):
                    j.update(trang_thai="cho", buoc="chờ", loi="")
                    if k not in self.cho:
                        self.cho.append(k)
                    n += 1
        self.dung.clear()
        self._bat_tho()
        return n

    def xoa(self, ids):
        with self.lock:
            bo = set(ids) if ids else {k for k, j in self.jobs.items()
                                       if j.get("trang_thai") != "dang_chay"}
            for k in bo:
                if self.jobs.get(k, {}).get("trang_thai") == "dang_chay":
                    continue
                self.jobs.pop(k, None)
                if k in self.cho:
                    self.cho.remove(k)
            self.thu_tu = [k for k in self.thu_tu if k in self.jobs]

    def dung_lai(self):
        self.dung.set()
        with self.lock:
            for k in self.cho:
                j = self.jobs.get(k)
                if j:
                    j.update(trang_thai="loi", loi="Đã bấm Dừng", buoc="dừng")
            self.cho.clear()
        log("⏹ Muse: đã dừng — lượt đang gửi sẽ bỏ ở bước kế.", "WARN", "muse")

    def mo_chrome(self) -> None:
        mv = muse_mod()
        m = self.giu.get("m")
        if m is None:
            m = mv.Muse(lambda s: log(s, "INFO", "muse"))
            m.ket_noi()
            self.giu["m"] = m
        m.hien_cua_so()

    def _bat_tho(self):
        with self.lock:
            if self.chay:
                return
            self.chay = True
        threading.Thread(target=self._tho, daemon=True).start()

    def _tho(self):
        mv = muse_mod()
        try:
            while not self.dung.is_set():
                with self.lock:
                    if not self.cho:
                        break
                    dau = self.jobs.get(self.cho[0])
                    kieu = (dau.get("loai"), dau.get("ti_le")) if dau else None
                    lo_ids = [k for k in self.cho if self.jobs.get(k)
                              and (self.jobs[k].get("loai"), self.jobs[k].get("ti_le")) == kieu]
                    for k in lo_ids:
                        self.cho.remove(k)
                    jobs = [self.jobs[k] for k in lo_ids]
                if not jobs:
                    continue
                try:
                    mv.chay_hang(self.giu, jobs, moi_lan=self.moi_lan, giu_prompt=True,
                                 an_chrome=self.an_chrome, stop=self.dung,
                                 log=lambda s: log(s, "INFO", "muse"))
                except Exception as e:
                    log("❌ Muse: %s" % e, "LỖI", "muse")
                    traceback.print_exc()
                    for j in jobs:
                        if j.get("trang_thai") in ("cho", "dang_chay"):
                            j.update(trang_thai="loi", loi=str(e)[:300])
        finally:
            with self.lock:
                self.chay = False
            if self.cho and not self.dung.is_set():
                self._bat_tho()


MUSE = HangMuse()


# ───────────────────────── Tiện ích: YouTube, tải video, upscale ─────────────
#
# Cùng bộ công cụ mã nguồn mở mà SuperVeo chở theo: yt-dlp, ffmpeg,
# realesrgan-ncnn-vulkan. ffmpeg/yt-dlp đã cài trên máy (PATH); realesrgan lấy
# ở thư mục SuperVeo (đổi bằng PB_REALESRGAN / PB_REALESRGAN_MODELS).

REALESRGAN = os.environ.get("PB_REALESRGAN") or r"Y:\SUPER VEO\realesrgan-n.exe"
REALESRGAN_MODELS = os.environ.get("PB_REALESRGAN_MODELS") or r"Y:\SUPER VEO\resources\models"
_KHONG_CUA_SO = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _exe(ten: str) -> str:
    p = shutil.which(ten)
    if not p:
        raise RuntimeError("Máy chưa có %s (cài bằng winget hoặc đặt vào PATH)." % ten)
    return p


def tube_search(q: str, n: int = 30) -> list[dict]:
    """Tìm video YouTube bằng yt-dlp (không cần API key)."""
    n = max(5, min(100, int(n or 30)))
    r = subprocess.run([_exe("yt-dlp"), "--flat-playlist", "-J", "--no-warnings",
                        "ytsearch%d:%s" % (n, q)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=120, creationflags=_KHONG_CUA_SO)
    if r.returncode != 0 and not r.stdout.strip():
        raise RuntimeError((r.stderr or "yt-dlp lỗi").strip()[-300:])
    data = json.loads(r.stdout or "{}")
    ra = []
    for e in data.get("entries") or []:
        if not e:
            continue
        ra.append({
            "id": e.get("id"), "title": e.get("title") or "",
            "url": e.get("url") or ("https://www.youtube.com/watch?v=%s" % e.get("id")),
            "channel": e.get("channel") or e.get("uploader") or "",
            "channel_url": e.get("channel_url") or e.get("uploader_url") or "",
            "views": e.get("view_count") or 0, "duration": e.get("duration") or 0,
        })
    return ra


def tube_suggest(q: str, gl: str = "US") -> list[str]:
    """Gợi ý tìm kiếm công khai của YouTube — nguồn của mục «Từ khóa ngách con»."""
    import urllib.parse
    import urllib.request
    url = ("https://suggestqueries-clients6.youtube.com/complete/search?client=youtube"
           "&ds=yt&hl=%s&gl=%s&q=%s" % ("vi" if gl == "VN" else "en", gl, urllib.parse.quote(q)))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
    m = re.search(r"\((.*)\)\s*$", raw, re.S)
    arr = json.loads(m.group(1) if m else raw)
    return [x[0] for x in (arr[1] if len(arr) > 1 else []) if isinstance(x, list) and x]


class ViecPhu:
    """Việc chạy nền (tải video, upscale) — mỗi việc một luồng, báo qua log tag «util»."""

    def __init__(self):
        self.lock = threading.Lock()
        self.viec: dict[str, dict] = {}

    def danh_sach(self):
        with self.lock:
            return sorted((dict(v) for v in self.viec.values()), key=lambda v: -v["t"])

    def _moi(self, loai: str, nguon: str) -> dict:
        v = {"id": uuid.uuid4().hex[:8], "loai": loai, "nguon": nguon, "status": "dang_chay",
             "msg": "", "out_path": "", "t": time.time()}
        with self.lock:
            self.viec[v["id"]] = v
        return v

    def tai_video(self, url: str, out_dir: str) -> dict:
        out_dir = out_dir if (out_dir and os.path.isabs(out_dir)) else os.path.join(OUT_MAC_DINH, "Tai_ve")
        os.makedirs(out_dir, exist_ok=True)
        v = self._moi("tai", url)

        def chay():
            try:
                log("⬇ Tải: %s" % url, "INFO", "util")
                r = subprocess.run(
                    [_exe("yt-dlp"), "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                     "--merge-output-format", "mp4", "--no-playlist", "--no-warnings",
                     "-o", os.path.join(out_dir, "%(title).80s [%(id)s].%(ext)s"),
                     "--print", "after_move:filepath", url],
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    timeout=3600, creationflags=_KHONG_CUA_SO)
                p = [x for x in (r.stdout or "").splitlines() if x.strip()]
                if r.returncode != 0 or not p:
                    raise RuntimeError((r.stderr or "yt-dlp lỗi").strip()[-300:])
                v.update(status="xong", out_path=p[-1].strip(), msg="Xong")
                log("✅ Đã tải → %s" % p[-1].strip(), "INFO", "util")
            except Exception as e:
                v.update(status="loi", msg=str(e)[:300])
                log("❌ Tải lỗi: %s" % e, "LỖI", "util")

        threading.Thread(target=chay, daemon=True).start()
        return v

    def upscale(self, path: str, scale: int = 2, model: str = "") -> dict:
        if not os.path.isfile(path):
            raise RuntimeError("Không thấy file: %s" % path)
        if not os.path.isfile(REALESRGAN):
            raise RuntimeError("Không thấy realesrgan: %s (đặt PB_REALESRGAN)" % REALESRGAN)
        scale = 4 if int(scale or 2) >= 4 else 2
        v = self._moi("upscale", path)
        goc, duoi = os.path.splitext(path)
        la_video = duoi.lower() in (".mp4", ".mov", ".mkv", ".webm")

        def esrgan(vao: str, ra: str, ten_model: str):
            r = subprocess.run([REALESRGAN, "-i", vao, "-o", ra, "-s", str(scale),
                                "-n", ten_model, "-m", REALESRGAN_MODELS, "-f", "png"],
                               capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=6 * 3600, creationflags=_KHONG_CUA_SO,
                               cwd=os.path.dirname(REALESRGAN))
            if r.returncode != 0:
                raise RuntimeError((r.stderr or "realesrgan lỗi").strip()[-300:])

        def chay():
            tmp = os.path.join(REF_DIR, "upscale_" + v["id"])
            try:
                if not la_video:
                    ra = "%s_x%d.png" % (goc, scale)
                    log("⬆ Upscale ảnh x%d: %s" % (scale, os.path.basename(path)), "INFO", "util")
                    esrgan(path, ra, model or "realesrgan-x4plus")
                else:
                    ff = _exe("ffmpeg")
                    vao_dir, ra_dir = os.path.join(tmp, "in"), os.path.join(tmp, "out")
                    os.makedirs(vao_dir, exist_ok=True)
                    os.makedirs(ra_dir, exist_ok=True)
                    log("⬆ Upscale video x%d: tách khung %s" % (scale, os.path.basename(path)),
                        "INFO", "util")
                    v["msg"] = "Tách khung…"
                    fps = subprocess.run(
                        [_exe("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries",
                         "stream=r_frame_rate", "-of", "default=nw=1:nk=1", path],
                        capture_output=True, text=True,
                        creationflags=_KHONG_CUA_SO).stdout.strip() or "24"
                    subprocess.run([ff, "-y", "-v", "error", "-i", path,
                                    os.path.join(vao_dir, "%06d.png")],
                                   check=True, creationflags=_KHONG_CUA_SO)
                    v["msg"] = "Upscale %d khung…" % len(os.listdir(vao_dir))
                    log("   " + v["msg"], "INFO", "util")
                    esrgan(vao_dir, ra_dir, model or "realesr-animevideov3")
                    v["msg"] = "Ghép lại…"
                    ra = "%s_x%d.mp4" % (goc, scale)
                    subprocess.run([ff, "-y", "-v", "error", "-framerate", fps,
                                    "-i", os.path.join(ra_dir, "%06d.png"), "-i", path,
                                    "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-crf", "17",
                                    "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy",
                                    "-shortest", ra], check=True, creationflags=_KHONG_CUA_SO)
                v.update(status="xong", out_path=ra, msg="Xong")
                log("✅ Upscale xong → %s" % ra, "INFO", "util")
            except Exception as e:
                v.update(status="loi", msg=str(e)[:300])
                log("❌ Upscale lỗi: %s" % e, "LỖI", "util")
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

        threading.Thread(target=chay, daemon=True).start()
        return v


VIEC = ViecPhu()


def ve_tay(path: str, cfg: dict) -> dict:
    """Video vẽ tay từ một ảnh (scripts/draw_engine.py) — chạy nền như upscale."""
    if not os.path.isfile(path):
        raise RuntimeError("Không thấy ảnh: %s" % path)
    import draw_engine
    v = VIEC._moi("draw", path)
    ra = os.path.splitext(path)[0] + "_draw.mp4"

    def chay():
        try:
            def _f(k, mac_dinh):
                try:
                    return float(cfg.get(k, mac_dinh))
                except Exception:
                    return mac_dinh
            # Mặc định theo SuperVeo: 5s vẽ · 0s giữ · nét 4 · mực 80% · contour-wipe ·
            # nền #F6F1E3. Cách dựng tự chọn theo bàn tay (tay «đẩy hình» →
            # object_place, còn lại → stroke_reveal) như draw_motion_profile.
            draw_engine.render(
                path, ra,
                draw_sec=max(1.0, _f("drawSec", 5)), hold_sec=max(0.0, _f("holdSec", 0)),
                stroke_px=int(max(1, min(16, _f("strokePx", 4)))),
                ink_ratio=_f("pencilRatio", 80) / 100.0,
                color_mode="brush-reveal" if cfg.get("colorMode") == "brush" else "contour-wipe",
                renderer=str(cfg.get("renderer") or "auto"),
                bg=str(cfg.get("bgPreset") or "cream"),
                bg_color=str(cfg.get("bgColor") or draw_engine.MAU_NEN_SV),
                hand_id=str(cfg.get("handId") or ""),
                log=lambda m: log(m, "INFO", "util"))
            v.update(status="xong", out_path=ra, msg="Xong")
        except Exception as e:
            v.update(status="loi", msg=str(e)[:300])
            log("❌ Vẽ tay lỗi: %s" % e, "LỖI", "util")

    threading.Thread(target=chay, daemon=True).start()
    return v

# ───────────────────────── MiniApp ─────────────────────────
#
# Tab «MiniApp» của giao diện mới. Việc nặng (ffmpeg, realesrgan, yt-dlp,
# vẽ tay) chạy nền qua `VIEC` y như tải/upscale — loai bắt đầu bằng «mini-»
# để tab MiniApp lọc ra từ /api/util/jobs. Việc chữ (viết lại, dịch, kịch bản
# → prompt) gọi Gemini đồng bộ, dùng chung khoá Gemini của tool cũ.

OUT_MINI = os.path.join(OUT_MAC_DINH, "MiniApp")
DUOI_ANH = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
DUOI_VIDEO = (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v")
GEMINI_MODEL = os.environ.get("PB_GEMINI_MODEL") or "gemini-3.5-flash"


def chon_file(loai: str = "", goc: str = "") -> list[str]:
    """Hộp thoại chọn NHIỀU file — tiến trình riêng như `chon_thu_muc`."""
    kieu = {"video": "*.mp4 *.mov *.mkv *.webm *.avi *.m4v",
            "anh": "*.png *.jpg *.jpeg *.webp *.bmp",
            "chu": "*.txt *.srt *.vtt *.ass",
            "audio": "*.mp3 *.wav *.m4a *.aac *.ogg *.flac"}.get(loai, "*.*")
    code = ("import tkinter as tk, json, sys; from tkinter import filedialog as f; r=tk.Tk();"
            "r.withdraw(); r.attributes('-topmost', True);"
            "ds=f.askopenfilenames(initialdir=sys.argv[1] or None,"
            " filetypes=[('Tệp', sys.argv[2]), ('Tất cả', '*.*')]);"
            "print(json.dumps(list(ds)))")
    try:
        r = subprocess.run([sys.executable, "-c", code, goc or "", kieu], capture_output=True,
                           text=True, encoding="utf-8", timeout=600)
        return [p.replace("/", "\\") for p in json.loads((r.stdout or "[]").strip() or "[]")]
    except Exception:
        return []


def _thu_ra(out_dir: str, con: str) -> str:
    d = out_dir if (out_dir and os.path.isabs(out_dir)) else os.path.join(OUT_MINI, con)
    os.makedirs(d, exist_ok=True)
    return d


def _ds_file(paths, duoi) -> list[str]:
    """File hợp lệ trong danh sách — thư mục thì lấy các file bên trong."""
    ra = []
    for p in paths or []:
        p = str(p or "")
        if os.path.isdir(p):
            ra += sorted(os.path.join(p, x) for x in os.listdir(p) if x.lower().endswith(duoi))
        elif os.path.isfile(p) and p.lower().endswith(duoi):
            ra.append(p)
    return ra


def _thoi_luong(path: str) -> float:
    r = subprocess.run([_exe("ffprobe"), "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", path], capture_output=True, text=True,
                       creationflags=_KHONG_CUA_SO)
    try:
        return float((r.stdout or "0").strip())
    except ValueError:
        return 0.0


def _chay_nen(loai: str, nguon: str, out_dir: str, viec_fn, tag: str = "mini") -> dict:
    """Bọc một việc chạy nền vào VIEC: viec_fn(v) trả về đường dẫn kết quả.

    viec_fn tự đặt v["msg"] lúc chạy; xong mà msg vẫn là «…» thì thay bằng «Xong»."""
    v = VIEC._moi(loai, nguon)
    v["out_dir"] = out_dir

    def chay():
        try:
            ra = viec_fn(v)
            msg = v.get("msg") or ""
            v.update(status="xong", out_path=ra or "",
                     msg="Xong" if (not msg or msg.endswith("…")) else msg)
            log("✅ %s xong → %s" % (loai, ra or out_dir), "INFO", tag)
        except subprocess.CalledProcessError as e:
            v.update(status="loi", msg="ffmpeg lỗi (mã %s)" % e.returncode)
            log("❌ %s lỗi: %s" % (loai, e), "LỖI", tag)
        except Exception as e:
            v.update(status="loi", msg=str(e)[:300])
            log("❌ %s lỗi: %s" % (loai, e), "LỖI", tag)

    threading.Thread(target=chay, daemon=True).start()
    return v


def mini_cat_anh(paths, every: float, out_dir: str) -> dict:
    """Mỗi `every` giây lấy một khung PNG."""
    ds = _ds_file(paths, DUOI_VIDEO)
    if not ds:
        raise RuntimeError("Chưa chọn video")
    every = max(0.1, float(every or 1))
    out_dir = _thu_ra(out_dir, "Cat_anh")

    def viec(v):
        ff = _exe("ffmpeg")
        for i, p in enumerate(ds, 1):
            v["msg"] = "%d/%d · %s" % (i, len(ds), os.path.basename(p))
            ten = os.path.splitext(os.path.basename(p))[0]
            subprocess.run([ff, "-y", "-v", "error", "-i", p, "-vf", "fps=1/%g" % every,
                            os.path.join(out_dir, ten + "_%04d.png")],
                           check=True, creationflags=_KHONG_CUA_SO)
        v["msg"] = "Xong %d video" % len(ds)
        return ""

    log("✂ Cắt ảnh %d video · %gs/khung" % (len(ds), every), "INFO", "mini")
    return _chay_nen("mini-cut-img", ds[0], out_dir, viec)


def mini_cat_video(paths, mode: str, value: float, out_dir: str) -> dict:
    """mode «parts»: chia đều thành `value` phần · «secs»: mỗi phần `value` giây."""
    ds = _ds_file(paths, DUOI_VIDEO)
    if not ds:
        raise RuntimeError("Chưa chọn video")
    value = float(value or 0)
    if value <= 0:
        raise RuntimeError("Số phần / số giây phải > 0")
    out_dir = _thu_ra(out_dir, "Cat_video")

    def viec(v):
        ff = _exe("ffmpeg")
        for i, p in enumerate(ds, 1):
            v["msg"] = "%d/%d · %s" % (i, len(ds), os.path.basename(p))
            dai = _thoi_luong(p)
            if dai <= 0:
                raise RuntimeError("Không đọc được thời lượng: %s" % p)
            doan = dai / max(1, int(value)) if mode == "parts" else value
            goc, duoi = os.path.splitext(os.path.basename(p))
            # Cắt lại (không -c copy) để mỗi phần bắt đầu đúng giây, không lệch keyframe.
            subprocess.run([ff, "-y", "-v", "error", "-i", p, "-map", "0:v:0", "-map", "0:a?",
                            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
                            "-c:a", "aac", "-f", "segment", "-segment_time", "%.3f" % doan,
                            "-force_key_frames", "expr:gte(t,n_forced*%.3f)" % doan,
                            "-reset_timestamps", "1",
                            os.path.join(out_dir, goc + "_%03d" + (duoi or ".mp4"))],
                           check=True, creationflags=_KHONG_CUA_SO)
        v["msg"] = "Xong %d video" % len(ds)
        return ""

    log("🎞 Cắt video %d file · %s=%g" % (len(ds), mode, value), "INFO", "mini")
    return _chay_nen("mini-cut-vid", ds[0], out_dir, viec)


def mini_upscale(paths, scale: int, out_dir: str) -> dict:
    """Upscale ảnh hàng loạt — realesrgan chạy TUẦN TỰ, một tiến trình mỗi lúc."""
    ds = _ds_file(paths, DUOI_ANH)
    if not ds:
        raise RuntimeError("Chưa chọn ảnh")
    if not os.path.isfile(REALESRGAN):
        raise RuntimeError("Không thấy realesrgan: %s (đặt PB_REALESRGAN)" % REALESRGAN)
    scale = 4 if int(scale or 2) >= 4 else 2
    out_dir = _thu_ra(out_dir, "Upscale")

    def viec(v):
        for i, p in enumerate(ds, 1):
            v["msg"] = "%d/%d · %s" % (i, len(ds), os.path.basename(p))
            ra = os.path.join(out_dir, "%s_x%d.png" % (os.path.splitext(os.path.basename(p))[0], scale))
            r = subprocess.run([REALESRGAN, "-i", p, "-o", ra, "-s", str(scale),
                                "-n", "realesrgan-x4plus", "-m", REALESRGAN_MODELS, "-f", "png"],
                               capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=3600, creationflags=_KHONG_CUA_SO,
                               cwd=os.path.dirname(REALESRGAN))
            if r.returncode != 0:
                raise RuntimeError((r.stderr or "realesrgan lỗi").strip()[-300:])
        v["msg"] = "Xong %d ảnh" % len(ds)
        return ""

    log("⬆ Upscale %d ảnh x%d" % (len(ds), scale), "INFO", "mini")
    return _chay_nen("mini-upscale", ds[0], out_dir, viec)


def mini_tai_kenh(url: str, out_dir: str, limit: int = 0) -> dict:
    """Tải trọn kênh / playlist / link lẻ (yt-dlp, 1800+ nền tảng)."""
    if not re.match(r"https?://", url or ""):
        raise RuntimeError("Link không hợp lệ")
    out_dir = _thu_ra(out_dir, "Tai_kenh")

    def viec(v):
        lenh = [_exe("yt-dlp"), "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                "--merge-output-format", "mp4", "--yes-playlist", "--no-warnings",
                "--ignore-errors", "--download-archive", os.path.join(out_dir, "_da_tai.txt"),
                "-o", os.path.join(out_dir, "%(uploader).40s", "%(title).80s [%(id)s].%(ext)s"),
                "--print", "after_move:filepath"]
        if int(limit or 0) > 0:
            lenh += ["--playlist-end", str(int(limit))]
        p = subprocess.Popen(lenh + [url], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace",
                             creationflags=_KHONG_CUA_SO)
        n, cuoi = 0, ""
        for dong in p.stdout:
            dong = dong.strip()
            if os.path.isfile(dong):
                n += 1
                cuoi = dong
                v["msg"] = "Đã tải %d video" % n
                log("⬇ %s" % os.path.basename(dong), "INFO", "mini")
            elif dong.startswith("ERROR"):
                log("⚠ %s" % dong[:200], "INFO", "mini")
        p.wait()
        if n == 0 and p.returncode != 0:
            raise RuntimeError("yt-dlp không tải được video nào (xem nhật ký)")
        v["msg"] = "Đã tải %d video" % n
        return cuoi

    log("⬇ Tải kênh/playlist: %s" % url, "INFO", "mini")
    return _chay_nen("mini-yt-dl", url, out_dir, viec)


def mini_ve_tay(paths, cfg: dict) -> dict:
    """Whiteboard hàng loạt — mỗi ảnh một việc `ve_tay` (ra cạnh ảnh gốc)."""
    ds = _ds_file(paths, DUOI_ANH)
    if not ds:
        raise RuntimeError("Chưa chọn ảnh")
    return {"jobs": [ve_tay(p, cfg) for p in ds]}


def gemini_text(prompt: str, model: str = "") -> str:
    """Gọi Gemini generateContent; hết hạn mức / khoá hỏng thì xoay khoá kế."""
    import urllib.error
    import urllib.request
    keys = gemini_keys()
    if not keys:
        raise RuntimeError("Chưa có Gemini key — nhập ở Cài đặt › Tài khoản")
    model = model or GEMINI_MODEL
    body = json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}]}).encode("utf-8")
    loi = ""
    for k in keys:
        url = ("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s"
               % (model, k))
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        try:
            raw = urllib.request.urlopen(req, timeout=300).read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            loi = "HTTP %d: %s" % (e.code, e.read().decode("utf-8", "replace")[:200])
            if e.code in (400, 401, 403, 429, 500, 503):
                continue
            raise RuntimeError("Gemini " + loi)
        data = json.loads(raw)
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        chu = "".join(p.get("text") or "" for p in parts).strip()
        if chu:
            return chu
        loi = "Gemini không trả chữ (%s)" % (data.get("promptFeedback") or "rỗng")
    raise RuntimeError(loi or "Gemini lỗi")


def _bo_rao(chu: str) -> str:
    """Bỏ ```…``` nếu model bọc kết quả trong khối code."""
    m = re.match(r"^```[a-zA-Z]*\n(.*?)\n```$", chu.strip(), re.S)
    return m.group(1) if m else chu


def _chia_khuc(chu: str, tran: int = 8000) -> list[str]:
    """Chia theo dòng trống (giữ trọn khối SRT) — mỗi khúc ≤ `tran` ký tự."""
    khuc, cur = [], ""
    for khoi in re.split(r"\n\s*\n", chu.strip()):
        if cur and len(cur) + len(khoi) + 2 > tran:
            khuc.append(cur)
            cur = ""
        cur = (cur + "\n\n" + khoi) if cur else khoi
    if cur:
        khuc.append(cur)
    return khuc


def mini_viet_lai(d: dict) -> dict:
    script = str(d.get("script") or "").strip()
    if not script:
        raise RuntimeError("Chưa có kịch bản")
    lang = str(d.get("lang") or "auto")
    dur = int(d.get("dur") or 0)
    yeu_cau = [
        "Bạn là biên kịch YouTube. Viết lại kịch bản dưới đây thành bản MỚI, nguyên bản:",
        "giữ ý chính và thông tin, đổi hoàn toàn câu chữ và cấu trúc, mở bằng hook mạnh.",
        "Giọng điệu: %s." % (d.get("tone") or "tự nhiên"),
    ]
    if str(d.get("extra") or "").strip():
        yeu_cau.append("Yêu cầu phong cách: %s." % str(d["extra"]).strip().replace("\n", "; "))
    yeu_cau.append("Ngôn ngữ đầu ra: %s." % ("giữ ngôn ngữ của bản gốc" if lang == "auto" else lang))
    if dur > 0:
        yeu_cau.append("Độ dài khoảng %d phút đọc (~%d từ)." % (dur, dur * 150))
    yeu_cau.append("Chỉ trả về kịch bản, không giải thích, không markdown.")
    log("✏ Viết lại kịch bản (%d ký tự)" % len(script), "INFO", "mini")
    return {"text": _bo_rao(gemini_text("\n".join(yeu_cau) + "\n\n=== KỊCH BẢN GỐC ===\n" + script))}


def mini_dich(d: dict) -> dict:
    chu = str(d.get("text") or "").strip()
    lang = str(d.get("lang") or "").strip()
    if not chu or not lang:
        raise RuntimeError("Thiếu nội dung hoặc ngôn ngữ đích")
    la_phu_de = bool(re.search(r"\d\d:\d\d:\d\d[,.]\d{3}\s*-->", chu))
    luat = ("Đây là phụ đề: GIỮ NGUYÊN số thứ tự, mốc thời gian và số dòng, chỉ dịch phần lời."
            if la_phu_de else "Giữ nguyên xuống dòng và định dạng.")
    khuc = _chia_khuc(chu)
    log("🌐 Dịch → %s · %d khúc" % (lang, len(khuc)), "INFO", "mini")
    ra = [_bo_rao(gemini_text("Dịch sang %s. %s Chỉ trả về bản dịch.\n\n%s" % (lang, luat, k)))
          for k in khuc]
    return {"text": "\n\n".join(ra)}


def mini_kich_ban_prompt(d: dict) -> dict:
    """Kịch bản / SRT → danh sách cảnh, mỗi cảnh prompt ảnh + video (JSON)."""
    chu = str(d.get("text") or "").strip()
    if not chu:
        raise RuntimeError("Chưa có kịch bản")
    giay = int(d.get("clipSec") or 8)
    yeu_cau = (
        "Bạn là đạo diễn hình ảnh. Chia kịch bản/phụ đề dưới đây thành các cảnh khoảng %d giây. "
        "Giữ nhân vật, trang phục, bối cảnh NHẤT QUÁN giữa các cảnh. Phong cách: %s. "
        "Tỉ lệ khung: %s. Prompt viết bằng %s.\n"
        "Trả về DUY NHẤT JSON: {\"bible\": \"mô tả nhân vật/bối cảnh dùng chung\", "
        "\"scenes\": [{\"time\": \"00:00-00:08\", \"text\": \"lời thoại\", "
        "\"img\": \"prompt ảnh\", \"vid\": \"prompt video có chuyển động máy quay\"}]}\n\n%s"
        % (giay, d.get("style") or "cinematic", d.get("aspect") or "16:9",
           "tiếng Việt" if d.get("outLang") == "vi" else "English", chu))
    log("🎬 Kịch bản → prompt (%d ký tự)" % len(chu), "INFO", "mini")
    raw = _bo_rao(gemini_text(yeu_cau))
    m = re.search(r"\{.*\}", raw, re.S)
    try:
        data = json.loads(m.group(0) if m else raw)
    except ValueError:
        raise RuntimeError("Gemini không trả JSON hợp lệ — thử lại")
    return {"bible": str(data.get("bible") or ""), "scenes": list(data.get("scenes") or [])}


def doc_chu(path: str) -> str:
    """Đọc file chữ người dùng vừa chọn (txt/srt/vtt/ass) — tối đa 5 MB."""
    if not (os.path.isfile(path) and path.lower().endswith((".txt", ".srt", ".vtt", ".ass"))):
        raise RuntimeError("Không đọc được: %s" % path)
    if os.path.getsize(path) > 5 << 20:
        raise RuntimeError("File quá lớn (>5 MB)")
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        return f.read()


# ───────────────────────── Giọng đọc · phiên âm · cấu hình ─────────────────────────
#
# Dùng chung cho Voice, InVideo, Creator. Khoá Gemini / ElevenLabs đọc CHUNG
# cấu hình TTS của tool cũ (tts.load_config) — nhập một chỗ, tab nào cũng dùng.
# Khoá chỉ cầu nối mới cần (Pexels…) để riêng ở %LOCALAPPDATA%\PBMedia\pb_bridge.json.

CAU_HINH = os.path.join(LOCAL, "PBMedia", "pb_bridge.json")
GEMINI_TTS_MODEL = os.environ.get("PB_GEMINI_TTS_MODEL") or "gemini-2.5-flash-preview-tts"
_CH_LOCK = threading.Lock()


def cau_hinh(moi: dict | None = None) -> dict:
    with _CH_LOCK:
        try:
            with open(CAU_HINH, encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            cfg = {}
        if moi:
            cfg.update({k: v for k, v in moi.items() if isinstance(v, (str, int, float, bool))})
            os.makedirs(os.path.dirname(CAU_HINH), exist_ok=True)
            with open(CAU_HINH, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=1)
        return cfg


def _tts_cfg() -> dict:
    try:
        import tts
        return tts.load_config() or {}
    except Exception:
        return {}


def _ds_khoa(raw) -> list[str]:
    return [x.strip() for x in str(raw or "").replace(",", "\n").splitlines() if x.strip()]


def gemini_keys_an_toan() -> list[str]:
    try:
        return gemini_keys()
    except Exception:
        return []


def eleven_keys() -> list[str]:
    cfg = _tts_cfg()
    return _ds_khoa(cfg.get("eleven_keys") or cfg.get("eleven_key") or cau_hinh().get("eleven_keys"))


def _http_json(url: str, body: dict | None, headers: dict | None = None, timeout: int = 300):
    """POST/GET JSON → (mã, bytes). Không ném lỗi HTTP — để caller xoay khoá."""
    import urllib.error
    import urllib.request
    data = json.dumps(body).encode("utf-8") if body is not None else None
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _ghi_wav(path: str, pcm: bytes, rate: int = 24000) -> None:
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


def tts_gemini(text: str, voice: str, out_path: str, style: str = "") -> str:
    """Gemini TTS → WAV 24 kHz. Hết hạn mức thì xoay khoá; cả rổ hết thì chờ rồi thử lại."""
    keys = gemini_keys()
    if not keys:
        raise RuntimeError("Chưa có Gemini key — nhập ở Cài đặt › Tài khoản")
    loi = ""
    for vong in range(3):
        for k in keys:
            ma, raw = _http_json(
                "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s"
                % (GEMINI_TTS_MODEL, k),
                {"contents": [{"parts": [{"text": (style.strip() + "\n\n" if style.strip() else "") + text}]}],
                 "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {
                     "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice or "Kore"}}}}})
            if ma != 200:
                loi = "Gemini TTS HTTP %d: %s" % (ma, raw[:200].decode("utf-8", "replace"))
                continue
            data = json.loads(raw)
            parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
            b64 = next((p["inlineData"]["data"] for p in parts if p.get("inlineData")), "")
            if b64:
                _ghi_wav(out_path, base64.b64decode(b64))
                return out_path
            loi = "Gemini TTS không trả âm thanh"
        if "HTTP 429" in loi and vong < 2:
            log("⚠ Gemini TTS hết hạn mức — chờ 30s rồi thử lại", "INFO", "voice")
            time.sleep(30)
            continue
        break
    raise RuntimeError(loi)


ELEVEN_MODEL = {"v4": "eleven_v4", "v3": "eleven_v3", "flash": "eleven_flash_v2_5",
                "multilingual": "eleven_multilingual_v2"}


def tts_eleven(text: str, voice_id: str, out_path: str, model: str = "", lang: str = "") -> str:
    keys = eleven_keys()
    if not keys:
        raise RuntimeError("Chưa có ElevenLabs key — nhập ở Cài đặt › Tài khoản (tool cũ)")
    if not voice_id:
        raise RuntimeError("Chưa chọn giọng ElevenLabs")
    body = {"text": text, "model_id": ELEVEN_MODEL.get(model, model or "eleven_multilingual_v2")}
    if lang:
        body["language_code"] = lang
    loi = ""
    for k in keys:
        ma, raw = _http_json("https://api.elevenlabs.io/v1/text-to-speech/%s?output_format=mp3_44100_128"
                             % voice_id, body, {"xi-api-key": k, "Accept": "audio/mpeg"})
        if ma == 200 and len(raw) > 100:
            with open(out_path, "wb") as f:
                f.write(raw)
            return out_path
        loi = "ElevenLabs HTTP %d: %s" % (ma, raw[:200].decode("utf-8", "replace"))
    raise RuntimeError(loi)


def eleven_ds_giong() -> list[dict]:
    keys = eleven_keys()
    if not keys:
        raise RuntimeError("Chưa có ElevenLabs key")
    ma, raw = _http_json("https://api.elevenlabs.io/v2/voices?page_size=100", None,
                         {"xi-api-key": keys[0]}, timeout=60)
    if ma != 200:
        raise RuntimeError("ElevenLabs HTTP %d" % ma)
    ra = []
    for v in json.loads(raw).get("voices") or []:
        nhan = v.get("labels") or {}
        ra.append({"id": v.get("voice_id"), "name": v.get("name") or "",
                   "desc": ", ".join(str(x) for x in nhan.values() if x)[:80]})
    return ra


def tts_tao(engine: str, text: str, out_base: str, voice: str, d: dict | None = None) -> str:
    """Một đoạn văn → một file âm thanh (đuôi do engine quyết định). Trả đường dẫn."""
    d = d or {}
    text = (text or "").strip()
    if not text:
        raise RuntimeError("Đoạn văn trống")
    if engine == "gemini":
        return tts_gemini(text, voice, out_base + ".wav", str(d.get("style") or ""))
    if engine == "eleven":
        return tts_eleven(text, voice, out_base + ".mp3", str(d.get("model") or ""),
                          str(d.get("lang") or ""))
    raise RuntimeError("Engine «%s» chưa hỗ trợ" % engine)


def ffmpeg_ok() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def noi_audio(paths: list[str], out_path: str, gap_ms: int = 0) -> str:
    """Nối nhiều file âm thanh (wav/mp3 lẫn lộn) + khoảng lặng giữa các đoạn."""
    ff = _exe("ffmpeg")
    lenh = [ff, "-y", "-v", "error"]
    for p in paths:
        lenh += ["-i", p]
    loc, n = [], 0
    for i in range(len(paths)):
        loc.append("[%d:a]aresample=44100,aformat=channel_layouts=stereo[a%d]" % (i, n))
        n += 1
        if gap_ms > 0 and i < len(paths) - 1:
            loc.append("aevalsrc=0:c=stereo:s=44100:d=%.3f[a%d]" % (gap_ms / 1000.0, n))
            n += 1
    loc.append("".join("[a%d]" % i for i in range(n)) + "concat=n=%d:v=0:a=1[out]" % n)
    lenh += ["-filter_complex", ";".join(loc), "-map", "[out]"]
    lenh += ["-c:a", "libmp3lame", "-b:a", "192k"] if out_path.lower().endswith(".mp3") else []
    subprocess.run(lenh + [out_path], check=True, creationflags=_KHONG_CUA_SO)
    return out_path


def phien_am(path: str, lang: str = "") -> list[dict]:
    """Âm thanh/video → [{start, end, text}]. faster-whisper nếu có, không thì Gemini."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception:
        WhisperModel = None
    if WhisperModel is not None:
        ten = os.environ.get("PB_WHISPER_MODEL") or "large-v3-turbo"
        log("🎙 Whisper (%s) đang nghe %s…" % (ten, os.path.basename(path)), "INFO", "voice")
        model = WhisperModel(ten, device="auto", compute_type="auto")
        segs, _info = model.transcribe(path, language=(lang or None), vad_filter=True)
        return [{"start": float(s.start), "end": float(s.end), "text": s.text.strip()} for s in segs
                if s.text.strip()]
    # Gemini: nén về mp3 mono 32 kbps (1 giờ ≈ 14 MB, dưới trần inline 20 MB)
    keys = gemini_keys()
    if not keys:
        raise RuntimeError("Cần faster-whisper (bấm «AI Models») hoặc Gemini key để phiên âm")
    tmp = os.path.join(REF_DIR, "pa_%s.mp3" % uuid.uuid4().hex[:8])
    os.makedirs(REF_DIR, exist_ok=True)
    subprocess.run([_exe("ffmpeg"), "-y", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000",
                    "-b:a", "32k", tmp], check=True, creationflags=_KHONG_CUA_SO)
    try:
        with open(tmp, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    log("🎙 Gemini đang phiên âm %s…" % os.path.basename(path), "INFO", "voice")
    yeu_cau = ("Phiên âm chính xác lời nói trong file âm thanh, chia theo câu. Trả về DUY NHẤT JSON: "
               "[{\"start\": giây_bắt_đầu, \"end\": giây_kết_thúc, \"text\": \"câu\"}]")
    loi = ""
    for k in keys:
        ma, raw = _http_json(
            "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s"
            % (GEMINI_MODEL, k),
            {"contents": [{"parts": [{"inlineData": {"mimeType": "audio/mp3", "data": b64}},
                                     {"text": yeu_cau}]}],
             "generationConfig": {"responseMimeType": "application/json"}})
        if ma != 200:
            loi = "Gemini HTTP %d" % ma
            continue
        parts = ((json.loads(raw).get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        chu = _bo_rao("".join(p.get("text") or "" for p in parts))
        try:
            ds = json.loads(chu)
        except ValueError:
            loi = "Gemini trả phiên âm sai định dạng"
            continue
        return [{"start": float(x.get("start") or 0), "end": float(x.get("end") or 0),
                 "text": str(x.get("text") or "").strip()} for x in ds if str(x.get("text") or "").strip()]
    raise RuntimeError(loi or "Không phiên âm được")


def _giay_srt(t: float) -> str:
    ms = int(round(max(0.0, t) * 1000))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def ghi_srt(segs: list[dict], path: str) -> str:
    with open(path, "w", encoding="utf-8") as f:
        for i, s in enumerate(segs, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (i, _giay_srt(s["start"]), _giay_srt(s["end"]), s["text"]))
    return path


def doc_srt(path: str) -> list[dict]:
    """SRT/VTT → [{start, end, text}] (bỏ thẻ <…> của phụ đề tự động YouTube)."""
    chu = doc_chu(path) if path.lower().endswith((".srt", ".vtt")) else ""
    ra = []
    for khoi in re.split(r"\n\s*\n", chu.replace("\r", "")):
        m = re.search(r"(\d+):(\d\d):(\d\d)[,.](\d{3})\s*-->\s*(\d+):(\d\d):(\d\d)[,.](\d{3})", khoi)
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        dong = khoi[m.end():].strip().splitlines()
        text = re.sub(r"<[^>]+>", "", " ".join(x.strip() for x in dong if x.strip())).strip()
        if text and (not ra or ra[-1]["text"] != text):
            ra.append({"start": g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000,
                       "end": g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000, "text": text})
    return ra


def voice_lo(d: dict) -> dict:
    """Đọc cả lô đoạn văn TUẦN TỰ (khỏi đụng hạn mức) — tiến độ từng đoạn ở v["items"]."""
    engine = str(d.get("engine") or "gemini")
    voice = str(d.get("voice") or "")
    ds = [{"id": x.get("id"), "text": str(x.get("text") or "").strip(), "status": "cho",
           "path": "", "dur": 0.0, "msg": ""} for x in d.get("items") or [] if str(x.get("text") or "").strip()]
    if not ds:
        raise RuntimeError("Chưa có đoạn văn nào")
    out_dir = _thu_ra(str(d.get("out_dir") or ""), os.path.join("Voice", time.strftime("%Y%m%d_%H%M%S")))

    def viec(v):
        v["items"] = ds
        loi = 0
        for i, it in enumerate(ds, 1):
            it["status"] = "dang_chay"
            v["msg"] = "Đoạn %d/%d…" % (i, len(ds))
            try:
                p = tts_tao(engine, it["text"], os.path.join(out_dir, "%03d" % i), voice, d)
                it.update(status="xong", path=p, dur=round(_thoi_luong(p), 2))
            except Exception as e:
                loi += 1
                it.update(status="loi", msg=str(e)[:200])
                log("❌ Đoạn %d: %s" % (i, e), "LỖI", "voice")
        v["msg"] = "Xong %d/%d đoạn" % (len(ds) - loi, len(ds))
        if loi == len(ds):
            raise RuntimeError(ds[0]["msg"] or "Không đọc được đoạn nào")
        return ""

    log("🎤 %s · %s · %d đoạn" % (engine, voice, len(ds)), "INFO", "voice")
    return _chay_nen("voice", "%s · %s" % (engine, voice), out_dir, viec, "voice")


def voice_noi(paths, gap_ms: int, out_dir: str) -> dict:
    ds = [p for p in (paths or []) if os.path.isfile(str(p))]
    if not ds:
        raise RuntimeError("Chưa có đoạn nào đã đọc xong")
    out_dir = out_dir or os.path.dirname(ds[0])
    ra = os.path.join(out_dir, "noi_%s.mp3" % time.strftime("%H%M%S"))
    return _chay_nen("voice-noi", ds[0], out_dir,
                     lambda v: noi_audio(ds, ra, max(0, int(gap_ms or 0))), "voice")


# ───────────────────────── Ghép Video ─────────────────────────
#
# Nối clip trong một thư mục + nhạc nền + lặp video. Mỗi clip được dựng lại
# về cùng khung/fps/âm thanh trước khi nối (clip từ Veo/Flow/tải về khác
# nhau codec, có clip không tiếng) — nối thẳng bằng `-c copy` sẽ vỡ hình.

def _probe(path: str) -> dict:
    r = subprocess.run([_exe("ffprobe"), "-v", "error", "-print_format", "json",
                        "-show_format", "-show_streams", path],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       creationflags=_KHONG_CUA_SO)
    try:
        data = json.loads(r.stdout or "{}")
    except ValueError:
        data = {}
    v = next((s for s in data.get("streams") or [] if s.get("codec_type") == "video"), {})
    return {"dur": float((data.get("format") or {}).get("duration") or 0),
            "w": int(v.get("width") or 0), "h": int(v.get("height") or 0),
            "audio": any(s.get("codec_type") == "audio" for s in data.get("streams") or [])}


def ghep_ds(folder: str) -> list[dict]:
    if not os.path.isdir(folder):
        raise RuntimeError("Không thấy thư mục: %s" % folder)
    ra = []
    for p in _ds_file([folder], DUOI_VIDEO):
        info = _probe(p)
        ra.append({"path": p, "name": os.path.basename(p), "dur": info["dur"],
                   "w": info["w"], "h": info["h"], "size": os.path.getsize(p)})
    return ra


def ghep_video(paths, d: dict) -> dict:
    ds = [p for p in (paths or []) if os.path.isfile(str(p))]
    if not ds:
        raise RuntimeError("Chưa chọn video")
    nhac = str(d.get("music") or "")
    if nhac and not os.path.isfile(nhac):
        raise RuntimeError("Không thấy file nhạc: %s" % nhac)
    out_dir = _thu_ra(str(d.get("out_dir") or ""), "Ghep_video")
    ra = os.path.join(out_dir, "ghep_%s.mp4" % time.strftime("%Y%m%d_%H%M%S"))

    def viec(v):
        ff = _exe("ffmpeg")
        tmp = os.path.join(REF_DIR, "ghep_" + v["id"])
        os.makedirs(tmp, exist_ok=True)
        try:
            dau = _probe(ds[0])
            w, h = (dau["w"] or 1280) // 2 * 2, (dau["h"] or 720) // 2 * 2
            ds_tam = []
            for i, p in enumerate(ds, 1):
                v["msg"] = "Chuẩn hoá %d/%d · %s" % (i, len(ds), os.path.basename(p))
                info = _probe(p)
                tam = os.path.join(tmp, "%04d.mp4" % i)
                lenh = [ff, "-y", "-v", "error", "-i", p]
                if not info["audio"]:
                    lenh += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
                lenh += ["-vf", "scale=%d:%d:force_original_aspect_ratio=decrease,"
                                "pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" % (w, h, w, h),
                         "-map", "0:v:0", "-map", "0:a:0" if info["audio"] else "1:a:0",
                         "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                         "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", tam]
                subprocess.run(lenh, check=True, creationflags=_KHONG_CUA_SO)
                ds_tam.append(tam)
            ds_txt = os.path.join(tmp, "list.txt")
            with open(ds_txt, "w", encoding="utf-8") as f:
                f.writelines("file '%s'\n" % x.replace("\\", "/").replace("'", "'\\''") for x in ds_tam)
            noi = os.path.join(tmp, "noi.mp4")
            v["msg"] = "Nối %d clip…" % len(ds)
            subprocess.run([ff, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", ds_txt,
                            "-c", "copy", noi], check=True, creationflags=_KHONG_CUA_SO)

            # Lặp video tới đủ thời lượng mục tiêu
            if d.get("loopVideo") and float(d.get("targetSec") or 0) > 0:
                v["msg"] = "Lặp video…"
                lap = os.path.join(tmp, "lap.mp4")
                subprocess.run([ff, "-y", "-v", "error", "-stream_loop", "-1", "-i", noi,
                                "-t", "%.3f" % float(d["targetSec"]), "-c", "copy", lap],
                               check=True, creationflags=_KHONG_CUA_SO)
                noi = lap

            if not nhac:
                shutil.move(noi, ra)
                return ra
            v["msg"] = "Trộn nhạc nền…"
            vol = max(0.0, min(2.0, float(d.get("vol") if d.get("vol") is not None else 100) / 100.0))
            lenh = [ff, "-y", "-v", "error", "-i", noi]
            if d.get("loopAudio", True):
                lenh += ["-stream_loop", "-1"]
            lenh += ["-i", nhac]
            if d.get("muteOrig", True):
                loc = "[1:a]volume=%.2f[a]" % vol
            else:
                loc = ("[1:a]volume=%.2f[m];[0:a][m]amix=inputs=2:duration=first:"
                       "dropout_transition=0:normalize=0[a]" % vol)
            # Nhạc không lặp mà ngắn hơn video → hết nhạc thì im, video vẫn chạy đủ
            loc = loc.replace("[1:a]volume", "[1:a]apad,volume") if not d.get("loopAudio", True) else loc
            lenh += ["-filter_complex", loc, "-map", "0:v", "-map", "[a]", "-c:v", "copy",
                     "-c:a", "aac", "-shortest", ra]
            subprocess.run(lenh, check=True, creationflags=_KHONG_CUA_SO)
            return ra
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    log("▦ Ghép %d clip%s" % (len(ds), " + nhạc" if nhac else ""), "INFO", "ghep")
    return _chay_nen("ghep", ds[0], out_dir, viec, "ghep")


# ───────────────────────── InVideo ─────────────────────────
#
# Video tự động kiểu InVideo: lời (ý tưởng / kịch bản / audio / link / lồng
# tiếng) → cảnh → ảnh/video stock Pexels (hoặc video nền) → chuyển cảnh xfade
# → phụ đề cứng → MP4. Mọi bước chạy trong một việc nền «invideo».

OUT_INVIDEO = os.path.join(OUT_MAC_DINH, "InVideo")
KHUNG = {"doc": (1080, 1920), "ngang": (1920, 1080), "vuong": (1080, 1080)}
HUONG_PEXELS = {"doc": "portrait", "ngang": "landscape", "vuong": "square"}
MA_NGON_NGU = {"Tiếng Việt": "vi", "English": "en", "中文": "zh", "日本語": "ja", "한국어": "ko",
               "Español": "es", "Français": "fr"}
# Tên hiệu ứng giao diện → transition của ffmpeg xfade
XFADE = {"fade": "fade", "fade_black": "fadeblack", "fade_gray": "fadegrays",
         "wipe_left": "wipeleft", "wipe_right": "wiperight", "wipe_up": "wipeup",
         "wipe_down": "wipedown", "dir_wipe": "diagtl", "slide": "slideleft", "wind": "hlwind",
         "crosswarp": "distance", "zoom_in": "zoomin", "zoom_out": "squeezeh", "blur": "hblur",
         "pixelate": "pixelize", "circle": "circleopen", "diamond": "rectcrop",
         "clock": "radial", "radial": "radial"}
T_CHUYEN = 0.5


def _tai_url(url: str, dich: str, headers: dict | None = None) -> str:
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r, open(dich, "wb") as f:
        shutil.copyfileobj(r, f)
    return dich


def pexels_tim(q: str, video: bool, ratio: str) -> str:
    """URL tải ảnh/video Pexels khớp từ khoá + hướng khung. '' nếu không thấy."""
    import urllib.parse
    key = str(cau_hinh().get("pexels_key") or os.environ.get("PB_PEXELS_KEY") or "")
    if not key:
        raise RuntimeError("Chưa có Pexels API key — nhập ở InVideo › AI Models (miễn phí tại pexels.com/api)")
    url = ("https://api.pexels.com/%s/search?query=%s&orientation=%s&per_page=8" % (
        "videos" if video else "v1", urllib.parse.quote(q), HUONG_PEXELS.get(ratio, "portrait")))
    ma, raw = _http_json(url, None, {"Authorization": key}, timeout=60)
    if ma != 200:
        raise RuntimeError("Pexels HTTP %d" % ma)
    data = json.loads(raw)
    if not video:
        ds = data.get("photos") or []
        return ((ds[0].get("src") or {}).get("large2x") or "") if ds else ""
    for v in data.get("videos") or []:
        tep = sorted((f for f in v.get("video_files") or [] if f.get("file_type") == "video/mp4"),
                     key=lambda f: abs((f.get("height") or 0) - 1080))
        if tep:
            return tep[0]["link"]
    return ""


def _chia_canh(text: str, toi_da_tu: int = 22) -> list[str]:
    """Văn → cảnh: gom câu tới ~toi_da_tu từ mỗi cảnh."""
    cau = [c.strip() for c in re.split(r"(?<=[.!?。！？…])\s+|\n+", text) if c.strip()]
    canh, cur = [], ""
    for c in cau:
        if cur and len((cur + " " + c).split()) > toi_da_tu:
            canh.append(cur)
            cur = c
        else:
            cur = (cur + " " + c).strip()
    if cur:
        canh.append(cur)
    return canh


def _gom_doan(segs: list[dict], toi_thieu: float = 4.0, toi_da: float = 9.0) -> list[dict]:
    """Câu phiên âm có mốc → cảnh 4–9 giây, nối liền (cảnh sau bắt đầu đúng chỗ cảnh trước hết)."""
    canh = []
    for s in segs:
        if canh and (s["end"] - canh[-1]["start"] <= toi_da or canh[-1]["end"] - canh[-1]["start"] < toi_thieu):
            canh[-1]["end"] = s["end"]
            canh[-1]["text"] += " " + s["text"]
            canh[-1]["caps"].append(dict(s))
        else:
            canh.append({"start": s["start"], "end": s["end"], "text": s["text"], "caps": [dict(s)]})
    if canh:
        canh[0]["start"] = 0.0
        for a, b in zip(canh, canh[1:]):
            a["end"] = b["start"]
    return canh


def _tu_khoa(texts: list[str]) -> list[str]:
    """Mỗi cảnh một cụm từ khoá tiếng Anh để tìm stock. Không có Gemini thì lấy chữ đầu câu."""
    try:
        raw = gemini_text(
            "For each numbered narration line, give ONE short English stock-footage search query "
            "(2-4 concrete visual words). Return ONLY a JSON array of strings, same order.\n\n"
            + "\n".join("%d. %s" % (i + 1, t) for i, t in enumerate(texts)))
        m = re.search(r"\[.*\]", _bo_rao(raw), re.S)
        ds = json.loads(m.group(0) if m else raw)
        if len(ds) == len(texts):
            return [str(x) for x in ds]
    except Exception as e:
        log("⚠ Không lấy được từ khoá bằng Gemini: %s" % e, "INFO", "invideo")
    return [" ".join(t.split()[:4]) for t in texts]


def _cat_phu_de(canh: list[dict], toi_da_tu: int = 7) -> list[dict]:
    """Phụ đề ngắn: chia lời mỗi cảnh thành cụm ≤ toi_da_tu từ, thời gian chia theo số ký tự."""
    ra = []
    for c in canh:
        for cap in c.get("caps") or [c]:
            tu = cap["text"].split()
            cum = [" ".join(tu[i:i + toi_da_tu]) for i in range(0, len(tu), toi_da_tu)] or [""]
            tong = sum(len(x) for x in cum) or 1
            t = cap["start"]
            for x in cum:
                dai = (cap["end"] - cap["start"]) * len(x) / tong
                ra.append({"start": t, "end": t + dai, "text": x})
                t += dai
    return [x for x in ra if x["text"]]


def _dung_canh(src: str, la_anh: bool, L: float, w: int, h: int, out: str) -> None:
    ff = _exe("ffmpeg")
    if not src:
        lenh = [ff, "-y", "-v", "error", "-f", "lavfi", "-i",
                "gradients=s=%dx%d:c0=0x0f172a:c1=0x1e3a8a:speed=0.01:d=%.3f:r=30" % (w, h, L)]
    elif la_anh:
        n = max(1, int(round(L * 30)))
        lenh = [ff, "-y", "-v", "error", "-i", src, "-vf",
                "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,"
                "zoompan=z='min(zoom+0.0007,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                ":d=%d:s=%dx%d:fps=30" % (w * 2, h * 2, w * 2, h * 2, n, w, h), "-frames:v", str(n)]
    else:
        lenh = [ff, "-y", "-v", "error", "-stream_loop", "-1", "-i", src, "-t", "%.3f" % L, "-vf",
                "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,fps=30" % (w, h, w, h)]
    lenh += ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
             "-r", "30", "-t", "%.3f" % L, out]
    subprocess.run(lenh, check=True, creationflags=_KHONG_CUA_SO)


def _noi_hinh(clips: list[str], durs: list[float], trans: str, out: str) -> None:
    """Nối các clip hình. Mỗi clip (trừ cuối) dài hơn cảnh T_CHUYEN giây để xfade ăn vào."""
    ff = _exe("ffmpeg")
    if trans == "none" or len(clips) == 1:
        ds = out + ".txt"
        with open(ds, "w", encoding="utf-8") as f:
            f.writelines("file '%s'\n" % c.replace("\\", "/") for c in clips)
        subprocess.run([ff, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", ds, "-c", "copy", out],
                       check=True, creationflags=_KHONG_CUA_SO)
        return
    loai = XFADE.get(trans, "fade")
    lenh = [ff, "-y", "-v", "error"]
    for c in clips:
        lenh += ["-i", c]
    loc, truoc, moc = [], "[0:v]", 0.0
    for i in range(1, len(clips)):
        moc += durs[i - 1]
        nhan = "[x%d]" % i
        loc.append("%s[%d:v]xfade=transition=%s:duration=%.3f:offset=%.3f%s" % (
            truoc, i, loai, T_CHUYEN, moc, nhan))
        truoc = nhan
    lenh += ["-filter_complex", ";".join(loc), "-map", truoc, "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "20", "-pix_fmt", "yuv420p", out]
    subprocess.run(lenh, check=True, creationflags=_KHONG_CUA_SO)


def _xuat(hinh: str, am: str, caps: list[dict], d: dict, w: int, h: int, tmp: str, ra: str) -> None:
    """Hình + tiếng + phụ đề cứng (+ sóng âm) → file cuối."""
    ff = _exe("ffmpeg")
    ghi_srt(caps, os.path.join(tmp, "cap.srt"))
    giua = d.get("media") == "gameplay"
    # FontSize tính theo PlayResY 288 mặc định của libass cho SRT — khung dọc chữ nhỏ lại
    co = 13 if h > w else 18
    kieu = ("FontName=Arial,FontSize=%d,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
            "BorderStyle=1,Outline=2,Shadow=1,Alignment=%d,MarginV=%d" % (co, 5 if giua else 2, 30))
    if d.get("wave") and am:
        loc = ("[0:v]subtitles=cap.srt:force_style='%s'[v0];"
               "[1:a]showwaves=s=%dx%d:mode=cline:colors=white@0.85,format=rgba[w];"
               "[v0][w]overlay=0:%d[v]" % (kieu, w, h // 7, int(h * 0.72)))
    else:
        loc = "[0:v]subtitles=cap.srt:force_style='%s'[v]" % kieu
    lenh = [ff, "-y", "-v", "error", "-i", hinh] + (["-i", am] if am else [])
    lenh += ["-filter_complex", loc, "-map", "[v]"] + (["-map", "1:a"] if am else [])
    lenh += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", ra]
    # cwd=tmp: «cap.srt» khỏi phải thoát dấu «:» của ổ đĩa Windows trong filter
    subprocess.run(lenh, check=True, creationflags=_KHONG_CUA_SO, cwd=tmp)


def _tai_link(url: str, tmp: str, lang: str) -> tuple[str, list[dict]]:
    """yt-dlp: video + phụ đề (nếu có) → (đường dẫn mp4, câu phụ đề)."""
    ma = MA_NGON_NGU.get(lang, "en")
    subprocess.run([_exe("yt-dlp"), "-f", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b",
                    "--merge-output-format", "mp4", "--no-playlist", "--no-warnings",
                    "--write-subs", "--write-auto-subs", "--sub-langs", "%s.*,%s" % (ma, ma),
                    "--convert-subs", "srt", "-o", os.path.join(tmp, "src.%(ext)s"), url],
                   check=True, creationflags=_KHONG_CUA_SO, capture_output=True)
    vid = os.path.join(tmp, "src.mp4")
    if not os.path.isfile(vid):
        raise RuntimeError("yt-dlp không tải được video")
    srt = next((os.path.join(tmp, f) for f in os.listdir(tmp) if f.endswith(".srt")), "")
    return vid, (doc_srt(srt) if srt else [])


def _doc_canh(canh: list[dict], voice: str, tmp: str, v: dict) -> str:
    """TTS từng cảnh → gán start/end theo độ dài tiếng, trả file tiếng đã nối."""
    t, ds = 0.0, []
    for i, c in enumerate(canh, 1):
        v["msg"] = "Đọc giọng %d/%d…" % (i, len(canh))
        p = tts_tao("gemini", c["text"], os.path.join(tmp, "tts_%03d" % i), voice)
        dai = _thoi_luong(p)
        c.update(start=t, end=t + dai)
        c["caps"] = [{"start": t, "end": t + dai, "text": c["text"]}]
        t += dai
        ds.append(p)
    return noi_audio(ds, os.path.join(tmp, "loi.wav"))


def invideo_tao(d: dict) -> dict:
    kieu = str(d.get("input") or "script")
    ratio = d.get("ratio") if d.get("ratio") in KHUNG else "doc"
    w, h = KHUNG[ratio]
    if kieu == "audio" and not os.path.isfile(str(d.get("audio") or "")):
        raise RuntimeError("Chưa chọn file âm thanh")
    if kieu in ("link", "dub") and not str(d.get("link") or "").strip():
        raise RuntimeError("Chưa có link / file nguồn")
    if kieu in ("idea", "script") and not str(d.get("text") or "").strip():
        raise RuntimeError("Chưa nhập nội dung")
    if d.get("media") == "gameplay" and kieu != "dub" and not os.path.isfile(str(d.get("bg") or "")):
        raise RuntimeError("Chưa chọn video nền")
    os.makedirs(OUT_INVIDEO, exist_ok=True)
    goc = str(d.get("title") or d.get("text") or d.get("link") or d.get("audio") or "video")
    if os.path.isfile(goc):
        goc = os.path.splitext(os.path.basename(goc))[0]
    elif re.match(r"https?://", goc):
        goc = re.sub(r"^https?://(www\.)?", "", goc)
    nhan = re.sub(r'[\\/:*?"<>|\s]+', " ", goc)[:50].strip(" .") or "video"
    ra = os.path.join(OUT_INVIDEO, "%s_%s.mp4" % (time.strftime("%Y%m%d_%H%M%S"), nhan))
    voice = str(d.get("voice") or "Kore")
    lang = str(d.get("lang") or "Tiếng Việt")

    def viec(v):
        tmp = os.path.join(REF_DIR, "invideo_" + v["id"])
        os.makedirs(tmp, exist_ok=True)
        try:
            # ── 1. Lời & cảnh ──
            am, nen_goc = "", ""
            if kieu == "dub":
                return _long_tieng(d, tmp, ra, v, w, h, voice, lang)
            if kieu in ("idea", "script"):
                text = str(d["text"]).strip()
                if kieu == "idea":
                    v["msg"] = "Gemini viết kịch bản…"
                    text = _bo_rao(gemini_text(
                        "Viết lời dẫn cho video ngắn ~60–90 giây bằng %s từ ý tưởng dưới đây. Mở bằng "
                        "hook mạnh, câu ngắn dễ đọc to, không tiêu đề, không markdown, không ghi chú "
                        "cảnh — chỉ lời đọc.\n\nÝ tưởng: %s" % (lang, text)))
                canh = [{"text": t} for t in _chia_canh(text)]
                am = _doc_canh(canh, voice, tmp, v)
            elif kieu == "audio":
                v["msg"] = "Phiên âm audio…"
                am = str(d["audio"])
                canh = _gom_doan(phien_am(am))
                if canh:
                    canh[-1]["end"] = max(canh[-1]["end"], _thoi_luong(am))
            else:  # link
                v["msg"] = "Tải video từ link…"
                nguon, segs = _tai_link(str(d["link"]).strip(), tmp, lang)
                if not segs:
                    v["msg"] = "Không có phụ đề — phiên âm…"
                    segs = phien_am(nguon)
                if d.get("audioSrc") == "original":
                    am = os.path.join(tmp, "goc.m4a")
                    subprocess.run([_exe("ffmpeg"), "-y", "-v", "error", "-i", nguon, "-vn", "-c:a", "aac",
                                    am], check=True, creationflags=_KHONG_CUA_SO)
                    canh = _gom_doan(segs)
                    if canh:
                        canh[-1]["end"] = max(canh[-1]["end"], _thoi_luong(am))
                else:
                    canh = [{"text": c["text"]} for c in _gom_doan(segs)]
                    am = _doc_canh(canh, voice, tmp, v)
            if not canh:
                raise RuntimeError("Không có lời nào để dựng video")

            # ── 2. Hình mỗi cảnh ──
            durs = [max(0.5, c["end"] - c["start"]) for c in canh]
            if d.get("media") == "gameplay":
                v["msg"] = "Dựng video nền…"
                hinh = os.path.join(tmp, "hinh.mp4")
                _dung_canh(str(d["bg"]), False, sum(durs), w, h, hinh)
            else:
                la_video = d.get("media") == "stock_vid"
                v["msg"] = "Tìm từ khoá stock…"
                tu = _tu_khoa([c["text"] for c in canh])
                clips = []
                for i, (c, q) in enumerate(zip(canh, tu), 1):
                    v["msg"] = "Cảnh %d/%d · %s" % (i, len(canh), q)
                    src = ""
                    try:
                        url = pexels_tim(q, la_video, ratio)
                        if url:
                            src = _tai_url(url, os.path.join(tmp, "src_%03d%s" % (i, ".mp4" if la_video else ".jpg")))
                    except RuntimeError:
                        raise
                    except Exception as e:
                        log("⚠ Cảnh %d không tải được stock «%s»: %s" % (i, q, e), "INFO", "invideo")
                    L = durs[i - 1] + (T_CHUYEN if (i < len(canh) and d.get("trans") != "none") else 0)
                    clip = os.path.join(tmp, "clip_%03d.mp4" % i)
                    _dung_canh(src, not la_video, L, w, h, clip)
                    clips.append(clip)
                v["msg"] = "Nối cảnh + chuyển cảnh…"
                hinh = os.path.join(tmp, "hinh.mp4")
                _noi_hinh(clips, durs, str(d.get("trans") or "fade"), hinh)

            # ── 3. Xuất ──
            v["msg"] = "Xuất video + phụ đề…"
            _xuat(hinh, am, _cat_phu_de(canh), d, w, h, tmp, ra)
            with open(os.path.splitext(ra)[0] + ".txt", "w", encoding="utf-8") as f:
                f.write("\n".join(c["text"] for c in canh))
            v["msg"] = "Xong · %d cảnh · %.1fs" % (len(canh), sum(durs))
            return ra
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    log("🎬 InVideo: %s · %s · %s" % (kieu, d.get("media"), ratio), "INFO", "invideo")
    return _chay_nen("invideo", nhan, OUT_INVIDEO, viec, "invideo")


def _long_tieng(d: dict, tmp: str, ra: str, v: dict, w: int, h: int, voice: str, lang: str) -> str:
    """Dịch & lồng tiếng: giữ hình gốc, thay tiếng bằng giọng đọc bản dịch đặt đúng mốc."""
    nguon = str(d["link"]).strip()
    if re.match(r"https?://", nguon):
        v["msg"] = "Tải video…"
        nguon, segs = _tai_link(nguon, tmp, "English")
    elif os.path.isfile(nguon):
        segs = []
    else:
        raise RuntimeError("Không thấy file: %s" % nguon)
    if not segs:
        v["msg"] = "Phiên âm…"
        segs = phien_am(nguon)
    if not segs:
        raise RuntimeError("Không nghe được lời nào")
    v["msg"] = "Dịch %d câu sang %s…" % (len(segs), lang)
    raw = _bo_rao(gemini_text(
        "Dịch từng dòng sang %s, giữ nghĩa, ngắn gọn để đọc vừa thời lượng. Trả về DUY NHẤT JSON "
        "mảng chuỗi, đúng số dòng và thứ tự.\n\n%s" % (
            lang, "\n".join("%d. %s" % (i + 1, s["text"]) for i, s in enumerate(segs)))))
    m = re.search(r"\[.*\]", raw, re.S)
    dich = json.loads(m.group(0) if m else raw)
    if len(dich) != len(segs):
        raise RuntimeError("Gemini dịch lệch số dòng (%d/%d) — thử lại" % (len(dich), len(segs)))
    ff = _exe("ffmpeg")
    vao, loc = [], []
    for i, (s, t) in enumerate(zip(segs, dich)):
        v["msg"] = "Lồng tiếng %d/%d…" % (i + 1, len(segs))
        s["text"] = str(t)
        p = tts_tao("gemini", s["text"], os.path.join(tmp, "dub_%03d" % i), voice)
        o = max(0.3, (segs[i + 1]["start"] if i + 1 < len(segs) else s["end"] + 1.5) - s["start"])
        nhanh = min(1.6, max(1.0, _thoi_luong(p) / o))
        vao += ["-i", p]
        loc.append("[%d:a]atempo=%.3f,adelay=%d:all=1[d%d]" % (i, nhanh, int(s["start"] * 1000), i))
    loc.append("".join("[d%d]" % i for i in range(len(segs)))
               + "amix=inputs=%d:normalize=0:dropout_transition=0[a]" % len(segs))
    am = os.path.join(tmp, "dub.wav")
    subprocess.run([ff, "-y", "-v", "error", *vao, "-filter_complex", ";".join(loc), "-map", "[a]", am],
                   check=True, creationflags=_KHONG_CUA_SO)
    info = _probe(nguon)
    w, h = (info["w"] or w) // 2 * 2, (info["h"] or h) // 2 * 2
    hinh = os.path.join(tmp, "hinh.mp4")
    subprocess.run([ff, "-y", "-v", "error", "-i", nguon, "-an", "-vf", "scale=%d:%d" % (w, h),
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", hinh],
                   check=True, creationflags=_KHONG_CUA_SO)
    # amix ngắn hơn video → đệm im lặng cho đủ, khỏi bị -shortest cắt hình
    am2 = os.path.join(tmp, "dub_pad.wav")
    subprocess.run([ff, "-y", "-v", "error", "-i", am, "-af", "apad", "-t", "%.3f" % info["dur"], am2],
                   check=True, creationflags=_KHONG_CUA_SO)
    v["msg"] = "Xuất video lồng tiếng…"
    _xuat(hinh, am2, _cat_phu_de([{"start": s["start"], "end": s["end"], "text": s["text"]} for s in segs]),
          {**d, "media": "dub"}, w, h, tmp, ra)
    v["msg"] = "Xong · lồng tiếng %d câu" % len(segs)
    return ra


def invideo_ds() -> list[dict]:
    if not os.path.isdir(OUT_INVIDEO):
        return []
    ra = []
    for f in os.listdir(OUT_INVIDEO):
        p = os.path.join(OUT_INVIDEO, f)
        if f.lower().endswith(".mp4") and os.path.isfile(p):
            ra.append({"path": p, "name": f, "t": os.path.getmtime(p), "size": os.path.getsize(p)})
    return sorted(ra, key=lambda x: -x["t"])


def invideo_trang_thai() -> dict:
    try:
        import faster_whisper  # type: ignore  # noqa: F401
        whisper = True
    except Exception:
        whisper = False
    cfg = cau_hinh()
    return {"ffmpeg": ffmpeg_ok(), "ytdlp": bool(shutil.which("yt-dlp")), "deno": bool(shutil.which("deno")),
            "whisper": whisper, "gemini": len(gemini_keys_an_toan()),
            "pexels": bool(cfg.get("pexels_key") or os.environ.get("PB_PEXELS_KEY"))}


def invideo_cai_whisper() -> dict:
    """pip install faster-whisper + tải trước model — một việc nền."""
    def viec(v):
        v["msg"] = "pip install faster-whisper…"
        r = subprocess.run([sys.executable, "-m", "pip", "install", "-U", "faster-whisper"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace",
                           creationflags=_KHONG_CUA_SO)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or "pip lỗi").strip()[-300:])
        ten = os.environ.get("PB_WHISPER_MODEL") or "large-v3-turbo"
        v["msg"] = "Tải model %s (~800 MB)…" % ten
        r = subprocess.run([sys.executable, "-c", "from faster_whisper import WhisperModel as W; W(%r)" % ten],
                           capture_output=True, text=True, encoding="utf-8", errors="replace",
                           creationflags=_KHONG_CUA_SO)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or "tải model lỗi").strip()[-300:])
        v["msg"] = "Whisper sẵn sàng"
        return ""
    return _chay_nen("invideo-setup", "faster-whisper", "", viec, "invideo")


# ───────────────────────── tiện ích ─────────────────────────

def chon_thu_muc(goc: str = "") -> str:
    """Hộp thoại chọn thư mục của Windows — chạy ở tiến trình riêng cho Tk khỏi kẹt."""
    code = ("import tkinter as tk; from tkinter import filedialog as f; r=tk.Tk(); r.withdraw();"
            "r.attributes('-topmost', True); import sys;"
            "print(f.askdirectory(initialdir=sys.argv[1] or None) or '')")
    try:
        r = subprocess.run([sys.executable, "-c", code, goc or ""], capture_output=True,
                           text=True, encoding="utf-8", timeout=600)
        return (r.stdout or "").strip().replace("/", "\\")
    except Exception:
        return ""


def luu_ref(ten: str, du_lieu_b64: str) -> dict:
    os.makedirs(REF_DIR, exist_ok=True)
    ten = re.sub(r'[\\/:*?"<>|]+', "_", os.path.basename(ten or "anh.png"))
    raw = base64.b64decode(du_lieu_b64.split(",", 1)[-1])
    p = os.path.join(REF_DIR, ten)
    with open(p, "wb") as f:
        f.write(raw)
    return {"path": p, "name": ten, "tag": "@" + ma_cua_anh(ten)}


def han_muc_gan_nhat() -> list[dict]:
    try:
        import google_vids_api as gva
        so = os.path.join(os.path.dirname(gva.vids_theo_tk_path()), "_vids_quota_log.jsonl")
        with open(so, encoding="utf-8") as f:
            dong = f.readlines()[-20:]
        return [json.loads(x) for x in dong if x.strip()]
    except Exception:
        return []


# ───────────────────────── HTTP ─────────────────────────

class XuLy(BaseHTTPRequestHandler):
    server_version = "PBBridge/1"

    def log_message(self, *a):
        pass

    def _json(self, code: int, obj) -> None:
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception:
            return {}

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == "/api/health":
                return self._json(200, {"ok": True, "tool_dir": TOOL_DIR, "pid": os.getpid()})
            if u.path == "/api/accounts":
                return self._json(200, {"ok": True, "accounts": ds_tai_khoan()})
            if u.path == "/api/logs":
                tu = int((q.get("since") or ["0"])[0] or 0)
                with _LOG_LOCK:
                    ra = [x for x in _LOG if x["id"] > tu]
                return self._json(200, {"ok": True, "logs": ra[-500:]})
            if u.path == "/api/vids/jobs":
                return self._json(200, {"ok": True, "jobs": HANG.danh_sach()})
            if u.path == "/api/vids/quota":
                return self._json(200, {"ok": True, "items": han_muc_gan_nhat()})
            if u.path == "/api/tube/search":
                qq = (q.get("q") or [""])[0].strip()
                if not qq:
                    return self._json(400, {"ok": False, "error": "Thiếu từ khoá"})
                return self._json(200, {"ok": True, "items": tube_search(qq, int((q.get("n") or ["30"])[0]))})
            if u.path == "/api/tube/suggest":
                qq = (q.get("q") or [""])[0].strip()
                return self._json(200, {"ok": True, "items": tube_suggest(qq, (q.get("gl") or ["US"])[0])})
            if u.path == "/api/config/gemini":
                ds = gemini_keys()
                che = [(k[:6] + "…" + k[-4:]) if len(k) > 12 else "…" for k in ds]
                return self._json(200, {"ok": True, "n": len(ds), "keys": che})
            if u.path == "/api/util/jobs":
                return self._json(200, {"ok": True, "jobs": VIEC.danh_sach()})
            if u.path == "/api/muse/jobs":
                return self._json(200, {"ok": True, "jobs": MUSE.danh_sach(),
                                        "running": MUSE.chay})
            if u.path == "/api/flow/state":
                kind = (q.get("kind") or ["anh"])[0]
                return self._json(200, {"ok": True, **FLOW.trang_thai(kind)})
            if u.path == "/api/file":
                p = (q.get("path") or [""])[0]
                # Chỉ phát file mà CHÍNH cầu nối vừa tạo ra — không mở cửa đọc
                # file tuỳ ý trên máy.
                cho_phep = {j.get("out_path") for j in HANG.jobs.values()}
                cho_phep.update(j.get("out_path") for j in MUSE.jobs.values())
                cho_phep.update(v.get("out_path") for v in VIEC.viec.values())
                for v in list(VIEC.viec.values()):
                    cho_phep.update(x.get("path") for x in v.get("items") or [])
                with FLOW.lock:
                    for v in FLOW.items.values():
                        cho_phep.update(v.get("files") or [])
                        if v["status"] == "xong":
                            cho_phep.update(FLOW._file_canh(v["out_dir"], v["scene"], v["kind"]))
                trong_out = os.path.abspath(p).startswith(os.path.abspath(OUT_MAC_DINH) + os.sep)
                if (p not in cho_phep and not trong_out) or not os.path.isfile(p):
                    return self._json(404, {"ok": False})
                with open(p, "rb") as f:
                    b = f.read()
                kieu = {".mp4": "video/mp4", ".png": "image/png", ".webp": "image/webp",
                        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
                        ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(
                            os.path.splitext(p)[1].lower(), "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", kieu)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
                return
            return self._json(404, {"ok": False, "error": "không có " + u.path})
        except Exception as e:
            log("❌ %s: %s" % (u.path, e), "LỖI")
            return self._json(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/upload":
            # Thân request = NGUYÊN file (video nguồn có thể cả trăm MB —
            # gói base64 trong JSON là phình thêm 1/3 và ngốn RAM).
            try:
                ten = (parse_qs(u.query).get("name") or ["file.bin"])[0]
                ten = re.sub(r'[\\/:*?"<>|]+', "_", os.path.basename(ten)) or "file.bin"
                n = int(self.headers.get("Content-Length") or 0)
                # Giữ NGUYÊN tên file (CHAR_01_lead.png…): tool Muse/Flow đọc mã
                # từ tên. Mỗi lần tải một thư mục con riêng để khỏi đè nhau.
                thu = os.path.join(REF_DIR, "upload", uuid.uuid4().hex[:8])
                os.makedirs(thu, exist_ok=True)
                dich = os.path.join(thu, ten)
                con = n
                with open(dich, "wb") as f:
                    while con > 0:
                        b = self.rfile.read(min(1 << 20, con))
                        if not b:
                            break
                        f.write(b)
                        con -= len(b)
                return self._json(200, {"ok": True, "path": dich, "name": ten,
                                        "tag": "@" + ma_cua_anh(ten)})
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        d = self._body()
        try:
            if u.path == "/api/vids/start":
                ids = HANG.them(d)
                log("▶ Vids: thêm %d prompt · %s · %s · %ss · %s luồng" % (
                    len(ids), d.get("aspect"), d.get("resolution"), d.get("duration"),
                    d.get("parallel")), "INFO", "vids")
                return self._json(200, {"ok": True, "ids": ids})
            if u.path == "/api/vids/retry":
                return self._json(200, {"ok": True, "n": HANG.chay_lai(list(d.get("ids") or []))})
            if u.path == "/api/vids/stop":
                HANG.dung_lai()
                return self._json(200, {"ok": True})
            if u.path == "/api/vids/delete":
                HANG.xoa(d.get("ids"))
                return self._json(200, {"ok": True})
            if u.path == "/api/flow/start":
                kind = (parse_qs(u.query).get("kind") or ["anh"])[0]
                r = FLOW.bat_dau(kind, d)
                return self._json(200 if r.get("ok") else 409, r)
            if u.path.startswith("/api/accounts/"):
                viec = u.path.rsplit("/", 1)[-1]
                r = tk_hanh_dong(viec, d)
                return self._json(200, {"ok": True, **r})
            if u.path == "/api/config/gemini":
                ds = gemini_keys(str(d.get("keys") or ""))
                log("🔑 Đã lưu %d khoá Gemini (chung cấu hình TTS của tool cũ)." % len(ds), "INFO", "tk")
                return self._json(200, {"ok": True, "n": len(ds)})
            if u.path == "/api/util/download":
                url = str(d.get("url") or "").strip()
                if not re.match(r"https?://", url):
                    return self._json(400, {"ok": False, "error": "Link không hợp lệ"})
                return self._json(200, {"ok": True, **VIEC.tai_video(url, str(d.get("out_dir") or ""))})
            if u.path == "/api/draw":
                return self._json(200, {"ok": True, **ve_tay(str(d.get("path") or ""),
                                                            dict(d.get("cfg") or {}))})
            if u.path == "/api/util/upscale":
                return self._json(200, {"ok": True, **VIEC.upscale(
                    str(d.get("path") or ""), int(d.get("scale") or 2), str(d.get("model") or ""))})
            if u.path == "/api/muse/start":
                ids = MUSE.them(d)
                log("▶ Muse: thêm %d prompt · %s · %s · %s cảnh/lần" % (
                    len(ids), d.get("mode"), d.get("aspect"), d.get("parallel")), "INFO", "muse")
                return self._json(200, {"ok": True, "ids": ids})
            if u.path == "/api/muse/retry":
                return self._json(200, {"ok": True, "n": MUSE.chay_lai(list(d.get("ids") or []))})
            if u.path == "/api/muse/stop":
                MUSE.dung_lai()
                return self._json(200, {"ok": True})
            if u.path == "/api/muse/delete":
                MUSE.xoa(d.get("ids"))
                return self._json(200, {"ok": True})
            if u.path == "/api/muse/chrome":
                threading.Thread(target=MUSE.mo_chrome, daemon=True).start()
                return self._json(200, {"ok": True})
            if u.path == "/api/flow/stop":
                FLOW.dung()
                return self._json(200, {"ok": True})
            if u.path == "/api/flow/clear":
                FLOW.xoa(str(d.get("kind") or "anh"))
                return self._json(200, {"ok": True})
            if u.path == "/api/refs/upload":
                return self._json(200, {"ok": True, **luu_ref(d.get("name") or "", d.get("data") or "")})
            if u.path == "/api/pick-files":
                return self._json(200, {"ok": True, "paths": chon_file(str(d.get("kind") or ""),
                                                                       str(d.get("start") or ""))})
            if u.path == "/api/mini/read-text":
                return self._json(200, {"ok": True, "text": doc_chu(str(d.get("path") or ""))})
            if u.path == "/api/mini/cut-img":
                return self._json(200, {"ok": True, **mini_cat_anh(
                    d.get("paths"), float(d.get("every") or 1), str(d.get("out_dir") or ""))})
            if u.path == "/api/mini/cut-vid":
                return self._json(200, {"ok": True, **mini_cat_video(
                    d.get("paths"), str(d.get("mode") or "parts"), float(d.get("value") or 0),
                    str(d.get("out_dir") or ""))})
            if u.path == "/api/mini/upscale":
                return self._json(200, {"ok": True, **mini_upscale(
                    d.get("paths"), int(d.get("scale") or 2), str(d.get("out_dir") or ""))})
            if u.path == "/api/mini/yt-dl":
                return self._json(200, {"ok": True, **mini_tai_kenh(
                    str(d.get("url") or "").strip(), str(d.get("out_dir") or ""),
                    int(d.get("limit") or 0))})
            if u.path == "/api/mini/draw":
                return self._json(200, {"ok": True, **mini_ve_tay(d.get("paths"),
                                                                   dict(d.get("cfg") or {}))})
            if u.path == "/api/mini/rewrite":
                return self._json(200, {"ok": True, **mini_viet_lai(d)})
            if u.path == "/api/mini/translate":
                return self._json(200, {"ok": True, **mini_dich(d)})
            if u.path == "/api/mini/script-prompt":
                return self._json(200, {"ok": True, **mini_kich_ban_prompt(d)})
            if u.path == "/api/ghep/list":
                return self._json(200, {"ok": True, "items": ghep_ds(str(d.get("folder") or ""))})
            if u.path == "/api/ghep/merge":
                return self._json(200, {"ok": True, **ghep_video(d.get("paths"), d)})
            if u.path == "/api/voice/tts":
                return self._json(200, {"ok": True, **voice_lo(d)})
            if u.path == "/api/voice/join":
                return self._json(200, {"ok": True, **voice_noi(d.get("paths"), int(d.get("gap_ms") or 0),
                                                                str(d.get("out_dir") or ""))})
            if u.path == "/api/voice/eleven-voices":
                return self._json(200, {"ok": True, "voices": eleven_ds_giong()})
            if u.path == "/api/config/bridge":
                cfg = cau_hinh(d.get("set") if isinstance(d.get("set"), dict) else None)
                che = {k: ((str(v)[:4] + "…") if "key" in k and v else v) for k, v in cfg.items()}
                return self._json(200, {"ok": True, "cfg": che,
                                        "gemini": len(gemini_keys_an_toan()),
                                        "eleven": len(eleven_keys())})
            if u.path == "/api/invideo/create":
                return self._json(200, {"ok": True, **invideo_tao(d)})
            if u.path == "/api/invideo/list":
                return self._json(200, {"ok": True, "items": invideo_ds()})
            if u.path == "/api/invideo/setup":
                if d.get("install") == "whisper":
                    return self._json(200, {"ok": True, **invideo_cai_whisper()})
                return self._json(200, {"ok": True, **invideo_trang_thai()})
            if u.path == "/api/invideo/delete":
                p = str(d.get("path") or "")
                if os.path.dirname(os.path.abspath(p)) == os.path.abspath(OUT_INVIDEO) and os.path.isfile(p):
                    os.remove(p)
                return self._json(200, {"ok": True})
            if u.path == "/api/pick-folder":
                return self._json(200, {"ok": True, "path": chon_thu_muc(d.get("start") or "")})
            if u.path == "/api/open-folder":
                p = str(d.get("path") or "")
                if os.path.isdir(p):
                    os.startfile(p)  # noqa — chỉ Windows
                return self._json(200, {"ok": True})
            return self._json(404, {"ok": False, "error": "không có " + u.path})
        except Exception as e:
            log("❌ %s: %s" % (u.path, e), "LỖI")
            traceback.print_exc()
            return self._json(500, {"ok": False, "error": str(e)})


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), XuLy)
    log("Cầu nối chạy ở http://127.0.0.1:%d — tool: %s" % (PORT, TOOL_DIR))
    if MINT_ABOUT and os.path.isdir(OVERLAY_DIR):
        log("🔑 Đúc token kiểu SuperVeo: flow.google.com/about + Chrome hồ sơ tạm "
            "(bộ mint 02/10 trong scripts/flow_overlay). Tắt: PB_MINT_ABOUT=0")
    srv.serve_forever()


if __name__ == "__main__":
    main()
