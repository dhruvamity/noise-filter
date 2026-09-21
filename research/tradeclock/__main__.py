"""Root-level entry point when running `python3 -m tradeclock` directly from the parent workspace."""
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent / "src"
if "tradeclock" in sys.modules:
    del sys.modules["tradeclock"]
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from tradeclock.terminal.app import main

if __name__ == "__main__":
    main()
