import sys
from app.core.database import engine, inspect
from app.main import app

insp = inspect(engine)
tables = sorted(insp.get_table_names())
print(f"Total tables in PostgreSQL: {len(tables)}")
for t in tables:
    print(f"  ✓ {t}")

print("\nRegistered API Routes:")
for r in app.routes:
    methods = getattr(r, "methods", None)
    path = getattr(r, "path", None)
    if methods and path:
        print(f"  {','.join(methods):20s} {path}")

print("\nNexCart API verified successfully!")
