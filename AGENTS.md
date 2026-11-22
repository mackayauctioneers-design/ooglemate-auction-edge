# Architecture rules

- Public market statistics are fetched directly from the VPS public aggregate endpoint by one small query hook; keep this page independent of authentication and backend functions to preserve the public read-only boundary.
- The portal desk reads only the VPS desk queue, DNA, stock and auctions using the portal session bearer token and no cookies; prices, stages and gaps are server-supplied (never derived), and synthetic fallback is restricted to development and Lovable preview hosts to preserve tenant isolation and the read-only boundary.