"""Configuración central: lee las claves desde el archivo .env de la raíz del repo."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    # NASA
    nasa_api_key: str = "DEMO_KEY"
    earthdata_username: str = ""
    earthdata_password: str = ""

    # Meteomatics
    meteomatics_username: str = ""
    meteomatics_password: str = ""

    # Google Cloud / Firebase
    google_application_credentials: str = ""
    firebase_project_id: str = ""
    gcs_bucket: str = ""

    # Microsoft Azure / Planetary Computer
    azure_storage_connection_string: str = ""
    pc_sdk_subscription_key: str = ""

    # IA (Claude). Opcional: sin clave, la app usa reglas y plantillas.
    anthropic_api_key: str = ""

    # API
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
