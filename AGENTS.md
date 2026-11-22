# Architecture rules

- Public market statistics are fetched directly from the VPS public aggregate endpoint by one small query hook; keep this page independent of authentication and backend functions to preserve the public read-only boundary.