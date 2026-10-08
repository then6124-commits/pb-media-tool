# -*- coding: utf-8 -*-
"""PuppeteerMinter — bộ mint reCAPTCHA thay cho Playwright, dùng rebrowser.

Cùng GIAO DIỆN với `flow_api.RecaptchaMinter` (start / stop / get /
request_reset / set_project / ready / dead / error) nên thả thẳng vào chỗ cũ
mà không phải sửa `image_gen` hay `superveo_test`.

Ruột: chạy `mint_sidecar.js` bằng Node + puppeteer-real-browser. Playwright để
lộ CDP `Runtime.enable` → reCAPTCHA chấm điểm nền thấp → 403 UNUSUAL_ACTIVITY.
rebrowser vá đúng rò rỉ đó, đây là cách SuperVeo qua được (đã soi).

Nếu môi trường thiếu Node hoặc thiếu gói → `available()` trả False, caller tự
rơi về `RecaptchaMinter` cũ (xem `flow_api.make_minter`).
"""
from __future__ import annotations

import atexit
import collections
import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))

#: Số token phát ra trên MỘT đời trình duyệt mint, chạm trần là dựng lại.
#:
#: Bản Playwright (`flow_api.RecaptchaMinter.MINT_MAX_TOKENS`) có từ lâu, bản
#: puppeteer thì QUÊN — và đó là khác biệt đo được trên log thật:
#:
#:   Playwright, 169 ảnh : dựng lại chủ động sau mỗi 12 token → 3 lần bị chặn
#:   puppeteer,  50 video: chạy ngon ~21 cảnh rồi 403 HÀNG LOẠT, dựng lại
#:                         4 lần theo kiểu chữa cháy vẫn không gỡ được
#:
#: `reloadEvery` trong sidecar chỉ tải lại TRANG. Điểm tin cậy bám vào cả đời
#: TIẾN TRÌNH Chrome (vân tay, lịch sử execute), nên phải dựng lại hẳn.
#:
#: ── 29/08: TẮT theo SuperVeo ──
#:
#: Đã soi `capture-sidecar.js` của SuperVeo: KHÔNG có bộ đếm token, KHÔNG có
#: trần nào. `page.goto(FLOW_URL)` đúng một lần lúc khởi động rồi
#: `grecaptcha.enterprise.execute()` chạy mãi trên page đó. Chỉ có đúng hai
#: chỗ trả `restart: true`, cả hai đều kèm `is403: true` — tức là nó dựng lại
#: trình duyệt CHỈ KHI thật sự ăn 403, không bao giờ dựng phòng xa.
#:
#: Số đo cũ ở trên vẫn đúng với thời điểm đo, nhưng đó là TRƯỚC khi khớp thứ
#: tự header + vân tay theo SuperVeo. Sau khi khớp, lỗi đã đổi từ 403 (điểm
#: thấp) sang 429 (quá nhiều request) — bài toán khác hẳn. Dựng lại phòng xa
#: là thuốc cho 403; với 429 nó vừa làm mọi luồng đứng chờ, vừa BƠM THÊM
#: request sang Google, đúng thứ đang bị kêu.
#:
#: Đường cứu hộ vẫn còn nguyên: gặp 403 thật thì `image_gen` vẫn dựng lại bộ
#: mint. Bỏ phòng xa, không bỏ cứu hộ.
#:
#: ── 30/08: BẬT LẠI, ở mức 10 ──
#:
#: Việc tắt hôm 29/08 là SAI, và log hai mẻ hôm nay chứng minh điều đó:
#:
#:   Luồng 12, đệm token 3/lô 3 : chạy sạch 13 cảnh rồi 403 ở cảnh 14, 18, 19, 20
#:   Luồng 8,  đệm token 6/lô 2 : chạy sạch 10 cảnh rồi 403 ở cảnh 11, 12, 13, 14
#:
#: Hạ luồng KHÔNG giúp, tăng đệm token KHÔNG giúp. Cái chung của cả hai mẻ là
#: SỐ TOKEN đã phát: cứ quanh 8–10 token trên một đời trình duyệt là điểm rơi.
#: Đúng thứ hằng số này sinh ra để chặn.
#:
#: Vì sao SuperVeo không cần mà tool thì cần — tôi chưa biết. Nhưng "SuperVeo
#: không làm" không phải lý do đủ để bỏ một thứ ĐO ĐƯỢC là có tác dụng ở đây.
#:
#: Dựng lại CHỦ ĐỘNG ở mức 10 rẻ hơn hẳn ăn 403: một lần 403 thì mất token
#: đang giữ, vẫn phải dựng lại, cộng thêm xin lại bearer, cộng nhịp gửi bị tự
#: nới 0→4→8→16→30s, và có khi bị chia đôi trần luồng.
#:
#: 0 = tắt. Hay 403 sớm hơn thì hạ xuống 6.
#: ── 30/08, lượt thứ hai: TẮT LẠI ──
#:
#: Bật ở mức 10 sáng nay KHÔNG giúp, và số liệu nói nó còn làm hại:
#:     trần TẮT → chạy sạch 13 cảnh
#:     trần BẬT → chạy sạch 10 cảnh (cả khi máy đã dọn sạch mồ côi)
#: Vì mỗi lần chạm trần là một lần DỰNG LẠI, mà trình duyệt vừa dựng mới
#: chính là thứ cho token điểm thấp. Trần token tự đẻ ra đúng cái nó định
#: chống. Cách chữa nằm ở `warmupMs`, không nằm ở đây.
MINT_MAX_TOKENS = max(0, int(os.environ.get("CAPCUT_MINT_MAX_TOKENS", "0") or 0))

#: `request_reset()` có GIẾT sidecar thật hay chỉ bật cờ. MẶC ĐỊNH TẮT.
#:
#: Sự thật đã kiểm: bật cờ không thôi thì KHÔNG BAO GIỜ dựng lại — `run()`
#: đứng trong `_read_stdout()` tới khi sidecar chết, mà hàm đó không đọc
#: `_reset_flag`. Nên mọi `request_reset()` từ `image_gen` (403 lẻ, 403
#: UNUSUAL_ACTIVITY, tự chạy lại cảnh hỏng) đều là lệnh rỗng. Log 05/09 18:29
#: xác nhận: vòng «TỰ CHẠY LẠI — mint mới» không in dòng dựng lại nào và ăn
#: 403 ngay request đầu.
#:
#: VÌ SAO VẪN ĐỂ TẮT: số đo ngay trên `MINT_MAX_TOKENS` nói ngược lại —
#: trần TẮT chạy sạch 13 cảnh, trần BẬT chỉ 10, vì trình duyệt VỪA DỰNG mới
#: là thứ cho token điểm thấp. Nếu điều đó đúng thì "sửa" cho reset chạy thật
#: sẽ làm mẻ tệ đi chứ không tốt lên. Hai giả thuyết đang mâu thuẫn và chưa có
#: số đo nào phân xử, nên KHÔNG đổi hành vi mặc định của bản đang chạy tốt.
#:
#: Bật để thử một mẻ:  set CAPCUT_MINT_HARD_RESET=1
#: Dấu hiệu ăn thua: trong vòng «TỰ CHẠY LẠI» phải thấy đủ ba dòng
#: «ép dựng lại sidecar mint» → «hâm nóng trang mint 6s» → «sẵn sàng».
HARD_RESET = (os.environ.get("CAPCUT_MINT_HARD_RESET", "0") or "0").strip() \
    .lower() in ("1", "on", "yes", "true")

SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV"
#: Dưới mức này là token cụt — xem ghi chú trong `get()`.
TOKEN_DAI_BINH_THUONG = int(os.environ.get("CAPCUT_TOKEN_DAI_TOI_THIEU")
                            or 1500)

#: Mọi tiến trình sidecar đã sinh ra trong phiên này — để `atexit` dọn hết.
_DA_SINH: list = []
_DA_SINH_LOCK = threading.Lock()


def _don_mo_coi(log=None) -> int:
    """Giết mọi `mint_sidecar.js` còn sót từ những lần chạy TRƯỚC.

    VÌ SAO CẦN. `stop()` chỉ được gọi trong luồng chạy mẻ. Đóng cửa sổ giữa
    chừng, mẻ thoát bất thường, hay tool bị tắt — sidecar sống tiếp mãi mãi,
    kéo theo cả một trình duyệt Chrome.

    Đã đo thật: sau ba mẻ thử nghiệm sáng 30/08, tool đã tắt mà vẫn còn NĂM
    sidecar sống và 62 tiến trình Chrome. Cả năm cùng trỏ tới labs.google/fx
    từ một IP — đúng thứ làm điểm reCAPTCHA rơi, và mỗi mẻ sau lại tệ hơn mẻ
    trước vì số mồ côi cứ cộng dồn.

    Chỉ giết đúng tiến trình có `mint_sidecar.js` trong dòng lệnh. Trả về số
    tiến trình đã giết.
    """
    try:
        import psutil
    except Exception:
        return 0
    minh = os.getpid()
    # Sidecar do CHÍNH phiên này dựng và ĐANG SỐNG — không phải mồ côi.
    #
    # LỖI ĐÃ TRẢ GIÁ: bản cũ chỉ trừ `os.getpid()`, mà đó là tiến trình
    # PYTHON — không bao giờ là node, nên phép trừ đó vô dụng. Kết quả:
    # `_spawn()` gọi hàm này ở dòng đầu, nên minter thứ HAI vừa dựng lên là
    # giết luôn minter thứ NHẤT đang chạy. Cái thứ nhất thấy stdout đóng, báo
    # «sidecar mint tắt bất ngờ — dựng lại», dựng lại rồi giết cái thứ hai…
    # Vòng giết nhau vô tận, đúng cái log 2:22:49–2:22:52:
    #     hâm nóng trang mint 6s…        ← A đang sống
    #     đã dọn 1 sidecar mồ côi        ← B dựng lên, giết A
    #     sidecar mint tắt bất ngờ       ← A chết
    # `make_minter()` KHÔNG dùng chung một cái, ba chỗ gọi đều đẻ mới, nên hai
    # cái cùng sống là chuyện thường.
    #
    # `_DA_SINH` vốn đã ghi sẵn chúng — chỉ là chưa ai dùng để loại trừ.
    try:
        with _DA_SINH_LOCK:
            cua_minh = {q.pid for q in _DA_SINH if q.poll() is None}
    except Exception:
        cua_minh = set()
    n = 0
    for p in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if p.info["pid"] == minh or p.info["pid"] in cua_minh:
                continue
            ten = (p.info.get("name") or "").lower()
            if "node" not in ten:
                continue
            dl = " ".join(p.info.get("cmdline") or [])
            if "mint_sidecar.js" not in dl:
                continue
            # Tool đẻ ra nó VẪN SỐNG (một cửa sổ tool KHÁC) → không phải mồ
            # côi, đừng động vào. 18/09: mở hai cửa sổ tool cùng lúc, mỗi bên
            # giết minter của bên kia → «tắt bất ngờ — dựng lại» vô tận, bấm
            # Dừng ở cửa sổ này thì cửa sổ kia vẫn chạy.
            try:
                cha = p.parent()
            except Exception:
                cha = None
            try:
                if (cha is not None and cha.pid != minh
                        and cha.is_running()):
                    continue
            except Exception:
                pass
            # Con cháu (Chrome do puppeteer sinh) chết theo cha.
            for c in p.children(recursive=True):
                try:
                    c.kill()
                except Exception:
                    pass
            p.kill()
            n += 1
        except Exception:
            continue
    if n and log:
        try:
            log(f"đã dọn {n} sidecar mint mồ côi từ lần chạy trước")
        except Exception:
            pass
    return n


def _don_tat_ca_khi_thoat():
    """Chốt cuối: tool tắt kiểu gì cũng không để lại sidecar."""
    with _DA_SINH_LOCK:
        ps = list(_DA_SINH)
        _DA_SINH.clear()
    for p in ps:
        try:
            p.kill()
        except Exception:
            pass
    try:
        _don_mo_coi()
    except Exception:
        pass


atexit.register(_don_tat_ca_khi_thoat)
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

def _thu_muc_ung_vien() -> list:
    """Những chỗ đáng tìm node / node_modules, theo thứ tự ưu tiên.

    `_HERE` KHÔNG đủ cho bản đóng gói: PyInstaller onefile giải nén mã nguồn
    vào một thư mục TẠM (`sys._MEIPASS`), nên `_HERE` trỏ vào đó chứ không
    phải chỗ đặt file .exe. Ship `node_modules` cạnh exe mà chỉ dò `_HERE` thì
    không bao giờ thấy — tool lặng lẽ rơi về Playwright và mọi mẻ VIDEO ăn 403,
    đúng lỗi đã mất một buổi để lần ra.
    """
    ds = [_HERE]
    try:
        import sys
        # Dò chỗ đặt file .exe — KHÔNG gác sau `sys.frozen`.
        #
        # `sys.frozen` là quy ước của PyInstaller. Nuitka — bản dựng thật của
        # tool này, xem `build_nuitka.bat` — đặt `__compiled__`, không hứa đặt
        # `frozen`. Gác sau `frozen` thì bản Nuitka không bao giờ nhìn cạnh
        # exe, không thấy `node_modules`, rơi về Playwright, rồi TẠO ẢNH vẫn
        # chạy trong khi TẠO VIDEO 403 sạch — đúng cái bẫy đã mất một buổi để
        # lần ra, chỉ khác là lần này nó chỉ lộ ra trên máy KHÁCH.
        #
        # Chạy từ mã nguồn thì `sys.executable` là python.exe, thư mục đó
        # không có `node_modules`, nên thêm vào vô hại.
        ds.append(os.path.dirname(os.path.abspath(sys.executable)))
        if sys.argv and sys.argv[0]:
            ds.append(os.path.dirname(os.path.abspath(sys.argv[0])))
    except Exception:
        pass
    la = os.environ.get("LOCALAPPDATA", "")
    if la:
        ds.append(os.path.join(la, "CapCutTool"))
        ds.append(os.path.join(la, "SuperVeo", "resources", "scripts"))
    ra, thay = [], set()
    for d in ds:
        if d and d not in thay and os.path.isdir(d):
            thay.add(d)
            ra.append(d)
    return ra


