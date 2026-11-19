import re
from typing import Any, Dict


_CHOICE_KEYS = re.compile(r"color|colour|ram|memory|storage|capacity|size|variant|style|fit|pattern|finish|edition|waist|shoe", re.IGNORECASE)


def _normalized(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def find_variant_configuration(configurations: list, selected: Dict[str, str]):
    selected = selected or {}
    for configuration in configurations or []:
        options = configuration.get("options") or {}
        normalized_options = {_normalized(key): _normalized(value) for key, value in options.items()}
        normalized_selected = {_normalized(key): _normalized(value) for key, value in selected.items()}
        if normalized_options == normalized_selected:
            return configuration
    return None


def selected_variant_price(configurations: list, selected: Dict[str, str], fallback: float):
    configuration = find_variant_configuration(configurations, selected)
    try:
        return float(configuration["price"]) if configuration and configuration.get("price") is not None else fallback
    except (TypeError, ValueError):
        return fallback


def selected_variant_image(variant_images: Dict[str, Any], selected: Dict[str, str], configurations: list = None):
    configuration = find_variant_configuration(configurations, selected)
    if configuration:
        photos = configuration.get("images") or []
        main = configuration.get("main_image")
        if main:
            return main
        if photos:
            return photos[0]
    for key, choice in (selected or {}).items():
        image = (variant_images or {}).get(key, {}).get(choice)
        if isinstance(image, list):
            image = image[0] if image else None
        if image:
            return image
    return None


def validate_product_options(specifications: Dict[str, Any], selected: Dict[str, str], configurations: list = None) -> None:
    """Ensure submitted shopper choices exist in specs or saved variant configurations."""
    specs = dict(specifications or {})
    for configuration in configurations or []:
        for key, value in (configuration.get("options") or {}).items():
            current = specs.get(key, [])
            current_choices = current if isinstance(current, list) else re.split(r"[,|]", str(current))
            specs[key] = list(dict.fromkeys([*current_choices, str(value)]))
    for key, chosen in (selected or {}).items():
        if not _CHOICE_KEYS.search(key):
            raise ValueError(f"{key} is not a selectable product option")
        raw_options = specs.get(key)
        if raw_options is None:
            raise ValueError(f"{key} is no longer available for this product")
        choices = raw_options if isinstance(raw_options, list) else re.split(r"[,|]", str(raw_options))
        choices = {str(option).strip() for option in choices if str(option).strip()}
        if not choices or _normalized(chosen) not in {_normalized(option) for option in choices}:
            raise ValueError(f"Choose a valid option for {key}")

    for key, raw_options in specs.items():
        if not _CHOICE_KEYS.search(key):
            continue
        choices = raw_options if isinstance(raw_options, list) else re.split(r"[,|]", str(raw_options))
        if len([option for option in choices if str(option).strip()]) > 1 and key not in (selected or {}):
            raise ValueError(f"Choose an option for {key}")
