# -*- coding: utf-8 -*-
import base64, pathlib, re, shutil

HERE = pathlib.Path(__file__).resolve().parent
tsx = base64.b64decode((HERE / "_tsx.b64").read_text().strip()).decode("utf-8")
css = base64.b64decode((HERE / "_css.b64").read_text().strip()).decode("utf-8")

root = pathlib.Path(r"K:\PB_MEDIA_TAURI\src")
staging = pathlib.Path(r"K:\PB_MEDIA_TAURI\_staging_mini")
staging.mkdir(parents=True, exist_ok=True)

(staging / "MiniAppWorkspace.tsx").write_text(tsx, encoding="utf-8", newline="\n")
(staging / "mini.css").write_text(css, encoding="utf-8", newline="\n")
(root / "MiniAppWorkspace.tsx").write_text(tsx, encoding="utf-8", newline="\n")
(root / "mini.css").write_text(css, encoding="utf-8", newline="\n")
print("wrote MiniAppWorkspace.tsx", len(tsx), "mini.css", len(css))

app_path = root / "App.tsx"
app = app_path.read_text(encoding="utf-8")
bak = root / "App.tsx.bak_pre_mini"
if not bak.exists():
    bak.write_text(app, encoding="utf-8")
    print("backup App.tsx.bak_pre_mini")

if "import MiniAppWorkspace from './MiniAppWorkspace'" not in app:
    # prefer after TubeHunter import if present, else after Ghep
    if "import TubeHunterWorkspace from './TubeHunterWorkspace'" in app:
        app = app.replace(
            "import TubeHunterWorkspace from './TubeHunterWorkspace'",
            "import TubeHunterWorkspace from './TubeHunterWorkspace'\nimport MiniAppWorkspace from './MiniAppWorkspace'",
            1,
        )
        print("added MiniAppWorkspace import after TubeHunter")
    elif "import GhepVideoWorkspace from './GhepVideoWorkspace'" in app:
        app = app.replace(
            "import GhepVideoWorkspace from './GhepVideoWorkspace'",
            "import GhepVideoWorkspace from './GhepVideoWorkspace'\nimport MiniAppWorkspace from './MiniAppWorkspace'",
            1,
        )
        print("added MiniAppWorkspace import after Ghep")
    else:
        raise SystemExit("could not find import hook")
else:
    print("import already present")

# tab class
if "tab-mini" not in app:
    # try after ghep or tube or voice
    for needle, repl in [
        ("${t.id === 'ghep' ? 'tab-ghep' : ''}`}", "${t.id === 'ghep' ? 'tab-ghep' : ''} ${t.id === 'mini' ? 'tab-mini' : ''}`}"),
        ("${t.id === 'voice' ? 'tab-voice' : ''}`}", "${t.id === 'voice' ? 'tab-voice' : ''} ${t.id === 'mini' ? 'tab-mini' : ''`}"),
    ]:
        if needle in app:
            app = app.replace(needle, repl, 1)
            print("added tab-mini class via", needle[:40])
            break
    else:
        print("WARN: could not add tab-mini class (non-fatal)")
else:
    print("tab-mini already present")

# render branch: replace PlaceholderWorkspace fallback for mini, or insert before placeholder
if "top === 'mini'" not in app:
    # Insert before tube or before placeholder
    old = """        ) : top === 'tube' ? (
          <TubeHunterWorkspace />
        ) : (
          <PlaceholderWorkspace
            title={TOP_TABS.find((t) => t.id === top)?.label || top}
          />
        )}"""
    new = """        ) : top === 'tube' ? (
          <TubeHunterWorkspace />
        ) : top === 'mini' ? (
          <MiniAppWorkspace />
        ) : (
          <PlaceholderWorkspace
            title={TOP_TABS.find((t) => t.id === top)?.label || top}
          />
        )}"""
    if old in app:
        app = app.replace(old, new, 1)
        print("wired mini branch after tube")
    else:
        # looser replace
        needle = ") : (\n          <PlaceholderWorkspace"
        if needle in app and "top === 'mini'" not in app:
            app = app.replace(
                needle,
                ") : top === 'mini' ? (\n          <MiniAppWorkspace />\n        ) : (\n          <PlaceholderWorkspace",
                1,
            )
            print("wired mini branch before PlaceholderWorkspace")
        else:
            raise SystemExit("could not wire mini render branch")
else:
    print("mini branch already present")

app_path.write_text(app, encoding="utf-8", newline="\n")
print("patched App.tsx ok")
