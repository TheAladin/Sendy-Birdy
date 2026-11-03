from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from app.core.client_ip import client_ip
from app.core.deps import SESSION_COOKIE, CurrentUser, SettingsDep
from app.core.ratelimit import too_many_attempts
from app.core.security import hash_token, new_session_token, normalize_email, verify_password
from app.db.session import SessionDep
from app.models import AuthSession, User
from app.schemas.auth import LoginRequest, UserOut
from app.services.activity import add_event

router = APIRouter(prefix="/auth", tags=["auth"])

# The cookie is only needed by the API, so it isn't sent with page or asset requests.
COOKIE_PATH = "/api"


@router.post("/login", responses={429: {"description": "Too many failed attempts"}})
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
) -> UserOut:
    limiter = request.app.state.rate_limits.login
    visitor = client_ip(request) or "unknown"
    # Checked first, so a blocked attempt doesn't even cost a password hash.
    if wait := limiter.retry_after(visitor):
        raise too_many_attempts(wait)

    user = await session.scalar(select(User).where(User.email == normalize_email(body.email)))
    valid, new_hash = await verify_password(body.password, user.password_hash if user else None)
    if user is None or not valid:
        limiter.record_failure(visitor)
        add_event(session, request, "login_failed")
        await session.commit()
        # Same message for both cases, so the response doesn't reveal which emails exist.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    if new_hash:
        user.password_hash = new_hash
    limiter.reset(visitor)

    token = new_session_token()
    lifetime = timedelta(days=settings.session_days)
    session.add(
        AuthSession(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=datetime.now(UTC) + lifetime,
        )
    )
    add_event(session, request, "login_succeeded")
    await session.commit()

    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(lifetime.total_seconds()),
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
    )
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> None:
    if token:
        await session.execute(
            delete(AuthSession).where(AuthSession.token_hash == hash_token(token))
        )
        await session.commit()
    response.delete_cookie(
        SESSION_COOKIE,
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
    )


@router.get("/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
