"""Shared room admission limits."""

# A room holds 3 to 10 members (one 3D seat and character each).
ROOM_CAPACITY = 10
# Authored scenario packages declare the larger group size they were written for; rooms stay at ROOM_CAPACITY.
SCENARIO_CAPACITY = 30
MINIMUM_TO_START = 3
PRESENCE_WINDOW_SECONDS = 30


def valid_unicode(value: str) -> bool:
    """Accept complete Unicode text without imposing a product length limit."""
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True
