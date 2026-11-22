# Architecture rules

- Public market statistics are fetched directly from the VPS public aggregate endpoint by one small query hook; keep this page independent of authentication and backend functions to preserve the public read-only boundary.
- The portal desk reads only the VPS desk queue and DNA using the portal session bearer token and no cookies; pricing is displayed verbatim, and synthetic fallback is restricted to development and Lovable preview hosts.