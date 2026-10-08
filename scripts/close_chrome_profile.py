# -*- coding: utf-8 -*-
"""Close chrome.exe whose CommandLine contains PBMedia browser_N profile."""
from __future__ import annotations
import json, subprocess, sys, time

def main():
    bid = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    bid = max(1, min(4, bid))
    needle = f"chrome_flow_accounts\\browser_{bid}".lower()
    needle2 = f"chrome_flow_accounts/browser_{bid}".lower()
    killed = []
    try:
        ps = (
            "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
            "ForEach-Object { [PSCustomObject]@{ Id=$_.ProcessId; CL=$_.CommandLine } } | "
            "ConvertTo-Json -Compress"
        )
        raw = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", ps],
            text=True, encoding="utf-8", errors="replace",
        ).strip()
        if raw:
            data = json.loads(raw)
            if isinstance(data, dict):
                data = [data]
            for row in data or []:
                cl = (row.get("CL") or "").lower()
                if needle in cl or needle2 in cl:
                    pid = int(row["Id"])
                    try:
                        subprocess.check_call(
                            ["taskkill", "/PID", str(pid), "/F"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        )
                        killed.append(pid)
                    except Exception:
                        pass
        if killed:
            time.sleep(1.2)
        print(json.dumps({
            "ok": True, "killed": killed,
            "detail": (f"Da dong {len(killed)} chrome Browser {bid}" if killed
                       else f"Khong thay chrome giu browser_{bid}"),
        }, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "killed": [], "detail": str(e)}, ensure_ascii=False))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
