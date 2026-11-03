#!/usr/bin/env bash
# Double-click before a meeting: wipes the demo data and re-seeds it with leave dates around today.
cd "$(dirname "$0")" && exec "./Start MVR Demo.command" --fresh
