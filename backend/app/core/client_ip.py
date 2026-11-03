"""The visitor's real IP address, also when requests arrive through a local tunnel."""

import ipaddress

from fastapi import Request


def _parse(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value.strip())
    except ValueError:
        return None


def client_ip(request: Request) -> str | None:
    """The address that connected, unless it's this machine.

    Tunnels (Tailscale Funnel, Cloudflare Tunnel) run locally and connect from localhost,
    passing the visitor's address in X-Forwarded-For. Only then is that header believed:
    anyone on the internet can send it, so from any other address it's ignored. The last
    entry is the one our tunnel added; earlier ones came from the visitor and prove nothing.
    """
    peer = _parse(request.client.host) if request.client else None
    if peer is None or not peer.is_loopback:
        return str(peer) if peer else None
    forwarded = request.headers.get("x-forwarded-for", "").split(",")
    visitor = _parse(forwarded[-1])
    return str(visitor) if visitor else str(peer)
