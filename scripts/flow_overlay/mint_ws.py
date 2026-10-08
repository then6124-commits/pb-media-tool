# -*- coding: utf-8 -*-
"""Máy chủ WebSocket nội bộ để TIỆN ÍCH CHROME đúc token reCAPTCHA hộ tool.

VÌ SAO CÓ FILE NÀY (24/09)
--------------------------
Google đã bỏ API cũ; tạo video giờ đi `batchexecute YhhmEf` và request đó phải
kèm token reCAPTCHA. Token do tool tự đúc bằng Chrome điều khiển (puppeteer,
hồ sơ tạm) luôn bị chấm điểm thấp → `PUBLIC_ERROR_UNUSUAL_ACTIVITY`, trong khi
người dùng bấm tạo tay trên flow.google.com thì chạy bình thường.

29/09: PRIMARY mint = Cookie Flow / Chrome thật (VIDEO + IMAGE).
CAPCUT_MINT_PRIMARY=ext (mặc định); sidecar chỉ backup khi disconnected/timeout.
28/09 IMAGE: CAPCUT_IMAGE_MINT_PRIMARY=ext — align VIDEO cùng ext.
29/09 IMAGE FAST: uu tien tab /project/; timeout ngan (~10s); 1 warn roi mint.
Uu tien flow.google.com/project/ tab khi mint_ws xin_token.

Soi SuperVeo 3.6.9 (`extension-superveo`, tiện ích «Cookie-Editor + Recaptcha
Pusher» 2.2.0, `cookie-editor.js` 1278 dòng sau khi giải rối) thì thấy nó KHÔNG
tự đúc: tiện ích nằm trong TRÌNH DUYỆT THẬT của người dùng, gọi
`grecaptcha.enterprise.execute(siteKey, {action})` ngay trong tab Flow rồi đẩy
token về app qua `ws://127.0.0.1:<cổng>/ws`.

GIAO THỨC — ĐẶT THEO ĐÚNG SUPERVEO, CÓ LÝ DO
--------------------------------------------
Dùng y tên gói của SuperVeo để tiện ích CỦA HỌ cắm vào tool này cũng chạy
(người dùng đã cài sẵn nó). Tiện ích của họ chặn mọi yêu cầu khi chưa được
"xác thực cầu nối", nên vừa nối là ta gửi `auth_ok` luôn.

    tool → tiện ích : {"type":"auth_ok"}                      (ngay khi nối)
                      {"type":"ping"}                         (20 giây một lần)
                      {"type":"need_token","request_id":"…","action":"…","count":1}
                      {"type":"reload_tab"}                   (dựng lại tab Flow)
                      {"type":"cancel"}
    tiện ích → tool : {"type":"tokens","request_id":"…","tokens":["0cAF…"]}
                      {"type":"error","message":"…","request_id":"…"}
                      {"type":"pong"} / {"type":"hello",…}

Vẫn nhận cả dạng `{"type":"token","id":N,"token":…}` của bản 1.3.0 để tiện ích
cũ chưa kịp cập nhật không chết.

MỘT LẦN MỘT TOKEN: tiện ích (cả của SuperVeo) chỉ xử lý một yêu cầu mint mỗi
lúc — gửi hai cái song song thì cái sau bị bỏ im, người gọi treo tới hết giờ.
Vì vậy `xin_token()` nối đuôi bằng khoá, đừng bỏ.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import threading
import time
import uuid

#: CỔNG RIÊNG của PB MEDIA_SRT — thử TRƯỚC.
#:
#: Soi SuperVeo đang chạy trên máy người dùng (netstat 25/09):
#:     SuperVeo PID 29484 nghe DUY NHẤT 127.0.0.1:3456 ← tiện ích của nó nối vào
#: Nó không có mẹo gì: chiếm được cổng ĐẦU dải nên tiện ích trúng ngay phát đầu.
#: Tool mình mở sau thì 3456/3457 đã có chủ, phải lấy 3458 — và tiện ích phải
#: dò lần lượt, mỗi lần dò hỏng là một dòng trong bảng «Lỗi» của Chrome, lại
#: còn bị Chrome phạt vì nối hỏng liên tiếp (đo được: 57,8 giây mới bắt được
#: dù tool đã chạy sẵn).
#: Cổng riêng thì không ai tranh: tiện ích hỏi một phát là trúng.
CONG_RIENG = tuple(range(17361, 17366))

#: Dải cũ — vẫn nghe để tiện ích SuperVeo (và bản tiện ích cũ) cắm vào được.
CONG = tuple(range(3456, 3467))
_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
#: Sàn cứng: ngắn hơn mức này chắc chắn là rác, vứt thẳng.
DAI_TOI_THIEU = 100
#: Token reCAPTCHA Enterprise thật dài khoảng 2300–2500 ký tự.
#: Log SuperVeo 25/09 (lần chạy THÀNH CÔNG): «token nguyên vẹn (len 2318)».
#: Nó đo độ dài trước khi nộp; tool mình trước đây nhận bừa từ 100 ký tự,
#: nên token cụt vẫn được gửi đi rồi ăn lỗi mà không biết vì sao.
DAI_BINH_THUONG = 1000
#: Nhịp ping. Tiện ích tự ngắt-nối lại nếu 30 giây không thấy ping (như SuperVeo).
NHIP_PING = 20.0


def _bat_tay(du_lieu: bytes) -> bytes | None:
    """Trả về phản hồi bắt tay WebSocket, hoặc None nếu không phải yêu cầu hợp lệ."""
    dong = du_lieu.split(b"\r\n")
    if not dong or b"GET" not in dong[0]:
        return None
    khoa = ""
    for d in dong[1:]:
        if d.lower().startswith(b"sec-websocket-key:"):
            khoa = d.split(b":", 1)[1].strip().decode("ascii", "ignore")
            break
    if not khoa:
        return None
    chap = base64.b64encode(
        hashlib.sha1((khoa + _GUID).encode("ascii")).digest()).decode("ascii")
    return ("HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {chap}\r\n\r\n").encode("ascii")


def _khung_text(chu: str) -> bytes:
    """Đóng gói một khung text (máy chủ KHÔNG mask)."""
    b = chu.encode("utf-8")
    n = len(b)
    if n < 126:
        dau = struct.pack("!BB", 0x81, n)
    elif n < (1 << 16):
        dau = struct.pack("!BBH", 0x81, 126, n)
    else:
        dau = struct.pack("!BBQ", 0x81, 127, n)
    return dau + b


class MayChuMint:
    """Nghe ở 127.0.0.1 (và [::1]), phục vụ NHIỀU tiện ích cùng lúc.

    VÌ SAO PHẢI NHIỀU (log thật 25/09):

        1:13:13  [mint-ws] tiện ích Chrome đã nối
        1:13:14  [mint-ws] tiện ích Chrome đã nối
        1:13:15  [mint-ws] tiện ích Chrome đã nối
        1:14:27  [mint-ws] hết giờ chờ token

    Trên máy người dùng có nhiều Chrome cùng chạy tiện ích: Chrome thật (đã
    đăng nhập), Chrome hồ sơ riêng của tool, Chrome dự phòng của bộ mint cũ…
    Bản trước chỉ giữ MỘT kết nối — cái nối sau đá cái nối trước ra. Xui là
    cái còn lại đúng vào Chrome CHƯA ĐĂNG NHẬP (trang /about, không có
    grecaptcha) → mọi yêu cầu token chờ tới hết giờ, trong khi Chrome thật
    ngồi không ngay bên cạnh.

    Giờ giữ hết, và hỏi lần lượt: ưu tiên cái GẦN ĐÂY NHẤT đúc được token,
    hỏng thì sang cái kế. Chrome nào đăng nhập sẽ tự nổi lên đầu hàng.
    """

    #: Chờ MỘT tiện ích bao lâu trước khi hỏi tiện ích kế (giây).
    CHO_MOI_CAI = 40.0

    def __init__(self, log=None):
        self.log = log or (lambda m: None)
        self.cong = 0
        self.cong_rieng = 0
        self._srv: list[socket.socket] = []
        self._clis: list[socket.socket] = []
        self._ua: dict[int, str] = {}           # id(socket) -> UA
        self._van_tay: dict[int, str] = {}      # id(socket) -> phiên Google nào
        self._diem: dict[int, float] = {}       # id(socket) -> lần cuối đúc được
        self._href: dict[int, str] = {}         # id(socket) -> tab href (/project/)
        self._nhac_nhieu_cli = 0.0   # rate-limit warn multi-client
        self._da_bao_uu_tien_proj = False
        self._stop = threading.Event()
        # Soft-cancel: bam Dung giua chung -> danh thuc waiter mint/RPC
        # ma KHONG dong may chu (tien ich con noi cho me sau).
        self._huy_cho = threading.Event()
        self._gui_lock = threading.Lock()
        self._mint_lock = threading.Lock()      # một yêu cầu mint mỗi lúc
        self._cho: dict[str, tuple[list, threading.Event]] = {}
        self._noi_luc = 0.0
        self._loi_cuoi = ""
        self._nhac_khac_phien = 0.0      # lần cuối nhắc "khác phiên"
        #: UA của Chrome ĐÚC ĐƯỢC TOKEN gần nhất. Phải gửi đúng UA này khi nộp
        #: request, nếu không Google chấm "đúc một nơi, nộp một nẻo" → 403.
        self.ua = ""

    # ---------- vòng đời ----------
    def start(self) -> bool:
        for c in CONG:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", c))
                s.listen(4)
                self._srv.append(s)
                self.cong = c
                break
            except OSError:
                continue
        if not self._srv:
            self.log("[mint-ws] không mở được cổng nào trong "
                     f"{CONG[0]}–{CONG[-1]}")
            return False
        # Tiện ích thử CẢ `ws://localhost:…`. Trên Windows `localhost` hay ra
        # ::1 trước — không nghe IPv6 thì lượt đó nối trượt, phải chờ lượt sau.
        try:
            s6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
            s6.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s6.bind(("::1", self.cong))
            s6.listen(4)
            self._srv.append(s6)
        except OSError:
            pass
        # Nghe THÊM một cổng riêng (xem CONG_RIENG). Tiện ích hỏi cổng này
        # trước nên không phải dò cả dải, không bị Chrome phạt.
        for c in CONG_RIENG:
            try:
                sr = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sr.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sr.bind(("127.0.0.1", c))
                sr.listen(4)
                self._srv.append(sr)
                self.cong_rieng = c
                break
            except OSError:
                continue
        for s in self._srv:
            threading.Thread(target=self._vong_nhan, args=(s,), daemon=True,
                             name="mint-ws").start()
        threading.Thread(target=self._vong_ping, daemon=True,
                         name="mint-ws-ping").start()
        _cong = [c for c in ([self.cong_rieng] if self.cong_rieng else [])
                            + [self.cong] if c]
        _cong = list(dict.fromkeys(_cong))          # cùng một cổng thì in một lần
        self.log("[mint-ws] đang nghe "
                 + ", ".join(f"ws://127.0.0.1:{c}/ws" for c in _cong))
        return True

    def _phai_dung(self) -> bool:
        """True neu may chu tat han hoac dang soft-cancel (bam Dung)."""
        return self._stop.is_set() or self._huy_cho.is_set()

    def bao_dung(self) -> None:
        """Bam Dung: huy waiter mint/RPC ngay, giu cong + tien ich."""
        self._huy_cho.set()
        try:
            self.huy()
        except Exception:
            pass
        try:
            items = list(self._cho.items())
        except Exception:
            items = []
        for rid, pair in items:
            try:
                hop, xong = pair
                if hop is not None and not hop:
                    hop.append({"error": "da dung"})
                if xong is not None:
                    xong.set()
            except Exception:
                pass
            try:
                self._cho.pop(rid, None)
            except Exception:
                pass

    def tiep_tuc(self) -> None:
        """Me moi: xoa soft-cancel de mint lai duoc."""
        try:
            self._huy_cho.clear()
        except Exception:
            self._huy_cho = threading.Event()

    def stop(self) -> None:
        self._stop.set()
        try:
            self.bao_dung()
        except Exception:
            pass
        for s in list(self._srv) + list(self._clis):
            try:
                if s:
                    s.close()
            except Exception:
                pass
        self._srv = []
        self._clis = []

    @property
    def da_noi(self) -> bool:
        return bool(self._clis)

    @property
    def so_tien_ich(self) -> int:
        return len(self._clis)

    def _thu_tu(self) -> list:
        """Tiện ích nào đúc được token gần đây nhất thì hỏi trước."""
        return sorted(list(self._clis),
                      key=lambda c: self._diem.get(id(c), 0.0), reverse=True)

    @property
    def loi_cuoi(self) -> str:
        return self._loi_cuoi

    # ---------- nhận kết nối ----------
    def _vong_nhan(self, srv: socket.socket) -> None:
        while not self._stop.is_set():
            try:
                cli, _ = srv.accept()
            except OSError:
                return
            try:
                cli.settimeout(10)
                yeu_cau = cli.recv(4096)
                tra_loi = _bat_tay(yeu_cau)
                if not tra_loi:
                    # 28/09 — NÓI RA khi có kết nối KHÔNG phải Cookie Flow.
                    #
                    # Đo thật: SuperVeo cũng mở máy chủ WebSocket cùng dải cổng
                    # (nó chiếm 3456, tool lùi xuống 3457), và tiện ích của nó
                    # quét cả dải nên gõ luôn vào cổng tool. Những kết nối đó
                    # bắt tay hỏng rồi bị đóng, im lặng — người dùng nhìn
                    # «đang chờ tiện ích» mãi mà không hiểu vì sao, trong khi
                    # netstat thì thấy rõ có 4 kết nối đang vào cổng.
                    self._la = getattr(self, "_la", 0) + 1
                    if self._la in (1, 5, 20) or self._la % 50 == 0:
                        self.log(f"[mint-ws] ⚠ có {self._la} kết nối lạ vào "
                                 "cổng này nhưng KHÔNG bắt tay được — không "
                                 "phải Cookie Flow (hay gặp khi SuperVeo đang "
                                 "mở: tiện ích của nó quét cả dải cổng).")
                        self.log("   → Nếu tool cứ «chờ tiện ích»: đóng "
                                 "SuperVeo, rồi chrome://extensions bấm "
                                 "Reload «Cookie Flow».")
                    cli.close()
                    continue
                cli.sendall(tra_loi)
                cli.settimeout(None)
            except Exception:
                try:
                    cli.close()
                except Exception:
                    pass
                continue
            self._clis.append(cli)
            self._noi_luc = time.time()
            _ncli = len(self._clis)
            self.log(f"[mint-ws] tiện ích Chrome đã nối "
                     f"({_ncli} đang nối)")
            if _ncli > 1:
                self.log(
                    f"[mint-ws] ⚠ {_ncli} Cookie Flow đang nối — de 1 tab Flow "
                    "project thoi (dong tab/extension thua). Nhieu client de "
                    "mint vao Chrome chua login (/about).")
            # Tiện ích SuperVeo chặn mọi yêu cầu tới khi được xác thực.
            self._gui({"type": "auth_ok"}, cli)
            threading.Thread(target=self._vong_doc, args=(cli,), daemon=True,
                             name="mint-ws-doc").start()

    def _vong_ping(self) -> None:
        while not self._stop.wait(NHIP_PING):
            for cli in list(self._clis):
                self._gui({"type": "ping", "t": int(time.time() * 1000)}, cli)

    # ---------- đọc khung ----------
    def _doc_du(self, s: socket.socket, n: int) -> bytes:
        ra = b""
        while len(ra) < n:
            m = s.recv(n - len(ra))
            if not m:
                raise ConnectionError("đóng")
            ra += m
        return ra

    def _vong_doc(self, cli: socket.socket) -> None:
        try:
            while not self._stop.is_set():
                d = self._doc_du(cli, 2)
                fin_op, mask_len = d[0], d[1]
                op = fin_op & 0x0F
                co_mask = bool(mask_len & 0x80)
                dai = mask_len & 0x7F
                if dai == 126:
                    dai = struct.unpack("!H", self._doc_du(cli, 2))[0]
                elif dai == 127:
                    dai = struct.unpack("!Q", self._doc_du(cli, 8))[0]
                mask = self._doc_du(cli, 4) if co_mask else b""
                than = self._doc_du(cli, dai) if dai else b""
                if co_mask:
                    than = bytes(b ^ mask[i % 4] for i, b in enumerate(than))
                if op == 0x8:                      # close
                    break
                if op == 0x9:                      # ping → pong
                    with self._gui_lock:
                        cli.sendall(struct.pack("!BB", 0x8A, len(than)) + than)
                    continue
                if op != 0x1:
                    continue
                try:
                    goi = json.loads(than.decode("utf-8", "ignore"))
                except Exception:
                    continue
                self._nhan_goi(goi, cli)
        except Exception:
            pass
        finally:
            if cli in self._clis:
                self._clis.remove(cli)
                self._ua.pop(id(cli), None)
                self._diem.pop(id(cli), None)
                self._van_tay.pop(id(cli), None)
                self._href.pop(id(cli), None)
                self.log(f"[mint-ws] tiện ích Chrome đã ngắt "
                         f"({len(self._clis)} còn nối)")
            try:
                cli.close()
            except Exception:
                pass

    def _xong(self, rid, goi: dict) -> None:
        cho = self._cho.pop(str(rid), None)
        if cho:
            cho[0].append(goi)
            cho[1].set()

    def _nhan_goi(self, goi: dict, cli=None) -> None:
        loai = (goi.get("type") or "").lower()
        if loai == "hello":
            ua = str(goi.get("ua") or "")
            vt = str(goi.get("van_tay") or "")
            if cli is not None:
                self._ua[id(cli)] = ua
                if vt:
                    self._van_tay[id(cli)] = vt
                _hf = str(goi.get("href") or "").strip()
                if _hf:
                    self._href[id(cli)] = _hf
            if not self.ua:            # chưa có ai đúc được thì tạm dùng cái này
                self.ua = ua
            self.log("[mint-ws] tiện ích chào: " + ua[:60])
            return
        if loai in ("ping", "pong"):
            if loai == "ping":
                self._gui({"type": "pong"}, cli)
            return
        if loai == "tokens":                       # kiểu SuperVeo
            ds = [t for t in (goi.get("tokens") or [])
                  if isinstance(t, str) and len(t) >= DAI_TOI_THIEU]
            self._xong(goi.get("request_id"), {"tokens": ds})
            return
        if loai == "rpc_result":
            _hf = str(goi.get("href") or "").strip()
            if cli is not None and _hf:
                self._href[id(cli)] = _hf
            self._xong(goi.get("request_id"),
                       {"status": int(goi.get("status") or 0),
                        "body": str(goi.get("body") or ""),
                        "projectId": str(goi.get("projectId") or ""),
                        "href": _hf})
            return
        if loai == "cookies":                      # cookie + at từ Chrome thật
            _hf = str(goi.get("href") or "").strip()
            if cli is not None and _hf:
                self._href[id(cli)] = _hf
            self._xong(goi.get("request_id"),
                       {"cookies": str(goi.get("cookie") or ""),
                        "at": str(goi.get("at") or ""),
                        "fsid": str(goi.get("fsid") or ""),
                        "bl": str(goi.get("bl") or ""),
                        "href": _hf})
            return
        if loai in ("token", "result"):             # kiểu bản 1.3.0
            self._xong(goi.get("request_id") or goi.get("id"),
                       {"tokens": [goi["token"]] if goi.get("token") else [],
                        "error": goi.get("error") or ""})
            return
        if loai == "error":
            self._loi_cuoi = str(goi.get("message") or "")[:200]
            rid = goi.get("request_id")
            if rid is None:                        # lỗi không gắn yêu cầu nào
                self.log(f"[mint-ws] tiện ích báo lỗi: {self._loi_cuoi[:100]}")
                return
            self._xong(rid, {"tokens": [], "error": self._loi_cuoi})

    def _gui(self, goi: dict, cli=None) -> bool:
        if cli is None:
            cli = (self._thu_tu() or [None])[0]
        if cli is None:
            return False
        try:
            with self._gui_lock:
                cli.sendall(_khung_text(json.dumps(goi, ensure_ascii=False)))
            return True
        except Exception:
            if cli in self._clis:
                self._clis.remove(cli)
            return False

    # ---------- việc chính ----------
    def _hoi_mot(self, cli, goi: dict, han: float) -> dict:
        """Gui mot yeu cau toi DUNG mot tien ich, cho tra loi. {} = truot."""
        if self._phai_dung():
            return {"error": "da dung"}
        rid = uuid.uuid4().hex[:12]
        goi = dict(goi, request_id=rid)
        hop, xong = [], threading.Event()
        self._cho[rid] = (hop, xong)
        if not self._gui(goi, cli):
            self._cho.pop(rid, None)
            return {}
        # Cho tung khuc ngan: bam Dung -> thoat ngay, khong treo 40-100s.
        han = max(0.1, float(han or 0))
        deadline = time.time() + han
        while True:
            if self._phai_dung():
                self._cho.pop(rid, None)
                try:
                    self._gui({"type": "cancel", "request_id": rid}, cli)
                except Exception:
                    pass
                return {"error": "da dung"}
            con = deadline - time.time()
            if con <= 0:
                break
            if xong.wait(min(0.25, con)):
                break
        if not xong.is_set():
            self._cho.pop(rid, None)
            # Het gio ben minh KHONG co nghia tien ich da bo cuoc: no van dang
            # duc, va khoa mot-luot-mot cua no van giu. Lan sau hoi se an ngay
            # «dang duc token khac, thu lai sau» (thay trong test 2 Chrome).
            # Bao huy de no nha khoa.
            self._gui({"type": "cancel", "request_id": rid}, cli)
            return {"error": "het gio"}
        return (hop[0] if hop else {}) or {}

    def van_tay_dang_noi(self) -> set:
        """Các phiên Google mà những Chrome đang nối thuộc về."""
        return {v for v in self._van_tay.values() if v}

    def co_van_tay(self, van_tay: str) -> bool:
        """Có tiện ích nào đang đăng nhập đúng phiên này không."""
        vt = (van_tay or "").strip()
        return bool(vt) and vt in set(self._van_tay.values())

    def xin_token(self, action: str = "VIDEO_GENERATION",
                  timeout: float = 90.0, van_tay: str = "",
                  project_id: str = "", email: str = "") -> str:
        """Nhờ tiện ích đúc một token. '' = không có (chưa nối / lỗi / hết giờ).

        Hỏi LẦN LƯỢT từng tiện ích đang nối, không dồn hết cược vào một cái:
        máy người dùng hay có vài Chrome cùng chạy tiện ích, và chỉ một trong
        số đó đăng nhập Flow. Cái đăng nhập sẽ trả token trong 1–3 giây, mấy
        cái kia trả lỗi ngay nhờ lượt soát URL trong inject.js.
        """
        if not self._clis:
            return ""
        if self._phai_dung():
            self._loi_cuoi = "da dung"
            return ""
        with self._mint_lock:
            if self._phai_dung():
                self._loi_cuoi = "da dung"
                return ""
            han_chung = time.time() + float(timeout)
            # 29/09 IMAGE FAST: KHONG cho ~8–18s ve 1 Connected moi lan mint.
            # Co tab flow.google.com/project/ → mint ngay (1 warn).
            # Chua co /project/ → cho ngan ≤2.5s; het gio van soft-mint.
            # CAPCUT_MINT_WS_ONE_CLIENT=1 → chi refuse khi van >1 VA khong co /project/.
            _one = (os.environ.get("CAPCUT_MINT_WS_ONE_CLIENT") or "").strip().lower()
            _force_one = _one in ("1", "yes", "on", "true")
            _n0 = len(self._clis)

            def _cli_project(c) -> bool:
                _h = (self._href.get(id(c)) or "").lower()
                return ("flow.google.com" in _h and "/project/" in _h
                        and "/about" not in _h)

            _proj0 = [c for c in self._clis if _cli_project(c)]
            if _n0 > 1:
                if _proj0:
                    # Co tab /project/ — mint ngay, 1 warn / 60s (khong spam).
                    _noww = time.time()
                    if _noww - getattr(self, "_nhac_nhieu_cli", 0) > 60:
                        self._nhac_nhieu_cli = _noww
                        self.log(
                            f"[mint-ws] {_n0} Cookie Flow Connected, "
                            f"{len(_proj0)} tab /project/ — mint ngay "
                            "(khong cho ve 1; uu tien /project/).")
                else:
                    # Chua thay /project/ — cho ngan ≤2.5s xem co xuat hien.
                    _cho_het = min(2.5, max(0.0, han_chung - time.time() - 1.0))
                    _t_cho = time.time()
                    _da_warn = False
                    while (len(self._clis) > 1
                           and time.time() - _t_cho < _cho_het
                           and not any(_cli_project(c) for c in self._clis)):
                        if not _da_warn:
                            _da_warn = True
                            self.log(
                                f"[mint-ws] {_n0} Connected, chua co tab "
                                "/project/ — cho ≤2.5s roi mint "
                                "(khong spam lan 1,2,4,8…).")
                        if self._phai_dung():
                            self._loi_cuoi = "da dung"
                            return ""
                        time.sleep(0.25)
                    _proj0 = [c for c in self._clis if _cli_project(c)]
                    if not _proj0 and len(self._clis) > 1:
                        if _force_one:
                            self._loi_cuoi = (
                                f"co {len(self._clis)} Cookie Flow Connected "
                                "va khong tab /project/ — dong bot den 1 "
                                "(CAPCUT_MINT_WS_ONE_CLIENT=1)")
                            self.log(
                                f"[mint-ws] ⛔ BO mint: van {len(self._clis)} "
                                "client, khong /project/ — "
                                "CAPCUT_MINT_WS_ONE_CLIENT=1.")
                            return ""
                        self.log(
                            f"[mint-ws] van {len(self._clis)} client, "
                            "chua /project/ sau cho ngan — soft-mint.")
            ds = self._thu_tu()
            # Uu tien client tab flow.google.com/project (bo /about).
            _proj = [c for c in ds if _cli_project(c)]
            if _proj:
                ds = _proj + [c for c in ds if c not in _proj]
                if len(self._clis) > 1 and not getattr(self, "_da_bao_uu_tien_proj", False):
                    self._da_bao_uu_tien_proj = True
                    self.log(
                        f"[mint-ws] uu tien {len(_proj)}/{len(self._clis)} "
                        "client tab flow.google.com/project "
                        "(bo /about khi clients>1).")
            # Chi thu project-tab truoc khi soft fallback (tranh 40s x N).
            _chi_proj = bool(_proj) and len(self._clis) > 1
            if _chi_proj:
                ds_thu = list(_proj)
            else:
                ds_thu = list(ds)

            # Token gắn với PHIÊN đúc ra nó. Đúc ở Chrome của tài khoản khác
            # rồi nộp kèm cookie tài khoản này thì Google trả
            # PUBLIC_ERROR_UNUSUAL_ACTIVITY — token thật, cookie thật, nhưng
            # không cùng một phiên. Nên hỏi ĐÚNG Chrome đang đăng nhập tài
            # khoản đang chạy trước.
            vt = (van_tay or "").strip()
            if vt:
                # Tiện ích khai vân tay trong lời chào, gửi ngay sau khi nối.
                # Hỏi token đúng vào khe đó thì chưa có vân tay nào để so —
                # định tuyến theo phiên trượt, token đúc nhầm Chrome. Chờ
                # một nhịp ngắn cho lời chào tới (test bắt được khe này).
                _han_chao = time.time() + 1.5
                while (time.time() < _han_chao
                       and any(id(c) not in self._van_tay for c in ds)):
                    time.sleep(0.05)
                ds = self._thu_tu()
                khop = [c for c in ds if self._van_tay.get(id(c)) == vt]
                if khop:
                    ds = khop + [c for c in ds if c not in khop]
                elif self._van_tay:
                    # Đúc token ở phiên A rồi nộp kèm cookie phiên B thì Google
                    # trả UNUSUAL_ACTIVITY — đo được trên log thật 26/09.
                    # Cứ đúc rồi nộp là phí token VÀ làm điểm tài khoản xấu
                    # thêm, nên DỪNG ngay tại đây.
                    # Vẫn muốn thử: set CAPCUT_EP_MINT_KHAC_PHIEN=1
                    if (os.environ.get("CAPCUT_EP_MINT_KHAC_PHIEN") or ""
                            ).strip() not in ("1", "yes", "on"):
                        now = time.time()
                        if now - self._nhac_khac_phien > 30:
                            self._nhac_khac_phien = now
                            _em = (email or "").strip()
                            if not _em:
                                _em = "tài khoản đang chạy"
                            _tip_pid = (project_id or "").strip()
                            if not _tip_pid:
                                _tip_pid = (os.environ.get("CAPCUT_FLOW_PROJECT_ID")
                                            or "").strip()
                            if not _tip_pid:
                                _tip_pid = "<project-cua-TK>"
                            self.log("[mint-ws] ⛔ DỪNG: Chrome session ≠ tài khoản "
                                     "tool đang chạy (token từ wrong profile).")
                            self.log(f"   → Đang chạy: {_em} — mở ĐÚNG "
                                     "Chrome profile đang login email đó "
                                     "(không profile khác / Guest).")
                            self.log("   → Trong profile đó chỉ mở 1 tab "
                                     f"https://flow.google.com/project/{_tip_pid} "
                                     "— đóng tab /project/ khác.")
                            self.log("   → chrome://extensions → Reload "
                                     "«Cookie Flow» 1.8.6+, đợi Connected, chạy lại.")
                        self._loi_cuoi = ("không Chrome nào đang đăng nhập tài "
                                          "khoản đang chạy")
                        return ""
                    self.log("[mint-ws] ⚠ KHÔNG Chrome nào đang đăng nhập tài "
                             "khoản đang chạy — vẫn đúc vì "
                             "CAPCUT_EP_MINT_KHAC_PHIEN=1.")
            # Sau van_tay: tinh lai ds_thu (uu tien /project/ trong ds moi)
            _proj = [c for c in ds if _cli_project(c)]
            if _proj and len(self._clis) > 1:
                ds_thu = [c for c in ds if _cli_project(c)]
                _chi_proj = True
            else:
                ds_thu = list(ds)
                _chi_proj = False

            # Timeout ngan: project-tab ~10s; client khac ~8s khi multi
            # (tranh 40s x 5 client). Env: CAPCUT_MINT_WS_PROJ_TIMEOUT /
            # CAPCUT_MINT_WS_OTHER_TIMEOUT.
            try:
                _cho_proj = float(
                    os.environ.get("CAPCUT_MINT_WS_PROJ_TIMEOUT") or "10")
            except Exception:
                _cho_proj = 10.0
            try:
                _cho_other = float(
                    os.environ.get("CAPCUT_MINT_WS_OTHER_TIMEOUT") or "8")
            except Exception:
                _cho_other = 8.0
            _cho_proj = max(3.0, min(40.0, _cho_proj))
            _cho_other = max(2.0, min(40.0, _cho_other))
            _is_img = "IMAGE" in (action or "").upper()
            if _is_img and len(self._clis) > 1:
                _cho_proj = min(_cho_proj, 12.0)
                _cho_other = min(_cho_other, 8.0)

            def _hoi_ds(_ds_local, _phase=""):
                loi_local = []
                for i, cli in enumerate(_ds_local):
                    if self._phai_dung():
                        self._loi_cuoi = "da dung"
                        return "", loi_local + ["da dung"]
                    con = han_chung - time.time()
                    if con <= 1:
                        break
                    _goi_tok = {"type": "need_token", "action": action, "count": 1}
                    _pid_tok = (project_id or "").strip()
                    if not _pid_tok:
                        _pid_tok = (os.environ.get("CAPCUT_FLOW_PROJECT_ID")
                                    or "").strip()
                    if _pid_tok:
                        _goi_tok["projectId"] = _pid_tok
                    _to = (_cho_proj if _cli_project(cli)
                           else (_cho_other if len(self._clis) > 1
                                 else self.CHO_MOI_CAI))
                    d = self._hoi_mot(cli, _goi_tok, min(_to, con))
                    toks = [t for t in (d.get("tokens") or [])
                            if isinstance(t, str) and len(t) >= DAI_TOI_THIEU]
                    if toks:
                        if len(toks[0]) < DAI_BINH_THUONG:
                            self.log(
                                f"[mint-ws] ⚠ token chỉ {len(toks[0])} ký tự "
                                f"(bình thường ~2300–2500) — vẫn nộp, nhưng "
                                "Google nhiều khả năng từ chối.")
                        else:
                            self.log(
                                f"[mint-ws] token {len(toks[0])} ký tự — "
                                "độ dài bình thường.")
                        self._diem[id(cli)] = time.time()
                        ua = self._ua.get(id(cli)) or ""
                        if ua and ua != self.ua:
                            self.ua = ua
                        return toks[0], loi_local
                    loi = str(d.get("error") or "không rõ")[:100]
                    loi_local.append(loi)
                    if len(_ds_local) > 1:
                        self.log(
                            f"[mint-ws] tiện ích {i + 1}/{len(_ds_local)}"
                            f"{_phase} không đúc được ({loi}) — hỏi cái kế")
                    else:
                        self.log(f"[mint-ws] tiện ích không đúc được: {loi}")
                return "", loi_local

            tok, loi_ds = _hoi_ds(ds_thu, " [project]" if _chi_proj else "")
            if tok:
                return tok
            # Soft fallback: thu client con lai (khong phai /project/) voi timeout ngan
            if _chi_proj:
                _rest = [c for c in ds if c not in ds_thu]
                if _rest and han_chung - time.time() > 2:
                    self.log(
                        f"[mint-ws] project-tab fail — soft thu "
                        f"{len(_rest)} client con (timeout ngan).")
                    tok2, loi2 = _hoi_ds(_rest, " [other]")
                    loi_ds = loi_ds + loi2
                    if tok2:
                        return tok2
            if loi_ds:
                self._loi_cuoi = next(
                    (x for x in loi_ds
                     if "ĐĂNG NHẬP" in x or "tab Flow" in x), loi_ds[0])
                if len(self._clis) > 1 and (
                        "hết giờ" in (self._loi_cuoi or "").lower()
                        or "het gio" in (self._loi_cuoi or "").lower()
                        or "hết giờ" in " ".join(loi_ds).lower()):
                    self._loi_cuoi = (
                        f"het gio — {len(self._clis)} Cookie Flow Connected; "
                        "mo 1 tab flow.google.com/project/<pid> + Reload")
                    self.log(
                        "[mint-ws] ⛔ het gio — uu tien tab /project/; "
                        f"hien {len(self._clis)} Connected.")
            return ""

    def xin_cookie(self, timeout: float = 60.0,
                   project_id: str = "") -> dict:
        """Xin cookie + at/f.sid/bl từ Chrome THẬT. {} nếu không có.

        Đây là thứ thay cho nút «lấy bearer/cookie» phải mở Chrome điều khiển:
        cookie httpOnly (SID/HSID/APISID/SAPISID/SIDCC) chỉ tiện ích đọc được,
        còn `at` thì nằm trong `WIZ_global_data` của trang. Tiện ích bắn thêm
        một request batchexecute cố tình sai trước khi đọc, để Google cấp lại
        SIDCC/__Secure-1PSIDTS mới — chiêu của SuperVeo.

        Nhiều tiện ích thì lấy cái CÓ `at` (tức Chrome đã đăng nhập). Không
        cái nào có `at` thì trả cái có cookie, còn hơn không.
        """
        if not self._clis:
            return {}
        if self._phai_dung():
            return {}
        with self._mint_lock:
            if self._phai_dung():
                return {}
            han_chung = time.time() + float(timeout)
            du_phong = {}
            # Mot Chrome treo KHONG duoc an het thoi gian ca luot — xem
            # ghi chu ban va 01/10 (loi 2). Chia deu, san 6s tran 15s.
            _n_cli = max(1, len(self._clis))
            try:
                _cho_moi = float(os.environ.get(
                    "CAPCUT_MINT_WS_COOKIE_TIMEOUT") or 0)
            except Exception:
                _cho_moi = 0.0
            if _cho_moi <= 0:
                _cho_moi = max(6.0, min(15.0, float(timeout) / _n_cli))
            _pid_ck = (project_id or "").strip()
            for cli in self._thu_tu():
                if self._phai_dung():
                    return {}
                con = han_chung - time.time()
                if con <= 1:
                    break
                d = self._hoi_mot(
                    cli, {"type": "need_cookies", "projectId": _pid_ck},
                    min(_cho_moi, con))
                if d.get("error"):
                    self.log("[mint-ws] tiện ích không lấy được cookie: "
                             + str(d["error"])[:100])
                    continue
                if not d.get("cookies"):
                    continue
                if d.get("at"):
                    self.log(f"[mint-ws] nhận cookie từ Chrome thật "
                             f"({len(d['cookies'])} ký tự, at={len(d['at'])})")
                    self._diem[id(cli)] = time.time()
                    return d
                du_phong = du_phong or d
            if du_phong:
                self.log(f"[mint-ws] chỉ lấy được cookie, KHÔNG có at "
                         f"({len(du_phong['cookies'])} ký tự) — Chrome đang mở "
                         "chưa đăng nhập Flow.")
            return du_phong

    def goi_rpc(self, rpcid: str, f_req: str, timeout: float = 120.0,
                van_tay: str = "", project_id: str = "") -> tuple:
        """Nhờ tiện ích gửi batchexecute NGAY TRONG TAB FLOW. (status, body).

        Đây là cách gần "người dùng bấm tay" nhất mà không phải mò DOM:
        request mang cookie, `at`, vân tay TLS và ngữ cảnh trang của chính
        Chrome thật — những thứ gửi từ tiến trình ngoài không khớp hết được,
        và chính chỗ lệch đó khiến Google trả UNUSUAL_ACTIVITY (đo 26/09:
        token đúng phiên, cookie đúng, vẫn bị chặn khi tool tự gửi).

        project_id: UUID ưu tiên (Cookie 22 / URL user) — tiện ích chọn tab
        khớp và ép f.req.ctx[5], tránh sticky tab project khác (f9b97132…).

        (0, "") = không gửi được.
        """
        if not self._clis:
            return 0, ""
        if self._phai_dung():
            self._loi_cuoi = "da dung"
            return 0, ""
        with self._mint_lock:
            if self._phai_dung():
                self._loi_cuoi = "da dung"
                return 0, ""
            han = time.time() + float(timeout)
            ds = self._thu_tu()
            vt = (van_tay or "").strip()
            if vt:
                khop = [c for c in ds if self._van_tay.get(id(c)) == vt]
                if not khop:
                    self._loi_cuoi = ("không Chrome nào đang đăng nhập tài "
                                      "khoản đang chạy")
                    self.log("[mint-ws] ⛔ không gửi RPC: Chrome đang mở không "
                             "phải phiên của tài khoản đang chạy.")
                    return 0, ""
                ds = khop
            for cli in ds:
                if self._phai_dung():
                    self._loi_cuoi = "da dung"
                    return 0, ""
                con = han - time.time()
                if con <= 1:
                    break
                _pid = (project_id or "").strip()
                _han_rpc = min(35.0, float(con))
                self.log(f"[mint-ws] need_rpc → tiện ích rpcid={rpcid} "
                         f"f_req_len={len(f_req or '')} "
                         f"pid={_pid[:8]+'…' if _pid else '-'} "
                         f"timeout={_han_rpc:.0f}s")
                if _pid:
                    self.log(f"[mint-ws] ⏳ chờ tab Flow /project/{_pid[:8]}… "
                             f"(≤{_han_rpc:.0f}s). Mở đúng project rồi F5 "
                             "nếu treo ở đây.")
                goi_rpc = {"type": "need_rpc", "rpcid": rpcid, "f_req": f_req}
                if _pid:
                    goi_rpc["projectId"] = _pid
                d = self._hoi_mot(cli, goi_rpc, _han_rpc)
                if d.get("error"):
                    self._loi_cuoi = str(d["error"])[:200]
                    err = self._loi_cuoi
                    if "hết giờ" in err.lower() or "het gio" in err.lower():
                        tip = (f"need_rpc HẾT GIỜ {_han_rpc:.0f}s — "
                               f"không khớp tab /project/"
                               f"{(_pid[:8]+'…') if _pid else '?'} "
                               "hoặc inject không trả lời. Mở đúng project "
                               f"{_pid or '<project-cua-TK>'} trên flow.google.com, "
                               "Reload tiện ích Cookie Flow, rồi chạy lại.")
                        self._loi_cuoi = tip[:200]
                        self.log("[mint-ws] ⛔ " + tip)
                    else:
                        self.log(f"[mint-ws] need_rpc FAIL: "
                                 f"{self._loi_cuoi[:160]}")
                    continue
                if d.get("body") is not None:
                    self._diem[id(cli)] = time.time()
                    sc = int(d.get("status") or 0)
                    body = str(d.get("body") or "")
                    _pid_r = str(d.get("projectId") or "")[:36]
                    self._pid_rpc_cuoi = _pid_r
                    # HARD: force project — reject OK neu pid tra ve lech force
                    if (_pid and _pid_r
                            and _pid_r.lower() != _pid.lower()):
                        tip = (f"need_rpc OK nhung pid={_pid_r[:8]}… != force "
                               f"{_pid[:8]}… — REJECT (sticky tab). Mo "
                               f"/project/{_pid}, Reload Cookie Flow 1.8.5+, F5.")
                        self._loi_cuoi = tip[:200]
                        self.log("[mint-ws] ⛔ " + tip)
                        continue
                    self.log(f"[mint-ws] need_rpc OK HTTP {sc} "
                             f"body_len={len(body)}"
                             + (f" pid={_pid_r[:8]}…" if _pid_r else "")
                             + (f" force={_pid[:8]}…" if _pid else "")
                             + (" UNUSUAL" if "UNUSUAL_ACTIVITY" in body else ""))
                    return sc, body
                self.log("[mint-ws] need_rpc: tiện ích trả lời nhưng không có body")
            if not self._loi_cuoi:
                self._loi_cuoi = "need_rpc failed — không client / hết giờ / no body"
            self.log(f"[mint-ws] need_rpc hết cách: {self._loi_cuoi[:120]}")
            return 0, ""

    def nap_lai_tab(self) -> bool:
        """Nhờ tiện ích dọn cookie grecaptcha rồi dựng lại tab Flow.

        Dùng khi token liên tục bị từ chối — SuperVeo gọi đúng việc này
        (`reload_tab`) thay vì đổi trình duyệt.
        """
        if not self._clis:
            return False
        self.log("[mint-ws] nhờ tiện ích dựng lại tab Flow (dọn grecaptcha)…")
        ok = False
        for cli in list(self._clis):
            ok = self._gui({"type": "reload_tab"}, cli) or ok
        return ok

    def huy(self) -> None:
        for cli in list(self._clis):
            self._gui({"type": "cancel"}, cli)
