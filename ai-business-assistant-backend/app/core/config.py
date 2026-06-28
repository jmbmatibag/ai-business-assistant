"""Application configuration, loaded from environment / .env."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database
    database_url: str = (
        "postgresql+psycopg2://aiba:aiba_dev_password@localhost:5432/aiba"
    )

    # Auth (used from Phase 2 onward)
    jwt_secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24 hours

    # AI engine (used from Phase 4 onward)
    anthropic_api_key: str = ""

    # Fernet key used to encrypt external data-source passwords at rest.
    # Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # Leave blank in dev to fall back to a deterministic key derived from jwt_secret_key.
    fernet_key: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
