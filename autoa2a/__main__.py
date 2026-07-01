"""CLI entrypoint: run the 0xAuto / AutoA2A web console.

    python -m autoa2a                 # serve on http://127.0.0.1:8000
    python -m autoa2a --port 9000
    autoa2a                            # console-script equivalent
"""

from __future__ import annotations

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="0xAuto / AutoA2A demo server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--no-seed", action="store_true", help="start with an empty store"
    )
    args = parser.parse_args()

    # Build the app with the chosen seeding behaviour.
    from .api import create_app

    app = create_app(seed_data=not args.no_seed)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
