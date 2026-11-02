from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.core.config import Settings
from app.core.security import hash_token
from app.db.session import SessionDep
from app.models import AuthSession, User

SESSION_COOKIE = "sendy_session"


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]


async def get_current_user(
    session: SessionDep,
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    user = None
    if token:
        user = await session.scalar(
            select(User)
            .join(AuthSession, AuthSession.user_id == User.id)
            .where(AuthSession.token_hash == hash_token(token), AuthSession.expires_at > func.now())
        )
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
