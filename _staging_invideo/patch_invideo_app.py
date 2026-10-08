from pathlib import Path
import re

src = Path(r"K:\PB_MEDIA_TAURI\src")
staging = Path(r"C:\Users\Admin\pb_media_src")

# Prefer staging next to copy destination
candidates = [
    Path(__file__).resolve().parent,
    staging,
    Path(r"K:\PB_MEDIA_TAURI\_staging_invideo"),
]
tsx = css = None
for c in candidates:
    a, b = c / "InVideoWorkspace.tsx", c / "invideo_styles.css"
    if a.exists() and b.exists():
        tsx, css = a, b
        break
if not tsx:
    raise SystemExit("InVideoWorkspace.tsx / invideo_styles.css not found")

(src / "InVideoWorkspace.tsx").write_text(tsx.read_text(encoding="utf-8"), encoding="utf-8")
print("wrote InVideoWorkspace.tsx", (src / "InVideoWorkspace.tsx").stat().st_size)

app_path = src / "App.tsx"
app = app_path.read_text(encoding="utf-8")

if "import InVideoWorkspace from './InVideoWorkspace'" not in app:
    if "import FlowWorkspace from './FlowWorkspace'" in app:
        app = app.replace(
            "import FlowWorkspace from './FlowWorkspace'",
            "import FlowWorkspace from './FlowWorkspace'\nimport InVideoWorkspace from './InVideoWorkspace'",
        )
    elif "import MuseWorkspace from './MuseWorkspace'" in app:
        app = app.replace(
            "import MuseWorkspace from './MuseWorkspace'",
            "import MuseWorkspace from './MuseWorkspace'\nimport InVideoWorkspace from './InVideoWorkspace'",
        )
    else:
        app = app.replace(
            "import VidsWorkspace from './VidsWorkspace'",
            "import VidsWorkspace from './VidsWorkspace'\nimport InVideoWorkspace from './InVideoWorkspace'",
        )
    print("added import")
else:
    print("import already present")

# Badge V2 to match screenshots
app = app.replace(
    "{ id: 'invideo', label: 'InVideo', badge: 'V3', badgeCls: 'v3' }",
    "{ id: 'invideo', label: 'InVideo', badge: 'V2', badgeCls: 'v2' }",
)

# tab-invideo class
if "tab-invideo" not in app:
    if "${t.id === 'flow' ? 'tab-flow' : ''}`}" in app:
        app = app.replace(
            "${t.id === 'flow' ? 'tab-flow' : ''}`}",
            "${t.id === 'flow' ? 'tab-flow' : ''} ${t.id === 'invideo' ? 'tab-invideo' : ''}`}",
        )
        print("added tab-invideo class")
    else:
        raise SystemExit("could not find tab-flow class hook")
else:
    print("tab-invideo already present")

# Render branch
if "top === 'invideo'" not in app:
    needle = ") : top === 'flow' ? (\n          <FlowWorkspace />\n        ) : top === 'voice' ? ("
    repl = ") : top === 'flow' ? (\n          <FlowWorkspace />\n        ) : top === 'invideo' ? (\n          <InVideoWorkspace />\n        ) : top === 'voice' ? ("
    if needle not in app:
        # try CRLF
        needle = ") : top === 'flow' ? (\r\n          <FlowWorkspace />\r\n        ) : top === 'voice' ? ("
        repl = ") : top === 'flow' ? (\r\n          <FlowWorkspace />\r\n        ) : top === 'invideo' ? (\r\n          <InVideoWorkspace />\r\n        ) : top === 'voice' ? ("
    if needle not in app:
        raise SystemExit("could not find flow/voice branch to insert invideo")
    app = app.replace(needle, repl, 1)
    print("added invideo render branch")
else:
    # ensure component usage
    if "<InVideoWorkspace" not in app:
        raise SystemExit("top === invideo present but missing component")
    print("invideo branch already present")

app_path.write_text(app, encoding="utf-8")
print("App.tsx patched, len=", len(app))

# CSS append
css_path = src / "App.css"
cur = css_path.read_text(encoding="utf-8")
extra = css.read_text(encoding="utf-8")
if ".inv-root {" in cur and "InVideo · Video Manager" in cur:
    print("InVideo CSS already present — skip")
else:
    if ".inv-root {" in cur:
        cur = re.sub(r"\n/\* ===== InVideo · Video Manager.*", "\n", cur, count=1, flags=re.S)
    css_path.write_text(cur.rstrip() + "\n" + extra + "\n", encoding="utf-8")
    print("App.css appended InVideo styles, size=", css_path.stat().st_size)

# sanity — do not break Muse/Flow
app3 = app_path.read_text(encoding="utf-8")
assert "import MuseWorkspace from './MuseWorkspace'" in app3
assert "import FlowWorkspace from './FlowWorkspace'" in app3
assert "import InVideoWorkspace from './InVideoWorkspace'" in app3
assert "function MuseWorkspace()" not in app3
assert "function FlowWorkspace()" not in app3
assert "<MuseWorkspace" in app3
assert "<FlowWorkspace" in app3
assert "<InVideoWorkspace" in app3
assert "tab-invideo" in app3
assert "badge: 'V2'" in app3
assert (src / "MuseWorkspace.tsx").exists()
assert (src / "FlowWorkspace.tsx").exists()
css3 = css_path.read_text(encoding="utf-8")
assert ".muse-root {" in css3
assert ".flow-root {" in css3
assert ".inv-root {" in css3
print("sanity OK — Muse/Flow intact")
