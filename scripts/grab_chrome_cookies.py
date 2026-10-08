# -*- coding: utf-8 -*-
"""Grab Flow cookies from PBMedia Chrome profile browser_N only.

Mirrors SuperVeo/CapCut: copy Cookies DB (after Chrome closed) + DPAPI/AES-GCM decrypt.
Only allows %LOCALAPPDATA%\\PBMedia\\chrome_flow_accounts\\browser_[1-4].
"""
from __future__ import annotations
import base64, json, os, shutil, sqlite3, sys, tempfile

WANT_HOSTS = ("google.com", "labs.google", "flow.google")
KEY_NAMES = (
    "__Secure-next-auth.session-token", "__Secure-1PSID", "__Secure-3PSID",
    "SID", "SAPISID", "HSID", "SSID", "APISID",
    "__Secure-1PSIDTS", "__Secure-3PSIDTS",
)

def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def profile_dir(browser_id: int) -> str:
    n = max(1, min(4, int(browser_id)))
    local = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    root = os.path.abspath(os.path.join(local, "PBMedia", "chrome_flow_accounts"))
    path = os.path.abspath(os.path.join(root, f"browser_{n}"))
    if not (path == root or path.startswith(root + os.sep)):
        raise SystemExit("profile path escape blocked")
    return path

def find_cookies_db(prof: str) -> str:
    for c in (
        os.path.join(prof, "Default", "Network", "Cookies"),
        os.path.join(prof, "Default", "Cookies"),
    ):
        if os.path.isfile(c):
            return c
    for dirpath, _, files in os.walk(prof):
        if "Cookies" in files and ("Default" in dirpath or "Profile" in dirpath):
            return os.path.join(dirpath, "Cookies")
    return ""

def get_key(prof: str) -> bytes:
    local_state = os.path.join(prof, "Local State")
    with open(local_state, encoding="utf-8") as fh:
        data = json.load(fh)
    enc = base64.b64decode(data["os_crypt"]["encrypted_key"])
    if enc.startswith(b"DPAPI"):
        enc = enc[5:]
    import win32crypt
    return win32crypt.CryptUnprotectData(enc, None, None, None, 0)[1]

def decrypt_value(buff: bytes, key: bytes) -> str:
    if not buff:
        return ""
    try:
        if buff.startswith((b"v10", b"v11", b"v20")):
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            return AESGCM(key).decrypt(buff[3:15], buff[15:], None).decode("utf-8", "ignore")
        import win32crypt
        return win32crypt.CryptUnprotectData(buff, None, None, None, 0)[1].decode("utf-8", "ignore")
    except Exception:
        return ""

def host_ok(host: str) -> bool:
    h = (host or "").lstrip(".").lower()
    return any(h == w or h.endswith("." + w) or w in h for w in WANT_HOSTS)

def rank(host: str) -> int:
    d = (host or "").lstrip(".").lower()
    if d == "flow.google.com" or d.endswith(".flow.google.com"):
        return 3
    if "labs.google" in d:
        return 2
    if d.endswith("google.com"):
        return 1
    return 0

def load_rows(db: str):
    try:
        uri = "file:" + db.replace("\\", "/") + "?mode=ro"
        con = sqlite3.connect(uri, uri=True)
        rows = con.execute("select host_key, name, value, encrypted_value from cookies").fetchall()
        con.close()
        if rows:
            return rows, None
    except Exception:
        pass
    tmp = tempfile.mktemp(suffix=".db")
    try:
        shutil.copy2(db, tmp)
        for suf in ("-wal", "-shm", "-journal"):
            src = db + suf
            if os.path.isfile(src):
                try:
                    shutil.copy2(src, tmp + suf)
                except Exception:
                    pass
        con = sqlite3.connect(tmp)
        rows = con.execute("select host_key, name, value, encrypted_value from cookies").fetchall()
        con.close()
        return rows, None
    except Exception as e:
        return None, str(e)
    finally:
        for p in (tmp, tmp + "-wal", tmp + "-shm", tmp + "-journal"):
            try:
                os.remove(p)
            except Exception:
                pass

def main() -> int:
    if len(sys.argv) < 2:
        out({"ok": False, "detail": "usage: grab_chrome_cookies.py <browser_id>"})
        return 2
    try:
        bid = int(sys.argv[1])
    except ValueError:
        out({"ok": False, "detail": "browser_id must be 1-4"})
        return 2
    prof = profile_dir(bid)
    if not os.path.isdir(prof):
        out({"ok": False, "profileDir": prof, "detail": f"Chua co profile Browser {bid} — mo Chrome login truoc"})
        return 1
    db = find_cookies_db(prof)
    if not db:
        out({"ok": False, "profileDir": prof, "detail": "Khong thay Cookies DB — login trong Chrome profile nay truoc"})
        return 1
    try:
        key = get_key(prof)
    except Exception as e:
        out({"ok": False, "profileDir": prof, "detail": f"DPAPI key loi: {e}"})
        return 1
    rows, err = load_rows(db)
    if rows is None:
        out({"ok": False, "profileDir": prof, "locked": True,
             "detail": f"Cookies dang khoa (Chrome dang mo). Tool se thu dong Chrome roi lay lai. ({err})"})
        return 1
    gop, gop_rank = {}, {}
    for host, name, value, enc in rows:
        if not name or not host_ok(host):
            continue
        val = (value or "").strip()
        if not val and enc:
            raw = enc if isinstance(enc, (bytes, bytearray)) else bytes(enc)
            val = decrypt_value(raw, key)
        if not val:
            continue
        # drop undecryptable / binary junk (breaks Cookie header)
        val = "".join(ch for ch in val if 32 <= ord(ch) < 127 or (128 <= ord(ch) <= 255))
        if not val or len(val) < 2:
            continue
        try:
            val.encode("latin-1")
        except UnicodeEncodeError:
            continue
        r = rank(host)
        if name not in gop or r >= gop_rank.get(name, -1):
            gop[name] = val
            gop_rank[name] = r
    ordered = [k for k in KEY_NAMES if k in gop] + [k for k in gop if k not in KEY_NAMES]
    cookies = "; ".join(f"{n}={gop[n]}" for n in ordered)
    has_na = "__Secure-next-auth.session-token" in gop
    has_psid = any(k in gop for k in ("__Secure-1PSID", "__Secure-3PSID", "SID"))
    if not cookies:
        out({"ok": False, "profileDir": prof, "hasNextAuth": False, "hasPsid": False, "cookieCount": 0,
             "detail": "Khong giai duoc cookie — login xong bam Xac nhan"})
        return 1
    out({"ok": bool(has_na or has_psid), "profileDir": prof, "cookies": cookies,
         "hasNextAuth": has_na, "hasPsid": has_psid, "cookieCount": len(gop),
         "keys": [k for k in KEY_NAMES if k in gop],
         "detail": f"Da lay {len(gop)} cookie (next-auth={'YES' if has_na else 'no'} PSID={'YES' if has_psid else 'no'})"})
    return 0 if (has_na or has_psid) else 1

if __name__ == "__main__":
    raise SystemExit(main())
