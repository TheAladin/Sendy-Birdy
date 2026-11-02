"""Liveness check for the frontend, scripts and monitoring."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]


@router.get("/health")
async def health() -> HealthResponse:
    """Report that the API is up."""
    return HealthResponse(status="ok")
