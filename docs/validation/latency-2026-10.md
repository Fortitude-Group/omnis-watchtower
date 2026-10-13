# Decision latency, 2026-10-13T22:44:57.488Z

The tripwire service deciding `npm install <name>` / `pip install <name>` for the top 100 names per ecosystem, against the live registries from one machine on a home connection, one command at a time.
SC-003: first-seen p95 under 5 s, cached under 0.5 s.

| Decision | Count | p50 | p95 | Max |
|---|---|---|---|---|
| First seen | 200 | 468 ms | 1058 ms | 1464 ms |
| Cached | 200 | 0 ms | 0 ms | 0 ms |

The PyPI names are the 100-name placeholder list (T037). Timings include the private-registry config lookup, which reads no files here.