# node_modules để tìm puppeteer-real-browser. Ưu tiên bản đi kèm tool (cạnh
# exe hoặc cạnh mã nguồn), rồi tới bản OSS đã cài sẵn của SuperVeo trên máy.
_MODULE_DIRS = [os.path.join(d, "node_modules") for d in _thu_muc_ung_vien()]


def _mask(px: str) -> str:
    """Che user:pass trong proxy URL khi in log."""
    try:
        import re as _re
        return _re.sub(r"://[^@/]+@", "://***@", px or "")
    except Exception:
        return px or ""


def _bat(ten: str, mac_dinh: bool) -> bool:
    """Đọc cờ bật/tắt từ biến môi trường. Không đặt thì dùng mặc định."""
    v = (os.environ.get(ten) or "").strip().lower()
    if not v:
        return mac_dinh
    return v not in ("0", "no", "false", "off", "tat")


def _co_man_hinh() -> dict:
    """Kích thước màn hình thật — để cửa sổ mint mở bằng cỡ đó như SuperVeo."""
    try:
        import ctypes
        u = ctypes.windll.user32
        return {"width": int(u.GetSystemMetrics(0)),
                "height": int(u.GetSystemMetrics(1))}
    except Exception:
        return {"width": 1920, "height": 1080}


def _find_node() -> str | None:
    """Đường dẫn node.exe: PATH hệ thống trước, rồi node đi kèm (tool/SuperVeo).

    Nhận cả `node.exe` đặt thẳng trong thư mục lẫn trong thư mục con `node/`,
    để bản phát hành muốn chở theo Node thì bỏ vào đâu cũng chạy.
    """
    exe = shutil.which("node")
    if exe:
        return exe
    for d in _thu_muc_ung_vien():
        for c in (os.path.join(d, "node.exe"),
                  os.path.join(d, "node", "node.exe")):
            if os.path.isfile(c):
                return c
    return None


def _find_modules() -> str | None:
    for d in _MODULE_DIRS:
        if os.path.isdir(os.path.join(d, "puppeteer-real-browser")):
            return d
    return None


def available() -> tuple[bool, str]:
    """(chạy được không, lý do). Dùng để quyết định có xài minter này không."""
    if os.name != "nt":
        return False, "chỉ bật trên Windows"
    if not _find_node():
        return False, "không tìm thấy node.exe"
    if not _find_modules():
        return False, "không thấy puppeteer-real-browser trong node_modules"
    if not os.path.isfile(os.path.join(_HERE, "mint_sidecar.js")):
        return False, "thiếu mint_sidecar.js"
    return True, "ok"


class PuppeteerMinter(threading.Thread):
    #: action reCAPTCHA mặc định — trùng RecaptchaMinter.
    ACTION = "IMAGE_GENERATION"

    def __init__(self, logger=None, visible=False, project_id=None):
        super().__init__(daemon=True)
        self.q: queue.Queue = queue.Queue()
        self.ready = threading.Event()
        self.dead = threading.Event()
        self.error = None
        #: UA cua chinh Chrome mint, sidecar bao ve luc ready. Tang HTTP
        #: phai nop bang UA nay (xem _chot_ua trong mint_tien_ich.py).
        self.ua = ''
        self.visible = bool(visible)
        self._log = logger or (lambda m: print(m))
        self._stop_flag = threading.Event()
        self._reset_flag = threading.Event()
        self._reset_reason = ""
        self._dem_token = 0
        self._dem_lock = threading.Lock()
        self._pid_lock = threading.Lock()
        self._project_id = (project_id or "").strip()
        self._proc: subprocess.Popen | None = None
        self._cfg_path = ""
        self._io_lock = threading.Lock()
        self._pending: dict[int, tuple[list, threading.Event]] = {}
        self._profile_dir = ""
        self._alt_pids = []
        self._req_id = 0
        self._cookies = ""
        # True = không inject cookie (profile Cookie_10 đã LOGIN=CO).
        # Tránh accounts.google.com/CookieMismatch (inject vs native).
        self._skip_inject = False
        # Jar TK dự phòng — khi skip_inject xóa _cookies vẫn giữ để recovery
        # CookieMismatch (temp profile + inject 1 lần).
        self._cookies_jar = ""
        self._cookie_mismatch = False
        self._cookie_mismatch_count = 0
        self._mismatch_temp_once = False
        # True khi temp jar roi /about hoac recovery 1 lan da xong → KHONG rebuild.
        self._mismatch_about_fail = False
        self._mismatch_stop_rebuild = False
        self._profile_dir_orig = ""
        # 20 dòng stderr cuối của sidecar — in ra khi nó chết không rõ lý do.
        self._loi_cuoi: collections.deque = collections.deque(maxlen=20)

    # ---------- log ----------
    def log(self, m):
        try:
            self._log(f"[minter] {m}")
        except Exception:
            pass

    # ---------- giao diện giống RecaptchaMinter ----------
    def stop(self):
        self._stop_flag.set()
        self._kill_proc()

    def set_project(self, project_id: str | None):
        pid = (project_id or "").strip()
        # Kiểm khuôn UUID nhẹ nhàng — sai thì bỏ qua, khỏi làm hỏng phiên.
        if len(pid) < 30 or pid.count("-") != 4:
            return
        with self._pid_lock:
            self._project_id = pid

    def _mismatch_lock(self) -> bool:
        """CookieMismatch / temp-once /about — KHÔNG mở lại Cookie_10."""
        return bool(
            getattr(self, "_mismatch_stop_rebuild", False)
            or getattr(self, "_mismatch_about_fail", False)
            or getattr(self, "_mismatch_temp_once", False)
            or getattr(self, "_cookie_mismatch", False)
        )

    def request_reset(self, reason: str = "", hard: bool | None = None):
        """Yêu cầu dựng lại sidecar mint.

        `hard=True` GIẾT sidecar ngay. Bật cờ không thôi là KHÔNG ĐỦ: vòng
        `run()` đứng trong `_read_stdout()` cho tới khi sidecar chết, mà
        `_read_stdout()` không hề đọc `_reset_flag`. Nên trước bản vá này mọi
        lời gọi `request_reset()` từ ngoài đều rơi vào hư không — bộ mint cứ
        phát tiếp token từ đúng trình duyệt đã cháy điểm.

        ĐO ĐƯỢC trong log 05/09 18:29: vòng «TỰ CHẠY LẠI 5 cảnh hỏng — mint
        mới» ăn 403 UNUSUAL_ACTIVITY ngay request đầu, và trong log KHÔNG có
        ba dòng «dựng lại sidecar mint» / «hâm nóng trang mint 6s» / «sẵn
        sàng». Chỉ 3 giây giữa lúc bỏ token và lúc gửi cảnh đầu — không đủ cho
        một lần dựng trình duyệt. Người dùng bấm Dừng rồi chạy lại (tiến trình
        mới, có đủ ba dòng đó) thì 5/5 cảnh chạy sạch.

        Xoá luôn cờ `ready`: `get()` đã có `ready.wait()` ở đầu hàm nên mọi
        worker tự chờ dựng xong — không phải sửa gì bên `image_gen`.

        `hard=False` giữ NGUYÊN hành vi cũ (chỉ bật cờ). Đường «đủ token, làm
        mới phiên» dùng nhánh này: engine puppeteer giữ điểm tốt suốt mẻ 101
        cảnh mà không cần dựng lại lần nào, nên bật nó lên là tự thêm ~10s mỗi
        12 token vào con đường đang chạy hoàn hảo — đổi lấy con số không.

        Quay lại hành vi cũ hoàn toàn: đặt CAPCUT_MINT_HARD_RESET=0.

        28/09 mismatch4: sau CookieMismatch / temp jar /about — CẤM hard-reset
        về Cookie_10 (gan tre / đồng bộ cookie Chrome thật từng undo recovery).
        """
        reason = reason or "bị chặn"
        # mismatch4: temp jar /about / stop_rebuild → không ép mở lại Cookie_10
        if self._mismatch_lock():
            _rs = (reason or "").lower()
            _ve_c10 = (
                "cookie_10" in _rs or "gan ho so" in _rs or "gan hồ sơ" in _rs
                or "dong bo" in _rs or "đồng bộ" in _rs
                or "chrome thật" in _rs or "chrome that" in _rs
            )
            if hard is True or _ve_c10 or getattr(self, "_mismatch_temp_once", False):
                try:
                    self.log(
                        f"[mismatch4] BO request_reset(hard={hard!r}) "
                        f"({reason}) — CookieMismatch/temp jar: KHONG mo lai "
                        "Cookie_10; dung Cookie Flow (ext).")
                except Exception:
                    pass
                return
        self._reset_reason = reason
        self._reset_flag.set()
        if hard is None:
            hard = HARD_RESET
        if not hard:
            return
        self.ready.clear()
        self.log(f"ép dựng lại sidecar mint ({self._reset_reason})")
        try:
            self._kill_proc()
        except Exception as e:
            self.log(f"không giết được sidecar mint: {e}")

    def get(self, n=1, timeout=90, action=None):
        """Xin n token. Trả list token (có thể rỗng)."""
        if self.dead.is_set():
            return []
        if not self.ready.wait(timeout=timeout):
            self.log("chưa sẵn sàng")
            return []
        holder, ev = [], threading.Event()
        try:
            self._send_mint(n, action or self.ACTION, holder, ev)
        except Exception as e:
            self.log(f"gửi lệnh mint hỏng: {e}")
            return []
        if not ev.wait(timeout=timeout):
            self.log("mint quá hạn")
            return []
        toks = list(holder)
        # ── CẢNH BÁO TOKEN CỤT (28/09) ──
        #
        # Token reCAPTCHA Enterprise thật dài ~2.300–2.500 ký tự. Đo trên
        # trình duyệt đúc của SuperVeo: 2.468–2.489. Đúc trên `labs.google/fx`
        # bằng trình duyệt CHƯA ĐĂNG NHẬP chỉ ra ~538 ký tự, và Google từ chối
        # 100% với `403 reCAPTCHA evaluation failed / PUBLIC_ERROR_UNUSUAL_ACTIVITY`
        # — đã thử đủ mọi tổ hợp header, Origin, Cookie, kể cả gửi từ trong
        # trang: token cụt là chết, không cứu được.
        #
        # Nguyên nhân: trang Flow (flow.google.com/project/<pid>) chỉ tải khi
        # trình duyệt ĐÃ ĐĂNG NHẬP; chưa đăng nhập thì bị đá sang
        # flow.google.com/about, không có grecaptcha, phải lùi về labs.google/fx
        # — nơi chỉ đúc ra token cụt.
        #
        # Nói thẳng ở đây, đừng để cả mẻ chạy rồi 403 từng cảnh mà không rõ vì sao.
        if toks:
            _dai = max(len(t or "") for t in toks)
            if _dai < TOKEN_DAI_BINH_THUONG:
                if not getattr(self, "_da_canh_token_ngan", False):
                    self._da_canh_token_ngan = True
                    self.log(
                        f"⛔ HARD-STOP IMAGE/VIDEO: token cut {_dai} ky tu "
                        f"(< {TOKEN_DAI_BINH_THUONG}) — KHONG gui aisandbox. "
                        "Token that ~2300-2500; ~538 = mint labs.google/fx "
                        "hoac ho so Cookie_10 chua login.")
                    self.log(
                        "   → Mo Chrome ho so Cookie_10, vao "
                        "https://flow.google.com (thay project, KHONG /about), "
                        "F5, roi chay lai. KHONG mint labs.google/fx.")
                # Reject: đừng để generate_image gửi token cụt → 403 hàng loạt
                try:
                    self.request_reset(
                        "token cut (sai trang mint / chua dang nhap)",
                        hard=True)
                except Exception:
                    pass
                return []
        # Đếm theo SỐ TOKEN chứ không phải số lệnh: `token_pool` gom nhiều
        # `execute()` vào một lệnh, đếm 1 là tự cho mình gấp mấy lần ngân sách.
        if toks and MINT_MAX_TOKENS > 0:
            cham = False
            with self._dem_lock:
                self._dem_token += len(toks)
                if self._dem_token >= MINT_MAX_TOKENS:
                    self._dem_token = 0
                    cham = True
            if cham:
                self.log(f"đã phát đủ {MINT_MAX_TOKENS} token — dựng lại "
                         "trình duyệt mint TRƯỚC khi bị chấm rớt.")
                try:
                    # hard=False: giữ NGUYÊN hành vi cũ kể cả khi HARD_RESET
                    # bật. Số đo ở `MINT_MAX_TOKENS` nói dựng lại theo trần
                    # token làm mẻ TỆ ĐI — đừng để bản vá 403 kéo theo nó.
                    self.request_reset("đủ token, làm mới phiên", hard=False)
                except Exception:
                    pass
        return toks

    # ---------- nội bộ ----------
    def _load_cookies_if_empty(self) -> None:
        """Chưa được cấp cookie thì tự lấy bộ MẠNH NHẤT như minter cũ.

        Bỏ qua khi skip_inject (profile Cookie_10 LOGIN=CO) — không nhồi
        cookie lệch phiên lên hồ sơ native (CookieMismatch).
        """
        if getattr(self, "_skip_inject", False):
            self._cookies = ""
            return
        if self._cookies:
            return
        # Hồ sơ bền đã có Default/Cookies → để sidecar tự quyết (skip nếu LOGIN=CO)
        # Vẫn có thể truyền cookie dự phòng khi hồ sơ CHƯA login.
        try:
            import flow_api as _fa
            ck = _fa.best_session_cookies(log=lambda m: None) or ""
            self._cookies = ck.strip()
        except Exception as e:
            self.log(f"không tự lấy được cookie: {e}")

    def _config(self) -> dict:
        self._load_cookies_if_empty()
        with self._pid_lock:
            pid = self._project_id
        # Proxy dân cư (KiotProxy) cho bộ mint — reCAPTCHA chấm điểm theo IP
        # LÚC MINT, nên đây mới là chỗ proxy có tác dụng nâng điểm.
        proxy_url = ""
        try:
            import flow_api as _fa
            proxy_url = _fa._flow_proxy_url() or ""
        except Exception:
            proxy_url = ""
        if proxy_url:
            self.log(f"mint qua proxy: {_mask(proxy_url)}")
        return {
            "cookies": self._cookies,
            # Mặc định: NẠP cookie phiên Flow + mint trên trang project
            # (reCAPTCHA chấm cao hơn khi đã đăng nhập).
            # Trước đây CAPCUT_MINT_SUPERVEO=1 (mặc định) → không cookie →
            # hay dính PUBLIC_ERROR_UNUSUAL_ACTIVITY.
            # Muốn A/B kiểu SuperVeo (không cookie, mint /fx): set CAPCUT_MINT_SUPERVEO=1
            # 28/09: bật MẶC ĐỊNH. Nhánh này là bộ cờ đo từ tiến trình
            # SuperVeo 3.7.2 đang chạy thật (xem ghi chú trong
            # mint_sidecar.js). Nhánh cũ (800x600 + --app + --disable-gpu)
            # là dấu vết bot kinh điển. Muốn về nhánh cũ: CAPCUT_MINT_SUPERVEO=0
            "superveoMode": _bat("CAPCUT_MINT_SUPERVEO", True),
            # 01/10 — duc tren flow.google.com/about bang HO SO TAM,
            # khong dang nhap, dung nhu SuperVeo dang chay. Mac dinh TAT
            # de khong doi hanh vi hien co: CAPCUT_MINT_ABOUT=1 de bat.
            "mintAbout": _bat("CAPCUT_MINT_ABOUT", False),
            # Cookie ON (điểm tin cậy). Trang mint mặc định /fx — trang công khai
            # luôn có grecaptcha. Trước đây mintUrl='' → vào /project/... rồi
            # tools/flow; nếu cookie chưa «ăn» hết thì không có grecaptcha →
            # sidecar exit 5 («grecaptcha không sẵn sàng»).
            # mintAbout: trinh duyet duc KHONG can dang nhap nen khong
            # nhoi cookie (nhoi vao chi de sinh CookieMismatch).
            "noCookie": (_bat("CAPCUT_MINT_NO_COOKIE", False)
                         or _bat("CAPCUT_MINT_ABOUT", False)
                         or bool(getattr(self, "_skip_inject", False))),
            # 24/09: ĐỂ TRỐNG → sidecar tự đi theo chuỗi flow.google.com
            # (đúng trang ứng dụng thật) rồi mới lùi về labs.google/fx.
            # Ghim cứng labs.google/fx như trước là mint sai ngữ cảnh, backend
            # chấm điểm thấp → 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY.
            # Muốn ghim một trang: set CAPCUT_MINT_URL=<url>.
            "mintUrl": (
                "" if "labs.google" in (
                    (os.environ.get("CAPCUT_MINT_URL") or "").strip().lower())
                else (os.environ.get("CAPCUT_MINT_URL") or "").strip()),
            # Hồ sơ Chrome THẬT của tài khoản (24/09): mint bằng hồ sơ tạm +
            # nhồi cookie bị reCAPTCHA chấm thấp → batchexecute trả
            # UNUSUAL_ACTIVITY, trong khi Chrome thật của người dùng tạo video
            # bình thường. `set_profile_dir()` để `image_gen`/test chỉ định.
            # Tắt: set CAPCUT_MINT_PROFILE=0
            # mintAbout -> de trong, sidecar tu tao ho so tam.
            "profileDir": (""
                           if (_bat("CAPCUT_MINT_ABOUT", False)
                               or (os.environ.get("CAPCUT_MINT_PROFILE")
                                   or "1").strip()
                               in ("0", "off", "no", "false"))
                           else (self._profile_dir or "")),
            "altProjectIds": list(getattr(self, "_alt_pids", None) or []),

            "screen": _co_man_hinh(),
            "projectId": pid,
            "siteKey": SITE_KEY,
            # Trang mint vừa dựng phải sống một lúc trước khi bị vắt token
            # — xem ghi chú trong `mint_sidecar.js`.
            "warmupMs": int(os.environ.get("CAPCUT_MINT_WARMUP_MS", "") or 6000),
            "action": "VIDEO_GENERATION",
            "chromePath": CHROME_PATH if os.path.isfile(CHROME_PATH) else "",
            "moduleDirs": [d for d in _MODULE_DIRS if os.path.isdir(d)],
            "offscreen": not self.visible,
            "blockResources": True,
            "proxyUrl": proxy_url,
            # 0 = KHÔNG BAO GIỜ tải lại trang mint, đúng như SuperVeo (nó
            # goto một lần rồi execute mãi trên page đó). Mỗi lần tải lại là
            # một khoảng mọi luồng đứng chờ token, cộng thêm request gửi sang
            # Google — xem ghi chú ở `MINT_MAX_TOKENS`.
            # Muốn bật lại lưới an toàn: set CAPCUT_MINT_RELOAD_EVERY=40
            "reloadEvery": int(os.environ.get("CAPCUT_MINT_RELOAD_EVERY", "0") or 0),
        }

    def _send_mint(self, n, action, holder, ev):
        with self._io_lock:
            if not (self._proc and self._proc.stdin):
                raise RuntimeError("sidecar chưa chạy")
            self._req_id += 1
            rid = self._req_id
            self._pending[rid] = (holder, ev)
            with self._pid_lock:
                pid = self._project_id
            msg = json.dumps({"id": rid, "cmd": "mint", "count": max(1, int(n)),
                              "action": action, "siteKey": SITE_KEY,
                              "projectId": pid}) + "\n"
            self._proc.stdin.write(msg)
            self._proc.stdin.flush()

    def set_profile_dir(self, path: str) -> None:
        """Hồ sơ Chrome bền cho mint (Cookie_10 / …_sidecar — kiểu SuperVeo).

        Phải gọi TRƯỚC `start()`. Rỗng = hồ sơ tạm (dễ 403 UNUSUAL_ACTIVITY).
        """
        self._profile_dir = (path or "").strip()
        if self._profile_dir:
            try:
                self.log("profileDir mint = " + self._profile_dir)
            except Exception:
                pass

    def set_alt_projects(self, pids) -> None:
        """Project dự phòng khi /project/<pid> trả 5xx / không grecaptcha."""
        out = []
        for p in (pids or []):
            s = (p or "").strip()
            if s and s not in out:
                out.append(s)
        self._alt_pids = out
        if out:
            try:
                self.log("altProjectIds mint = " + ", ".join(x[:8] + "…" for x in out[:5]))
            except Exception:
                pass

    def lay_wiz(self, project_id: str = "", timeout: float = 60.0) -> dict:
        """Hỏi trình duyệt mint: at (SNlM0e), f.sid, bl và COOKIE TƯƠI.

        24/09: cào `at` bằng HTTP hay ăn trang đăng nhập vì cookie trong sổ đã
        bị Google xoay (`__Secure-1PSIDTS`, `SIDCC`). Chrome này đang mở đúng
        trang Flow và tự làm mới cookie, nên hỏi thẳng nó là chắc nhất.
        Trả {} nếu sidecar chưa sẵn sàng / không có at.
        """
        if not self.ready.wait(timeout=min(timeout, 30)):
            return {}
        holder, ev = [], threading.Event()
        try:
            with self._io_lock:
                if not (self._proc and self._proc.stdin):
                    return {}
                self._req_id += 1
                rid = self._req_id
                self._pending[rid] = (holder, ev)
                pid = (project_id or "").strip()
                if not pid:
                    with self._pid_lock:
                        pid = self._project_id
                self._proc.stdin.write(json.dumps(
                    {"id": rid, "cmd": "wiz", "projectId": pid}) + "\n")
                self._proc.stdin.flush()
        except Exception as e:
            self.log(f"lay_wiz gửi lệnh hỏng: {e}")
            return {}
        if not ev.wait(timeout=timeout):
            self._pending.pop(rid, None)
            self.log("lay_wiz: sidecar không trả lời")
            return {}
        d = holder[0] if holder else {}
        if not isinstance(d, dict) or not d.get("at"):
            self.log("lay_wiz: trang mint không có SNlM0e ("
                     + str(d.get("href", ""))[:60] + ")")
            return {}
        self.log(f"lay_wiz: at={len(d.get('at') or '')} ký tự, cookie tươi="
                 f"{len([x for x in (d.get('cookies') or '').split(';') if '=' in x])}")
        return d

    def fetch_api(self, url: str, headers: dict | None = None,
                  body: str | None = None, timeout: float = 90.0) -> dict:
        """POST URL từ trong trang mint (page.evaluate fetch) — cùng phiên token.

        Trả dict {ok, status, body, error?}. Rỗng/None nếu sidecar chưa sẵn.
        Dùng cho aisandbox create (IMAGE/VIDEO): token reCAPTCHA bám BotGuard
        của đúng Chrome này; gửi từ Node hay bị 403 UNUSUAL_ACTIVITY.
        """
        if not self.ready.wait(timeout=min(timeout, 30)):
            return {"ok": False, "status": 0, "body": "", "error": "sidecar chưa ready"}
        holder, ev = [], threading.Event()
        try:
            with self._io_lock:
                if not (self._proc and self._proc.stdin):
                    return {"ok": False, "status": 0, "body": "", "error": "sidecar chưa chạy"}
                self._req_id += 1
                rid = self._req_id
                self._pending[rid] = (holder, ev)
                with self._pid_lock:
                    pid = self._project_id
                msg = {
                    "id": rid,
                    "cmd": "fetch",
                    "url": url,
                    "headers": headers or {},
                    "body": body if body is not None else "",
                    "timeoutMs": int(max(5000, min(180000, float(timeout) * 1000))),
                    "projectId": pid or "",
                }
                self._proc.stdin.write(json.dumps(msg) + "\n")
                self._proc.stdin.flush()
        except Exception as e:
            self.log(f"fetch_api gửi lệnh hỏng: {e}")
            return {"ok": False, "status": 0, "body": "", "error": str(e)}
        if not ev.wait(timeout=timeout + 15):
            self._pending.pop(rid, None)
            self.log("fetch_api: sidecar không trả lời")
            return {"ok": False, "status": 0, "body": "", "error": "timeout"}
        d = holder[0] if holder else {}
        if not isinstance(d, dict):
            return {"ok": False, "status": 0, "body": "", "error": "bad response"}
        return d

    def _kill_proc(self):
        p = self._proc
        self._proc = None
        if not p:
            return
        try:
            if p.stdin:
                try:
                    p.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
                    p.stdin.flush()
                except Exception:
                    pass
            # Giết cả con cháu: `p.terminate()` chỉ hạ tiến trình node, còn
            # Chrome do puppeteer sinh ra là tiến trình CON — mồ côi thì nó
            # sống tiếp và vẫn giữ phiên tới labs.google.
            try:
                import psutil
                _pp = psutil.Process(p.pid)
                for _c in _pp.children(recursive=True):
                    try:
                        _c.kill()
                    except Exception:
                        pass
            except Exception:
                pass
            p.terminate()
            try:
                p.wait(timeout=5)
            except Exception:
                p.kill()
        finally:
            try:
                with _DA_SINH_LOCK:
                    if p in _DA_SINH:
                        _DA_SINH.remove(p)
            except Exception:
                pass
        # huỷ mọi lệnh đang chờ để get() không treo
        for rid, (holder, ev) in list(self._pending.items()):
            ev.set()
        self._pending.clear()

    def _spawn(self) -> bool:
        # Dọn sidecar mồ côi TRƯỚC khi dựng cái mới. Không dọn thì mỗi lần
        # chạy để lại một trình duyệt mint sống mãi, tất cả cùng trỏ tới
        # labs.google/fx từ một IP — xem ghi chú ở `_don_mo_coi()`.
        try:
            _don_mo_coi(self.log)
        except Exception:
            pass
        # Cookie_10 dual-Chrome: chờ Lấy Cookie đóng / kill Chrome giữ hồ sơ.
        _hs = (getattr(self, "_profile_dir", "") or "").strip()
        if _hs:
            try:
                import flow_api as _fa_busy
                ok_free = _fa_busy.ensure_mint_profile_free(
                    _hs, log=self.log, kill=True, wait_sidecar=True)
                if not ok_free:
                    self.error = (
                        "ho so Cookie dang mo (Lay Cookie Chrome) — "
                        "dong Chrome do roi mint lai")
                    self.log(self.error)
                    self.dead.set()
                    return False
            except Exception as _e_busy:
                try:
                    self.log(f"ensure_mint_profile_free: {_e_busy}")
                except Exception:
                    pass
        node = _find_node()
        mods = _find_modules()
        if not node or not mods:
            self.error = "thiếu node hoặc puppeteer-real-browser"
            self.log(self.error)
            self.dead.set()
            return False

        # Ghi config ra file tạm (cookie rất dài, không nhét vào argv được)
        try:
            fd, self._cfg_path = tempfile.mkstemp(suffix=".json", prefix="mint_cfg_")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self._config(), f)
        except Exception as e:
            self.error = f"ghi config: {e}"
            self.log(self.error)
            self.dead.set()
            return False

        sidecar = os.path.join(_HERE, "mint_sidecar.js")
        env = dict(os.environ)
        env["NODE_PATH"] = os.pathsep.join(
            [mods] + [p for p in env.get("NODE_PATH", "").split(os.pathsep) if p])
        crees = 0
        if os.name == "nt":
            crees = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            self._proc = subprocess.Popen(
                [node, sidecar, self._cfg_path],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, encoding="utf-8",
                errors="replace",
                cwd=_HERE, env=env, bufsize=1, creationflags=crees)
            with _DA_SINH_LOCK:
                _DA_SINH.append(self._proc)
            # Hút stderr sang một bên. Bản cũ để `stderr=DEVNULL` nên MỌI lý
            # do node chết đều bị vứt — thiếu module, Chrome không mở được,
            # hết bộ nhớ, promise văng — tất cả cùng hiện ra một dòng vô hồn
            # «sidecar mint tắt bất ngờ». Giữ lại 20 dòng cuối là đủ để lần
            # sau đọc ra bệnh.
            #
            # PHẢI hút liên tục bằng luồng riêng: ống stderr chỉ vài chục KB,
            # đầy là node ĐỨNG IM khi ghi — treo mà không báo gì, đúng kiểu
            # hỏng khó lần nhất.
            self._loi_cuoi.clear()
            threading.Thread(target=self._hut_stderr, args=(self._proc,),
                             daemon=True).start()
        except Exception as e:
            self.error = f"chạy node: {e}"
            self.log(self.error)
            self.dead.set()
            return False
        return True

    def _hut_stderr(self, proc) -> None:
        """Hút stderr của sidecar vào vòng đệm 20 dòng cuối."""
        try:
            for dong in proc.stderr:
                dong = (dong or "").rstrip()
                if dong:
                    self._loi_cuoi.append(dong)
        except Exception:
            pass

    def _bao_loi_cuoi(self) -> None:
        """In mấy dòng stderr cuối — gọi khi sidecar chết không rõ lý do."""
        try:
            dong = list(self._loi_cuoi)
        except Exception:
            dong = []
        if not dong:
            self.log("   (sidecar không để lại dòng lỗi nào)")
            return
        self.log("   lý do node tắt — %d dòng cuối:" % len(dong))
        for d in dong[-8:]:
            self.log("     " + d[:300])

    def _read_stdout(self) -> None:
        """Đọc từng dòng JSON từ sidecar, phân phối về đúng lệnh chờ."""
        p = self._proc
        if not (p and p.stdout):
            return
        for line in p.stdout:
            if self._stop_flag.is_set():
                return
            line = (line or "").strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            ev = msg.get("event")
            if ev == "ready":
                # UA cua chinh Chrome mint — de tang HTTP nop dung UA do.
                _ua_sc = str(msg.get("ua") or "").strip()
                if _ua_sc:
                    self.ua = _ua_sc
                    self.log("UA Chrome mint: " + _ua_sc[:90])
                self.log("sẵn sàng (puppeteer-real-browser, rebrowser)")
                self.ready.set()
            elif ev == "log":
                _lm = str(msg.get("message", "") or "")
                self.log(_lm)
                _lml = _lm.lower()
                if "CookieMismatch" in _lm or "cookiemismatch" in _lml:
                    try:
                        self.note_cookie_mismatch(_lm[:120])
                    except Exception:
                        self._cookie_mismatch = True
                elif ("/about" in _lml and ("chua login" in _lml
                      or "hard fail" in _lml or "flow da /about" in _lml)):
                    try:
                        self.note_about_not_logged_in(_lm[:120])
                    except Exception:
                        self._mismatch_about_fail = True
                        self._cookie_mismatch = True
                        self._mismatch_stop_rebuild = True
            elif ev == "cookie_mismatch":
                try:
                    self.note_cookie_mismatch(str(msg.get("message", "") or ""))
                except Exception:
                    self._cookie_mismatch = True
                self.log("sidecar CookieMismatch — sẽ thử temp jar 1 lan / Cookie Flow")
                return
            elif ev == "about_not_logged_in":
                # Temp jar / inject roi /about = hard fail recovery
                try:
                    self.note_about_not_logged_in(str(msg.get("message", "") or ""))
                except Exception:
                    self._mismatch_about_fail = True
                    self._cookie_mismatch = True
                    self._mismatch_stop_rebuild = True
                self.log("sidecar /about (chua login) — HARD FAIL, dung rebuild, fallback Cookie Flow")
                return
            elif ev == "error":
                _em = str(msg.get("message", "") or "")
                self.log("sidecar báo lỗi: " + _em)
                _eml = _em.lower()
                if "CookieMismatch" in _em or "cookiemismatch" in _eml:
                    try:
                        self.note_cookie_mismatch(_em[:120])
                    except Exception:
                        self._cookie_mismatch = True
                elif ("about_not_logged_in" in _eml
                      or "/about" in _eml
                      or "chua login" in _eml):
                    try:
                        self.note_about_not_logged_in(_em[:120])
                    except Exception:
                        self._mismatch_about_fail = True
                        self._cookie_mismatch = True
                        self._mismatch_stop_rebuild = True
                return   # thoát vòng đọc → run() quyết định rebuild hay dừng
            elif "id" in msg:
                rid = msg.get("id")
                item = self._pending.pop(rid, None)
                if item:
                    holder, done = item
                    if msg.get("kind") == "fetch" or (
                            "status" in msg and "body" in msg
                            and "tokens" not in msg and "at" not in msg):
                        holder.append(msg)      # trả lời lệnh 'fetch'
                    elif "at" in msg or "href" in msg:
                        holder.append(msg)      # trả lời lệnh 'wiz'
                    else:
                        for t in (msg.get("tokens") or []):
                            holder.append(t)
                    done.set()
        # stdout đóng = tiến trình chết
        return

    def run(self) -> None:
        """Vòng đời: mở sidecar → phục vụ → dựng lại khi hỏng/được yêu cầu."""
        backoff = 0
        while not self._stop_flag.is_set():
            self._reset_flag.clear()
            self.ready.clear()
            if not self._spawn():
                # thiếu node/deps → chịu, để caller rơi về minter cũ
                return
            # Đọc stdout trong luồng này cho tới khi sidecar chết / lỗi
            try:
                self._read_stdout()
            except Exception as e:
                self.log(f"đọc sidecar hỏng: {e}")

            self._kill_proc()
            self.ready.clear()
            if self._stop_flag.is_set():
                break
            # ── CookieMismatch /about recovery (28/09 mismatch3) ──
            # Truoc: temp jar 1 lan, clear _cookie_mismatch, roi /about →
            # grecaptcha fail → rebuild CUNG temp vo han (user STOP).
            # Nay: toi da 1 lan temp; /about = hard fail; moi lan chet sau
            # temp_once → DUNG, giu _cookie_mismatch cho MintKep → Cookie Flow.
            if getattr(self, "_mismatch_stop_rebuild", False) or getattr(
                    self, "_mismatch_about_fail", False):
                self._cookie_mismatch = True
                self._mismatch_stop_rebuild = True
                self.log(
                    "CookieMismatch recovery HARD STOP (/about hoac het 1 lan) — "
                    "KHONG rebuild sidecar; MintKep fallback Cookie Flow "
                    "(CAPCUT_MINT_PRIMARY=auto).")
                break
            if getattr(self, "_mismatch_temp_once", False):
                # Da thu temp 1 lan — bat ky chet nao (CookieMismatch, /about,
                # grecaptcha, crash) deu DUNG. Khong spawn lai cung temp dir.
                self._cookie_mismatch = True
                self._mismatch_stop_rebuild = True
                self.log(
                    "CookieMismatch recovery: temp jar 1 lan da xong (chet/"
                    "fail) — dung sidecar; MintKep se uu tien Cookie Flow.")
                break
            if getattr(self, "_cookie_mismatch", False) and not getattr(
                    self, "_mismatch_temp_once", False):
                jar = (getattr(self, "_cookies_jar", "") or "").strip()
                if not jar:
                    try:
                        import flow_api as _fa_jar
                        jar = (_fa_jar.best_session_cookies(
                            log=lambda m: None) or "").strip()
                    except Exception:
                        jar = ""
                if jar:
                    self._mismatch_temp_once = True
                    if not getattr(self, "_profile_dir_orig", ""):
                        self._profile_dir_orig = (
                            getattr(self, "_profile_dir", "") or "")
                    try:
                        self._profile_dir = tempfile.mkdtemp(
                            prefix="mint_mismatch_")
                    except Exception:
                        self._profile_dir = ""
                    self._skip_inject = False
                    self._cookies = jar
                    # GIU _cookie_mismatch=True: MintKep co the chuyen Cookie
                    # Flow ngay khi Connected, khong cho 60s sidecar /about.
                    self.log(
                        "CookieMismatch recovery: mint 1 lan bang ho so TAM "
                        "+ cookie jar TK (profile="
                        + (self._profile_dir or "(tam)")
                        + ") — neu /about se HARD STOP + fallback Cookie Flow")
                    with self._dem_lock:
                        self._dem_token = 0
                    backoff = 0
                    time.sleep(0.5)
                    continue
                self._mismatch_stop_rebuild = True
                self.log(
                    "CookieMismatch — khong co jar TK de thu temp profile; "
                    "dung sidecar, de MintKep fallback Cookie Flow.")
                break
            if self._reset_flag.is_set():
                self.log(f"dựng lại sidecar mint ({self._reset_reason})")
                with self._dem_lock:
                    self._dem_token = 0
                backoff = 0
            else:
                self.log("sidecar mint tắt bất ngờ — dựng lại")
                self._bao_loi_cuoi()
                backoff = min(backoff + 1, 5)
            time.sleep(backoff * 0.5)
        # dọn config tạm
        try:
            if self._cfg_path and os.path.exists(self._cfg_path):
                os.remove(self._cfg_path)
        except Exception:
            pass
        self.dead.set()

    # ---------- cấp cookie ----------
    def set_cookies(self, cookie_str: str) -> None:
        """Nạp chuỗi cookie đăng nhập TRƯỚC khi start().

        Chuỗi rỗng = clear (sidecar sẽ không inject). Khi hồ sơ Cookie_10
        đã LOGIN=CO, image_gen gọi set_cookies("") + set_skip_inject(True).
        Jar gốc vẫn giữ ở `_cookies_jar` để recovery CookieMismatch.
        """
        ck = (cookie_str or "").strip()
        self._cookies = ck
        if ck:
            self._cookies_jar = ck


    def set_skip_inject(self, skip: bool = True) -> None:
        """Bỏ inject cookie — dùng cookie native hồ sơ (SuperVeo / Cookie_10)."""
        self._skip_inject = bool(skip)
        if self._skip_inject:
            self._cookies = ""
            try:
                self.log("skip inject because profile logged in "
                         "(set_skip_inject) — dung cookie native ho so")
            except Exception:
                pass

    def note_cookie_mismatch(self, msg: str = "") -> None:
        """Sidecar báo CookieMismatch — bật cờ cho MintKep fallback ext."""
        self._cookie_mismatch = True
        self._cookie_mismatch_count = int(
            getattr(self, "_cookie_mismatch_count", 0) or 0) + 1
        try:
            self.log(
                f"CookieMismatch #{self._cookie_mismatch_count}"
                + (f": {msg}" if msg else "")
                + " — 1 lan temp jar roi fallback Cookie Flow (ext auto)")
            self.log(
                "Tip: Cookie_10 lech/dual Chrome — Lay Cookie lai, DONG Chrome "
                "ho so do truoc khi mint (tranh CookieMismatch).")
        except Exception:
            pass

    def note_about_not_logged_in(self, msg: str = "") -> None:
        """Temp/native recovery roi /about — hard fail, dung rebuild sidecar."""
        self._mismatch_about_fail = True
        self._mismatch_stop_rebuild = True
        self._cookie_mismatch = True
        self._cookie_mismatch_count = int(
            getattr(self, "_cookie_mismatch_count", 0) or 0) + 1
        try:
            self.log(
                "HARD FAIL /about (chua login)"
                + (f": {msg}" if msg else "")
                + " — dung sidecar rebuild; MintKep fallback Cookie Flow")
        except Exception:
            pass

